/**
 * Calendario del juego. El tiempo se representa como un índice de día
 * (`day`), donde el día 0 es el 1 de enero de START_YEAR. El tiempo del juego
 * es totalmente independiente del reloj real.
 */
export const START_YEAR = 2026;
const MS_PER_DAY = 86_400_000;
const EPOCH = Date.UTC(START_YEAR, 0, 1);

export interface GameDate {
  y: number;
  m: number; // 1-12
  d: number; // 1-31
  weekday: number; // 0 = domingo
}

export function dateOf(day: number): GameDate {
  const dt = new Date(EPOCH + day * MS_PER_DAY);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate(), weekday: dt.getUTCDay() };
}

export function dayOf(y: number, m: number, d: number): number {
  return Math.round((Date.UTC(y, m - 1, d) - EPOCH) / MS_PER_DAY);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function isLastDayOfMonth(day: number): boolean {
  const g = dateOf(day);
  return g.d === daysInMonth(g.y, g.m);
}

/**
 * Comienzo de la ventana de "últimos 30 días" que contiene exactamente un cierre de mes.
 * Sueldos, alquileres y cargas se pagan el último día del mes: una ventana fija de 30 días
 * a veces no tiene ninguno (del 1 al 30 de un mes de 31) y a veces dos (fin de enero y de
 * febrero), y el resultado salía inflado o hundido. Así la ventana mide 28–31 días.
 */
export function last30Start(day: number): number {
  let from = day - 29;
  const ends: number[] = [];
  for (let d = from; d <= day; d++) if (isLastDayOfMonth(d)) ends.push(d);
  if (ends.length === 0) from -= 1;
  else if (ends.length > 1) from = ends[0] + 1;
  return from;
}

/** Suma meses conservando el día del mes (ajustado al último día si no existe). */
export function addMonths(day: number, months: number): number {
  const g = dateOf(day);
  const total = g.y * 12 + (g.m - 1) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return dayOf(y, m, Math.min(g.d, daysInMonth(y, m)));
}

export function startOfMonth(day: number): number {
  const g = dateOf(day);
  return dayOf(g.y, g.m, 1);
}

export function endOfMonth(day: number): number {
  const g = dateOf(day);
  return dayOf(g.y, g.m, daysInMonth(g.y, g.m));
}

export function startOfYear(day: number): number {
  return dayOf(dateOf(day).y, 1, 1);
}

export function monthKey(day: number): string {
  const g = dateOf(day);
  return `${g.y}-${String(g.m).padStart(2, '0')}`;
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const WEEKDAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

export function formatDate(day: number): string {
  const g = dateOf(day);
  return `${g.d} ${MONTHS[g.m - 1]} ${g.y}`;
}

export function formatMonth(day: number): string {
  const g = dateOf(day);
  return `${MONTHS[g.m - 1]} ${g.y}`;
}

export function formatDateShort(day: number): string {
  const g = dateOf(day);
  return `${WEEKDAYS[g.weekday]} ${g.d} ${MONTHS[g.m - 1]} ${g.y}`;
}
