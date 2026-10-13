import type { GameState } from '../state';
import type { Holding, Lot, Trade, OrderSide, OrderType } from './types';
import { post } from '../ledger/ledger';
import type { AccountId } from '../ledger/accounts';
import { Cents, roundCents } from '../money';
import { residence } from '../tax/taxEngine';

/**
 * CONTABILIDAD COMÚN DE INVERSIONES (acciones, bonos, fondos y Mogul Exchange).
 *
 * - Cada clase tiene su cuenta de activo personal y su subregistro de tenencias
 *   (cantidad, costo FIFO por lotes y valor contable).
 * - Las tenencias se llevan a VALOR DE MERCADO: `revalueInvestments` ajusta el
 *   valor contable contra "Revalorización no realizada" (no tributa).
 * - Al vender se revierte la revalorización de la porción vendida y se registra
 *   la ganancia REALIZADA = precio bruto − costo FIFO (tributa en la declaración).
 * - Las comisiones van a "Comisiones de inversión" y reducen la base imponible.
 */
export type InvestClass = 'stocks' | 'bonds' | 'funds' | 'mogul' | 'managed';
export const INVEST_CLASSES: InvestClass[] = ['stocks', 'bonds', 'funds', 'mogul', 'managed'];

export const CLASS_ACCOUNT: Record<InvestClass, AccountId> = { stocks: 'stocks', bonds: 'bonds', funds: 'funds', mogul: 'mogul', managed: 'managed' };
export const CLASS_MARKET: Record<InvestClass, Trade['market']> = { stocks: 'bolsa', bonds: 'bonos', funds: 'fondos', mogul: 'mogul', managed: 'gestor' };
const EPS = 1e-9;

export function holdingsOf(state: GameState, cls: InvestClass): Record<string, Holding> {
  switch (cls) {
    case 'stocks': return state.stocks.holdings;
    case 'bonds': return state.bonds.holdings;
    case 'funds': return state.funds.holdings;
    case 'mogul': return state.mogul.holdings;
    case 'managed': return (state.managed ??= { mandates: [], holdings: {} }).holdings;
  }
}

/** Precio de mercado actual por unidad (centavos, puede tener decimales). */
export function markPrice(state: GameState, cls: InvestClass, id: string): number {
  switch (cls) {
    case 'stocks': return state.stocks.stocks.find((s) => s.id === id)?.price ?? 0;
    case 'bonds': return state.bonds.issues.find((b) => b.id === id)?.price ?? 0;
    case 'funds': return state.funds.funds.find((f) => f.id === id)?.nav ?? 0;
    case 'mogul': return state.mogul.assets.find((a) => a.id === id)?.nav ?? 0;
    case 'managed': return state.managed?.mandates.find((m) => m.id === id)?.nav ?? 0;
  }
}

function recordTrade(state: GameState, t: Omit<Trade, 'id' | 'day'>): void {
  state.stocks.trades.push({ id: state.meta.nextId++, day: state.day, ...t });
  if (state.stocks.trades.length > 500) state.stocks.trades.splice(0, state.stocks.trades.length - 500);
}

/**
 * Compra: Debe activo (bruto) + comisión / Haber cuenta corriente.
 * El llamador valida fondos y precio. `gross` ya está redondeado a centavos.
 */
export function bookBuy(state: GameState, cls: InvestClass, id: string, qty: number, gross: Cents, fee: Cents, memo: string, orderType?: OrderType): void {
  const acc = CLASS_ACCOUNT[cls];
  post(state.ledger, {
    day: state.day, memo, cf: 'investing', tag: `invest:${cls}:buy`,
    lines: [{ account: acc, debit: gross }, ...(fee > 0 ? [{ account: 'brokerage_fees' as const, debit: fee }] : []), { account: 'checking', credit: gross + fee }],
  });
  const hs = holdingsOf(state, cls);
  const h = hs[id] ?? (hs[id] = { qty: 0, cost: 0, carrying: 0, lots: [] });
  h.qty += qty;
  h.cost += gross;
  h.carrying += gross;
  h.lots.push({ qty, cost: gross, day: state.day });
  if (fee > 0) state.tax.ytd.investFees = (state.tax.ytd.investFees ?? 0) + fee;
  recordTrade(state, { market: CLASS_MARKET[cls], assetId: id, side: 'compra', qty, price: qty > 0 ? Math.round(gross / qty) : 0, fee, gross, orderType });
}

/** Retira `qty` de los lotes FIFO. Devuelve costo total y porción de largo plazo. */
function takeLots(state: GameState, h: Holding, qty: number): { cost: Cents; longCost: Cents; longQty: number } {
  const j = residence(state);
  let left = qty;
  let cost = 0;
  let longCost = 0;
  let longQty = 0;
  const kept: Lot[] = [];
  for (const l of h.lots) {
    if (left <= EPS) {
      kept.push(l);
      continue;
    }
    const take = Math.min(l.qty, left);
    const c = take >= l.qty - EPS ? l.cost : roundCents((l.cost * take) / l.qty);
    cost += c;
    const isLong = j.capitalGains.longAfterDays > 0 && state.day - l.day >= j.capitalGains.longAfterDays;
    if (isLong) {
      longCost += c;
      longQty += take;
    }
    left -= take;
    if (take < l.qty - EPS) kept.push({ qty: l.qty - take, cost: l.cost - c, day: l.day });
  }
  h.lots = kept;
  return { cost, longCost, longQty };
}

