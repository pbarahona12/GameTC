import { post } from '../ledger/ledger';
import { Cents, roundCents, usd } from '../money';
import type { GameState } from '../state';
import { dateOf } from '../time/calendar';
import { addLog } from '../log';
import { ActionResult, FAIL, OK } from '../result';
import { fmtMoney, fmtPct } from '../format';
import { recordInquiry, recordLate, recordOnTime, refreshCreditScore } from './credit';
import { canPayFromChecking, spendable } from './payments';
import { practice } from '../skills/skills';
import { monthlyGrossIncome } from '../career/career';
import { accrueRewards, cardTier, cardUsed } from './cardRewards';
import { CARD_TIER_BY_ID, CARD_TIER_ORDER, CardTier, CardTierDef } from '../../content/cards';
import { computeMetrics } from '../reports/metrics';
import { chance } from '../rng';
import { formatDateShort } from '../time/calendar';

/**
 * Tarjeta de crédito con ciclo real:
 * - Corte el día 25: se emite el resumen (saldo del resumen y pago mínimo).
 * - Vencimiento 20 días después del corte.
 * - Si el resumen anterior se pagó COMPLETO, no se cobran intereses (período de gracia).
 * - Si no, se cobra interés sobre el saldo promedio diario del ciclo.
 * - No pagar el mínimo: recargo por mora + reporte negativo al puntaje.
 */
export const STATEMENT_DAY = 25;
export const GRACE_DAYS = 20;
export const LATE_FEE = usd(29);
export const MIN_PAYMENT_FLOOR = usd(25);
export const MIN_PAYMENT_RATE = 0.02;

export function cardBalance(state: GameState): Cents {
  return state.ledger.balances.credit_card;
}

export function cardAvailable(state: GameState): Cents {
  const c = state.bank.card;
  return c.active ? Math.max(0, c.limit - cardUsed(state)) : 0;
}

/** Tasa anual efectiva: la variable del mercado menos la rebaja del nivel de tarjeta. */
export function effectiveApr(state: GameState): number {
  return Math.max(0.01, state.bank.card.apr - cardTier(state).aprDiscount);
}

export function accrueCardDaily(state: GameState): void {
  state.bank.card.cycleBalanceDays += cardBalance(state);
}

/** Pendiente del resumen actual (lo que falta para pagarlo completo). */
export function statementRemaining(state: GameState): Cents {
  const c = state.bank.card;
  return Math.max(0, Math.min(c.statementBalance - c.paidSinceStatement, cardBalance(state)));
}

export function minRemaining(state: GameState): Cents {
  const c = state.bank.card;
  return Math.max(0, Math.min(c.minPayment - c.paidSinceStatement, cardBalance(state)));
}

export function payCard(state: GameState, amount: Cents, silent = false): ActionResult {
  const bal = cardBalance(state);
  if (bal <= 0) return FAIL('La tarjeta no tiene saldo.');
  const pay = Math.min(amount, bal);
  if (pay <= 0) return FAIL('Ingresá un monto mayor a cero.');
  if (!canPayFromChecking(state, pay)) return FAIL('Fondos insuficientes en la cuenta corriente.');
  post(state.ledger, {
    day: state.day,
    memo: 'Pago de tarjeta de crédito',
    cf: 'financing',
    tag: 'card:payment',
    lines: [
      { account: 'credit_card', debit: pay },
      { account: 'checking', credit: pay },
    ],
  });
  state.bank.card.paidSinceStatement += pay;
  if (!silent) addLog(state, 'info', '💳', 'Pago de tarjeta registrado.', pay);
  if (state.bank.card.dueDay >= 0 && statementRemaining(state) === 0) practice(state, 'card_full', 'finEdu', 60);
  refreshCreditScore(state);
  return OK('Pago realizado.');
}

