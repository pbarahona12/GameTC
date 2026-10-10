import type { GameState } from '../engine/state';
import type { Company } from '../engine/business/types';
import { store } from './store';
import { computeMetrics } from '../engine/reports/metrics';
import { analyze } from '../engine/advisor/advisor';
import { evaluateStage } from '../engine/progression/progression';
import { incomeStatement, cashFlowStatement } from '../engine/reports/statements';
import { startOfMonth, last30Start } from '../engine/time/calendar';
import { consolidated, coIncomeStatement, coCashFlow, coMetrics, valuation } from '../engine/business/reports';
import { analyzeCompany } from '../engine/business/advisor';
import { consolidateGroup, groupRisks } from '../engine/business/groups';
import { projectCurrentYear } from '../engine/tax/taxEngine';
import { quoteAll } from '../engine/finance/loans';
import { agenda } from '../engine/saga/agenda';
import { playerPosition, cityTable, globalTable } from '../engine/saga/ranking';
import { suggestedGoals, GOAL_BY_ID } from '../engine/saga/goals';
import type { JurisdictionId } from '../content/jurisdictions';

/**
 * CÁLCULOS DERIVADOS DE LA PARTIDA para la interfaz (usar con useDerived).
 * Cada uno es una función pura y estable: el store la ejecuta una sola vez por
 * cambio de la partida y comparte el resultado entre pantallas. Las empresas se
 * pasan por id (los parámetros forman la clave del caché).
 */

function company(s: GameState, id: number): Company {
  const co = s.companies.find((c) => c.id === id);
  if (!co) throw new Error(`Empresa ${id} inexistente.`);
  return co;
}

export const metricsOf = (s: GameState) => computeMetrics(s);

/** Análisis del asesor (todas las categorías: el filtro de Ajustes se aplica al mostrar). */
export const insightsOf = (s: GameState) => analyze(s, store.derive(metricsOf, []));

export const stageOf = (s: GameState) => evaluateStage(s, store.derive(metricsOf, []));

/** Estado de resultados y flujo de caja del mes en curso. */
export const monthOf = (s: GameState) => {
  const from = startOfMonth(s.day);
  return { is: incomeStatement(s, from, s.day), cf: cashFlowStatement(s, from, s.day) };
};

/** Estado de resultados del mes calendario anterior (null en el primer mes). */
export const lastMonthOf = (s: GameState) => {
  const prevEnd = startOfMonth(s.day) - 1;
  return prevEnd >= 0 ? incomeStatement(s, startOfMonth(prevEnd), prevEnd) : null;
};

export const incomeOf = (s: GameState, from: number, to: number) => incomeStatement(s, from, to);
export const cashFlowOf = (s: GameState, from: number, to: number) => cashFlowStatement(s, from, to);
export const taxProjectionOf = (s: GameState) => projectCurrentYear(s);
export const loanOffersOf = (s: GameState, amount: number, term: number) => quoteAll(s, amount, term);

/** Consolidado de las empresas de los últimos 30 días. */
export const businessesOf = (s: GameState) => consolidated(s, last30Start(s.day), s.day);

export const groupOf = (s: GameState, rootId: number) => {
  const root = company(s, rootId);
  return consolidateGroup(s, root, Math.max(root.foundedDay, last30Start(s.day)), s.day);
};
export const groupRisksOf = (s: GameState, rootId: number) => groupRisks(s, company(s, rootId));

export const coMetricsOf = (s: GameState, id: number) => coMetrics(s, company(s, id));
export const coInsightsOf = (s: GameState, id: number) => analyzeCompany(s, company(s, id));
export const coValuationOf = (s: GameState, id: number) => valuation(s, company(s, id));
export const coIncomeOf = (s: GameState, id: number, from: number) => coIncomeStatement(company(s, id), from, s.day);
export const coCashFlowOf = (s: GameState, id: number, from: number) => coCashFlow(company(s, id), from, s.day);

// ------------------------------------------------------------------ 1.4 · la historia del magnate

export const agendaOf = (s: GameState) => agenda(s);

/** Tu puesto en tu ciudad (exacto o estimado) y en el mundo, con el patrimonio de hoy. */
export const positionOf = (s: GameState) => playerPosition(s, store.derive(metricsOf, []).netWorth);

export const cityTableOf = (s: GameState, city: JurisdictionId | 'global') => {
  const nw = store.derive(metricsOf, []).netWorth;
  return city === 'global' ? globalTable(s, nw) : cityTable(s, city, nw);
};

export const goalsOf = (s: GameState) => {
  const m = store.derive(metricsOf, []);
  return {
    active: s.saga.goals.active.filter((a) => GOAL_BY_ID[a.id]).map((a) => ({ ...a, def: GOAL_BY_ID[a.id], p: GOAL_BY_ID[a.id].check(s, m) })),
    suggested: suggestedGoals(s, m).map((def) => ({ def, p: def.check(s, m) })),
  };
};
