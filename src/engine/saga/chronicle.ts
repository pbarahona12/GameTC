import type { GameState } from '../state';
import type { ChronicleEntry, ChronicleKind, Celebration } from './types';
import { balanceSheet } from '../reports/statements';
import { dateOf } from '../time/calendar';
import { fmtMoney, fmtPct } from '../format';

/**
 * CRÓNICA DEL MAGNATE: la historia de la partida contada como línea de tiempo.
 * Se escribe sola a partir de lo que pasa (etapas, logros, metas, dilemas,
 * clasificaciones, crisis) y cada año cierra con un resumen.
 *
 * CELEBRACIONES: los hitos importantes dejan un festejo pendiente que la
 * interfaz muestra una vez (pantalla breve para los grandes, aviso para el resto).
 */
const MAX_CHRONICLE = 600;
const MAX_CELEBRATIONS = 6;

export function chronicle(state: GameState, kind: ChronicleKind, icon: string, title: string, text: string): ChronicleEntry | null {
  if (state.meta.projection || !state.saga) return null;
  let netWorth: number | undefined;
  try {
    netWorth = balanceSheet(state).netWorth;
  } catch {
    netWorth = undefined;
  }
  const cap = title ? title[0].toUpperCase() + title.slice(1) : title;
  const e: ChronicleEntry = { id: state.meta.nextId++, day: state.day, kind, icon, title: cap, text, netWorth };
  const list = state.saga.chronicle;
  list.push(e);
  if (list.length > MAX_CHRONICLE) {
    // Se recortan primero los resúmenes anuales más viejos que tengan reemplazo… y si no, lo más viejo.
    list.splice(0, list.length - MAX_CHRONICLE);
  }
  return e;
}

export function celebrate(state: GameState, size: Celebration['size'], icon: string, title: string, text: string): void {
  if (state.meta.projection || !state.saga) return;
  const q = state.saga.celebrations;
  q.push({ id: state.meta.nextId++, day: state.day, size, icon, title, text });
  if (q.length > MAX_CELEBRATIONS) {
    const small = q.findIndex((c) => c.size === 'small');
    q.splice(small >= 0 ? small : 0, 1);
  }
}

/** La interfaz marca un festejo como mostrado. */
export function dismissCelebration(state: GameState, id: number): void {
  if (!state.saga) return;
  state.saga.celebrations = state.saga.celebrations.filter((c) => c.id !== id);
}

/** Resumen del año que terminó (se escribe el 31 de diciembre, con la foto del mes ya tomada). */
export function yearSummary(state: GameState, rankText: string | null): void {
  const y = dateOf(state.day).y;
  const snaps = state.history;
  const end = snaps[snaps.length - 1];
  if (!end) return;
  const start = [...snaps].reverse().find((h) => dateOf(h.day).y === y - 1 && dateOf(h.day).m === 12);
  const delta = start ? end.netWorth - start.netWorth : null;
  const pct = start && start.netWorth > 0 && delta !== null ? delta / start.netWorth : null;
  const yearEntries = state.saga.chronicle.filter((c) => dateOf(c.day).y === y && c.kind !== 'anio').length;
  const parts = [`Patrimonio neto al cierre: ${fmtMoney(end.netWorth, { decimals: false })}`];
  if (delta !== null) parts.push(`${delta >= 0 ? 'creció' : 'cayó'} ${fmtMoney(Math.abs(delta), { decimals: false })}${pct !== null ? ` (${fmtPct(Math.abs(pct), 1)})` : ''} en el año`);
  if (rankText) parts.push(rankText);
  if (yearEntries) parts.push(`${yearEntries} momento${yearEntries > 1 ? 's' : ''} para recordar`);
  chronicle(state, 'anio', 'calendar', `Tu ${y}`, parts.join(' · ') + '.');
}
