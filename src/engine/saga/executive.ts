import type { GameState } from '../state';
import type { Cents } from '../money';
import { usd, roundCents } from '../money';
import { dateOf, daysInMonth } from '../time/calendar';
import { ActionResult, FAIL, OK } from '../result';
import { addLog } from '../log';
import { fmtMoney } from '../format';
import { payExpense, spendable } from '../finance/payments';
import { EXEC_FREE_COMPANIES, execAdjustment, isOpen } from '../business/common';
import { chronicle } from './chronicle';

/**
 * EQUIPO DIRECTIVO (1.4): el costo de la complejidad. Con más de 4 empresas
 * operando, los gerentes pierden eficacia si nadie coordina (8 puntos de
 * habilidad por empresa extra, hasta 30). Un equipo directivo (director general,
 * finanzas y operaciones) cuesta cada mes, evita esa pérdida y suma 5 puntos.
 */
export function operatingCompanies(state: GameState): number {
  return state.companies.filter((c) => isOpen(c) && !c.npc && c.sector !== 'holding').length;
}

export function execCost(state: GameState): Cents {
  return usd((6000 + 1500 * operatingCompanies(state)) * state.macro.priceIndex);
}

export function execStatus(state: GameState): { companies: number; free: number; adjustment: number; hired: boolean; cost: Cents } {
  return { companies: operatingCompanies(state), free: EXEC_FREE_COMPANIES, adjustment: execAdjustment(state), hired: !!state.saga.exec?.hired, cost: execCost(state) };
}

export function hireExecTeam(state: GameState): ActionResult {
  if (state.saga.exec?.hired) return FAIL('Ya tenés un equipo directivo.');
  if (operatingCompanies(state) < 2) return FAIL('Con una sola empresa no hace falta un equipo directivo.');
  // Lo que queda de este mes se paga hoy (proporcional); desde el día 1, el mes completo.
  const g = dateOf(state.day);
  const dim = daysInMonth(g.y, g.m);
  const first = roundCents((execCost(state) * (dim - g.d + 1)) / dim);
  if (spendable(state) < first) return FAIL(`Necesitás ${fmtMoney(first, { decimals: false })} disponibles para lo que queda del mes.`);
  const paid = payExpense(state, 'other_expense', first, { memo: 'Equipo directivo (resto del mes)', tag: 'saga:exec', method: 'checking', allowArrears: false });
  if (!paid.ok) return FAIL(`No se pudo pagar el primer mes del equipo directivo (${fmtMoney(first, { decimals: false })}).`);
  state.saga.exec = { hired: true, since: state.day };
  chronicle(state, 'empresa', 'network', 'Contrataste un equipo directivo', 'Un director general, uno de finanzas y uno de operaciones coordinan tus empresas.');
  return OK(`Equipo directivo contratado: ${fmtMoney(execCost(state), { decimals: false })} por mes. Tus gerentes rinden más.`);
}

export function dismissExecTeam(state: GameState): ActionResult {
  if (!state.saga.exec?.hired) return FAIL('No tenés un equipo directivo.');
  state.saga.exec = null;
  return OK('Despediste al equipo directivo.');
}

/** Día 1 de cada mes: se paga el equipo; si no alcanza, se va. */
export function execMonth(state: GameState): void {
  if (!state.saga?.exec?.hired) return;
  if (operatingCompanies(state) < 2) {
    state.saga.exec = null;
    addLog(state, 'info', '🧭', 'Con menos de dos empresas operando ya no hace falta un equipo directivo: se desarmó y no se cobra más.');
    return;
  }
  const cost = execCost(state);
  // Solo con dinero disponible: no se paga con la tarjeta ni con deuda.
  const r = spendable(state) >= cost ? payExpense(state, 'other_expense', cost, { memo: 'Equipo directivo (sueldos)', tag: 'saga:exec', method: 'checking', allowArrears: false }) : { ok: false };
  if (!r.ok) {
    state.saga.exec = null;
    addLog(state, 'danger', '🧭', `No alcanzó para pagar al equipo directivo (${fmtMoney(cost, { decimals: false })}): renunció.`, undefined, 'ofertas');
  }
}
