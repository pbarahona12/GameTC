import { BANKS, BANK_BY_ID, BankDef } from '../../content/banks';
import { post } from '../ledger/ledger';
import { Cents, clamp, roundCents, usd } from '../money';
import type { GameState, Loan } from '../state';
import { nextId } from '../state';
import { addMonths } from '../time/calendar';
import { addLog } from '../log';
import { ActionResult, FAIL, OK } from '../result';
import { fmtMoney, fmtPct } from '../format';
import { recordInquiry, recordLate, recordOnTime, refreshCreditScore } from './credit';
import { canPayFromChecking } from './payments';
import { monthlyGrossIncome } from '../career/career';
import { cardBalance } from './creditCard';
import { chance } from '../rng';
import { practice } from '../skills/skills';

export const LOAN_LATE_FEE = usd(25);
export const MAX_ACTIVE_LOANS = 3;
export const DEFAULT_AFTER_MISSES = 3;
export const LOAN_TERMS = [6, 12, 24, 36, 48, 60];

/** Cuota fija de un préstamo amortizable (sistema francés). */
export function amortizedPayment(principal: Cents, apr: number, months: number): Cents {
  if (months <= 0) return principal;
  const r = apr / 12;
  if (r === 0) return Math.ceil(principal / months);
  return Math.ceil((principal * r) / (1 - Math.pow(1 + r, -months)));
}

/** Tabla de amortización completa (para mostrar y para verificar en pruebas). */
export function amortizationSchedule(principal: Cents, apr: number, months: number) {
  const pay = amortizedPayment(principal, apr, months);
  const rows: Array<{ n: number; payment: Cents; interest: Cents; principal: Cents; balance: Cents }> = [];
  let bal = principal;
  for (let n = 1; n <= months && bal > 0; n++) {
    const interest = roundCents((bal * apr) / 12);
    const payment = Math.min(pay, bal + interest);
    const princ = payment - interest;
    bal -= princ;
    rows.push({ n, payment, interest, principal: princ, balance: bal });
  }
  return rows;
}

/** Prima de riesgo según puntaje crediticio (puntos porcentuales). */
export function riskPremium(score: number): number {
  if (score >= 760) return 0;
  if (score >= 700) return 1;
  if (score >= 650) return 3;
  if (score >= 600) return 6;
  return 10;
}

/** Pagos mensuales de deuda actuales: cuotas de préstamos + mínimo estimado de tarjeta. */
export function monthlyDebtPayments(state: GameState): Cents {
  let t = 0;
  for (const l of state.bank.loans) if (l.status !== 'paid') t += l.payment;
  const bal = cardBalance(state);
  if (bal > 0) t += Math.max(usd(25), roundCents(bal * 0.02));
  return t;
}

export interface LoanOffer {
  bank: BankDef;
  approved: boolean;
  reasons: string[];
  amount: Cents;
  termMonths: number;
  apr: number;
  negotiatedDiscount: number;
  fee: Cents;
  netDisbursed: Cents;
  payment: Cents;
  totalPaid: Cents;
  totalInterest: Cents;
  totalCost: Cents;
  dtiAfter: number | null;
}

function negotiatedDiscount(state: GameState, bankId: string): number {
  const n = state.bank.rateNegotiations[bankId];
  if (n && state.day - n.day <= 30) return n.discount;
  return 0;
}

