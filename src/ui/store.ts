import { useSyncExternalStore } from 'react';
import type { GameState, LogItem, LogCategory } from '../engine/state';
import { logCategory } from '../engine/log';
import { newGame, NewGameOptions } from '../engine/state';
import type { ActionResult } from '../engine/result';
import { advanceDaySafe, simulateDaysSafe, lastLogIdOf, SimReport, DayFailure } from '../engine/simulation';
import { refreshListings } from '../engine/business/simulate';
import { updateProgression } from '../engine/progression/progression';
import { checkInvariants } from '../engine/invariants';
import { takeSnapshot } from '../engine/snapshot';
import { loadGame, saveGame, KV, serialize, listBackups, restoreBackup, deleteSlot, snapshotBeforeUpdate, collectRawCopies, rescueBundle, parseImport, slotKeys, allKeys, clearPreupdate, type LoadReport } from '../persistence/save';
import { readRegistry, writeRegistry, newSlotId, upsertSlot, removeSlot, MAX_SLOTS, type SlotRegistry, type SlotMeta } from '../persistence/slots';
import { balanceSheet } from '../engine/reports/statements';
import { offlineDays, DEFAULT_OFFLINE } from '../persistence/offline';
import { createStorage, exportToFile } from '../persistence/platformStorage';
import { APP_VERSION } from '../version';
import { syncSystemBars, syncThemeColor } from './systemBars';

export type Speed = 0 | 1 | 2 | 4 | 8;
export type PlaySpeed = Exclude<Speed, 0>;
/** Orden del botón de velocidad: 1× → 2× → 4× → 8× → 1×. */
export const NEXT_SPEED: Record<PlaySpeed, PlaySpeed> = { 1: 2, 2: 4, 4: 8, 8: 1 };
export type ThemeChoice = 'system' | 'light' | 'dark';

export type PauseCategory = LogCategory;

export interface Settings {
  theme: ThemeChoice;
  learningMode: boolean;
  autoPause: boolean;
  offlineMaxDays: number;
  alertCategories: string[];
  /** Velocidad base: milisegundos reales por día de juego a 1×. */
  msPerDay: number;
  /** Qué eventos pausan el tiempo (si la pausa automática está activa). */
  pauseOn: PauseCategory[];
  /** Mostrar avisos de confirmación de acciones exitosas. */
  successToasts: boolean;
  /** Accesibilidad y personalización de la interfaz. */
  fontScale: number;
  highContrast: boolean;
  reduceMotion: boolean;
  colorblind: boolean;
  density: 'comoda' | 'compacta';
  /** Mostrar todas las secciones sin recomendaciones por etapa (1.2). */
  showAllSections: boolean;
  /** Buscar actualizaciones al abrir la app (1.2). */
  autoUpdate: boolean;
  /** Velocidad con la que se reanuda el tiempo (la última elegida). */
  playSpeed: PlaySpeed;
  /** Hasta cuándo no recordar exportar la partida (ms reales). */
  exportReminderSnoozedUntil: number;
  /** Sonidos cortos al cobrar, cumplir metas y festejar (1.4). */
  sound: boolean;
  /** Vibración breve en los festejos (1.4, solo teléfonos). */
  haptics: boolean;
  /** Ajustes de 1.4 ya aplicados a una instalación anterior. */
  seen14?: boolean;
}

const SETTINGS_KEY = 'urt.settings';
const HOST_THEME = typeof document !== 'undefined' ? document.documentElement.getAttribute('data-theme') : null;
const DEFAULT_SETTINGS: Settings = {
  theme: 'system', learningMode: true, autoPause: true, offlineMaxDays: 30,
  alertCategories: ['liquidez', 'deuda', 'credito', 'ahorro', 'impuestos', 'carrera', 'bienestar', 'empresa', 'inversiones', 'inmuebles', 'legal', 'economia'],
  msPerDay: 2000, pauseOn: ['peligro', 'ofertas', 'logros', 'legal', 'decisiones'], successToasts: true,
  fontScale: 1, highContrast: false, reduceMotion: false, colorblind: false, density: 'comoda', showAllSections: false, autoUpdate: true, playSpeed: 1, exportReminderSnoozedUntil: 0, sound: false, haptics: true, seen14: true,
};

/** Milisegundos reales por día de juego a velocidad 1× (valor por defecto). */
export const MS_PER_DAY_1X = 2000;
/** Guardado automático por tiempo REAL (no por días de juego, que a 8× pasan en segundos). */
export const AUTOSAVE = { everyMs: 90 * 1000, afterActionMs: 3000 };

