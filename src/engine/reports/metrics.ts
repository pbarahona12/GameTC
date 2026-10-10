import { COURSE_BY_ID } from '../../content/courses';
import type { Cents } from '../money';
import { roundCents } from '../money';
import type { GameState } from '../state';
import { balanceSheet } from './statements';
import { payroll } from '../tax/incomeTax';
import { residence } from '../tax/taxEngine';
import { monthlyRecurring } from '../finance/budget';
import { monthlyDebtPayments } from '../finance/loans';
import { savingsRate, depositInterest } from '../finance/banking';
import { tuition } from '../skills/education';
import { JOB_BY_ID } from '../../content/jobs';

/**
 * Indicadores derivados SIEMPRE de datos reales de la partida.
 * Los campos "expected*" son estimaciones y así se etiquetan en la interfaz.
 */
export interface Metrics {
  netWorth: Cents;
  totalAssets: Cents;
  totalLiabilities: Cents;
  liquid: Cents;
  investments: Cents;
  /** Acciones, bonos, fondos, Mogul y cuentas con gestor a valor de mercado. */
  securities: Cents;
  realEstate: Cents;
  /** Tu parte de las ganancias mensuales de tus empresas (promedio 3 meses, 1.2). */
  businessPassive: Cents;
  mortgages: Cents;
  /** Cuotas hipotecarias personales mensuales. */
  mortgagePayments: Cents;
  /** Alquileres mensuales de contratos vigentes (personales). */
  rentIncome: Cents;
  pension: Cents;
  debt: Cents;
  monthlyGross: Cents;
  expectedNetPay: Cents;
  essentialMonthly: Cents;
  recurringMonthly: Cents;
  debtPayments: Cents;
  tuitionMonthly: Cents;
  passiveMonthly: Cents;
  expectedMonthlyNet: Cents;
  runwayMonths: number | null;
  runwayRange: [number, number] | null;
  dti: number | null;
  cardUtilization: number;
  emergencyMonths: number;
  debtToAssets: number;
  currentRatio: number | null;
  lastMonth: { income: Cents; expenses: Cents; cashIn: Cents; cashOut: Cents } | null;
}

export function computeMetrics(state: GameState): Metrics {
  const b = state.ledger.balances;
  const bs = balanceSheet(state);
  const job = state.career.job;
  const pr = job ? payroll(residence(state), job.salary, state.bank.pensionRate) : null;
  const commission = job && JOB_BY_ID[job.jobId].commission ? roundCents(job.salary * JOB_BY_ID[job.jobId].commission! * (job.performance / 50) * 0.75) : 0;
  const expectedNetPay = pr ? pr.net + commission : 0;
  const essentialMonthly = monthlyRecurring(state, true); // ya incluye el seguro médico privado
  const recurringMonthly = monthlyRecurring(state);
  const mortgagePayments = state.realEstate.mortgages.filter((mm) => mm.status === 'activa' && mm.owner.kind === 'personal').reduce((s, mm) => s + mm.payment, 0);
  const debtPayments = monthlyDebtPayments(state) + mortgagePayments;
  const personalProps = state.realEstate.properties.filter((p) => p.owner.kind === 'personal');
  const rentIncome = personalProps.reduce((s, p) => s + (p.lease?.rent ?? 0), 0);
  const propertyCosts = personalProps.reduce((s, p) => s + Math.round(p.appraisal * ((1 - p.landShare) * 0.001 + 0.01 / 12)), 0);
  const tuitionMonthly = state.education.active.reduce((s, a) => s + tuition(state, COURSE_BY_ID[a.courseId]), 0);
  const depositMonthly = state.bank.deposits.reduce((s, d) => s + depositInterest(d) / Math.max(1, d.termMonths), 0);
  const securities = b.stocks + b.bonds + b.funds + b.mogul + (b.managed ?? 0);
  // Tu parte de las ganancias de tus empresas (promedio de los últimos 3 meses, si es positivo):
  // también es ingreso más allá del salario, aunque la empresa lo reinvierta.
  const businessPassive = state.companies.filter((c) => !c.parentId && c.status === 'active' && c.history.length >= 3).reduce((acc, c) => {
    const avg = c.history.slice(-3).reduce((a, h) => a + h.netIncome, 0) / 3;
    return acc + Math.max(0, Math.round(avg * c.ownership));
  }, 0);
  const passiveMonthly = roundCents((b.savings * savingsRate(state)) / 12 + depositMonthly + rentIncome * 0.9 - propertyCosts + securities * 0.02 / 12 + businessPassive);
  const expectedMonthlyNet = expectedNetPay + passiveMonthly - recurringMonthly - debtPayments - tuitionMonthly;
  const liquid = bs.liquid;
  let runwayMonths: number | null = null;
  let runwayRange: [number, number] | null = null;
  if (expectedMonthlyNet < 0) {
    const burn = -expectedMonthlyNet;
    runwayMonths = liquid / burn;
    // Rango: gastos entre −5 % y +10 % de lo presupuestado (imprevistos, variaciones).
    const outflows = recurringMonthly + debtPayments + tuitionMonthly;
    const inflows = expectedNetPay + passiveMonthly;
    const hiBurn = outflows * 1.1 - inflows;
    const loBurn = outflows * 0.95 - inflows;
    runwayRange = [liquid / Math.max(1, hiBurn), loBurn > 0 ? liquid / loBurn : Infinity];
  }
  const debt = b.credit_card + b.personal_loans + b.arrears + b.taxes_payable + b.mortgages + b.fines_payable;
  // Pasivo corriente: tarjeta, atrasos, impuestos y la porción de préstamos que vence en 12 meses.
  const loanPayments = state.bank.loans.filter((l) => l.status !== 'paid').reduce((s, l) => s + l.payment, 0);
  const current = b.credit_card + b.arrears + b.taxes_payable + b.fines_payable + Math.min(b.personal_loans, loanPayments * 12) + mortgagePayments * 12;
  const last = state.history[state.history.length - 1];
  return {
    netWorth: bs.netWorth,
    totalAssets: bs.totalAssets,
    totalLiabilities: bs.totalLiabilities,
    liquid,
    investments: b.term_deposits + securities,
    securities,
    realEstate: b.real_estate,
    businessPassive,
    mortgages: b.mortgages,
    mortgagePayments,
    rentIncome,
    pension: b.pension,
    debt,
    monthlyGross: job?.salary ?? 0,
    expectedNetPay,
    essentialMonthly,
    recurringMonthly,
    debtPayments,
    tuitionMonthly,
    passiveMonthly,
    expectedMonthlyNet,
    runwayMonths,
    runwayRange,
    dti: job && job.salary + rentIncome > 0 ? debtPayments / (job.salary + rentIncome) : rentIncome > 0 ? debtPayments / rentIncome : null,
    cardUtilization: state.bank.card.limit > 0 ? b.credit_card / state.bank.card.limit : 0,
    emergencyMonths: essentialMonthly > 0 ? (b.savings + b.term_deposits) / essentialMonthly : 0,
    debtToAssets: bs.totalAssets > 0 ? debt / bs.totalAssets : debt > 0 ? Infinity : 0,
    currentRatio: current > 0 ? liquid / current : null,
    lastMonth: last ? { income: last.income, expenses: last.expenses, cashIn: last.cashIn, cashOut: last.cashOut } : null,
  };
}
