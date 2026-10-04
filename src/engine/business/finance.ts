import type { GameState } from '../state';
import type { Company, CoLoan } from './types';
import { coLog, coPay, isOpen, px } from './common';
import { coPost } from './companyLedger';
import { coIncomeStatement, coMetrics, coBalanceSheet } from './reports';
import { amortizedPayment, amortizationSchedule } from '../finance/loans';
import { Cents, roundCents, clamp } from '../money';
import { ActionResult, FAIL, OK } from '../result';
import { fmtMoney, fmtPct } from '../format';
import { addMonths, dayOf } from '../time/calendar';
import { LEGAL_FORM_BY_ID, CORPORATE_LOSS_CARRY_YEARS } from '../../content/sectors';
import { recordInquiry } from '../finance/credit';
import { settleArrears } from './common';
import { coPeriodTotals } from './companyLedger';
import { jurisdictionById } from '../../content/jurisdictions';
import { chance } from '../rng';
import { companyFilingErrorRisk } from '../pros/pros';
import { recordCompanyEvasion, recordLoanFraud } from '../legal/hooks';
import { formatDate } from '../time/calendar';
import { creditSpread } from '../economy/economy';

// ------------------------------------------------------------ Préstamos

export interface BizBank {
  id: string;
  name: string;
  tagline: string;
  spread: number;
  requiresGuarantee: boolean;
  minDaysOpen: number;
  maxTerm: number;
  fee: number;
}

export const BIZ_BANKS: BizBank[] = [
  { id: 'austral_pyme', name: 'Banco Austral PyME', tagline: 'Presta a empresas con historia y ganancias', spread: 5, requiresGuarantee: false, minDaysOpen: 180, maxTerm: 60, fee: 0.01 },
  { id: 'andino_emp', name: 'Crédito Andino Empresas', tagline: 'Presta a empresas nuevas con tu garantía personal', spread: 9, requiresGuarantee: true, minDaysOpen: 0, maxTerm: 48, fee: 0.02 },
];

export interface CoLoanOffer {
  bank: BizBank;
  approved: boolean;
  reasons: string[];
  apr: number;
  payment: Cents;
  fee: Cents;
  totalInterest: Cents;
  dscr: number | null;
  maxAmount: Cents;
}

export function quoteCoLoan(state: GameState, co: Company, bank: BizBank, amount: Cents, term: number): CoLoanOffer {
  const reasons: string[] = [];
  const m = coMetrics(state, co);
  const is = coIncomeStatement(co, Math.max(co.openDay, state.day - 89), state.day);
  const monthsData = Math.max(1, (state.day - Math.max(co.openDay, state.day - 89) + 1) / 30.4);
  // Libros inflados (fraude ficticio): el banco ve un EBITDA mayor al real.
  const ebitdaMonthly = (is.ebitda / monthsData) * (1 + clamp(co.irregular.inflatedBooks, 0, 1));
  const bs = coBalanceSheet(co);
  const collateral = roundCents(co.ledger.balances.fixed_assets * 0.5 + co.ledger.balances.inventory * 0.5 + co.ledger.balances.receivables * 0.7);
  const riskPremium = bs.equity <= 0 ? 4 : m.consecutiveLossMonths >= 3 ? 2 : 0;
  const audited = (state.pros?.audits ?? []).some((a) => a.companyId === co.id && a.clean && a.validUntil >= state.day);
  const apr = state.macro.policyRate + (bank.spread + riskPremium) / 100 + creditSpread(state) - (audited ? 0.005 : 0);
  const payment = amortizedPayment(amount, apr, term);
  const existing = co.loans.filter((l) => l.balance > 0).reduce((s, l) => s + l.payment, 0);
  const dscr = ebitdaMonthly > 0 ? ebitdaMonthly / (payment + existing) : null;
  let maxAmount: Cents;
  if (bank.requiresGuarantee) maxAmount = collateral + roundCents(Math.max(0, co.ledger.balances.cash) * 0.5) + px(state, 10000);
  else maxAmount = Math.max(0, roundCents(ebitdaMonthly * 12 * 3));
  if (!isOpen(co)) reasons.push('La empresa no está operando.');
  if (co.status === 'insolvent' || co.ledger.balances.arrears > 0) reasons.push('La empresa tiene deudas vencidas.');
  if (state.day - co.foundedDay < bank.minDaysOpen) reasons.push(`Se exigen ${bank.minDaysOpen} días de antigüedad.`);
  if (term > bank.maxTerm) reasons.push(`Plazo máximo: ${bank.maxTerm} meses.`);
  if (amount < px(state, 1000)) reasons.push(`Monto mínimo: ${fmtMoney(px(state, 1000))}.`);
  if (amount > maxAmount) reasons.push(`Monto máximo según ${bank.requiresGuarantee ? 'garantías' : 'ganancias (3 × EBITDA anual)'}: ${fmtMoney(maxAmount)}.`);
  if (!bank.requiresGuarantee && (dscr === null || dscr < 1.25)) reasons.push('La empresa no genera suficiente EBITDA para cubrir 1.25 veces las cuotas.');
  if (bank.requiresGuarantee && state.credit.score < 640) reasons.push(`Tu puntaje personal (${state.credit.score}) está por debajo de 640, requerido para garantizar.`);
  const sched = amortizationSchedule(amount, apr, term);
  return {
    bank, approved: reasons.length === 0, reasons, apr, payment, fee: roundCents(amount * bank.fee),
    totalInterest: sched.reduce((s, r) => s + r.interest, 0), dscr, maxAmount,
  };
}

