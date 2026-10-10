import type { GameState, LogItem } from './state';
import { dateOf, isLastDayOfMonth, startOfMonth } from './time/calendar';
import { accrueDaily, monthEndBanking, processDeposits } from './finance/banking';
import { processCardDue, processCardEndOfDay } from './finance/creditCard';
import { processLoans } from './finance/loans';
import { processRecurring } from './finance/budget';
import { refreshCreditScore } from './finance/credit';
import { monthEndCareer, processApplications, processReview } from './career/career';
import { processEducation } from './skills/education';
import { fileAnnualReturn, processTaxes } from './tax/taxEngine';
import { monthlyAttributes, monthlyRandomEvents, yearStartMacro } from './world';
import { incomeStatement, cashFlowStatement, balanceSheet } from './reports/statements';
import { updateProgression } from './progression/progression';
import { companiesDay, companiesMonthEnd, refreshListings } from './business/simulate';
import { monthlyMacro } from './economy/economy';
import { investmentsDay } from './invest';
import { realEstateDay } from './realestate/realestate';
import { legalDay, legalMonth } from './legal/legal';
import { embezzlementMonth, prosMonthEnd } from './pros/pros';

/**
 * Orquestador diario. El ORDEN importa y está documentado en
 * docs/REGLAS_ECONOMICAS.md:
 *  1. Inicio de año (impuestos de empresas, declaración personal, indexación).
 *  2. Día 1 de cada mes: economía (ciclo, inflación, tasas trimestrales, eventos).
 *  3. Vencimientos (tarjeta) y respuestas (postulaciones).
 *  4. Formación, gastos recurrentes, cuotas, depósitos, impuestos, evaluaciones.
 *  5. Eventos del día 15.
 *  6. Empresas, mercados financieros, inmuebles e hipotecas, sistema legal.
 *  7. Cierre del día (acumulaciones de saldo, corte de tarjeta).
 *  8. Cierre de mes (empresas y grupos, profesionales, legal, nómina, intereses,
 *     atributos, puntaje, foto mensual).
 */
import { compactLedgers } from './ledger/compaction';
import { takeSnapshot as takeStateSnapshot } from './snapshot';
import { checkInvariants } from './invariants';
import { worldDay, worldMonth } from './world/rivals';
import { possessionsMonth } from './lifestyle/shops';
import { sagaDay, sagaMonth } from './saga/index';

export function advanceDay(state: GameState): void {
  state.day++;
  const g = dateOf(state.day);
  if (g.m === 1 && g.d === 1) yearStartMacro(state);
  if (g.d === 1) {
    monthlyMacro(state);
    worldMonth(state);
  }
  processCardDue(state);
  processApplications(state);
  processEducation(state);
  processRecurring(state);
  processLoans(state);
  processDeposits(state);
  processTaxes(state);
  processReview(state);
  if (g.d === 15) monthlyRandomEvents(state);

  companiesDay(state);
  if (!state.meta.projection && state.day % 60 === 0) refreshListings(state);
  investmentsDay(state);
  realEstateDay(state);
  legalDay(state);
  worldDay(state);
  sagaDay(state);

  accrueDaily(state);
  processCardEndOfDay(state);

  if (isLastDayOfMonth(state.day)) {
    embezzlementMonth(state);
    companiesMonthEnd(state);
    prosMonthEnd(state);
    legalMonth(state);
    monthEndCareer(state);
    monthEndBanking(state);
    possessionsMonth(state);
    monthlyAttributes(state);
    refreshCreditScore(state);
    // 31 de diciembre: la declaración del año (con el sueldo, los intereses y las empresas
    // transparentes de diciembre ya registrados) queda en los números de diciembre.
    if (dateOf(state.day).m === 12) fileAnnualReturn(state);
    takeSnapshot(state);
    sagaMonth(state); // antes del progreso: los logros de clasificación se ven el mismo día
    updateProgression(state);
    compactLedgers(state);
  }
}

export function takeSnapshot(state: GameState): void {
  const from = startOfMonth(state.day);
  const is = incomeStatement(state, from, state.day);
  const cf = cashFlowStatement(state, from, state.day);
  const bs = balanceSheet(state);
  state.history.push({
    day: state.day,
    netWorth: bs.netWorth,
    liquid: bs.liquid,
    assets: bs.totalAssets,
    liabilities: bs.totalLiabilities,
    income: is.grossIncome,
    expenses: is.totalExpensesBeforeTax + is.totalTaxes,
    cashIn: cf.cashIn,
    cashOut: cf.cashOut,
    creditScore: state.credit.score,
    stage: state.progression.stage,
  });
}

