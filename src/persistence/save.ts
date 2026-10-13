import type { GameState } from '../engine/state';
import { SAVE_VERSION } from '../engine/state';
import { checkInvariants } from '../engine/invariants';
import { migrate, validateShape } from './migrations';
import { balanceSheet } from '../engine/reports/statements';
import { canCompress, gzipText, gunzipText, fnv1a } from './codec';
import { packPayload } from './pack';

export { canCompress, gzipText, gunzipText, fnv1a };

/**
 * Guardado robusto:
 *  - Sobre con formato, versión, fecha real, día de juego y checksum FNV-1a del contenido.
 *  - Escritura en dos pasos: primero a una ranura temporal, luego a la principal.
 *    Si la app se cierra a mitad de guardado, la temporal o la anterior siguen intactas.
 *  - 3 copias de seguridad escalonadas por tiempo real (10 min, 1 h, 1 día).
 *  - Varias partidas (ranuras): cada una con sus propias claves (ver `slotKeys`).
 *  - Al cargar: checksum → migración → forma → invariantes contables.
 *    Si algo falla se prueba la siguiente copia.
 *  - Nunca se guarda un estado que viole los invariantes contables.
 */
export interface KV {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export const KEYS = {
  primary: 'urt.save.primary',
  temp: 'urt.save.tmp',
  backups: ['urt.save.bak1', 'urt.save.bak2', 'urt.save.bak3'],
  /** Copia hecha justo antes de instalar una actualización (por si hay que volver atrás). */
  preupdate: 'urt.save.preupdate',
};


export interface Envelope {
  format: 'urt-save';
  version: number;
  savedAt: number;
  day: number;
  name: string;
  /** Suma de verificación del JSON del estado SIN comprimir. */
  checksum: string;
  payload: string;
  /** 'gzip-b64': el payload es el JSON comprimido con gzip y codificado en base64. */
  encoding?: 'gzip-b64';
  /** Patrimonio neto al guardar (para listar partidas sin abrirlas; desde 1.3). */
  netWorth?: number;
}

// ------------------------------------------------------------ Compresión (gzip nativo, sin dependencias)

/** Guardado comprimido (si la plataforma lo permite). El checksum se calcula sobre el JSON original. */
export async function serializeCompact(state: GameState, now: number): Promise<string> {
  if (!canCompress()) return serialize(state, now);
  const payload = JSON.stringify(state);
  // Suma de verificación y compresión en un hilo aparte si se puede (pack.ts).
  const { checksum, packed } = await packPayload(payload);
  const env: Envelope = { format: 'urt-save', version: SAVE_VERSION, savedAt: now, day: state.day, name: state.player.name, netWorth: netWorthOf(state), checksum, payload: packed, encoding: 'gzip-b64' };
  return JSON.stringify(env);
}

/** Abre un sobre comprimido o plano y lo devuelve como texto plano verificable por `deserialize`. */
export async function deserializeAny(text: string | null): Promise<LoadResult> {
  if (!text) return { ok: false, error: 'Sin datos.' };
  let env: Envelope;
  try {
    env = JSON.parse(text);
  } catch {
    return { ok: false, error: 'El archivo está dañado (JSON inválido).' };
  }
  if (env?.encoding === 'gzip-b64') {
    if (!canCompress()) return { ok: false, error: 'Esta plataforma no puede descomprimir la partida.' };
    try {
      env = { ...env, payload: await gunzipText(env.payload), encoding: undefined };
    } catch {
      return { ok: false, error: 'Los datos comprimidos están dañados.' };
    }
    return deserializeEnvelope(env);
  }
  return deserialize(text);
}

function netWorthOf(state: GameState): number | undefined {
  try {
    return balanceSheet(state).netWorth;
  } catch {
    return undefined;
  }
}


export function serialize(state: GameState, now: number): string {
  const payload = JSON.stringify(state);
  const env: Envelope = { format: 'urt-save', version: SAVE_VERSION, savedAt: now, day: state.day, name: state.player.name, netWorth: netWorthOf(state), checksum: fnv1a(payload), payload };
  return JSON.stringify(env);
}

export type LoadResult = { ok: true; state: GameState; envelope: Envelope; migratedFrom: number | null } | { ok: false; error: string };

export function deserialize(text: string | null): LoadResult {
  if (!text) return { ok: false, error: 'Sin datos.' };
  let env: Envelope;
  try {
    env = JSON.parse(text);
  } catch {
    return { ok: false, error: 'El archivo está dañado (JSON inválido).' };
  }
  if (env?.encoding) return { ok: false, error: 'La partida está comprimida: usá la carga asíncrona.' };
  return deserializeEnvelope(env);
}

function deserializeEnvelope(env: Envelope): LoadResult {
  if (!env || env.format !== 'urt-save' || typeof env.payload !== 'string') return { ok: false, error: 'No es una partida de Ultimate Realistic Tycoon.' };
  if (fnv1a(env.payload) !== env.checksum) return { ok: false, error: 'La suma de verificación no coincide: la partida fue alterada o está dañada.' };
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(env.payload);
  } catch {
    return { ok: false, error: 'Contenido dañado.' };
  }
  const shape = validateShape(raw);
  if (shape.length) return { ok: false, error: shape.join(' ') };
  let migrated;
  try {
    migrated = migrate(raw);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
  const inv = checkInvariants(migrated.state);
  if (inv.length) return { ok: false, error: 'Contabilidad inconsistente: ' + inv.slice(0, 3).join(' ') };
  return { ok: true, state: migrated.state, envelope: env, migratedFrom: migrated.migratedFrom };
}

// ------------------------------------------------------------ ranuras de partida

/** Claves de almacenamiento de UNA partida (ranura). */
export interface SlotKeys {
  primary: string;
  temp: string;
  backups: string[];
  /** Copia hecha justo antes de instalar una actualización. */
  preupdate: string;
  /** Copia de la partida actual hecha antes de restaurar otra copia (para deshacer). */
  prerestore: string;
}

/** Ranura histórica: las claves de siempre (compatibles con versiones anteriores del juego). */
export const LEGACY_SLOT = 'main';

export function slotKeys(id: string = LEGACY_SLOT): SlotKeys {
  if (id === LEGACY_SLOT) return { ...KEYS, backups: [...KEYS.backups], prerestore: 'urt.save.prerestore' };
  const b = `urt.s.${id}`;
  return { primary: `${b}.primary`, temp: `${b}.tmp`, backups: [`${b}.bak1`, `${b}.bak2`, `${b}.bak3`], preupdate: `${b}.preupdate`, prerestore: `${b}.prerestore` };
}

/** Todas las claves de una ranura, en orden de preferencia ante un empate de fecha. */
export function allKeys(k: SlotKeys): string[] {
  return [k.primary, k.temp, ...k.backups, k.prerestore, k.preupdate];
}

/**
 * Las copias de seguridad se escalonan por tiempo REAL, no por días de juego (a
 * 8× un mes de juego dura segundos). Cuando la copia 1 tiene 10 minutos se
 * reemplaza por la principal anterior; antes, si la copia 2 tiene más de 1 hora,
 * la copia 1 pasa a ser la 2; y si la 3 tiene más de 1 día, la 2 pasa a ser la 3.
 * Resultado: la copia 1 tiene como mucho ~10 minutos, la 2 entre 10 y 70
 * minutos y la 3 entre 1 hora y ~1 día. Un error reciente no alcanza a todas.
 */
export const BACKUP_TIERS_MS = [10 * 60 * 1000, 60 * 60 * 1000, 24 * 60 * 60 * 1000];

/**
 * Escribe con reintento: si el almacenamiento está lleno, libera primero las
 * copias de seguridad MÁS VIEJAS (nunca la principal) y vuelve a intentar.
 */
async function setWithRoom(kv: KV, key: string, text: string, k: SlotKeys): Promise<string | null> {
  const victims = [k.preupdate, k.prerestore, ...[...k.backups].reverse()].filter((v) => v !== key);
  for (let attempt = 0; ; attempt++) {
    try {
      await kv.set(key, text);
      return null;
    } catch (e) {
      const victim = victims[attempt];
      if (!victim) return (e as Error)?.name === 'QuotaExceededError' ? 'El almacenamiento del dispositivo está lleno.' : `Error de escritura: ${(e as Error)?.message ?? e}`;
      try {
        await kv.remove(victim);
      } catch {
        /* seguimos intentando */
      }
    }
  }
}

/** Rota las copias por antigüedad real (ver BACKUP_TIERS_MS). Solo copia textos ya escritos. */
async function rotateBackups(kv: KV, k: SlotKeys, now: number): Promise<void> {
  const primary = await kv.get(k.primary);
  if (!primary || !deserializeHeader(primary)) return;
  const age = async (key: string) => {
    const h = deserializeHeader(await kv.get(key));
    return h ? now - h.savedAt : null;
  };
  const [a1, a2, a3] = await Promise.all(k.backups.map(age));
  if (a1 !== null && a1 < BACKUP_TIERS_MS[0]) return;
  if (a1 !== null && (a2 === null || a2 >= BACKUP_TIERS_MS[1])) {
    if (a2 !== null && (a3 === null || a3 >= BACKUP_TIERS_MS[2])) {
      const t2 = await kv.get(k.backups[1]);
      if (t2) await kv.set(k.backups[2], t2);
    }
    const t1 = await kv.get(k.backups[0]);
    if (t1) await kv.set(k.backups[1], t1);
  }
  await kv.set(k.backups[0], primary);
}

export async function saveGame(kv: KV, state: GameState, now: number, k: SlotKeys = slotKeys()): Promise<{ ok: true; bytes: number } | { ok: false; error: string }> {
  const inv = checkInvariants(state);
  if (inv.length) return { ok: false, error: 'No se guardó: se detectó una inconsistencia contable. ' + inv[0] };
  state.meta.lastRealTime = now;
  const text = await serializeCompact(state, now);
  // 1. Ranura temporal: si falla, la principal y las copias quedan intactas.
  const e1 = await setWithRoom(kv, k.temp, text, k);
  if (e1) return { ok: false, error: `No se guardó (${e1}). Tu partida anterior sigue intacta; exportala a un archivo desde Ajustes.` };
  // 2. Rotación de copias de seguridad.
  try {
    await rotateBackups(kv, k, now);
  } catch {
    /* sin espacio para rotar copias: se conserva lo que ya había */
  }
  // 3. Principal. Si falla, la temporal (más nueva) se usa al cargar.
  const e2 = await setWithRoom(kv, k.primary, text, k);
  if (e2) return { ok: false, error: `Guardado parcial (${e2}): la partida quedó en la ranura temporal y se recuperará al abrir.` };
  try {
    await kv.remove(k.temp);
  } catch {
    /* no crítico */
  }
  return { ok: true, bytes: text.length };
}

export function deserializeHeader(text: string | null): Pick<Envelope, 'savedAt' | 'day' | 'name' | 'version' | 'netWorth'> | null {
  if (!text) return null;
  try {
    const e = JSON.parse(text) as Envelope;
    return e.format === 'urt-save' && typeof e.savedAt === 'number' ? { savedAt: e.savedAt, day: e.day, name: e.name, version: e.version, netWorth: e.netWorth } : null;
  } catch {
    return null;
  }
}

export interface LoadReport {
  state: GameState | null;
  source: string | null;
  recovered: boolean;
  problems: string[];
  migratedFrom: number | null;
}

/**
 * Carga la copia válida MÁS RECIENTE de la ranura: se ordenan todas las copias
 * (principal, temporal, de seguridad, "antes de restaurar" y "antes de
 * actualizar") por fecha de guardado y se usa la primera que se lea bien. Una
 * copia vieja nunca le gana a una más nueva, y una copia dañada nunca borra a
 * las demás. Ante un empate gana la principal.
 */
export async function loadGame(kv: KV, k: SlotKeys = slotKeys()): Promise<LoadReport> {
  const problems: string[] = [];
  const order = allKeys(k);
  const found: Array<{ key: string; text: string; savedAt: number }> = [];
  for (const key of order) {
    const text = await kv.get(key);
    if (!text) continue;
    const h = deserializeHeader(text);
    // Una copia sin encabezado legible está dañada: se informa y se intenta al final.
    if (!h) problems.push(`${key}: copia dañada (no se puede leer su encabezado).`);
    found.push({ key, text, savedAt: h?.savedAt ?? -1 });
  }
  found.sort((a, b) => b.savedAt - a.savedAt || order.indexOf(a.key) - order.indexOf(b.key));
  for (const f of found) {
    const r = await deserializeAny(f.text);
    if (r.ok) return { state: r.state, source: f.key, recovered: f.key !== k.primary && f.key !== k.temp, problems, migratedFrom: r.migratedFrom };
    if (f.savedAt >= 0) problems.push(`${f.key}: ${r.error}`);
  }
  return { state: null, source: null, recovered: false, problems, migratedFrom: null };
}

export type BackupKind = 'principal' | 'copia' | 'antes de restaurar' | 'antes de actualizar';

export async function listBackups(kv: KV, k: SlotKeys = slotKeys()) {
  const out: Array<{ key: string; kind: BackupKind; header: ReturnType<typeof deserializeHeader> }> = [];
  const add = async (key: string, kind: BackupKind) => out.push({ key, kind, header: deserializeHeader(await kv.get(key)) });
  await add(k.primary, 'principal');
  for (const b of k.backups) await add(b, 'copia');
  await add(k.prerestore, 'antes de restaurar');
  await add(k.preupdate, 'antes de actualizar');
  return out;
}

/**
 * Restaura una copia de la ranura. Antes guarda la partida actual en
 * "antes de restaurar", así la restauración se puede deshacer.
 */
export async function restoreBackup(kv: KV, key: string, k: SlotKeys = slotKeys()): Promise<LoadResult> {
  const text = await kv.get(key);
  const r = await deserializeAny(text);
  if (!r.ok || !text) return r.ok ? { ok: false, error: 'Sin datos.' } : r;
  const current = await kv.get(k.primary);
  if (current && key !== k.prerestore && deserializeHeader(current)) await kv.set(k.prerestore, current);
  await kv.set(k.primary, text);
  return r;
}

/** Borra todas las copias de una ranura. */
export async function deleteSlot(kv: KV, k: SlotKeys = slotKeys()): Promise<void> {
  for (const key of allKeys(k)) await kv.remove(key);
}

/** Borra la copia "antes de actualizar" cuando la actualización ya se confirmó. */
export async function clearPreupdate(kv: KV, k: SlotKeys = slotKeys()): Promise<void> {
  await kv.remove(k.preupdate);
}

// ------------------------------------------------------------ rescate de copias

/** Archivo con el texto crudo de todas las copias (aunque estén dañadas). */
export interface RescueBundle {
  format: 'urt-rescue';
  exportedAt: number;
  app: string;
  copies: Record<string, string>;
}

/** Lee el texto crudo de cada clave. Una clave ilegible se omite: nunca lanza. */
export async function collectRawCopies(kv: KV, keys: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const key of keys) {
    try {
      const v = await kv.get(key);
      if (v) out[key] = v;
    } catch {
      /* clave ilegible: se sigue con las demás */
    }
  }
  return out;
}