/** Pasa al resumen la cuota del mes de cada compra en cuotas (capital + interés). */
function billInstallments(state: GameState): void {
  const c = state.bank.card;
  for (const it of c.installments ?? []) {
    if (it.paidCount >= it.n || it.remaining <= 0) continue;
    const last = it.paidCount === it.n - 1;
    const interest = it.rate > 0 ? roundCents(it.remaining * it.rate) : 0;
    const principal = last ? it.remaining : Math.min(it.remaining, Math.max(0, it.payment - interest));
    post(state.ledger, {
      day: state.day,
      memo: `Cuota ${it.paidCount + 1}/${it.n}: ${it.desc}`,
      cf: 'internal',
      tag: 'card:installment',
      lines: [
        { account: 'card_installments', debit: principal },
        ...(interest > 0 ? [{ account: 'interest_expense' as const, debit: interest }] : []),
        { account: 'credit_card', credit: principal + interest },
      ],
    });
    it.remaining -= principal;
    it.paidCount++;
  }
  c.installments = (c.installments ?? []).filter((it) => it.paidCount < it.n && it.remaining > 0);
}

/** Acredita el reintegro acumulado: descuenta del saldo de la tarjeta (o va a tu cuenta si no hay saldo). */
function creditRewards(state: GameState): void {
  const c = state.bank.card;
  const r = c.rewardsPending ?? 0;
  if (r <= 0) return;
  const toCard = Math.min(r, cardBalance(state));
  const toChecking = r - toCard;
  post(state.ledger, {
    day: state.day,
    memo: `Reintegro de tarjeta ${cardTier(state).name}`,
    cf: 'operating',
    tag: 'card:rewards',
    lines: [
      ...(toCard > 0 ? [{ account: 'credit_card' as const, debit: toCard }] : []),
      ...(toChecking > 0 ? [{ account: 'checking' as const, debit: toChecking }] : []),
      { account: 'card_rewards', credit: r },
    ],
  });
  c.rewardsTotal = (c.rewardsTotal ?? 0) + r;
  c.rewardsPending = 0;
  addLog(state, 'income', '🎁', `Reintegro de tu tarjeta ${cardTier(state).name}: ${fmtMoney(r)}.`, r);
}

function cutStatement(state: GameState): void {
  const c = state.bank.card;
  billInstallments(state);
  creditRewards(state);
  if (c.revolving && c.cycleBalanceDays > 0) {
    const interest = roundCents((c.cycleBalanceDays * effectiveApr(state)) / 365);
    if (interest > 0) {
      post(state.ledger, {
        day: state.day,
        memo: `Intereses de tarjeta (${fmtPct(effectiveApr(state), 1)} anual)`,
        cf: 'operating',
        tag: 'interest:card',
        lines: [
          { account: 'interest_expense', debit: interest },
          { account: 'credit_card', credit: interest },
        ],
      });
      addLog(state, 'expense', '💳', 'La tarjeta cobró intereses porque el resumen anterior no se pagó completo.', interest);
    }
  }
  const bal = cardBalance(state);
  c.statementBalance = bal;
  c.minPayment = bal <= 0 ? 0 : Math.min(bal, Math.max(MIN_PAYMENT_FLOOR, roundCents(bal * MIN_PAYMENT_RATE)));
  c.paidSinceStatement = 0;
  c.dueDay = bal > 0 ? state.day + GRACE_DAYS : -1;
  c.cycleBalanceDays = 0;
  c.cycleStartDay = state.day;
  if (bal > 0) addLog(state, 'info', '🧾', `Resumen de tarjeta: saldo ${fmtMoney(bal)}, pago mínimo ${fmtMoney(c.minPayment)}. Vence en ${GRACE_DAYS} días.`);
}