export function quoteLoan(state: GameState, bank: BankDef, amount: Cents, termMonths: number): LoanOffer {
  const reasons: string[] = [];
  const income = monthlyGrossIncome(state);
  const discount = negotiatedDiscount(state, bank.id);
  const apr = Math.max(0.01, state.macro.policyRate + bank.spread / 100 + riskPremium(state.credit.score) / 100 - discount);
  const fee = roundCents(amount * bank.originationFee);
  const payment = amortizedPayment(amount, apr, termMonths);
  const sched = amortizationSchedule(amount, apr, termMonths);
  const totalPaid = sched.reduce((s, r) => s + r.payment, 0);
  const totalInterest = totalPaid - amount;
  const active = state.bank.loans.filter((l) => l.status !== 'paid');
  const dtiAfter = income > 0 ? (monthlyDebtPayments(state) + payment) / income : null;

  if (amount < usd(200)) reasons.push('El monto mínimo es $200.');
  if (termMonths > bank.maxTermMonths) reasons.push(`Plazo máximo en este banco: ${bank.maxTermMonths} meses.`);
  if (state.credit.score < bank.minScore) reasons.push(`Puntaje insuficiente (mínimo ${bank.minScore}, tenés ${state.credit.score}).`);
  if (active.length >= MAX_ACTIVE_LOANS) reasons.push(`Ya tenés ${active.length} préstamos activos (máximo ${MAX_ACTIVE_LOANS}).`);
  if (state.bank.loans.some((l) => l.status === 'default')) reasons.push('Tenés un préstamo en impago.');
  if (state.ledger.balances.arrears > 0 && bank.id !== 'finarapido') reasons.push('Tenés pagos vencidos sin regularizar.');
  if (income <= 0) {
    if (bank.maxWithoutIncome <= 0) reasons.push('Este banco exige ingresos demostrables (empleo).');
    else if (amount > usd(bank.maxWithoutIncome)) reasons.push(`Sin ingresos solo se aprueban hasta ${fmtMoney(usd(bank.maxWithoutIncome))}.`);
    if (active.length > 0) reasons.push('Sin ingresos no se aprueba un segundo préstamo.');
  } else {
    if (amount > roundCents(income * bank.maxIncomeMultiple)) reasons.push(`Monto máximo: ${bank.maxIncomeMultiple}× tu ingreso bruto mensual (${fmtMoney(roundCents(income * bank.maxIncomeMultiple))}).`);
    if (dtiAfter !== null && dtiAfter > bank.maxDti) reasons.push(`Tus pagos de deuda serían el ${Math.round(dtiAfter * 100)} % de tu ingreso (máximo ${Math.round(bank.maxDti * 100)} %).`);
  }
  return {
    bank, approved: reasons.length === 0, reasons, amount, termMonths, apr, negotiatedDiscount: discount, fee,
    netDisbursed: amount - fee, payment, totalPaid, totalInterest, totalCost: totalInterest + fee, dtiAfter,
  };
}

export function quoteAll(state: GameState, amount: Cents, termMonths: number): LoanOffer[] {
  return BANKS.map((b) => quoteLoan(state, b, amount, termMonths));
}

/** Probabilidad de que un banco acepte rebajar la tasa, la rebaja y desde cuándo se puede volver a pedir. */
export function rateNegotiationInfo(state: GameState, bankId: string): { chance: number; discount: number; nextDay: number | null } {
  const neg = state.skills.negotiation.level;
  const prev = state.bank.rateNegotiations[bankId];
  return {
    chance: clamp(0.2 + neg * 0.006 + state.skills.social.level * 0.002, 0.2, 0.85),
    discount: Math.min(0.015, 0.005 + neg / 10000),
    nextDay: prev && state.day - prev.day <= 30 ? prev.day + 31 : null,
  };
}

/** Negociar la tasa con un banco (una vez cada 30 días por banco). */
export function negotiateRate(state: GameState, bankId: string): ActionResult {
  const prev = state.bank.rateNegotiations[bankId];
  if (prev && state.day - prev.day <= 30) return FAIL('Ya negociaste con este banco en los últimos 30 días.');
  const neg = state.skills.negotiation.level;
  const p = rateNegotiationInfo(state, bankId).chance;
  practice(state, 'negotiate_loan', 'negotiation', 150);
  if (chance(state, p)) {
    const discount = Math.min(0.015, 0.005 + neg / 10000);
    state.bank.rateNegotiations[bankId] = { day: state.day, discount };
    return OK(`El banco aceptó rebajar la tasa ${fmtPct(discount, 2)} (válido 30 días). Probabilidad estimada era ${Math.round(p * 100)} %.`);
  }
  state.bank.rateNegotiations[bankId] = { day: state.day, discount: 0 };
  return FAIL(`El banco no aceptó rebajar la tasa (probabilidad estimada ${Math.round(p * 100)} %). Podés volver a intentarlo en 30 días.`);
}