export interface Toast {
  id: number;
  text: string;
  tone: 'ok' | 'error' | 'info';
}

/** Un día de simulación que falló: la partida volvió al día anterior y el tiempo quedó en pausa. */
export interface SimError extends DayFailure {
  /** Dónde ocurrió: reloj, salto manual o días simulados mientras la app estaba cerrada. */
  context: 'tick' | 'step' | 'offline';
  /** Veces seguidas que falló el mismo día (para saber si reintentar tiene sentido). */
  attempts: number;
  at: number;
}

/** La partida no se pudo abrir al iniciar. */
export interface BootError {
  kind: 'unreadable' | 'storage' | 'timeout' | 'unexpected';
  message: string;
  details: string[];
}

export interface UIState {
  /** Sube con cada cambio de la interfaz (incluye avisos, guardado, ajustes…). */
  version: number;
  /** Sube solo cuando cambia la PARTIDA: es la clave de los cálculos derivados (useDerived). */
  gameRev: number;
  ready: boolean;
  state: GameState | null;
  speed: Speed;
  settings: Settings;
  toasts: Toast[];
  absence: SimReport | null;
  loadNotice: string | null;
  storageKind: string;
  lastSaved: number | null;
  saveError: string | null;
  saveBytes: number | null;
  simError: SimError | null;
  bootError: BootError | null;
  /** Partidas guardadas en este dispositivo. */
  slots: SlotMeta[];
  /** Partida abierta (o la que se intentó abrir). */
  activeSlot: string | null;
  /** Al elegir "Nueva partida" con otra abierta: a cuál se puede volver. */
  returnSlot: string | null;
}