function processDue(state: GameState): void {
  const c = state.bank.card;
  // Débito automático.
  if (c.autopay !== 'none') {
    const target = c.autopay === 'full' ? statementRemaining(state) : minRemaining(state);
    if (target > 0) {
      const available = Math.min(target, Math.max(0, spendable(state)));
      if (available > 0) payCard(state, available, true);
    }
  }
  const paidFull = statementRemaining(state) === 0;
  const paidMin = minRemaining(state) === 0;
  if (paidFull) {
    c.revolving = false;
    c.fullPayStreak++;
    recordOnTime(state);
  } else if (paidMin) {
    c.revolving = true;
    c.fullPayStreak = 0;
    recordOnTime(state);
    addLog(state, 'warning', '💳', 'Pagaste solo parte del resumen: el saldo restante generará intereses.');
  } else {
    c.revolving = true;
    c.fullPayStreak = 0;
    post(state.ledger, {
      day: state.day,
      memo: 'Recargo por pago tardío de tarjeta',
      cf: 'operating',
      tag: 'fee:card_late',
      lines: [
        { account: 'late_fees', debit: LATE_FEE },
        { account: 'credit_card', credit: LATE_FEE },
      ],
    });
    recordLate(state);
    state.player.attributes.stress = Math.min(100, state.player.attributes.stress + 5);
    addLog(state, 'danger', '⛔', `No pagaste el mínimo de la tarjeta. Recargo de ${fmtMoney(LATE_FEE)} y reporte negativo en tu puntaje crediticio.`, LATE_FEE);
  }
  c.dueDay = -1;
}

/** Vencimiento del resumen (al inicio del día, antes de nuevos cargos). */
export function processCardDue(state: GameState): void {
  const c = state.bank.card;
  if (c.active && c.dueDay === state.day) processDue(state);
}

/** Cierre del día: acumula saldo para intereses y, si corresponde, emite el resumen. */
export function processCardEndOfDay(state: GameState): void {
  const c = state.bank.card;
  if (!c.active) return;
  if (c.feeDay !== undefined && state.day >= c.feeDay) chargeAnnualFee(state);
  accrueCardDaily(state);
  if (dateOf(state.day).d === STATEMENT_DAY) cutStatement(state);
}

function chargeAnnualFee(state: GameState): void {
  const c = state.bank.card;
  const fee = usd(cardTier(state).annualFee * state.macro.priceIndex);
  c.feeDay = state.day + 365;
  if (fee <= 0) return;
  post(state.ledger, { day: state.day, memo: `Costo anual de la tarjeta ${cardTier(state).name}`, cf: 'operating', tag: 'fee:card_annual', lines: [{ account: 'bank_fees', debit: fee }, { account: 'credit_card', credit: fee }] });
  addLog(state, 'expense', '💳', `Costo anual de tu tarjeta ${cardTier(state).name}: ${fmtMoney(fee)} (se cargó a la tarjeta).`, fee);
}

// ------------------------------------------------------------------ niveles de tarjeta (1.2)

export interface TierCheck {
  tier: CardTierDef;
  items: Array<{ label: string; met: boolean }>;
  eligible: boolean;
  /** Probabilidad de aprobación si cumplís todo (menor cerca del mínimo de puntaje). */
  chance: number;
  limit: Cents;
}

/** Límite que te daría el banco con ese nivel según tus ingresos. */
export function tierLimit(state: GameState, t: CardTierDef): Cents {
  const income = monthlyGrossIncome(state);
  return Math.min(usd(t.limitCap), Math.max(usd(t.limitFloor), roundCents(income * t.limitMult)));
}