/**
 * Venta: revierte la revalorización de la porción vendida y registra la
 * ganancia realizada. Devuelve la ganancia realizada (bruto − costo FIFO).
 */
export function bookSell(state: GameState, cls: InvestClass, id: string, qty: number, gross: Cents, fee: Cents, memo: string, orderType?: OrderType, side: OrderSide = 'venta'): Cents {
  const hs = holdingsOf(state, cls);
  const h = hs[id];
  if (!h || h.qty < qty - EPS) throw new Error('Tenencia insuficiente para vender.');
  const all = qty >= h.qty - EPS;
  const carryingPart = all ? h.carrying : roundCents((h.carrying * qty) / h.qty);
  const lots = takeLots(state, h, all ? h.qty : qty);
  const costPart = all ? h.cost : lots.cost;
  const unreal = carryingPart - costPart;
  const realized = gross - costPart;
  const acc = CLASS_ACCOUNT[cls];
  const lines: Array<{ account: AccountId; debit?: Cents; credit?: Cents }> = [];
  if (gross - fee > 0) lines.push({ account: 'checking', debit: gross - fee });
  if (fee > 0) lines.push({ account: 'brokerage_fees', debit: fee });
  if (gross - fee < 0) lines.push({ account: 'checking', credit: fee - gross });
  if (carryingPart > 0) lines.push({ account: acc, credit: carryingPart });
  if (unreal > 0) lines.push({ account: 'unrealized_gains', debit: unreal });
  if (unreal < 0) lines.push({ account: 'unrealized_gains', credit: -unreal });
  if (realized > 0) lines.push({ account: 'realized_gains', credit: realized });
  if (realized < 0) lines.push({ account: 'realized_gains', debit: -realized });
  if (lines.length >= 2) post(state.ledger, { day: state.day, memo, cf: 'investing', tag: `invest:${cls}:sell`, lines });
  h.qty -= all ? h.qty : qty;
  h.cost -= costPart;
  h.carrying -= carryingPart;
  if (all || h.qty <= EPS) delete hs[id];
  // Ganancia de capital por plazo (proporcional al costo de largo plazo).
  const longGain = costPart > 0 ? roundCents((realized * lots.longCost) / costPart) : 0;
  const y = state.tax.ytd;
  y.gainsLong = (y.gainsLong ?? 0) + longGain;
  y.gainsShort = (y.gainsShort ?? 0) + (realized - longGain);
  if (fee > 0) y.investFees = (y.investFees ?? 0) + fee;
  recordTrade(state, { market: CLASS_MARKET[cls], assetId: id, side, qty, price: qty > 0 ? Math.round(gross / qty) : 0, fee, gross, realized, orderType });
  return realized;
}

/**
 * Lleva todas las tenencias a valor de mercado en UN asiento (si hay cambios).
 * Se ejecuta cada día y antes de cada operación.
 */
export function revalueInvestments(state: GameState, classes: InvestClass[] = INVEST_CLASSES): Cents {
  const lines: Array<{ account: AccountId; debit?: Cents; credit?: Cents }> = [];
  let total = 0;
  for (const cls of classes) {
    const hs = holdingsOf(state, cls);
    let delta = 0;
    for (const id of Object.keys(hs)) {
      const h = hs[id];
      const target = Math.max(0, roundCents(h.qty * markPrice(state, cls, id)));
      delta += target - h.carrying;
      h.carrying = target;
    }
    if (delta > 0) lines.push({ account: CLASS_ACCOUNT[cls], debit: delta });
    if (delta < 0) lines.push({ account: CLASS_ACCOUNT[cls], credit: -delta });
    total += delta;
  }
  if (!lines.length) return 0;
  if (total > 0) lines.push({ account: 'unrealized_gains', credit: total });
  if (total < 0) lines.push({ account: 'unrealized_gains', debit: -total });
  if (total === 0 && lines.length < 2) return 0;
  post(state.ledger, { day: state.day, memo: 'Valuación a mercado de inversiones', cf: 'internal', tag: 'invest:mark', lines });
  return total;
}

export interface PositionSummary {
  cls: InvestClass;
  id: string;
  qty: number;
  cost: Cents;
  value: Cents;
  unrealized: Cents;
  unrealizedPct: number;
  avgCost: number;
  price: number;
}

export function positions(state: GameState, cls: InvestClass): PositionSummary[] {
  const hs = holdingsOf(state, cls);
  return Object.keys(hs).map((id) => {
    const h = hs[id];
    const price = markPrice(state, cls, id);
    const value = roundCents(h.qty * price);
    return { cls, id, qty: h.qty, cost: h.cost, value, unrealized: value - h.cost, unrealizedPct: h.cost > 0 ? value / h.cost - 1 : 0, avgCost: h.qty > 0 ? h.cost / h.qty : 0, price };
  });
}

/** Valor total de mercado de las inversiones financieras personales. */
export function investmentsValue(state: GameState): Cents {
  let v = 0;
  for (const cls of INVEST_CLASSES) for (const p of positions(state, cls)) v += p.value;
  return v;
}

/**
 * Comisión estándar del corredor: 0,2 % con mínimo de $1 (ajustado por inflación).
 * Nunca supera el monto de la operación: vender acciones que casi no valen nada no
 * puede costar más de lo que se cobra (la caja de prueba de 50 × 20 lo encontró).
 */
export function brokerFee(state: GameState, gross: Cents, rate = 0.002): Cents {
  return Math.min(Math.max(0, gross), Math.max(roundCents(100 * state.macro.priceIndex), roundCents(gross * rate)));
}
