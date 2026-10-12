import { APP_VERSION, WEB_BUILD } from '../version';
import { verifySignedManifest } from './otaSignature';

/**
 * Actualizaciones por internet (sin reinstalar la APK).
 *
 * El juego es una sola página web empaquetada dentro de la app. Cada versión nueva
 * de esa página la publica el CI en la rama `ota-channel`, con un manifiesto FIRMADO
 * (ECDSA P-256, ver otaSignature.ts) que indica número de versión, tamaño y huella
 * SHA-256. La app:
 *   1. descarga el manifiesto, verifica la firma con la clave pública embebida y, si
 *      hay una versión mayor compatible con la APK instalada, se la ofrece al jugador;
 *   2. descarga la página, comprueba tamaño y huella, y la guarda en los archivos
 *      privados de la app;
 *   3. guarda la partida y una copia "antes de actualizar";
 *   4. abre la versión nueva SIN hacerla permanente todavía;
 *   5. la versión nueva, cuando carga la partida y funciona unos segundos sin
 *      errores, se confirma a sí misma (queda como la versión de arranque).
 * Si la versión nueva falla antes de confirmarse, vuelve a la anterior. Si la app se
 * cierra justo durante la confirmación (la versión nueva ya había cargado bien), al
 * volver a abrirla se retoma la versión nueva en lugar de marcarla como fallida; solo
 * se da por fallida si nunca llegó a funcionar o si arrancó varias veces sin confirmarse.
 * La red tiene tiempos máximos y reintentos. La partida vive fuera de la página
 * (archivos de la app), así que no se pierde.
 */

export const OTA_REPO = 'pbarahona12/gametc';
/**
 * Canal firmado: rama que publica el CI (solo desde main) con el manifiesto firmado y
 * los archivos de cada versión. La carpeta ota/ de main queda solo como puente para
 * las versiones 1.2 y anteriores (que no verifican firmas).
 */
export const OTA_CHANNEL = 'ota-channel';
export const OTA_BASE = `https://raw.githubusercontent.com/${OTA_REPO}/${OTA_CHANNEL}/`;
/** Descarga de la APK nueva cuando una versión necesita cambios nativos (solo la variante de GitHub). */
export const APK_DOWNLOAD_URL: string | null = `https://github.com/${OTA_REPO}/releases/latest`;
const PREF_KEY = 'urt.ota';
const CONFIRM_AFTER_MS = 6000;
/** Tiempos y reintentos de red (la conexión del teléfono puede ser mala o cortarse). */
export const OTA_NET = { manifestTimeoutMs: 15000, stallTimeoutMs: 30000, retries: 2, retryDelayMs: 1500 };
/** Arranques sin confirmar que se toleran antes de dar por fallida una versión. */
const MAX_UNCONFIRMED_STARTS = 3;

export interface OtaManifest {
  format: 'urt-ota';
  version: string;
  build: number;
  /** versionCode mínimo de la APK (si cambia algo nativo, hace falta una APK nueva). */
  minNativeCode: number;
  /** Nombre del archivo dentro de ota/. */
  file: string;
  sha256: string;
  size: number;
  date: string;
  notes: string[];
}

interface PendingUpdate {
  build: number;
  version: string;
  path: string;
  prevPath: string;
  fromVersion: string;
  at: number;
  notes: string[];
  /** Veces que la versión nueva llegó a arrancar sin confirmarse todavía. */
  starts?: number;
  /** La versión nueva cargó la partida y dibujó la interfaz (aunque no alcanzó a confirmarse). */
  healthyAt?: number;
}

interface OtaPrefs {
  pending?: PendingUpdate;
  failed: number[];
  current?: number;
  justUpdated?: { from: string; to: string; notes: string[] };
  rolledBack?: { version: string; reason: string };
  lastCheck?: number;
}

export type OtaCheck =
  | { kind: 'web' }
  | { kind: 'none'; latest: string }
  | { kind: 'available'; manifest: OtaManifest }
  | { kind: 'needs-apk'; manifest: OtaManifest; nativeCode: number }
  | { kind: 'failed-before'; manifest: OtaManifest }
  | { kind: 'error'; message: string };

