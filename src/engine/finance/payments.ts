import { difficultyOf } from '../economy/difficulty';
import type { AccountId } from '../ledger/accounts';
import { post, tryPost, CashFlowClass } from '../ledger/ledger';
import type { Cents } from '../money';
import { applyRate } from '../money';
import type { GameState, PaymentMethod } from '../state';
import { addLog } from '../log';
import { accrueRewards, cardUsed } from './cardRewards';

/**
 * Pagos con cadena de respaldo realista:
 *  1. Medio elegido (tarjeta / efectivo / cuenta corriente).
 *  2. Cuenta corriente, con barrido automático desde ahorro si está activado.
 *  3. Efectivo.
 *  4. Tarjeta de crédito, si hay cupo.
 *  5. Si nada alcanza: se paga lo que haya y el resto queda como ATRASO
 *     (pasivo "Pagos vencidos") con un recargo. El dinero nunca se inventa.
 */
export const ARREARS_FEE_RATE = 0.05;
export const ARREARS_FEE_MIN = 1500;

function cardAvailable(state: GameState): Cents {
  const c = state.bank.card;
  if (!c.active) return 0;
  return Math.max(0, c.limit - cardUsed(state));
}

/**
 * LIQUIDEZ PERSONAL: la única definición de "cuánto dinero tenés disponible".
 * Toda pantalla y toda validación de compra usa esta función, así el número que
 * ves arriba es el mismo con el que se decide si te alcanza.
 */
export interface Liquidity {
  checking: Cents;
  savings: Cents;
  wallet: Cents;
  /**
   * Lo que podés pagar hoy desde tu cuenta: la cuenta corriente más el ahorro
   * cuando el barrido automático está activado. Es lo que usan las compras,
   * inversiones, inmuebles, empresas y cuotas.
   */
  spendable: Cents;
  /** Todo tu dinero líquido (corriente + ahorro + efectivo): base de la autonomía en meses. */
  total: Cents;
}

export function liquidity(state: GameState): Liquidity {
  const b = state.ledger.balances;
  const checking = b.checking;
  const savings = b.savings;
  const wallet = b.cash_wallet;
  return { checking, savings, wallet, spendable: checking + (state.bank.overdraftSweep ? savings : 0), total: checking + savings + wallet };
}

/** Dinero que podés usar ya para pagar desde tu cuenta (ver Liquidity.spendable). */
export function spendable(state: GameState): Cents {
  return liquidity(state).spendable;
}

/** Asegura fondos en la cuenta corriente transfiriendo desde ahorro si está permitido. */
export function sweepToChecking(state: GameState, needed: Cents): void {
  const checking = state.ledger.balances.checking;
  if (checking >= needed || !state.bank.overdraftSweep) return;
  const shortfall = needed - checking;
  const move = Math.min(shortfall, state.ledger.balances.savings);
  if (move <= 0) return;
  post(state.ledger, {
    day: state.day,
    memo: 'Barrido automático desde ahorro',
    cf: 'internal',
    tag: 'sweep',
    lines: [
      { account: 'checking', debit: move },
      { account: 'savings', credit: move },
    ],
  });
  addLog(state, 'info', '🔁', 'Barrido automático: se transfirió dinero del ahorro a la cuenta corriente para cubrir un pago.', move);
}

export interface PayOptions {
  memo: string;
  tag?: string;
  cf?: CashFlowClass;
  method?: PaymentMethod;
  /** Si es false, en lugar de generar atraso devuelve fallo sin tocar nada. */
  allowArrears?: boolean;
}

export type PayResult = { ok: true; via: 'card' | 'checking' | 'cash' } | { ok: false; paid: Cents; arrears: Cents };

export function payExpense(state: GameState, account: AccountId, amount: Cents, opt: PayOptions): PayResult {
  if (amount <= 0) return { ok: true, via: 'checking' };
  const cf = opt.cf ?? 'operating';
  const base = { day: state.day, memo: opt.memo, cf, tag: opt.tag };
  const via = (source: AccountId) =>
    tryPost(state.ledger, { ...base, lines: [{ account, debit: amount }, { account: source, credit: amount }] });

  if (opt.method === 'card' && cardAvailable(state) >= amount) {
    if (via('credit_card').ok) {
      accrueRewards(state, amount);
      return { ok: true, via: 'card' };
    }
  }
  if (opt.method === 'cash' && state.ledger.balances.cash_wallet >= amount) {
    if (via('cash_wallet').ok) return { ok: true, via: 'cash' };
  }
  sweepToChecking(state, amount);
  if (state.ledger.balances.checking >= amount && via('checking').ok) return { ok: true, via: 'checking' };
  if (state.ledger.balances.cash_wallet >= amount && via('cash_wallet').ok) return { ok: true, via: 'cash' };
  if (cardAvailable(state) >= amount && via('credit_card').ok) {
    accrueRewards(state, amount);
    addLog(state, 'warning', '💳', `Sin fondos: "${opt.memo}" se cargó a la tarjeta de crédito.`, amount);
    return { ok: true, via: 'card' };
  }
  if (opt.allowArrears === false) return { ok: false, paid: 0, arrears: 0 };

  // Pago parcial + atraso.
  const fromChecking = state.ledger.balances.checking;
  const fromCash = state.ledger.balances.cash_wallet;
  const paid = Math.min(amount, fromChecking + fromCash);
  const useChecking = Math.min(fromChecking, paid);
  const useCash = paid - useChecking;
  const arrears = amount - paid;
  // Modo tranquilo (dificultad Fácil, 1.4): el primer atraso de la partida no tiene recargo ni marca en tu historial.
  const grace = difficultyOf(state).id === 'facil' && !state.options.graceUsed;
  const fee = grace ? 0 : Math.max(ARREARS_FEE_MIN, applyRate(arrears, ARREARS_FEE_RATE));
  post(state.ledger, {
    ...base,
    memo: `${opt.memo} (pago incompleto)`,
    lines: [
      { account, debit: amount },
      { account: 'late_fees', debit: fee },
      { account: 'checking', credit: useChecking },
      { account: 'cash_wallet', credit: useCash },
      { account: 'arrears', credit: arrears + fee },
    ],
  });
  if (grace) {
    state.options.graceUsed = true;
    addLog(state, 'warning', '🤝', `No alcanzó el dinero para "${opt.memo}". Por ser tu primer atraso (dificultad Fácil), no hay recargo ni marca en tu historial de crédito: pagalo cuanto antes.`, arrears);
    return { ok: false, paid, arrears };
  }
  addLog(state, 'danger', '⛔', `No alcanzó el dinero para "${opt.memo}". Quedó un atraso más un recargo.`, arrears + fee);
  state.player.attributes.stress = Math.min(100, state.player.attributes.stress + 6);
  state.credit.arrearsEvents++;
  return { ok: false, paid, arrears };
}

/**
 * Paga una obligación financiera desde la cuenta corriente (con barrido).
 * No usa la tarjeta ni genera atraso: si no alcanza, devuelve false y el
 * llamador decide la consecuencia (mora del préstamo, etc.).
 */
export function canPayFromChecking(state: GameState, amount: Cents): boolean {
  if (spendable(state) < amount) return false;
  sweepToChecking(state, amount);
  return state.ledger.balances.checking >= amount;
}
