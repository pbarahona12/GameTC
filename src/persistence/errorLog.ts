/**
 * REGISTRO LOCAL DE ERRORES (fase 0 de la auditoría).
 *
 * Guarda en el dispositivo los últimos errores de la app (excepciones sin atrapar,
 * pantallas que no se pudieron dibujar, días de simulación que fallaron, guardados
 * fallidos) para poder diagnosticarlos en teléfonos reales sin telemetría.
 *
 * - Nunca sale del dispositivo por sí solo: el jugador lo ve en Ajustes y decide si
 *   lo copia o lo exporta para pedir ayuda.
 * - Solo datos técnicos (mensaje, pila recortada, versión, día de juego): nada de
 *   la partida ni datos personales.
 * - Vive fuera de la partida (no cambia el formato de guardado ni la simulación).
 * - Registrar un error nunca puede provocar otro: todo está protegido.
 */
import { APP_VERSION } from '../version';

export const ERROR_LOG_KEY = 'urt.errors';
export const MAX_ERRORS = 20;
const MAX_MESSAGE = 400;
const MAX_STACK_LINES = 8;

export interface ErrorEntry {
  /** Fecha real (ms). */
  at: number;
  /** Dónde ocurrió: "ventana", "promesa", "interfaz", "simulación", "guardado", "arranque"… */
  where: string;
  name: string;
  message: string;
  stack: string | null;
  version: string;
  /** Día de juego, si había una partida abierta. */
  day?: number;
}

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readErrors(): ErrorEntry[] {
  try {
    const raw = storage()?.getItem(ERROR_LOG_KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? (list as ErrorEntry[]).filter((e) => e && typeof e.message === 'string') : [];
  } catch {
    return [];
  }
}

const listeners = new Set<() => void>();
/** Para que Ajustes se actualice cuando entra un error nuevo. */
export function onErrorsChanged(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

function write(list: ErrorEntry[]): void {
  try {
    storage()?.setItem(ERROR_LOG_KEY, JSON.stringify(list.slice(-MAX_ERRORS)));
  } catch {
    /* sin espacio o sin almacenamiento: no se registra */
  }
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* un oyente roto no debe romper el registro */
    }
  }
}

/** Registra un error. No lanza nunca. */
export function recordError(error: unknown, where: string, extra: { day?: number; now?: number } = {}): void {
  try {
    const e = error instanceof Error ? error : new Error(typeof error === 'string' ? error : safeString(error));
    const entry: ErrorEntry = {
      at: extra.now ?? Date.now(),
      where,
      name: e.name || 'Error',
      message: (e.message || '').slice(0, MAX_MESSAGE),
      stack: e.stack ? e.stack.split('\n').slice(0, MAX_STACK_LINES).join('\n') : null,
      version: APP_VERSION,
      ...(extra.day !== undefined ? { day: extra.day } : {}),
    };
    const list = readErrors();
    // El mismo error repetido seguido (por ejemplo, en cada cuadro) se guarda una sola vez.
    const last = list[list.length - 1];
    if (last && last.message === entry.message && last.where === entry.where && entry.at - last.at < 5000) return;
    write([...list, entry]);
  } catch {
    /* nunca romper por registrar */
  }
}

function safeString(v: unknown): string {
  try {
    return String(v);
  } catch {
    return 'Error desconocido';
  }
}

export function clearErrors(): void {
  try {
    storage()?.removeItem(ERROR_LOG_KEY);
  } catch {
    /* nada que borrar */
  }
  for (const l of listeners) l();
}

/** Texto para copiar o exportar (lo comparte el jugador si quiere). */
export function errorLogText(list = readErrors()): string {
  if (!list.length) return 'Sin errores registrados.';
  return list
    .map((e) => {
      const head = `[${new Date(e.at).toISOString()}] ${e.where} · versión ${e.version}${e.day !== undefined ? ` · día ${e.day}` : ''}`;
      return [head, `${e.name}: ${e.message}`, ...(e.stack ? [e.stack] : [])].join('\n');
    })
    .join('\n\n');
}

let installed = false;
/** Escucha los errores sin atrapar de la página (una sola vez). */
export function installGlobalErrorLog(currentDay: () => number | undefined): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  window.addEventListener('error', (ev) => recordError(ev.error ?? ev.message, 'ventana', { day: currentDay() }));
  window.addEventListener('unhandledrejection', (ev) => recordError(ev.reason, 'promesa', { day: currentDay() }));
}