/** ¿El manifiesto ofrece algo instalable para esta app? (lógica pura, probada en tests). */
export function evaluateManifest(m: unknown, ctx: { webBuild: number; nativeCode: number; failed: number[]; manual: boolean }): OtaCheck {
  const man = m as OtaManifest;
  if (!man || man.format !== 'urt-ota' || typeof man.build !== 'number' || typeof man.file !== 'string' || !/^[\w.-]+\.html$/.test(man.file) || !/^[0-9a-f]{64}$/.test(man.sha256 ?? '')) {
    return { kind: 'error', message: 'El manifiesto de actualización no es válido.' };
  }
  if (man.build <= ctx.webBuild) return { kind: 'none', latest: man.version };
  if (ctx.nativeCode < (man.minNativeCode ?? 0)) return { kind: 'needs-apk', manifest: man, nativeCode: ctx.nativeCode };
  if (ctx.failed.includes(man.build) && !ctx.manual) return { kind: 'failed-before', manifest: man };
  return { kind: 'available', manifest: man };
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Qué hacer al arrancar con una actualización pendiente (lógica pura, probada en tests). */
export type BootDecision =
  | { kind: 'none' }
  | { kind: 'watch' }
  | { kind: 'resume'; path: string }
  | { kind: 'failed'; reason: string; rollback: boolean };

export function decideBoot(pending: PendingUpdate | undefined, webBuild: number): BootDecision {
  if (!pending) return { kind: 'none' };
  const starts = pending.starts ?? 0;
  if (pending.build === webBuild) {
    // Esta página ES la versión pendiente.
    if (starts >= MAX_UNCONFIRMED_STARTS) return { kind: 'failed', reason: 'La versión nueva arrancó varias veces sin poder confirmarse.', rollback: true };
    return { kind: 'watch' };
  }
  // Arrancó otra versión (la anterior): el cambio todavía no era permanente.
  if (pending.healthyAt && starts < MAX_UNCONFIRMED_STARTS) return { kind: 'resume', path: pending.path };
  return { kind: 'failed', reason: 'La versión nueva no terminó de iniciar.', rollback: false };
}

/** Error de red que vale la pena reintentar (no los de integridad del archivo). */
class NetError extends Error {}

/** fetch con tiempo máximo y reintentos ante fallas de red o del servidor (5xx). */
async function fetchRetry(url: string, timeoutMs: number): Promise<Response> {
  let last: unknown = null;
  for (let attempt = 0; attempt <= OTA_NET.retries; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, OTA_NET.retryDelayMs * attempt));
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { cache: 'no-store', signal: ctrl.signal });
      if (res.status >= 500) throw new NetError(`el servidor respondió ${res.status}`);
      if (!res.ok) throw new Error(`el servidor respondió ${res.status}`);
      return res;
    } catch (e) {
      last = e;
      const retryable = e instanceof NetError || (e as Error).name === 'AbortError' || e instanceof TypeError;
      if (!retryable) throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  const err = last as Error;
  throw new Error(err?.name === 'AbortError' ? 'la conexión tardó demasiado' : err?.message ?? 'sin conexión');
}

/** Lee el cuerpo con barra de progreso y corta si deja de llegar información. */
async function readBody(res: Response, total: number, onProgress: (p: number) => void): Promise<string> {
  if (!res.body || !total) return res.text();
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    let stall: ReturnType<typeof setTimeout> | undefined;
    const stalled = new Promise<never>((_, reject) => {
      stall = setTimeout(() => reject(new NetError('la descarga se detuvo')), OTA_NET.stallTimeoutMs);
    });
    try {
      const { done, value } = await Promise.race([reader.read(), stalled]);
      if (done) break;
      chunks.push(value);
      got += value.length;
      onProgress(Math.min(0.99, got / total));
    } catch (e) {
      void reader.cancel().catch(() => undefined);
      throw e;
    } finally {
      clearTimeout(stall);
    }
  }
  const all = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) {
    all.set(c, o);
    o += c.length;
  }
  return new TextDecoder().decode(all);
}

// ------------------------------------------------------------------ plataforma

async function native(): Promise<boolean> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

async function readPrefs(): Promise<OtaPrefs> {
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const r = await Preferences.get({ key: PREF_KEY });
    const p = r.value ? (JSON.parse(r.value) as OtaPrefs) : null;
    return { failed: [], ...(p ?? {}) };
  } catch {
    return { failed: [] };
  }
}