export function takeLoan(state: GameState, bankId: string, amount: Cents, termMonths: number): ActionResult {
  const bank = BANK_BY_ID[bankId];
  if (!bank) return FAIL('Banco inexistente.');
  if (!Number.isSafeInteger(amount) || amount <= 0) return FAIL('Ingresá un monto mayor a cero.');
  if (state.legal?.prison) return FAIL('Desde prisión no podés pedir préstamos.');
  const offer = quoteLoan(state, bank, amount, termMonths);
  recordInquiry(state);
  if (!offer.approved) return FAIL(`Solicitud rechazada: ${offer.reasons.join(' ')}`);
  const loan: Loan = {
    id: nextId(state), bankId, principal: amount, balance: amount, apr: offer.apr, termMonths, payment: offer.payment,
    startDay: state.day, nextDueDay: addMonths(state.day, 1), paymentsMade: 0, missedConsecutive: 0, missedTotal: 0, interestPaid: 0, status: 'active',
  };
  post(state.ledger, {
    day: state.day,
    memo: `Préstamo ${bank.name} (${termMonths} meses, ${fmtPct(offer.apr, 2)})`,
    cf: 'financing',
    tag: 'loan:disburse',
    lines: [
      { account: 'checking', debit: amount - offer.fee },
      ...(offer.fee > 0 ? [{ account: 'loan_fees' as const, debit: offer.fee }] : []),
      { account: 'personal_loans', credit: amount },
    ],
  });
  state.bank.loans.push(loan);
  addLog(state, 'info', '🏦', `Préstamo aprobado por ${bank.name}. Cuota mensual: ${fmtMoney(offer.payment)}.`, amount - offer.fee);
  practice(state, 'loan', 'finEdu', 80);
  refreshCreditScore(state);
  return OK(`Préstamo acreditado: ${fmtMoney(amount - offer.fee)} (comisión ${fmtMoney(offer.fee)}).`);
}

function payInstallment(state: GameState, loan: Loan): void {
  const interest = roundCents((loan.balance * loan.apr) / 12);
  // Si los recargos capitalizados hicieron que el interés supere la cuota, se paga al menos el interés.
  const due = Math.max(interest, Math.min(loan.payment, loan.balance + interest));
  const bank = BANK_BY_ID[loan.bankId];
  if (canPayFromChecking(state, due)) {
    const principal = due - interest;
    post(state.ledger, {
      day: state.day,
      memo: `Cuota préstamo ${bank.name}`,
      cf: 'financing',
      tag: 'loan:payment',
      lines: [
        { account: 'personal_loans', debit: principal },
        { account: 'interest_expense', debit: interest },
        { account: 'checking', credit: due },
      ],
    });
    loan.balance -= principal;
    loan.interestPaid += interest;
    loan.paymentsMade++;
    loan.missedConsecutive = 0;
    recordOnTime(state);
    if (loan.balance === 0) {
      loan.status = 'paid';
      addLog(state, 'success', '🎉', `Terminaste de pagar el préstamo de ${bank.name}.`);
    }
  } else {
    // Impago: el interés del mes se capitaliza y se suma un recargo.
    post(state.ledger, {
      day: state.day,
      memo: `Cuota impaga préstamo ${bank.name}: interés capitalizado y recargo`,
      cf: 'operating',
      tag: 'loan:missed',
      lines: [
        { account: 'interest_expense', debit: interest },
        { account: 'late_fees', debit: LOAN_LATE_FEE },
        { account: 'personal_loans', credit: interest + LOAN_LATE_FEE },
      ],
    });
    loan.balance += interest + LOAN_LATE_FEE;
    loan.missedConsecutive++;
    loan.missedTotal++;
    recordLate(state);
    state.player.attributes.stress = Math.min(100, state.player.attributes.stress + 8);
    addLog(state, 'danger', '⛔', `No pudiste pagar la cuota de ${bank.name}. Se sumaron intereses y un recargo.`, interest + LOAN_LATE_FEE);
    if (loan.missedConsecutive >= DEFAULT_AFTER_MISSES && loan.status === 'active') {
      loan.status = 'default';
      state.credit.defaults++;
      state.player.attributes.reputation = Math.max(0, state.player.attributes.reputation - 10);
      addLog(state, 'danger', '🚨', `Préstamo de ${bank.name} en IMPAGO: 3 cuotas seguidas sin pagar. El banco embargará el 20 % de tu salario neto hasta cubrir la deuda.`, undefined, 'peligro');
      refreshCreditScore(state);
    }
  }
}