export function checkTier(state: GameState, id: CardTier): TierCheck {
  const t = CARD_TIER_BY_ID[id];
  const income = monthlyGrossIncome(state);
  const nw = computeMetrics(state).netWorth;
  const history = state.day - (state.credit.firstAccountDay ?? 0);
  const recentLate = state.credit.latePayments.filter((d) => state.day - d < 365).length;
  const items = [
    { label: `Puntaje crediticio ≥ ${t.minScore} (tenés ${state.credit.score})`, met: state.credit.score >= t.minScore },
    { label: `Ingresos ≥ ${fmtMoney(usd(t.minIncome), { decimals: false })}/mes o patrimonio ≥ ${fmtMoney(usd(t.minNetWorth), { decimals: false })}`, met: income >= usd(t.minIncome) || nw >= usd(t.minNetWorth) },
    { label: `Historial crediticio ≥ ${Math.round(t.minHistoryDays / 30)} meses (tenés ${Math.max(0, Math.round(history / 30))})`, met: history >= t.minHistoryDays },
    { label: 'Sin atrasos en los últimos 12 meses', met: recentLate === 0 && state.ledger.balances.arrears === 0 },
  ];
  const eligible = items.every((i) => i.met);
  const margin = state.credit.score - t.minScore;
  const chance = eligible ? Math.min(0.95, 0.55 + margin / 60) : 0;
  return { tier: t, items, eligible, chance, limit: tierLimit(state, t) };
}

/** Pedir otra tarjeta (subir o bajar de nivel). Subir implica una consulta a tu crédito. */
export function requestTier(state: GameState, id: CardTier): ActionResult {
  const c = state.bank.card;
  const cur = CARD_TIER_ORDER.indexOf(c.tier ?? 'clasica');
  const next = CARD_TIER_ORDER.indexOf(id);
  if (next < 0) return FAIL('Nivel inexistente.');
  if (next === cur) return FAIL('Ya tenés esa tarjeta.');
  if (next < cur) {
    c.tier = id;
    const t = CARD_TIER_BY_ID[id];
    c.limit = Math.min(c.limit, Math.max(usd(t.limitFloor), Math.min(usd(t.limitCap), c.limit)));
    addLog(state, 'info', '💳', `Cambiaste a la tarjeta ${t.name}. El próximo costo anual será de ${fmtMoney(usd(t.annualFee), { decimals: false })}.`);
    return OK(`Ahora tenés la tarjeta ${t.name}.`);
  }
  if (state.day - (c.lastTierRequest ?? -999) < 30) return FAIL(`Pediste un cambio hace menos de 30 días. Podés volver a pedir el ${formatDateShort((c.lastTierRequest ?? 0) + 30)}.`);
  c.lastTierRequest = state.day;
  const chk = checkTier(state, id);
  recordInquiry(state);
  if (!chk.eligible) {
    refreshCreditScore(state);
    return FAIL(`Rechazada: ${chk.items.filter((i) => !i.met).map((i) => i.label).join('; ')}. La consulta quedó registrada en tu historial.`);
  }
  if (!chance(state, chk.chance)) {
    refreshCreditScore(state);
    return FAIL(`El banco rechazó la solicitud esta vez (aprobación estimada ${Math.round(chk.chance * 100)} %). Podés volver a intentar en 30 días.`);
  }
  const t = chk.tier;
  c.tier = id;
  c.limit = Math.max(c.limit, chk.limit);
  c.feeDay = state.day;
  chargeAnnualFee(state);
  practice(state, 'card_upgrade', 'finEdu', 80);
  addLog(state, 'success', '💳', `¡Aprobada! Tu nueva tarjeta ${t.name}: límite ${fmtMoney(c.limit, { decimals: false })}, ${fmtPct(t.cashback, 1)} de reintegro.`);
  refreshCreditScore(state);
  return OK(`Tarjeta ${t.name} aprobada. Límite: ${fmtMoney(c.limit, { decimals: false })}.`);
}

// ------------------------------------------------------------------ compras en cuotas

export interface InstallmentQuote {
  n: number;
  rate: number;
  payment: Cents;
  total: Cents;
  interest: Cents;
  free: boolean;
}