/** Texto para soporte: qué falló, dónde y en qué versión (sin datos personales). */
export function errorReport(e: { name: string; message: string; stack: string | null }, extra: Record<string, string | number | undefined>): string {
  const lines = [`${e.name}: ${e.message}`, ...Object.entries(extra).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${v}`)];
  if (e.stack) lines.push('', e.stack);
  return lines.join('\n');
}

async function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new BootTimeout(what)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

class BootTimeout extends Error {
  constructor(what: string) {
    super(`${what} no respondió a tiempo.`);
    this.name = 'BootTimeout';
  }
}

/** Tiempos máximos del arranque: nunca debe quedar "Cargando…" para siempre. */
export const BOOT_TIMEOUTS = { storage: 15000, load: 30000 };

type Listener = () => void;

/** Cálculo puro a partir de la partida y parámetros serializables. */
export type Derivation<A extends unknown[], T> = (s: GameState, ...args: A) => T;

/** Categoría de pausa de un evento del registro (null = no pausa). Es la del motor: explícita, no por ícono. */
export const pauseCategory = logCategory;

export interface StoreOptions {
  /** Cómo se simula un día (las pruebas lo reemplazan para provocar fallas). */
  step?: (s: GameState) => void;
}

export class GameStore {
  constructor(private readonly opts: StoreOptions = {}) {}
  private listeners = new Set<Listener>();
  private kv: KV | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastTick = 0;
  private accumulator = 0;
  private dirty = false;
  private toastId = 1;
  private listenersAttached = false;
  private registry: SlotRegistry = { version: 1, active: null, slots: [] };
  /** Guardado en curso (candado: nunca dos guardados a la vez). */
  private saving: Promise<boolean> | null = null;
  private saveAgain = false;
  private lastSaveAttempt = 0;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  ui: UIState = {
    version: 0, gameRev: 0, ready: false, state: null, speed: 0, settings: DEFAULT_SETTINGS, toasts: [], absence: null, loadNotice: null, storageKind: '', lastSaved: null, saveError: null, saveBytes: null, simError: null, bootError: null, slots: [], activeSlot: null, returnSlot: null,
  };

  subscribe = (l: Listener) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };
  getSnapshot = () => this.ui;

  /** La partida cambió: hay que guardarla y recalcular lo derivado. */
  private changed = false;
  private revState: GameState | null = null;
  private touch() {
    this.dirty = true;
    this.changed = true;
  }

  private emit() {
    let gameRev = this.ui.gameRev;
    if (this.changed || this.ui.state !== this.revState) {
      gameRev++;
      this.changed = false;
      this.revState = this.ui.state;
    }
    this.ui = { ...this.ui, version: this.ui.version + 1, gameRev };
    for (const l of this.listeners) l();
  }

  // ---------- Cálculos derivados ----------
  private derivedRev = -1;
  private derived = new Map<Derivation<never[], unknown>, Map<string, unknown>>();

  /**
   * Valor derivado de la partida, calculado UNA vez por cambio de la partida y
   * compartido entre todos los componentes que lo pidan (ver useDerived).
   * `fn` debe ser una función pura y estable (definida a nivel de módulo).
   */
  derive<A extends unknown[], T>(fn: Derivation<A, T>, args: A): T {
    const s = this.ui.state;
    if (!s) throw new Error('No hay una partida abierta.');
    if (this.derivedRev !== this.ui.gameRev || this.revState !== s) {
      this.derived.clear();
      this.derivedRev = this.ui.gameRev;
    }
    const f = fn as unknown as Derivation<never[], unknown>;
    let byArgs = this.derived.get(f);
    if (!byArgs) this.derived.set(f, (byArgs = new Map()));
    const key = args.length ? JSON.stringify(args) : '';
    if (byArgs.has(key)) return byArgs.get(key) as T;
    const value = fn(s, ...args);
    byArgs.set(key, value);
    return value;
  }

  // ---------- Arranque ----------
  /**
   * Arranque. Nunca queda colgado: cualquier falla del almacenamiento, de la
   * carga, de una migración o de la simulación sin conexión termina en una
   * partida abierta o en `bootError` (pantalla "No pudimos abrir tu partida").
   */
  async boot() {
    this.loadSettings();
    await this.loadFromStorage();
    this.ui.ready = true;
    this.applyTheme();
    this.emit();
    this.startClock();
    if (!this.listenersAttached && typeof document !== 'undefined') {
      this.listenersAttached = true;
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void this.save();
      });
      window.addEventListener('pagehide', () => void this.save());
      // Con el tema "Sistema", seguir al teléfono si cambia entre claro y oscuro.
      window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener?.('change', () => syncThemeColor());
    }
  }

  private loadSettings() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) {
        this.ui.settings = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
        // Categorías nuevas se activan por defecto al actualizar.
        for (const c of ['empresa', 'inversiones', 'inmuebles', 'legal', 'economia']) if (!this.ui.settings.alertCategories.includes(c)) this.ui.settings.alertCategories.push(c);
        // 1.4: las decisiones con plazo pausan el tiempo por defecto (una sola vez, al actualizar).
        if (!this.ui.settings.seen14) {
          if (!this.ui.settings.pauseOn.includes('decisiones')) this.ui.settings.pauseOn = [...this.ui.settings.pauseOn, 'decisiones'];
          this.ui.settings.seen14 = true;
        }
      }
    } catch {
      /* ajustes por defecto */
    }
  }

  private async loadFromStorage() {
    this.ui.bootError = null;
    try {
      if (!this.kv) {
        const storage = await withTimeout(createStorage(), BOOT_TIMEOUTS.storage, 'El almacenamiento del dispositivo');
        this.kv = storage.kv;
        this.ui.storageKind = storage.kind;
      }
      this.registry = await withTimeout(readRegistry(this.kv), BOOT_TIMEOUTS.load, 'El índice de partidas');
      this.syncSlots();
      const active = this.registry.active;
      if (!active) return;
      const report = await withTimeout(loadGame(this.kv, slotKeys(active)), BOOT_TIMEOUTS.load, 'La lectura de la partida');
      if (report.state) await this.applyLoaded(report);
      else if (report.problems.length) this.ui.bootError = { kind: 'unreadable', message: 'Encontramos tu partida, pero ninguna de sus copias se pudo leer.', details: report.problems };
    } catch (e) {
      const err = e as Error;
      const kind: BootError['kind'] = err?.name === 'BootTimeout' ? 'timeout' : this.kv ? 'unexpected' : 'storage';
      const message = kind === 'timeout' ? `${err.message} Puede ser un problema momentáneo del teléfono.` : kind === 'storage' ? 'No se pudo acceder al almacenamiento del dispositivo.' : 'Ocurrió un error inesperado al abrir la partida.';
      this.ui.bootError = { kind, message, details: [`${err?.name ?? 'Error'}: ${err?.message ?? String(e)}`] };
    }
  }

  /** Abre una partida ya leída: avisos de recuperación y días transcurridos mientras estaba cerrada. */
  private async applyLoaded(report: LoadReport) {
    const state = report.state!;
    this.ui.state = state;
    this.ui.absence = null;
    this.ui.simError = null;
    if (!state.listings.length) refreshListings(state);
    const notices: string[] = [];
    const k = slotKeys(this.registry.active ?? undefined);
    if (report.recovered && report.source === k.preupdate) notices.push('Se cargó la copia guardada justo antes de la última actualización.');
    else if (report.recovered && report.source === k.prerestore) notices.push('Se cargó la copia guardada antes de la última restauración.');
    else if (report.recovered) notices.push(`La partida principal no se pudo leer o era más vieja; se recuperó la copia de seguridad más reciente (${report.source}).`);
    if (report.migratedFrom !== null) notices.push(`Partida actualizada desde la versión ${report.migratedFrom}.`);
    this.ui.loadNotice = notices.join(' ') || null;
    const days = offlineDays(state.meta.lastRealTime, Date.now(), { ...DEFAULT_OFFLINE, maxDays: this.ui.settings.offlineMaxDays });
    if (days > 0) {
      const run = simulateDaysSafe(state, days, this.opts.step);
      this.ui.state = run.state;
      this.ui.absence = run.daysDone > 0 ? run.report : null;
      if (run.failure) this.onSimFailure(run.failure, 'offline');
      await this.save();
    }
  }

  private syncSlots() {
    this.ui.slots = this.registry.slots;
    this.ui.activeSlot = this.registry.active;
  }

  private async setRegistry(r: SlotRegistry) {
    this.registry = r;
    this.syncSlots();
    if (this.kv) await writeRegistry(this.kv, r);
  }

  private keys() {
    return slotKeys(this.registry.active ?? undefined);
  }

  /** Vuelve a intentar abrir la partida desde la pantalla de error de arranque. */
  async retryBoot() {
    this.ui.ready = false;
    this.emit();
    await this.loadFromStorage();
    this.ui.ready = true;
    this.emit();
  }

  /**
   * Desde la pantalla de error de arranque: ir a "partida nueva" SIN borrar
   * nada. La partida que no se pudo leer sigue guardada en su ranura.
   */
  startOverAfterBootError() {
    this.ui.bootError = null;
    this.ui.returnSlot = null;
    this.emit();
  }

  /** Exporta el texto crudo de todas las copias de la partida, aunque estén dañadas. */
  async exportRawCopies(): Promise<void> {
    if (!this.kv) {
      this.toast('No hay acceso al almacenamiento para leer las copias.', 'error');
      return;
    }
    const copies = await collectRawCopies(this.kv, allKeys(this.keys()));
    if (!Object.keys(copies).length) {
      this.toast('No hay copias guardadas en este dispositivo.', 'info');
      return;
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const r = await exportToFile(rescueBundle(copies, Date.now(), APP_VERSION), `urt-copias-${stamp}.json`);
    this.toast(r.message, r.ok ? 'ok' : 'error');
  }

  // ---------- Partidas (ranuras) ----------
  /** ¿Hay lugar para otra partida? */
  canCreateSlot(): boolean {
    return this.registry.slots.length < MAX_SLOTS;
  }

  /**
   * Crea una partida nueva en una ranura NUEVA: nunca reemplaza ni borra otra
   * partida ni sus copias. Devuelve false si ya hay el máximo de partidas.
   */
  async startNewGame(opts: NewGameOptions): Promise<boolean> {
    if (!this.canCreateSlot()) {
      this.toast(`Ya tenés ${MAX_SLOTS} partidas guardadas. Borrá una en "Tus partidas" para empezar otra.`, 'error');
      return false;
    }
    const now = Date.now();
    const state = newGame({ ...opts, nowReal: now, seed: opts.seed || `${opts.name}-${now}` });
    refreshListings(state);
    updateProgression(state);
    const id = newSlotId(this.registry, now);
    await this.setRegistry(upsertSlot({ ...this.registry, active: id }, { id, name: state.player.name, day: 0, netWorth: null, savedAt: now, createdAt: now }));
    this.ui.state = state;
    this.ui.absence = null;
    this.ui.simError = null;
    this.ui.loadNotice = null;
    this.ui.returnSlot = null;
    this.ui.speed = 0;
    this.touch();
    this.emit();
    await this.save();
    return true;
  }

  /** "Nueva partida" con otra abierta: la actual se guarda y queda en su ranura. */
  async requestNewGame() {
    await this.save();
    this.setSpeed(0);
    this.ui.returnSlot = this.registry.active;
    this.ui.state = null;
    this.ui.absence = null;
    this.ui.simError = null;
    this.ui.loadNotice = null;
    this.emit();
  }

  /** Abre otra partida guardada (la actual se guarda antes). */
  async openSlot(id: string): Promise<boolean> {
    if (!this.kv || !this.registry.slots.some((x) => x.id === id)) return false;
    if (this.ui.state && this.registry.active !== id) await this.save();
    this.setSpeed(0);
    const report = await loadGame(this.kv, slotKeys(id));
    if (!report.state) {
      this.toast(`No se pudo abrir esa partida: ${report.problems[0] ?? 'no tiene copias'}. Podés exportar sus copias desde la lista.`, 'error');
      return false;
    }
    await this.setRegistry({ ...this.registry, active: id });
    this.ui.returnSlot = null;
    this.ui.bootError = null;
    await this.applyLoaded(report);
    this.dirty = false;
    this.emit();
    return true;
  }

  /** Borra una partida guardada que NO es la abierta (con todas sus copias). */
  async deleteSlotById(id: string): Promise<boolean> {
    if (!this.kv || (this.ui.state && this.registry.active === id)) return false;
    await deleteSlot(this.kv, slotKeys(id));
    await this.setRegistry(removeSlot(this.registry, id));
    if (this.ui.returnSlot === id) this.ui.returnSlot = null;
    this.emit();
    return true;
  }

  /** Exporta las copias crudas de cualquier partida guardada (aunque no se pueda abrir). */
  async exportSlotCopies(id: string): Promise<void> {
    if (!this.kv) return;
    const copies = await collectRawCopies(this.kv, allKeys(slotKeys(id)));
    const meta = this.registry.slots.find((x) => x.id === id);
    const safe = (meta?.name ?? 'partida').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
    const r = await exportToFile(rescueBundle(copies, Date.now(), APP_VERSION), `urt-${safe}-copias.json`);
    this.toast(r.message, r.ok ? 'ok' : 'error');
  }

  /**
   * Ejecuta una acción del jugador de forma atómica: si falla con una
   * excepción, el estado vuelve exactamente a como estaba.
   */
  run(fn: (s: GameState) => ActionResult | void, opts: { toast?: boolean } = {}): ActionResult {
    const s = this.ui.state;
    if (!s) return { ok: false, error: 'No hay partida.' };
    const snap = takeSnapshot(s);
    let r: ActionResult;
    try {
      r = fn(s) ?? { ok: true };
      updateProgression(s);
    } catch (e) {
      this.ui.state = snap.restore();
      r = { ok: false, error: `No se pudo completar la operación: ${(e as Error).message}` };
    }
    if (opts.toast !== false) {
      if (!r.ok) this.toast(r.error, 'error');
      else if (r.message && this.ui.settings.successToasts) this.toast(r.message, 'ok');
    }
    this.touch();
    // Una acción que cambió la partida se guarda poco después (sin esperar el guardado periódico).
    if (r.ok) this.scheduleSave(AUTOSAVE.afterActionMs);
    this.emit();
    return r;
  }

  /**
   * Cambio liviano de la partida que solo afecta a la interfaz (cerrar un festejo,
   * marcar un paso de la guía): sin recalcular progreso ni etapas.
   */
  quick(fn: (s: GameState) => void): void {
    const s = this.ui.state;
    if (!s) return;
    fn(s);
    this.touch();
    this.emit();
  }

  markSeen(term: string) {
    const s = this.ui.state;
    if (!s || s.meta.seenTerms.includes(term)) return;
    s.meta.seenTerms.push(term);
    this.touch();
    this.emit();
  }

  private isImportant(l: LogItem): boolean {
    const c = pauseCategory(l);
    return c !== null && this.ui.settings.pauseOn.includes(c);
  }

  // ---------- Tiempo ----------
  /** Play/Pausa: reanuda con la última velocidad elegida. */
  togglePlay() {
    this.setSpeed(this.ui.speed === 0 ? this.ui.settings.playSpeed : 0);
  }

  /** Botón de velocidad: 1× → 2× → 4× → 8× → 1×. Si el tiempo corre, se aplica ya. */
  cycleSpeed() {
    const next = NEXT_SPEED[this.ui.settings.playSpeed] ?? 1;
    if (this.ui.speed !== 0) this.setSpeed(next);
    else this.updateSettings({ playSpeed: next });
  }

  setSpeed(speed: Speed) {
    if (speed !== 0 && speed !== this.ui.settings.playSpeed) this.updateSettings({ playSpeed: speed });
    const pausing = speed === 0 && this.ui.speed !== 0;
    this.ui.speed = speed;
    this.accumulator = 0;
    this.lastTick = performance.now();
    this.emit();
    if (pausing && this.dirty) void this.save();
  }

  /**
   * Avanza días de a uno y de forma atómica. Si un día falla, la partida queda
   * en el día anterior, el tiempo se pausa y se muestra un error recuperable.
   * Devuelve cuántos días se completaron.
   */
  private runDays(days: number, context: SimError['context'], stopOnImportant: boolean): number {
    let done = 0;
    for (let i = 0; i < days; i++) {
      const s = this.ui.state;
      if (!s) break;
      const before = lastLogIdOf(s);
      const r = advanceDaySafe(s, this.opts.step);
      if (!r.ok) {
        this.ui.state = r.state;
        this.onSimFailure(r.failure, context);
        break;
      }
      done++;
      // Los saltos se detienen ante un evento importante para que no se pierdan ofertas ni alertas.
      if (stopOnImportant && i < days - 1) {
        const hit = s.log.find((l) => l.id > before && this.isImportant(l));
        if (hit) {
          this.toast(`Salto detenido: ${hit.text}`, hit.kind === 'danger' ? 'error' : 'info');
          break;
        }
      }
    }
    return done;
  }

  private onSimFailure(f: DayFailure, context: SimError['context']) {
    const prev = this.ui.simError;
    const attempts = prev && prev.day === f.day ? prev.attempts + 1 : 1;
    this.ui.simError = { ...f, context, attempts, at: Date.now() };
    this.ui.speed = 0;
    this.accumulator = 0;
    console.error(`[URT] Falló la simulación del día ${f.day}:`, f.message, f.stack ?? '');
    // La partida restaurada es consistente: se guarda para no perder el progreso previo.
    if (this.ui.ready) void this.save();
  }

  /** Vuelve a intentar el día que falló (la partida ya está restaurada, así que es seguro). */
  retrySimDay() {
    if (!this.ui.state) return;
    const lastId = lastLogIdOf(this.ui.state);
    const done = this.runDays(1, 'step', false);
    if (done) this.ui.simError = null;
    this.afterAdvance(done, lastId);
  }

  dismissSimError() {
    this.ui.simError = null;
    this.emit();
  }

  /** Un error de la interfaz: se pausa el tiempo para que nada avance sin que el jugador lo vea. */
  pauseForError(error: Error) {
    console.error('[URT] Error de interfaz:', error);
    if (this.ui.speed !== 0) {
      this.ui.speed = 0;
      this.accumulator = 0;
      this.emit();
    }
  }

  step(days: number) {
    const s = this.ui.state;
    if (!s || this.ui.simError) return;
    const lastId = lastLogIdOf(s);
    const done = this.runDays(days, 'step', this.ui.settings.autoPause);
    this.afterAdvance(done, lastId);
    // Un salto de días es progreso importante: se guarda enseguida.
    if (done > 0) this.scheduleSave(AUTOSAVE.afterActionMs);
  }

  /** Detiene el reloj (pruebas y cierre). */
  stopClock() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private startClock() {
    if (this.timer) return;
    this.lastTick = performance.now();
    this.timer = setInterval(() => this.tick(), 100);
  }

  private tick() {
    const now = performance.now();
    const dt = now - this.lastTick;
    this.lastTick = now;
    if (this.dirty && this.ui.state && Date.now() - this.lastSaveAttempt >= AUTOSAVE.everyMs) void this.save();
    const s = this.ui.state;
    if (!s || this.ui.speed === 0 || this.ui.simError) return;
    this.accumulator += dt * this.ui.speed;
    const ms = this.ui.settings.msPerDay || MS_PER_DAY_1X;
    let days = Math.floor(this.accumulator / ms);
    if (days <= 0) return;
    this.accumulator -= days * ms;
    days = Math.min(days, 8);
    const lastId = lastLogIdOf(s);
    const done = this.runDays(days, 'tick', false);
    this.afterAdvance(done, lastId);
  }

  private afterAdvance(days: number, lastLogId: number) {
    const s = this.ui.state!;
    if (days > 0) this.touch();
    if (this.ui.settings.autoPause && this.ui.speed !== 0) {
      const fresh = s.log.filter((l) => l.id > lastLogId);
      const important = fresh.find((l) => this.isImportant(l));
      if (important) {
        this.ui.speed = 0;
        this.toast(`Pausa automática: ${important.text}`, important.kind === 'danger' ? 'error' : 'info');
        void this.save();
      }
    }
    this.emit();
  }

  // ---------- Guardado ----------
  /**
   * Guarda la partida abierta. Nunca hay dos guardados a la vez: si se pide
   * otro mientras uno está en curso, se hace UNO más al terminar (con el estado
   * más reciente) y todos los que esperaban reciben su resultado.
   */
  save(): Promise<boolean> {
    if (this.saving) {
      this.saveAgain = true;
      return this.saving;
    }
    const run = async () => {
      let ok: boolean;
      do {
        this.saveAgain = false;
        ok = await this.saveOnce();
      } while (this.saveAgain);
      return ok;
    };
    this.saving = run().finally(() => {
      this.saving = null;
    });
    return this.saving;
  }

  /** Programa un guardado (se agrupan los pedidos cercanos). */
  private scheduleSave(ms: number) {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (this.dirty) void this.save();
    }, ms);
  }

  private async saveOnce(): Promise<boolean> {
    const s = this.ui.state;
    const active = this.registry.active;
    if (!s || !this.kv || !active) return false;
    this.lastSaveAttempt = Date.now();
    const now = Date.now();
    this.dirty = false;
    let r: Awaited<ReturnType<typeof saveGame>>;
    try {
      r = await saveGame(this.kv, s, now, slotKeys(active));
    } catch (e) {
      r = { ok: false, error: `No se pudo guardar: ${(e as Error).message}` };
    }
    if (r.ok) {
      this.ui.lastSaved = now;
      this.ui.saveBytes = r.bytes;
      this.ui.saveError = null;
      const prev = this.registry.slots.find((x) => x.id === active);
      let netWorth: number | null;
      try {
        netWorth = balanceSheet(s).netWorth;
      } catch {
        netWorth = null;
      }
      try {
        await this.setRegistry(upsertSlot(this.registry, { id: active, name: s.player.name, day: s.day, netWorth, savedAt: now, createdAt: prev?.createdAt ?? now, exportedAt: prev?.exportedAt }));
      } catch {
        /* el índice se reconstruye desde las copias si hiciera falta */
      }
    } else {
      this.dirty = true;
      this.ui.saveError = r.error;
      this.toast(r.error, 'error');
    }
    this.emit();
    return r.ok;
  }

  isDirty() {
    return this.dirty;
  }

  /** Antes de cambiar de versión: pausa, guarda y deja una copia verificada "antes de actualizar". */
  async saveForUpdate(): Promise<boolean> {
    this.setSpeed(0);
    if (!this.kv) return false;
    if (!this.ui.state) return true;
    if (!(await this.save())) return false;
    try {
      return await snapshotBeforeUpdate(this.kv, this.keys());
    } catch {
      return false;
    }
  }

  /** La actualización se confirmó: la copia "antes de actualizar" ya no hace falta. */
  async onUpdateConfirmed(): Promise<void> {
    if (!this.kv) return;
    for (const slot of this.registry.slots) {
      try {
        await clearPreupdate(this.kv, slotKeys(slot.id));
      } catch {
        /* no crítico */
      }
    }
  }

  exportText(): string | null {
    return this.ui.state ? serialize(this.ui.state, Date.now()) : null;
  }

  async exportFile(): Promise<void> {
    const text = this.exportText();
    if (!text || !this.ui.state) return;
    const safe = this.ui.state.player.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'partida';
    const r = await exportToFile(text, `urt-${safe}-dia-${this.ui.state.day}.json`);
    this.toast(r.message, r.ok ? 'ok' : 'error');
    const meta = this.registry.slots.find((x) => x.id === this.ui.activeSlot);
    if (r.ok && meta) {
      try {
        await this.setRegistry(upsertSlot(this.registry, { ...meta, exportedAt: Date.now() }));
      } catch {
        /* solo afecta al recordatorio */
      }
    }
  }

  /** Metadatos de la partida abierta (para el recordatorio de exportar). */
  activeSlotMeta(): SlotMeta | undefined {
    return this.ui.slots.find((x) => x.id === this.ui.activeSlot);
  }

  /**
   * Importa una partida como partida NUEVA (otra ranura): la que estaba abierta
   * queda guardada. Si ya hay el máximo de partidas, no importa nada.
   */
  async importText(text: string): Promise<ActionResult> {
    const r = await parseImport(text.trim());
    if (!r.ok) {
      this.toast(`No se pudo importar: ${r.error}`, 'error');
      return { ok: false, error: r.error };
    }
    if (!this.canCreateSlot()) {
      const error = `Ya tenés ${MAX_SLOTS} partidas guardadas. Borrá una en "Tus partidas" para importar otra.`;
      this.toast(error, 'error');
      return { ok: false, error };
    }
    if (this.ui.state) await this.save();
    const now = Date.now();
    const id = newSlotId(this.registry, now);
    await this.setRegistry(upsertSlot({ ...this.registry, active: id }, { id, name: r.state.player.name, day: r.state.day, netWorth: null, savedAt: now, createdAt: now }));
    this.ui.state = r.state;
    this.ui.simError = null;
    this.ui.bootError = null;
    this.ui.absence = null;
    this.ui.loadNotice = null;
    this.ui.returnSlot = null;
    this.ui.speed = 0;
    this.touch();
    await this.save();
    this.toast('Partida importada y verificada. Se abrió como una partida nueva.', 'ok');
    this.emit();
    return { ok: true, message: 'Partida importada.' };
  }

  async backups() {
    return this.kv ? listBackups(this.kv, this.keys()) : [];
  }

  /** Restaura una copia; la partida actual queda en "antes de restaurar" (se puede deshacer). */
  async restore(key: string): Promise<ActionResult> {
    if (!this.kv) return { ok: false, error: 'Sin almacenamiento.' };
    const r = await restoreBackup(this.kv, key, this.keys());
    if (!r.ok) return { ok: false, error: r.error };
    this.ui.state = r.state;
    this.ui.simError = null;
    this.ui.speed = 0;
    this.touch();
    await this.save();
    this.emit();
    return { ok: true, message: 'Copia restaurada. La partida anterior quedó en «Antes de restaurar» por si querés volver.' };
  }

  audit(): string[] {
    return this.ui.state ? checkInvariants(this.ui.state) : [];
  }

  // ---------- Interfaz ----------
  updateSettings(patch: Partial<Settings>) {
    this.ui.settings = { ...this.ui.settings, ...patch };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.ui.settings));
    } catch {
      /* sin almacenamiento */
    }
    this.applyTheme();
    this.emit();
  }

  private applyTheme() {
    const st = this.ui.settings;
    const t = st.theme;
    const root = document.documentElement;
    // "Sistema" respeta el tema que haya fijado el entorno anfitrión (si lo hay).
    if (t === 'system') {
      if (HOST_THEME) root.setAttribute('data-theme', HOST_THEME);
      else root.removeAttribute('data-theme');
    } else root.setAttribute('data-theme', t);
    const flag = (name: string, on: boolean, value = '1') => (on ? root.setAttribute(name, value) : root.removeAttribute(name));
    flag('data-contrast', st.highContrast, 'high');
    flag('data-cb', st.colorblind);
    flag('data-motion', st.reduceMotion, 'reduce');
    flag('data-density', st.density === 'compacta', 'compact');
    root.style.setProperty('--ui-zoom', String(st.fontScale || 1));
    void syncSystemBars(t);
    syncThemeColor();
  }

  toast(text: string, tone: Toast['tone'] = 'info') {
    if (this.ui.toasts.some((t) => t.text === text)) return;
    const id = this.toastId++;
    this.ui.toasts = [...this.ui.toasts.slice(-1), { id, text, tone }];
    this.emit();
    setTimeout(() => {
      this.ui.toasts = this.ui.toasts.filter((t) => t.id !== id);
      this.emit();
    }, tone === 'error' ? 5000 : 3200);
  }

  dismissToast(id: number) {
    this.ui.toasts = this.ui.toasts.filter((t) => t.id !== id);
    this.emit();
  }

  dismissAbsence() {
    this.ui.absence = null;
    this.emit();
  }

  dismissNotice() {
    this.ui.loadNotice = null;
    this.emit();
  }
}

export const store = new GameStore();

export function useUI(): UIState {
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}

/**
 * Cálculo derivado de la partida (métricas, informes, asesor…): se recalcula
 * solo cuando cambia la partida, no con cada aviso o guardado, y se comparte
 * entre componentes. Los parámetros forman parte de la clave del caché.
 */
export function useDerived<A extends unknown[], T>(fn: Derivation<A, T>, ...args: A): T {
  useUI();
  return store.derive(fn, args);
}

/** Estado de juego garantizado (usar solo dentro de pantallas con partida activa). */
export function useGame(): GameState {
  return useUI().state as GameState;
}