export function rescueBundle(copies: Record<string, string>, now: number, app: string): string {
  const b: RescueBundle = { format: 'urt-rescue', exportedAt: now, app, copies };
  return JSON.stringify(b);
}

/**
 * Interpreta un texto importado: una partida exportada o un archivo de rescate
 * (en ese caso se usa la copia válida más reciente que contenga).
 */
export async function parseImport(text: string): Promise<LoadResult & { source?: string }> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: 'El archivo está dañado (JSON inválido).' };
  }
  const b = parsed as Partial<RescueBundle> | null;
  if (b && b.format === 'urt-rescue' && b.copies && typeof b.copies === 'object') {
    const entries = Object.entries(b.copies).filter((e): e is [string, string] => typeof e[1] === 'string');
    entries.sort((x, y) => (deserializeHeader(y[1])?.savedAt ?? 0) - (deserializeHeader(x[1])?.savedAt ?? 0));
    const errors: string[] = [];
    for (const [key, raw] of entries) {
      const r = await deserializeAny(raw);
      if (r.ok) return { ...r, source: key };
      errors.push(`${key}: ${r.error}`);
    }
    return { ok: false, error: entries.length ? `Ninguna copia del archivo se pudo leer (${errors.join(' | ')}).` : 'El archivo de rescate no tiene copias.' };
  }
  return deserializeAny(text);
}

/** Copia la partida principal (ya verificada) a la ranura "antes de actualizar". */
export async function snapshotBeforeUpdate(kv: KV, k: SlotKeys = slotKeys()): Promise<boolean> {
  const primary = await kv.get(k.primary);
  if (!primary) return false;
  const r = await deserializeAny(primary);
  if (!r.ok) return false;
  await kv.set(k.preupdate, primary);
  return (await kv.get(k.preupdate)) === primary;
}

/** Memoria (pruebas y entornos sin almacenamiento persistente). */
export class MemoryKV implements KV {
  map = new Map<string, string>();
  async get(k: string) {
    return this.map.get(k) ?? null;
  }
  async set(k: string, v: string) {
    this.map.set(k, v);
  }
  async remove(k: string) {
    this.map.delete(k);
  }
}
