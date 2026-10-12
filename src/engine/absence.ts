import type { GameState, LogCategory } from './state';
import { logCategory } from './log';
import { simulateDaysSafe, type SafeRun } from './simulation';
import { agenda, type AgendaItem } from './saga/agenda';

/**
 * AUSENCIA (progreso sin conexión): cerrar la app nunca decide por el jugador.
 *
 * Mientras la app está cerrada (o vuelve de segundo plano después de un rato) el
 * tiempo avanza con EXACTAMENTE las mismas reglas que en vivo, pero:
 *  1. Si hay una decisión abierta (dilema, oferta de empleo, tentación a un
 *     empleado, oferta por una empresa, acuerdo de la fiscalía, remate), el tiempo
 *     no avanza: la decisión conserva todo su plazo.
 *  2. El tiempo se detiene el día ANTERIOR a cualquier vencimiento de un pago de la
 *     agenda (multa, inspección, impuestos, resumen de la tarjeta), para que el
 *     jugador pueda pagarlo antes de que se recargue o embargue.
 *  3. El tiempo se detiene en cuanto aparece algo que en vivo pausaría el juego:
 *     una decisión nueva, una oferta, una guerra de precios, un aviso de peligro o
 *     un hecho legal.
 * La lógica es pura y determinista (no mira el reloj real): la interfaz decide
 * cuántos días caben en la ausencia y esto decide cuántos se simulan.
 */

/** Prefijos de la agenda que son decisiones del jugador (vencen solas si no responde). */
const CHOICE_KEYS = ['dil', 'job', 'poach', 'offer', 'plea', 'remate'];
/** Prefijos de la agenda que son pagos con fecha (vencidos tienen recargo o embargo). */
const PAYMENT_KEYS = ['insp', 'fine', 'tax', 'card'];
/** Categorías del registro que detienen la ausencia (en vivo pausan el juego). */
export const ABSENCE_STOP_CATEGORIES: LogCategory[] = ['peligro', 'ofertas', 'decisiones', 'legal'];

const prefix = (i: AgendaItem) => i.key.split(':')[0];

/** Decisiones abiertas con plazo: mientras haya alguna, la ausencia no avanza. */
export function pendingChoices(s: GameState): AgendaItem[] {
  return agenda(s).filter((i) => i.due !== null && i.due >= s.day && CHOICE_KEYS.includes(prefix(i)));
}

/**
 * Pago de la agenda cuyo vencimiento se alcanzaría al simular el día siguiente.
 * Los ya vencidos (por ejemplo, una multa en embargo) no detienen nada: la
 * consecuencia ya ocurrió y frenar la ausencia para siempre no ayuda.
 */
export function paymentDueTomorrow(s: GameState): AgendaItem | null {
  return agenda(s).find((i) => i.due !== null && PAYMENT_KEYS.includes(prefix(i)) && i.due >= s.day && i.due <= s.day + 1) ?? null;
}

export type AbsenceStop =
  /** Se simularon todos los días que cabían en la ausencia. */
  | { kind: 'complete' }
  /** No se simuló nada: había decisiones abiertas al cerrar la app. */
  | { kind: 'waiting'; items: AgendaItem[] }
  /** Se detuvo el día anterior a un vencimiento de pago. */
  | { kind: 'deadline'; item: AgendaItem }
  /** Se detuvo porque pasó algo que necesita tu atención. */
  | { kind: 'event'; text: string }
  /** Un día falló (ver SafeRun.failure); la partida quedó en el día anterior. */
  | { kind: 'failure' };

export interface AbsenceRun extends SafeRun {
  requestedDays: number;
  stop: AbsenceStop;
}

/** Simula una ausencia de hasta `days` días respetando las reglas de arriba. */
export function simulateAbsence(state: GameState, days: number, step?: (s: GameState) => void): AbsenceRun {
  const waiting = pendingChoices(state);
  let stop: AbsenceStop = waiting.length ? { kind: 'waiting', items: waiting } : { kind: 'complete' };
  const run = simulateDaysSafe(state, waiting.length ? 0 : days, step, {
    stopBefore: (s) => {
      const due = paymentDueTomorrow(s);
      if (due) stop = { kind: 'deadline', item: due };
      return !!due;
    },
    stopAfter: (s, logIdBefore) => {
      const hit = s.log.find((l) => l.id > logIdBefore && ABSENCE_STOP_CATEGORIES.includes(logCategory(l) as LogCategory));
      const choice = hit ? null : pendingChoices(s)[0];
      if (hit) stop = { kind: 'event', text: hit.text };
      else if (choice) stop = { kind: 'event', text: choice.title };
      return !!(hit || choice);
    },
  });
  if (run.failure) stop = { kind: 'failure' };
  return { ...run, requestedDays: days, stop };
}

/** Texto breve para el jugador: por qué el tiempo avanzó lo que avanzó. */
export function describeAbsenceStop(stop: AbsenceStop): string | null {
  switch (stop.kind) {
    case 'waiting':
      return `El tiempo te esperó: ${stop.items.length === 1 ? `tenés una decisión pendiente («${stop.items[0].title}»)` : `tenés ${stop.items.length} decisiones pendientes`}. Ninguna venció mientras no estabas.`;
    case 'deadline':
      return `El tiempo se detuvo antes de un vencimiento: ${stop.item.title}. Todavía estás a tiempo.`;
    case 'event':
      return `El tiempo se detuvo para que decidas vos: ${stop.text}`;
    default:
      return null;
  }
}