export function processLoans(state: GameState): void {
  for (const loan of state.bank.loans) {
    if (loan.status === 'paid' || loan.nextDueDay !== state.day) continue;
    payInstallment(state, loan);
    loan.nextDueDay = addMonths(loan.nextDueDay, 1);
  }
}

export function prepayLoan(state: GameState, id: number, amount: Cents): ActionResult {
  const loan = state.bank.loans.find((l) => l.id === id);
  if (!loan || loan.status === 'paid') return FAIL('Préstamo inexistente o cancelado.');
  const pay = Math.min(amount, loan.balance);
  if (pay <= 0) return FAIL('Ingresá un monto mayor a cero.');
  if (!canPayFromChecking(state, pay)) return FAIL('Fondos insuficientes en la cuenta corriente.');
  post(state.ledger, {
    day: state.day,
    memo: `Amortización anticipada ${BANK_BY_ID[loan.bankId].name}`,
    cf: 'financing',
    tag: 'loan:prepay',
    lines: [
      { account: 'personal_loans', debit: pay },
      { account: 'checking', credit: pay },
    ],
  });
  loan.balance -= pay;
  if (loan.balance === 0) {
    loan.status = 'paid';
    addLog(state, 'success', '🎉', `Cancelaste por completo el préstamo de ${BANK_BY_ID[loan.bankId].name}.`);
  } else {
    // Se mantiene el plazo restante y se recalcula la cuota.
    const remaining = Math.max(1, loan.termMonths - loan.paymentsMade);
    loan.payment = amortizedPayment(loan.balance, loan.apr, remaining);
    if (loan.status === 'default' && loan.missedConsecutive > 0) loan.missedConsecutive = 0;
  }
  practice(state, 'prepay', 'finEdu', 60);
  refreshCreditScore(state);
  return OK('Pago anticipado aplicado.');
}

/** Embargo del 20 % del salario neto para préstamos en impago. Devuelve lo embargado. */
export function garnish(state: GameState, netPay: Cents): Cents {
  let taken = 0;
  for (const loan of state.bank.loans) {
    if (loan.status !== 'default' || loan.balance <= 0) continue;
    const amount = Math.min(loan.balance, roundCents(netPay * 0.2) - taken, state.ledger.balances.checking);
    if (amount <= 0) continue;
    post(state.ledger, {
      day: state.day,
      memo: `Embargo salarial ${BANK_BY_ID[loan.bankId].name}`,
      cf: 'financing',
      tag: 'loan:garnish',
      lines: [
        { account: 'personal_loans', debit: amount },
        { account: 'checking', credit: amount },
      ],
    });
    loan.balance -= amount;
    taken += amount;
    if (loan.balance === 0) {
      loan.status = 'paid';
      addLog(state, 'success', '🧾', `La deuda en impago con ${BANK_BY_ID[loan.bankId].name} quedó saldada.`);
    }
  }
  return taken;
}