export interface SimReport {
  fromDay: number;
  toDay: number;
  netWorthBefore: number;
  netWorthAfter: number;
  liquidBefore: number;
  liquidAfter: number;
  logs: LogItem[];
}

export function simulateDays(state: GameState, days: number): SimReport {
  const before = balanceSheet(state);
  const lastLogId = lastLogIdOf(state);
  const fromDay = state.day;
  for (let i = 0; i < days; i++) advanceDay(state);
  return simReport(state, fromDay, before, lastLogId);
}

function simReport(state: GameState, fromDay: number, before: { netWorth: number; liquid: number }, lastLogId: number): SimReport {
  const after = balanceSheet(state);
  return {
    fromDay,
    toDay: state.day,
    netWorthBefore: before.netWorth,
    netWorthAfter: after.netWorth,
    liquidBefore: before.liquid,
    liquidAfter: after.liquid,
    logs: state.log.filter((l) => l.id > lastLogId),
  };
}

export function lastLogIdOf(state: GameState): number {
  return state.log.length ? state.log[state.log.length - 1].id : 0;
}

// ------------------------------------------------------------------ días atómicos

/** Un día que no se pudo simular. El estado quedó exactamente como al terminar el día anterior. */
export interface DayFailure {
  /** Día que se intentó simular. */
  day: number;
  kind: 'exception' | 'invariants';
  name: string;
  message: string;
  stack: string | null;
}

export type SafeDayResult = { ok: true; state: GameState } | { ok: false; state: GameState; failure: DayFailure };

export class InvariantViolation extends Error {
  constructor(readonly problems: string[]) {
    super(`Contabilidad inconsistente al cerrar el día: ${problems.slice(0, 3).join(' ')}`);
    this.name = 'InvariantViolation';
  }
}

function describeFailure(e: unknown, day: number): DayFailure {
  const err = e instanceof Error ? e : new Error(String(e));
  return {
    day,
    kind: err instanceof InvariantViolation ? 'invariants' : 'exception',
    name: err.name || 'Error',
    message: err.message || String(e),
    stack: err.stack ? err.stack.split('\n').slice(0, 12).join('\n') : null,
  };
}

/**
 * Avanza un día de forma atómica: o se aplica el día completo, o el estado
 * vuelve exactamente a como estaba. Si falla, devuelve el estado restaurado
 * (un objeto NUEVO: quien llama debe reemplazar su referencia) y la causa.
 *
 * Al cerrar cada mes también se verifican los invariantes contables: una
 * inconsistencia se trata como una falla del día, no se deja avanzar en silencio.
 * `step` permite a las pruebas simular fallas; en el juego es `advanceDay`.
 */
export function advanceDaySafe(state: GameState, step: (s: GameState) => void = advanceDay): SafeDayResult {
  const snap = takeStateSnapshot(state);
  const day = state.day + 1;
  try {
    step(state);
    if (isLastDayOfMonth(state.day)) {
      const problems = checkInvariants(state);
      if (problems.length) throw new InvariantViolation(problems);
    }
    return { ok: true, state };
  } catch (e) {
    return { ok: false, state: snap.restore(), failure: describeFailure(e, day) };
  }
}

export interface SafeRun {
  /** Estado final: el mismo objeto si todo salió bien, uno restaurado si un día falló. */
  state: GameState;
  report: SimReport;
  daysDone: number;
  failure: DayFailure | null;
}

/** Simula varios días con días atómicos: se detiene en el primero que falla. */
export function simulateDaysSafe(state: GameState, days: number, step?: (s: GameState) => void): SafeRun {
  const before = balanceSheet(state);
  const lastLogId = lastLogIdOf(state);
  const fromDay = state.day;
  let cur = state;
  let failure: DayFailure | null = null;
  let done = 0;
  for (let i = 0; i < days; i++) {
    const r = advanceDaySafe(cur, step);
    cur = r.state;
    if (!r.ok) {
      failure = r.failure;
      break;
    }
    done++;
  }
  return { state: cur, report: simReport(cur, fromDay, before, lastLogId), daysDone: done, failure };
}