async function writePrefs(p: OtaPrefs): Promise<void> {
  const { Preferences } = await import('@capacitor/preferences');
  await Preferences.set({ key: PREF_KEY, value: JSON.stringify(p) });
}

/**
 * Lee, modifica y guarda el estado de actualizaciones EN ORDEN: dos cambios que
 * ocurren casi a la vez (anotar "funcionó" y confirmar) nunca se pisan.
 */
let prefsQueue: Promise<unknown> = Promise.resolve();
function updatePrefs<T>(fn: (p: OtaPrefs) => T): Promise<{ prefs: OtaPrefs; result: T }> {
  const run = prefsQueue.then(async () => {
    const prefs = await readPrefs();
    const result = fn(prefs);
    await writePrefs(prefs);
    return { prefs, result };
  });
  prefsQueue = run.catch(() => undefined);
  return run;
}

export async function nativeInfo(): Promise<{ version: string; code: number } | null> {
  if (!(await native())) return null;
  try {
    const { App } = await import('@capacitor/app');
    const info = await App.getInfo();
    return { version: info.version, code: parseInt(info.build, 10) || 0 };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ estado observable

export type OtaPhase = 'idle' | 'checking' | 'downloading' | 'verifying' | 'installing' | 'error';

export interface OtaView {
  phase: OtaPhase;
  check: OtaCheck | null;
  progress: number;
  message: string | null;
  justUpdated: OtaPrefs['justUpdated'] | null;
  rolledBack: OtaPrefs['rolledBack'] | null;
  native: { version: string; code: number } | null;
  confirmed: boolean;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let view: OtaView = { phase: 'idle', check: null, progress: 0, message: null, justUpdated: null, rolledBack: null, native: null, confirmed: true };

function set(patch: Partial<OtaView>) {
  view = { ...view, ...patch };
  for (const l of listeners) l();
}

export const otaStore = {
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => view,
};

// ------------------------------------------------------------------ arranque, confirmación y reversión

let bootErrorHandler: ((e: unknown) => void) | null = null;

async function rollback(reason: string): Promise<void> {
  const { result: pend } = await updatePrefs((p) => {
    const pending = p.pending;
    if (!pending || pending.build !== WEB_BUILD) return null;
    p.failed = [...new Set([...p.failed, pending.build])];
    p.pending = undefined;
    p.rolledBack = { version: pending.version, reason };
    return pending;
  });
  if (!pend) return;
  const { WebView } = await import('@capacitor/core');
  // Volver a la versión anterior: otra página descargada o la que viene dentro de la APK.
  if (pend.prevPath && pend.prevPath.startsWith('/')) await WebView.setServerBasePath({ path: pend.prevPath });
  else await (WebView as unknown as { setServerAssetPath(o: { path: string }): Promise<void> }).setServerAssetPath({ path: 'public' });
}

/**
 * Se llama al iniciar la app (antes de cargar la partida).
 *  - Si esta página es una actualización pendiente: vigila errores y se confirma sola
 *    cuando `markHealthy()` avisa que la partida cargó y la interfaz funciona.
 *  - Si hay una actualización pendiente pero arrancó OTRA versión, la nueva falló:
 *    se marca como fallida para no ofrecerla de nuevo automáticamente.
 */
export async function otaBoot(): Promise<void> {
  if (!(await native())) return;
  const nat = await nativeInfo();
  const { prefs: p, result: d } = await updatePrefs((p): BootDecision => {
    const d = decideBoot(p.pending, WEB_BUILD);
    if (d.kind === 'watch' && p.pending) p.pending.starts = (p.pending.starts ?? 0) + 1;
    if (d.kind === 'failed' && !d.rollback && p.pending) {
      p.failed = [...new Set([...p.failed, p.pending.build])];
      p.rolledBack = { version: p.pending.version, reason: d.reason };
      p.pending = undefined;
    }
    return d;
  });
  set({ native: nat, justUpdated: p.justUpdated ?? null, rolledBack: p.rolledBack ?? null });
  if (d.kind === 'watch') {
    set({ confirmed: false });
    bootErrorHandler = () => void rollback('La versión nueva tuvo un error al iniciar.');
    window.addEventListener('error', bootErrorHandler);
    window.addEventListener('unhandledrejection', bootErrorHandler);
    return;
  }
  if (d.kind === 'resume') {
    // La versión nueva ya había funcionado pero la app se cerró antes de confirmarla.
    const { WebView } = await import('@capacitor/core');
    await WebView.setServerBasePath({ path: d.path });
    return;
  }
  if (d.kind === 'failed' && d.rollback) {
    await rollback(d.reason);
    return;
  }
  // Limpieza en segundo plano (no demora el arranque); instalar una versión la espera
  // antes de escribir, para que nunca borre la carpeta que se está creando.
  cleanup = cleanupOldBundles([p.current, p.pending?.build]);
}

/** La versión pendiente no pudo cargar la partida: volver a la anterior. */
export function failBoot(reason: string): void {
  if (view.confirmed) return;
  void rollback(reason);
}

/** La partida cargó y la interfaz se dibujó: si esta versión estaba pendiente, se confirma. */
export function markHealthy(onConfirmed?: () => void): void {
  if (view.confirmed) return;
  // Se anota YA que la versión funcionó: si la app se cierra durante la espera, al
  // volver a abrirla se retoma esta versión en lugar de darla por fallida.
  void updatePrefs((p) => {
    if (p.pending && p.pending.build === WEB_BUILD && !p.pending.healthyAt) p.pending.healthyAt = Date.now();
  }).catch(() => undefined);
  setTimeout(async () => {
    try {
      const { prefs } = await updatePrefs(() => undefined);
      if (!prefs.pending || prefs.pending.build !== WEB_BUILD) return;
      const { WebView } = await import('@capacitor/core');
      await WebView.persistServerBasePath();
      const { prefs: p } = await updatePrefs((p) => {
        if (!p.pending || p.pending.build !== WEB_BUILD) return;
        p.justUpdated = { from: p.pending.fromVersion, to: APP_VERSION, notes: p.pending.notes ?? [] };
        p.current = WEB_BUILD;
        p.pending = undefined;
        p.rolledBack = undefined;
      });
      if (bootErrorHandler) {
        window.removeEventListener('error', bootErrorHandler);
        window.removeEventListener('unhandledrejection', bootErrorHandler);
        bootErrorHandler = null;
      }
      set({ confirmed: true, justUpdated: p.justUpdated });
      onConfirmed?.();
    } catch {
      /* se reintenta en el próximo arranque */
    }
  }, CONFIRM_AFTER_MS);
}

export async function dismissUpdateNotes(): Promise<void> {
  if (!(await native())) return;
  await updatePrefs((p) => {
    p.justUpdated = undefined;
    p.rolledBack = undefined;
  });
  set({ justUpdated: null, rolledBack: null });
}

/** Limpieza de versiones viejas en curso (ver otaBoot). */
let cleanup: Promise<void> = Promise.resolve();

async function cleanupOldBundles(keep: Array<number | undefined>): Promise<void> {
  const keepNames = new Set([String(WEB_BUILD), ...keep.filter((x): x is number => typeof x === 'number').map(String)]);
  try {
    const fs = await import('@capacitor/filesystem');
    const dir = await fs.Filesystem.readdir({ path: 'ota', directory: fs.Directory.Data });
    for (const f of dir.files) {
      if (!keepNames.has(f.name)) {
        await fs.Filesystem.rmdir({ path: `ota/${f.name}`, directory: fs.Directory.Data, recursive: true });
      }
    }
  } catch {
    /* no hay carpeta ota todavía */
  }
}

// ------------------------------------------------------------------ buscar e instalar

export async function checkForUpdate(manual: boolean): Promise<OtaCheck> {
  if (!(await native())) {
    const r: OtaCheck = { kind: 'web' };
    set({ check: r });
    return r;
  }
  set({ phase: 'checking', message: null });
  try {
    const res = await fetchRetry(`${OTA_BASE}manifest.json?t=${Date.now()}`, OTA_NET.manifestTimeoutMs);
    const doc: unknown = await res.json();
    const signed = await verifySignedManifest(doc);
    const nat = view.native ?? (await nativeInfo());
    const { result: r } = await updatePrefs((p): OtaCheck => {
      p.lastCheck = Date.now();
      return signed.ok
        ? evaluateManifest(signed.manifest, { webBuild: WEB_BUILD, nativeCode: nat?.code ?? 0, failed: p.failed, manual })
        : { kind: 'error', message: signed.error };
    });
    set({ phase: r.kind === 'error' ? 'error' : 'idle', check: r, message: r.kind === 'error' ? r.message : null });
    return r;
  } catch (e) {
    const r: OtaCheck = { kind: 'error', message: `No se pudo buscar actualizaciones (${(e as Error).message}). Revisá la conexión.` };
    set({ phase: 'error', check: r, message: r.message });
    return r;
  }
}

/**
 * Descarga, verifica e instala. `beforeSwitch` debe guardar la partida (y su copia
 * previa) ANTES de cambiar de versión. Devuelve un mensaje de error o null.
 */
export async function applyUpdate(man: OtaManifest, beforeSwitch: () => Promise<boolean>): Promise<string | null> {
  try {
    set({ phase: 'downloading', progress: 0, message: null });
    let text = '';
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetchRetry(`${OTA_BASE}${man.file}?t=${man.build}`, OTA_NET.manifestTimeoutMs);
        const total = man.size || Number(res.headers.get('content-length')) || 0;
        text = await readBody(res, total, (progress) => set({ progress }));
        break;
      } catch (e) {
        // Una descarga cortada se reintenta desde cero; un error de otro tipo, no.
        if (!(e instanceof NetError) || attempt >= OTA_NET.retries) throw e;
        set({ progress: 0 });
      }
    }
    set({ phase: 'verifying', progress: 1 });
    const bytes = new TextEncoder().encode(text).length;
    if (man.size && bytes !== man.size) throw new Error(`tamaño inesperado (${bytes} de ${man.size} bytes)`);
    if ((await sha256Hex(text)) !== man.sha256) throw new Error('la huella SHA-256 no coincide: el archivo llegó incompleto o alterado');
    if (!text.includes('<div id="root">')) throw new Error('el archivo no es una versión del juego');

    set({ phase: 'installing' });
    await cleanup;
    const fs = await import('@capacitor/filesystem');
    const rel = `ota/${man.build}`;
    try {
      await fs.Filesystem.rmdir({ path: rel, directory: fs.Directory.Data, recursive: true });
    } catch {
      /* no existía */
    }
    await fs.Filesystem.mkdir({ path: rel, directory: fs.Directory.Data, recursive: true });
    await fs.Filesystem.writeFile({ path: `${rel}/index.html`, data: text, directory: fs.Directory.Data, encoding: fs.Encoding.UTF8 });
    const check = await fs.Filesystem.readFile({ path: `${rel}/index.html`, directory: fs.Directory.Data, encoding: fs.Encoding.UTF8 });
    if (typeof check.data !== 'string' || (await sha256Hex(check.data)) !== man.sha256) throw new Error('no se pudo escribir la versión nueva completa');
    const uri = (await fs.Filesystem.getUri({ path: rel, directory: fs.Directory.Data })).uri;
    const path = decodeURIComponent(uri.replace(/^file:\/\//, ''));

    if (!(await beforeSwitch())) throw new Error('no se pudo guardar la partida antes de actualizar; no se cambió nada');

    const { WebView } = await import('@capacitor/core');
    const prev = (await WebView.getServerBasePath()).path ?? '';
    await updatePrefs((p) => {
      p.pending = { build: man.build, version: man.version, path, prevPath: prev, fromVersion: APP_VERSION, at: Date.now(), notes: (man.notes ?? []).slice(0, 30) };
      p.failed = p.failed.filter((b) => b !== man.build);
    });
    await WebView.setServerBasePath({ path });
    return null;
  } catch (e) {
    const msg = `No se instaló la actualización: ${(e as Error).message}. Tu versión actual y tu partida siguen intactas.`;
    set({ phase: 'error', message: msg });
    return msg;
  }
}

/** Búsqueda automática al abrir la app (el manifiesto pesa menos de 1 KB). */
export async function autoCheck(): Promise<void> {
  if (!(await native())) return;
  const p = await readPrefs();
  if (p.pending) return;
  await checkForUpdate(false);
}