export function takeCoLoan(state: GameState, co: Company, bankId: string, amount: Cents, term: number): ActionResult {
  const bank = BIZ_BANKS.find((b) => b.id === bankId);
  if (!bank) return FAIL('Banco inexistente.');
  if (!Number.isSafeInteger(amount) || amount <= 0) return FAIL('Ingresá un monto mayor a cero.');
  const q = quoteCoLoan(state, co, bank, amount, term);
  if (bank.requiresGuarantee) recordInquiry(state);
  if (!q.approved) return FAIL('Rechazado: ' + q.reasons.join(' '));
  coPost(co.ledger, {
    day: state.day, memo: `Préstamo ${bank.name}`, cf: 'financing', tag: 'coloan:disburse',
    lines: [{ account: 'cash', debit: amount - q.fee }, { account: 'admin', debit: q.fee }, { account: 'loans', credit: amount }],
  });
  const loan: CoLoan = { id: state.meta.nextId++, bankId, principal: amount, balance: amount, apr: q.apr, termMonths: term, payment: q.payment, nextDueDay: addMonths(state.day, 1), paymentsMade: 0, missed: 0, guaranteed: bank.requiresGuarantee };
  if (co.irregular.inflatedBooks > 0) recordLoanFraud(state, co, amount);
  co.loans.push(loan);
  coLog(state, co, 'info', '🏦', `recibió un préstamo de ${fmtMoney(amount)} al ${fmtPct(q.apr, 2)} (${term} meses).`, amount);
  return OK(`Préstamo acreditado en ${co.name}. Cuota: ${fmtMoney(q.payment)}.`);
}

export function processCoLoans(state: GameState, co: Company): void {
  for (const l of co.loans) {
    if (l.balance <= 0 || l.nextDueDay !== state.day) continue;
    const interest = roundCents((l.balance * l.apr) / 12);
    // Bonos: el vencimiento llega en su fecha aunque se haya atrasado algún cupón.
    const due = l.bullet ? (l.paymentsMade + l.missed + 1 >= l.termMonths ? l.balance + interest : interest) : Math.max(interest, Math.min(l.payment, l.balance + interest));
    const principal = due - interest;
    if (co.ledger.balances.cash >= due) {
      coPost(co.ledger, { day: state.day, memo: l.bullet ? (principal > 0 ? 'Vencimiento de bonos (capital e intereses)' : 'Cupón de bonos') : 'Cuota de préstamo', cf: 'financing', tag: 'coloan:payment', lines: [{ account: 'loans', debit: principal }, { account: 'interest', debit: interest }, { account: 'cash', credit: due }] });
      l.paymentsMade++;
    } else {
      // Cuota impaga: pasa a deuda vencida con recargo.
      const fee = Math.max(100, roundCents(due * 0.05));
      coPost(co.ledger, {
        day: state.day, memo: 'Cuota de préstamo impaga', cf: 'internal', tag: 'coloan:missed',
        lines: [{ account: 'loans', debit: principal }, { account: 'interest', debit: interest }, { account: 'penalties', debit: fee }, { account: 'arrears', credit: due + fee }],
      });
      co.arrears.push({ id: state.meta.nextId++, kind: 'prestamo', amount: due + fee, since: state.day, label: 'Cuota de préstamo' });
      l.missed++;
      coLog(state, co, 'danger', '🏦', 'no pudo pagar la cuota del préstamo.');
    }
    l.balance -= principal;
    l.nextDueDay = addMonths(l.nextDueDay, 1);
  }
  co.loans = co.loans.filter((l) => l.balance > 0 || l.nextDueDay > state.day - 400);
}

