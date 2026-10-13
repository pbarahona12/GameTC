import type { GameState } from '../state';
import type { AgendaTarget } from './agenda';
import { ActionResult, OK } from '../result';
import { monthlyRecurring } from '../finance/budget';
import { spendable } from '../finance/payments';
import { dateOf, dayOf } from '../time/calendar';
import type { Cents } from '../money';

/**
 * TU PRIMER MES (1.4): reemplaza el "leé primero" por tres decisiones guiadas
 * con resultado inmediato. Cada paso se cumple por lo que pasa de verdad en la
 * partida (o al tocarlo, si es solo revisar algo). Nunca bloquea nada y se
 * puede ocultar.
 */
export interface FirstStep {
  id: string;
  title: string;
  body: string;
  action: string;
  target: AgendaTarget;
  done: boolean;
}

const hasApplied = (s: GameState) => s.career.applications.length > 0 || s.career.job !== null || s.career.history.length > 0;
const usedFirstSalary = (s: GameState) => s.ledger.balances.savings > 0 || s.bank.deposits.length > 0 || Object.keys(s.funds.holdings).length > 0 || s.stocks.trades.length > 0 || s.realEstate.properties.some((p) => p.owner.kind === 'personal') || s.companies.length > 0;
/** Un ingreso propio sin empleo también cuenta: una empresa o un inmueble alquilado. */
const hasIncome = (s: GameState) => s.career.job !== null || s.career.history.length > 0 || s.companies.length > 0 || s.realEstate.properties.some((p) => p.owner.kind === 'personal' && p.lease);

/** Se postuló, pero todas sus postulaciones terminaron sin oferta: hay que volver a postularse. */
const waitingNothing = (s: GameState) => !hasIncome(s) && s.career.applications.length > 0 && !s.career.applications.some((a) => a.status === 'pending' || a.status === 'offer');

/**
 * OBJETIVO INMEDIATO CON RELOJ (1.6, auditoría E7): mientras no tengas ingresos, el
 * primer mes tiene una meta concreta y visible: llegar al próximo alquiler (el día 1)
 * con un ingreso. Muestra cuántos días faltan y cuántos meses de gastos cubren tus
 * ahorros. Desaparece cuando conseguís un ingreso.
 */
export interface FirstGoal {
  /** Día del próximo alquiler. */
  dueDay: number;
  daysLeft: number;
  /** Gastos fijos de un mes (todos, con el estilo de vida actual). */
  monthCost: Cents;
  /** Lo que podés gastar hoy. */
  cash: Cents;
  /** Meses de gastos que cubre lo que tenés (con un decimal). */
  monthsCovered: number;
}

export function firstGoal(s: GameState): FirstGoal | null {
  if (hasIncome(s) || !firstMonthActive(s)) return null;
  const g = dateOf(s.day);
  const dueDay = g.m === 12 ? dayOf(g.y + 1, 1, 1) : dayOf(g.y, g.m + 1, 1);
  const monthCost = monthlyRecurring(s);
  const cash = Math.max(0, spendable(s));
  return { dueDay, daysLeft: dueDay - s.day, monthCost, cash, monthsCovered: monthCost > 0 ? Math.floor((cash / monthCost) * 10) / 10 : 99 };
}

export function firstMonthSteps(s: GameState): FirstStep[] {
  const fm = s.saga.firstMonth;
  const marked = (id: string) => fm.done.includes(id);
  // 1.6: «Mirá cuánto te cuesta vivir» (una lectura) se reemplazó por el objetivo con
  // reloj (firstGoal). Las partidas viejas que lo tenían marcado no se ven afectadas.
  return [
    { id: 'postular', title: 'Postulate a dos o tres empleos', body: 'En Carrera → Vacantes, elegí puestos cuyos requisitos cumplas. Cada postulación tarda unos días en responderse y puede ser rechazada: con dos o tres es mucho más probable que llegue una oferta.', action: 'Ver vacantes', target: { kind: 'tab', tab: 'career', sub: 'board' }, done: marked('postular') || hasApplied(s) || s.companies.length > 0 },
    { id: 'tiempo', title: 'Poné el tiempo en marcha', body: 'Tocá ▶ arriba (o este botón). El juego se pausa solo cuando llega una oferta o algo importante.', action: 'Poner en marcha', target: { kind: 'tab', tab: 'home' }, done: marked('tiempo') || s.day >= 2 },
    waitingNothing(s)
      ? { id: 'empleo', title: 'Aceptá tu primera oferta', body: 'Te rechazaron y no te queda ninguna postulación abierta: postulate a otros puestos (al mismo podés volver en 30 días). Mientras tanto, cada mes sin sueldo achica tus ahorros.', action: 'Ver vacantes', target: { kind: 'tab', tab: 'career', sub: 'board' }, done: marked('empleo') || hasIncome(s) }
      : { id: 'empleo', title: 'Aceptá tu primera oferta', body: 'Cuando llegue, tenés 7 días para aceptarla (o negociar el sueldo).', action: 'Ver ofertas', target: { kind: 'tab', tab: 'career', sub: 'job' }, done: marked('empleo') || hasIncome(s) },
    { id: 'cierre', title: 'Cerrá tu primer mes', body: 'El último día del mes ves cuánto entró, cuánto salió y cuánto te quedó.', action: 'Seguir', target: { kind: 'tab', tab: 'home' }, done: marked('cierre') || s.history.length > 0 },
    { id: 'decidir', title: 'Decidí qué hacer con lo que sobra', body: 'Guardalo en la cuenta de ahorro (fondo de emergencia), abrí un depósito o invertí en un fondo índice desde $50.', action: 'Ir a mis cuentas', target: { kind: 'tab', tab: 'finance', sub: 'accounts' }, done: marked('decidir') || usedFirstSalary(s) },
  ];
}

/** ¿Se muestra la guía? Hasta completarla o ocultarla (y nunca después del primer año). */
export function firstMonthActive(s: GameState): boolean {
  const fm = s.saga?.firstMonth;
  if (!fm || fm.dismissed || s.day > 365) return false;
  return firstMonthSteps(s).some((x) => !x.done);
}

export function markFirstStep(s: GameState, id: string): ActionResult {
  const fm = s.saga.firstMonth;
  if (!fm.done.includes(id)) fm.done.push(id);
  return OK();
}

export function dismissFirstMonth(s: GameState): ActionResult {
  s.saga.firstMonth.dismissed = true;
  return OK();
}