/** Cuotas: sin interés si la tienda y tu nivel lo permiten; si no, con la tasa de la tarjeta. */
export function quoteInstallments(state: GameState, amount: Cents, n: number, storeFree: number): InstallmentQuote {
  const tierFree = cardTier(state).freeInstallments;
  const free = n <= Math.min(storeFree, tierFree);
  const rate = free || n <= 1 ? 0 : (effectiveApr(state) * 0.9) / 12;
  const payment = rate > 0 ? roundCents((amount * rate) / (1 - Math.pow(1 + rate, -n))) : Math.ceil(amount / n);
  const total = rate > 0 ? payment * n : amount;
  return { n, rate, payment, total, interest: total - amount, free: rate === 0 };
}

/** Registra una compra en cuotas: el total se reserva del límite y cada mes pasa una cuota al resumen. */
export function chargeInstallments(state: GameState, amount: Cents, n: number, storeFree: number, desc: string, debitAccount: 'personal_assets' | 'shopping'): ActionResult {
  const c = state.bank.card;
  if (!c.active) return FAIL('No tenés tarjeta activa.');
  if (!(n >= 2 && n <= 24)) return FAIL('Cantidad de cuotas inválida.');
  if (cardAvailable(state) < amount) return FAIL(`Tu tarjeta tiene ${fmtMoney(cardAvailable(state))} disponibles.`);
  const q = quoteInstallments(state, amount, n, storeFree);
  post(state.ledger, { day: state.day, memo: `${desc} en ${n} cuotas`, cf: 'operating', tag: 'card:installments', lines: [{ account: debitAccount, debit: amount }, { account: 'card_installments', credit: amount }] });
  c.installments = c.installments ?? [];
  c.installments.push({ id: state.meta.nextId++, desc, principal: amount, remaining: amount, n, paidCount: 0, payment: q.payment, rate: q.rate, startDay: state.day });
  accrueRewards(state, amount);
  return OK(`${n} cuotas de ${fmtMoney(q.payment)}${q.free ? ' sin interés' : ` (interés total ${fmtMoney(q.interest)})`}.`);
}

export function setAutopay(state: GameState, mode: 'none' | 'min' | 'full'): ActionResult {
  state.bank.card.autopay = mode;
  return OK(mode === 'none' ? 'Débito automático desactivado.' : `Débito automático: ${mode === 'full' ? 'pago total del resumen' : 'pago mínimo'}.`);
}

/** Límite máximo que aprobaría el banco hoy (null si no calificás: puntaje o ingresos). */
export function limitIncreaseTarget(state: GameState): Cents | null {
  const income = monthlyGrossIncome(state);
  if (state.credit.score < 680 || income <= 0) return null;
  const t = cardTier(state);
  return Math.min(Math.min(roundCents(income * Math.max(1.5, t.limitMult)), usd(t.limitCap)), state.bank.card.limit * 2);
}

/** Solicitud de aumento de límite: consulta de crédito (afecta el puntaje) y evaluación. */
export function requestLimitIncrease(state: GameState): ActionResult {
  const c = state.bank.card;
  const income = monthlyGrossIncome(state);
  recordInquiry(state);
  if (state.credit.score < 680) return FAIL(`Rechazado: el banco exige un puntaje de al menos 680 (tenés ${state.credit.score}). La consulta quedó registrada.`);
  if (income <= 0) return FAIL('Rechazado: se requiere un ingreso estable demostrable.');
  const t = cardTier(state);
  const target = Math.min(roundCents(income * Math.max(1.5, t.limitMult)), usd(t.limitCap));
  if (target <= c.limit) return FAIL(`Rechazado: tu límite ya es el máximo para una tarjeta ${t.name} con tus ingresos. Para más límite, pedí una tarjeta de nivel superior.`);
  const newLimit = Math.min(target, c.limit * 2);
  c.limit = newLimit;
  addLog(state, 'success', '💳', `Aprobado: tu nuevo límite es ${fmtMoney(newLimit)}.`);
  refreshCreditScore(state);
  return OK(`Nuevo límite: ${fmtMoney(newLimit)}.`);
}
