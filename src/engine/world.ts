import { clamp, usd } from './money';
import { PHASES } from './economy/economy';
import type { GameState } from './state';
import { dateOf } from './time/calendar';
import { addLog } from './log';
import { fmtPct } from './format';
import { chance, randInt } from './rng';
import { indexBudget, hasEmployerInsurance } from './finance/budget';
import { payExpense, liquidity } from './finance/payments';
import { LIFESTYLE_BY_ID } from '../content/lifestyle';
import { JOB_BY_ID } from '../content/jobs';
import { studyHoursPerWeek } from './skills/education';
import { monthlyDebtPayments } from './finance/loans';
import { monthlyGrossIncome } from './career/career';
import { luckBias } from './skills/skills';
import { possessionEffects, imageScore } from './lifestyle/effects';
import { ageHealthPenalty, foundationReputation } from './saga/life';

/**
 * Cierre económico anual (1 de enero): los gastos recurrentes se indexan por la
 * inflación REALIZADA del año (acumulada mes a mes en economy.ts). Los precios,
 * la inflación y la tasa de interés evolucionan mensualmente (economy.ts).
 */
export function yearStartMacro(state: GameState): void {
  const m = state.macro;
  const prevYear = dateOf(state.day).y - 1;
  const realized = Math.round(m.yearInflationAcc * 10000) / 10000;
  m.history.push({ year: prevYear, inflation: realized, policyRate: m.policyRate });
  indexBudget(state, realized);
  m.yearInflationAcc = 0;
  addLog(
    state,
    'info',
    '📊',
    `Nuevo año económico. La inflación de ${prevYear} fue ${fmtPct(realized)}: tus gastos recurrentes subieron en esa proporción. Inflación actual: ${fmtPct(m.inflation)}; tasa de política: ${fmtPct(m.policyRate, 2)}; economía en ${PHASES[m.phase].name.toLowerCase()}.`,
  );
}

/** Evolución mensual de estrés, salud, reputación y red de contactos. */
export function monthlyAttributes(state: GameState): void {
  const a = state.player.attributes;
  const ls = LIFESTYLE_BY_ID[state.budget.lifestyle];
  const job = state.career.job ? JOB_BY_ID[state.career.job.jobId] : null;
  const study = studyHoursPerWeek(state);
  const load = (job?.hoursPerWeek ?? 0) + study;
  const disciplineRelief = 1 - state.skills.discipline.level * 0.003;
  // El estrés tiende a un nivel base (15) y las presiones lo empujan hacia arriba.
  const fx = possessionEffects(state);
  let pressure = (job?.stress ?? 0) * 0.6 + ls.stress + Math.max(0, load - 50) * 0.4 * disciplineRelief + fx.stress;
  const income = monthlyGrossIncome(state);
  if (income > 0 && monthlyDebtPayments(state) / income > 0.4) pressure += 4;
  if (state.ledger.balances.arrears > 0) pressure += 5;
  if (!job) {
    const liquid = liquidity(state).total;
    if (liquid < usd(1500)) pressure += 4;
  }
  a.stress = clamp(Math.round(a.stress + pressure - (a.stress - 15) * 0.2), 0, 100);
  // La salud tiende a un objetivo que depende del estilo de vida y del estrés.
  // 1.4: con los años la salud tiende a bajar (desde los 50).
  const healthTarget = clamp(80 + ls.health * 5 - Math.max(0, a.stress - 50) * 0.8 + fx.health * 10 - ageHealthPenalty(state), 10, 100);
  a.health = clamp(Math.round((a.health + (healthTarget - a.health) * 0.1 + fx.health) * 10) / 10, 0, 100);
  // La imagen personal suma a la reputación (hasta +10): cómo te presentás también construye tu nombre.
  const repTarget = (job ? job.level * 12 : 5) + state.education.certificates.length * 2 + ls.reputation * 3 + imageScore(state) / 10 + foundationReputation(state);
  a.reputation = clamp(Math.round((a.reputation + (repTarget - a.reputation) * 0.05) * 10) / 10, 0, 100);
  if (job) a.network = clamp(Math.round((a.network + job.level * 0.2) * 10) / 10, 0, 100);
  if (fx.network > 0 && a.network < 60) a.network = clamp(Math.round((a.network + fx.network) * 10) / 10, 0, 60);
  if (a.stress >= 85) addLog(state, 'warning', '🥵', `Tu estrés está en ${a.stress}/100. Afecta tu desempeño y tu salud.`);
}

/**
 * Imprevisto médico mensual. No es un castigo arbitrario: la probabilidad
 * depende de tu salud y el costo de si tenés seguro.
 */
export function medicalRisk(state: GameState): { probability: number; insured: boolean } {
  const h = state.player.attributes.health;
  const p = clamp(0.015 + Math.max(0, 60 - h) * 0.003 - luckBias(state) * 0.3, 0.005, 0.25);
  return { probability: p, insured: hasEmployerInsurance(state) || state.budget.privateInsurance };
}

export function monthlyRandomEvents(state: GameState): void {
  if (state.meta.projection) return;
  const { probability, insured } = medicalRisk(state);
  if (chance(state, probability)) {
    const pi = state.macro.priceIndex;
    const cost = insured ? usd(randInt(state, 40, 150) * pi) : usd(randInt(state, 300, 2500) * pi);
    addLog(
      state,
      'warning',
      '🩺',
      insured
        ? 'Tuviste un problema de salud. Tu seguro cubrió la mayor parte: pagaste solo el copago.'
        : 'Tuviste un problema de salud sin seguro médico: pagaste la atención completa.',
      cost,
    );
    payExpense(state, 'health', cost, { memo: 'Atención médica', tag: 'medical', method: 'checking' });
    if (state.career.job && state.player.attributes.health < 30) state.career.job.performance = Math.max(0, state.career.job.performance - 10);
  }
}