export function prepayCoLoan(state: GameState, co: Company, loanId: number, amount: Cents): ActionResult {
  const l = co.loans.find((x) => x.id === loanId);
  if (!l || l.balance <= 0) return FAIL('Préstamo inexistente o cancelado.');
  const pay = Math.min(amount, l.balance);
  if (pay <= 0 || co.ledger.balances.cash < pay) return FAIL('Caja insuficiente.');
  coPost(co.ledger, { day: state.day, memo: 'Amortización anticipada de préstamo', cf: 'financing', tag: 'coloan:payment', lines: [{ account: 'loans', debit: pay }, { account: 'cash', credit: pay }] });
  l.balance -= pay;
  if (l.balance > 0) l.payment = l.bullet ? roundCents((l.balance * l.apr) / 12) : amortizedPayment(l.balance, l.apr, Math.max(1, l.termMonths - l.paymentsMade));
  return OK('Pago anticipado aplicado.');
}

// ------------------------------------------------------------ Impuestos

/**
 * Cierre fiscal anual (1 de enero, para el año que terminó):
 *  - SRL y corporación: 25 % sobre el beneficio antes de impuestos, restando
 *    pérdidas de hasta 5 años anteriores. Vence el 30 de abril.
 *  - Individual y sociedad: sin impuesto empresarial; la parte del jugador del
 *    resultado se suma (o resta) a su declaración personal.
 */
export function closeCompanyYear(state: GameState, co: Company, year: number): void {
  const from = Math.max(dayOf(year, 1, 1), co.acquiredDay ?? co.foundedDay);
  const to = dayOf(year, 12, 31);
  if (to < from) return;
  const is = coIncomeStatement(co, from, to);
  const t = coPeriodTotals(co.ledger, from, to);
  // El resultado de subsidiarias ya tributó en cada subsidiaria (exención por participación).
  const profit = is.preTax - t.subsidiary_results;
  const lf = LEGAL_FORM_BY_ID[co.legalForm];
  const j = jurisdictionById(co.jurisdiction);
  if (lf.passThrough) {
    const share = roundCents(profit * co.ownership);
    state.tax.ytd.business = (state.tax.ytd.business ?? 0) + share;
    co.taxFilings.push({ year, profit, carryUsed: 0, taxable: share, tax: 0, dueDay: state.day, outstanding: 0, passThrough: true });
    coLog(state, co, 'info', '🧾', `resultado ${year}: ${fmtMoney(profit)}. Como es ${lf.name.toLowerCase()}, tu parte (${fmtMoney(share)}) va a tu declaración personal.`);
    return;
  }
  co.lossCarry = co.lossCarry.filter((l) => year - l.year <= CORPORATE_LOSS_CARRY_YEARS && l.amount > 0);
  if (profit <= 0) {
    if (profit < 0) co.lossCarry.push({ year, amount: -profit });
    co.taxFilings.push({ year, profit, carryUsed: 0, taxable: 0, tax: 0, dueDay: state.day, outstanding: 0, passThrough: false });
    coLog(state, co, 'info', '🧾', `cerró ${year} con pérdida de ${fmtMoney(-profit)}: no paga impuesto y la pérdida compensa ganancias futuras (5 años).`);
    return;
  }
  // Evasión empresarial (ficticia): se declara menos beneficio del real.
  const hidden = roundCents(profit * clamp(co.irregular.underreport, 0, 0.9));
  let taxable = profit - hidden;
  let used = 0;
  for (const l of co.lossCarry) {
    const u = Math.min(l.amount, taxable);
    l.amount -= u;
    taxable -= u;
    used += u;
  }
  let tax = roundCents(taxable * j.corporateRate);
  // Sin contador, la declaración puede tener errores que luego se multan.
  let errorNote = '';
  if (chance(state, companyFilingErrorRisk(state, co.id))) {
    const penalty = roundCents(Math.max(tax * 0.08, 5000));
    tax += penalty;
    errorNote = ` La declaración tuvo errores (sin contador): multa de ${fmtMoney(penalty)} incluida.`;
  }
  if (tax > 0) coPost(co.ledger, { day: state.day, memo: `Impuesto empresarial ${year}`, cf: 'internal', tag: 'cotax:accrual', lines: [{ account: 'corporate_tax', debit: tax }, { account: 'taxes_payable', credit: tax }] });
  co.taxFilings.push({ year, profit, carryUsed: used, taxable, tax, dueDay: dayOf(year + 1, j.filingDeadline.month, j.filingDeadline.day), outstanding: tax, passThrough: false, hidden });
  if (hidden > 0) recordCompanyEvasion(state, co, year, roundCents(hidden * j.corporateRate), hidden);
  coLog(state, co, 'info', '🧾', `impuesto empresarial ${year}: ${fmtMoney(tax)} (${fmtPct(j.corporateRate, 0)} de ${fmtMoney(taxable)}${used ? `, tras compensar ${fmtMoney(used)} de pérdidas` : ''}). Vence el ${formatDate(dayOf(year + 1, j.filingDeadline.month, j.filingDeadline.day))}.${errorNote}`);
}

export function processCoTaxes(state: GameState, co: Company): void {
  for (const f of co.taxFilings) {
    if (f.outstanding <= 0 || f.dueDay !== state.day) continue;
    if (co.ledger.balances.cash >= f.outstanding) {
      coPost(co.ledger, { day: state.day, memo: `Pago de impuesto empresarial ${f.year}`, cf: 'operating', tag: 'cotax', lines: [{ account: 'taxes_payable', debit: f.outstanding }, { account: 'cash', credit: f.outstanding }] });
    } else {
      const fee = roundCents(f.outstanding * 0.05);
      coPost(co.ledger, {
        day: state.day, memo: `Impuesto ${f.year} vencido`, cf: 'internal', tag: 'cotax:late',
        lines: [{ account: 'taxes_payable', debit: f.outstanding }, { account: 'penalties', debit: fee }, { account: 'arrears', credit: f.outstanding + fee }],
      });
      co.arrears.push({ id: state.meta.nextId++, kind: 'impuestos', amount: f.outstanding + fee, since: state.day, label: `Impuesto empresarial ${f.year}` });
      coLog(state, co, 'danger', '🏛️', `no pudo pagar el impuesto empresarial de ${f.year}: multa del 5 % y deuda vencida.`);
    }
    f.outstanding = 0;
  }
}

// ------------------------------------------------------------ Insolvencia

export const INSOLVENCY_GRACE_DAYS = 60;

/**
 * Proceso de insolvencia comprensible:
 *  1. Cada día, la caja disponible paga primero las deudas vencidas.
 *  2. Con deudas vencidas la empresa pasa a "insolvente" y empieza un plazo de 60 días.
 *  3. Si en ese plazo no se regulariza (aportes, préstamos, ventas), se declara la quiebra
 *     y se liquida automáticamente (ver ownership.ts).
 * Devuelve true si corresponde declarar la quiebra hoy.
 */
export function insolvencyCheck(state: GameState, co: Company): boolean {
  if (co.ledger.balances.arrears > 0 && co.ledger.balances.cash > 0) settleArrears(state, co);
  if (co.ledger.balances.arrears > 0) {
    if (co.insolventSince === null) {
      co.insolventSince = state.day;
      co.status = 'insolvent';
      coLog(state, co, 'danger', '🚨', `entró en INSOLVENCIA: tiene ${fmtMoney(co.ledger.balances.arrears)} de deudas vencidas. Tenés ${INSOLVENCY_GRACE_DAYS} días para regularizar (aportar capital, pedir un préstamo, vender activos o cerrar ordenadamente) o se declarará la quiebra.`);
    } else {
      const left = INSOLVENCY_GRACE_DAYS - (state.day - co.insolventSince);
      if (left === 30 || left === 7) coLog(state, co, 'danger', '⏳', `quedan ${left} días para salir de la insolvencia antes de la quiebra.`);
      if (left <= 0) return true;
    }
  } else if (co.insolventSince !== null) {
    co.insolventSince = null;
    co.status = 'active';
    coLog(state, co, 'success', '✅', 'regularizó sus deudas y salió de la insolvencia.');
  }
  return false;
}

export function daysToBankruptcy(state: GameState, co: Company): number | null {
  return co.insolventSince === null ? null : Math.max(0, INSOLVENCY_GRACE_DAYS - (state.day - co.insolventSince));
}

export function coTaxRateLabel(co: Company): string {
  const lf = LEGAL_FORM_BY_ID[co.legalForm];
  const j = jurisdictionById(co.jurisdiction);
  return lf.passThrough ? 'Transparente: tributa en tu declaración personal' : `${fmtPct(j.corporateRate, 0)} empresarial + ${fmtPct(j.dividendRate, 0)} sobre dividendos (${j.name})`;
}

export function payCoArrearsNow(state: GameState, co: Company): ActionResult {
  if (co.ledger.balances.arrears <= 0) return FAIL('No hay deudas vencidas.');
  const paid = settleArrears(state, co);
  if (paid <= 0) return FAIL('La empresa no tiene caja. Aportá capital o pedí un préstamo.');
  return OK(`Se pagaron ${fmtMoney(paid)} de deudas vencidas.`);
}

export { coPay };
