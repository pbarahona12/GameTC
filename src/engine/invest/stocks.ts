import { resolveEarningsHints } from '../world/rivals';
import { mandatesOnDividend, mandatesOnSplit } from './managed';
import type { GameState } from '../state';
import type { Stock, Candle, Order, OrderType, OrderSide } from './types';
import { STOCK_DEFS, IPO_POOL, SECTOR_PE, StockDef, SECTOR_NAMES } from '../../content/stocks';
import { Cents, clamp, roundCents, usd } from '../money';
import { dateOf } from '../time/calendar';
import { randNormal, nextRandom, chance, hashNormal, randInt } from '../rng';
import { stockMarketDrift, stockSectorDrift } from '../economy/economy';
import { ActionResult, FAIL, OK } from '../result';
import { fmtMoney, fmtPct } from '../format';
import { addLog } from '../log';
import { canPayFromChecking, spendable } from '../finance/payments';
import { bookBuy, bookSell, brokerFee, holdingsOf, revalueInvestments } from './portfolio';
import { practice } from '../skills/skills';
import { post } from '../ledger/ledger';
import { residence } from '../tax/taxEngine';
import { hiredPro } from '../pros/lookup';

/**
 * BOLSA DE VALORES (Fase 3).
 *
 * Modelo de precios diario (solo días hábiles, lunes a viernes). Retorno de cada acción:
 *   r = β·r_mercado + deriva sectorial + reversión al valor justo + momento + ruido propio
 * - r_mercado depende del ciclo económico, las tasas y los eventos (economy.ts).
 * - Valor justo = BPA × P/E justo (según sector, crecimiento y tasa de interés).
 *   El precio tiende lentamente a su valor justo: por eso los fundamentos importan.
 * - Momento: los compradores y vendedores siguen la tendencia reciente (oferta y demanda).
 * - Cada trimestre la empresa presenta resultados: la sorpresa frente a lo esperado
 *   mueve el precio. Si hay beneficios, paga dividendos (el precio cae lo pagado).
 * - Las órdenes grandes del jugador mueven el precio (impacto de mercado).
 */
export const TRADING_DAYS = 252;
const DAILY_HISTORY = 260;
const WEEKLY_HISTORY = 520;

export function isTradingDay(day: number): boolean {
  const w = dateOf(day).weekday;
  return w >= 1 && w <= 5;
}

function makeStock(state: GameState, d: StockDef, day: number): Stock {
  const price = usd(d.price * state.macro.priceIndex);
  const eps = Math.round(price / d.pe);
  const s: Stock = {
    id: d.id, name: d.name, sector: d.sector, description: d.description, shares: d.shares * 1_000_000,
    price, prevClose: price, open: price, high: price, low: price, volume: 0, avgVolume: Math.round(d.shares * 1_000_000 * 0.004),
    eps, growth: d.growth, payout: d.payout, beta: d.beta, vol: d.vol, debtRatio: d.debtRatio, health: d.health, fairPE: 0, momentum: 0,
    nextEarnings: day + 20, expectedQEps: Math.round((eps / 4) * (1 + d.growth / 4)), lastQEps: Math.round(eps / 4), dividend: 0, exDay: -1,
    status: 'activa', listedDay: day, history: [], weekly: [], news: [], splits: [],
  };
  s.fairPE = fairPE(state, s);
  return s;
}

/** P/E justo: el del sector, ajustado por crecimiento esperado y por la tasa de interés. */
export function fairPE(state: GameState, s: Pick<Stock, 'sector' | 'growth' | 'health'>): number {
  const base = SECTOR_PE[s.sector];
  const growthAdj = clamp(1 + (s.growth - 0.06) * 4, 0.55, 2);
  const rateAdj = clamp(0.07 / (state.macro.policyRate + 0.02), 0.6, 1.5);
  const healthAdj = clamp(0.7 + s.health / 200, 0.7, 1.2);
  return base * growthAdj * rateAdj * healthAdj;
}

export function fairValue(state: GameState, s: Stock): Cents {
  if (s.eps <= 0) return Math.max(1, Math.round(s.price * 0.8));
  return Math.round(s.eps * fairPE(state, s));
}

/** Historial previo simulado (6 meses) para que los gráficos tengan contexto desde el día 0. */
function backfill(state: GameState, s: Stock, day: number): void {
  let price = s.price;
  const out: Candle[] = [];
  const dv = s.vol / Math.sqrt(TRADING_DAYS);
  let d = day - 1;
  let n = 0;
  while (n < 130) {
    if (isTradingDay(d)) {
      const r = (0.06 / TRADING_DAYS) * s.beta + dv * 1.1 * randNormal(state);
      const close = price;
      const open = Math.max(1, Math.round(close * Math.exp(-r * 0.4)));
      const hi = Math.round(Math.max(open, close) * (1 + Math.abs(randNormal(state)) * dv * 0.5));
      const lo = Math.round(Math.min(open, close) * (1 - Math.abs(randNormal(state)) * dv * 0.5));
      out.push({ d, o: open, h: hi, l: Math.max(1, lo), c: close, v: Math.round(s.avgVolume * (0.6 + nextRandom(state) * 0.8)) });
      price = Math.max(1, Math.round(close / Math.exp(r)));
      n++;
    }
    d--;
  }
  s.history = out.reverse();
  s.prevClose = s.price;
}

export function initStocks(state: GameState): void {
  const day = state.day;
  state.stocks.stocks = STOCK_DEFS.map((d, i) => {
    const s = makeStock(state, d, day);
    s.nextEarnings = day + 12 + i * 5;
    backfill(state, s, day);
    return s;
  });
  state.stocks.index.base = indexCap(state) / 1000;
  state.stocks.index.level = 1000;
  state.stocks.index.history = [{ d: day, v: 1000 }];
}

function indexCap(state: GameState): number {
  return state.stocks.stocks.filter((s) => s.status === 'activa').reduce((t, s) => t + s.price * s.shares, 0);
}

export function stockById(state: GameState, id: string): Stock | undefined {
  return state.stocks.stocks.find((s) => s.id === id);
}

function pushCandle(s: Stock, c: Candle): void {
  s.history.push(c);
  if (s.history.length > DAILY_HISTORY) {
    // Las velas más antiguas se compactan en velas semanales.
    const chunk = s.history.splice(0, 5);
    s.weekly.push({ d: chunk[0].d, o: chunk[0].o, h: Math.max(...chunk.map((x) => x.h)), l: Math.min(...chunk.map((x) => x.l)), c: chunk[chunk.length - 1].c, v: chunk.reduce((a, x) => a + x.v, 0) });
    if (s.weekly.length > WEEKLY_HISTORY) s.weekly.shift();
  }
}

function news(s: Stock, day: number, text: string, impact: number): void {
  s.news.push({ day, text, impact });
  if (s.news.length > 12) s.news.shift();
}

/** Día bursátil completo: precios, resultados, dividendos, órdenes e índice. */
export function stocksDay(state: GameState): void {
  const m = state.stocks;
  if (!m.stocks.length) return;
  if (!isTradingDay(state.day)) {
    expireOrders(state);
    return;
  }
  const { drift, vol } = stockMarketDrift(state);
  const mVol = (0.15 * vol) / Math.sqrt(TRADING_DAYS);
  const rm = drift / TRADING_DAYS + mVol * randNormal(state);
  for (const s of m.stocks) stepStock(state, s, rm, vol);
  processEarnings(state);
  processDividends(state);
  runMarketOnOpen(state);
  processOrders(state);
  expireOrders(state);
  updateIndex(state);
  warnStrongDrops(state);
  delistAndIpo(state);
}

/** Caída diaria a partir de la cual se avisa (y, si lo elegiste, se pausa). */
export const STRONG_DROP = 0.08;

/** Aviso de caídas fuertes del día en acciones que tenés (categoría "inversiones"). */
function warnStrongDrops(state: GameState): void {
  if (state.meta.projection) return;
  const held = holdingsOf(state, 'stocks');
  const drops = state.stocks.stocks
    .filter((s) => (held[s.id]?.qty ?? 0) > 0 && s.prevClose > 0 && s.price / s.prevClose - 1 <= -STRONG_DROP)
    .map((s) => `${s.id} ${fmtPct(s.price / s.prevClose - 1, 1)}`);
  if (drops.length) addLog(state, 'warning', '📉', `Caída fuerte hoy en tus acciones: ${drops.join(', ')}.`, undefined, 'inversiones');
}

function stepStock(state: GameState, s: Stock, rm: number, volMult: number): void {
  s.prevClose = s.price;
  const dv = (s.vol * Math.sqrt(volMult)) / Math.sqrt(TRADING_DAYS);
  let r: number;
  if (s.status === 'quebrada') {
    r = dv * 2 * randNormal(state) - 0.01;
  } else {
    const fv = fairValue(state, s);
    const rev = 0.0015 * Math.log(fv / Math.max(1, s.price));
    const sec = stockSectorDrift(state, s.sector) / TRADING_DAYS;
    r = s.beta * rm + sec + rev + 0.06 * s.momentum + dv * randNormal(state);
  }
  r = clamp(r, -0.3, 0.3);
  s.momentum = 0.85 * s.momentum + 0.15 * r;
  const open = Math.max(1, Math.round(s.price * Math.exp(r * 0.3 + dv * 0.2 * randNormal(state))));
  const close = Math.max(1, Math.round(s.price * Math.exp(r)));
  const high = Math.max(open, close, Math.round(Math.max(open, close) * (1 + Math.abs(randNormal(state)) * dv * 0.6)));
  const low = Math.max(1, Math.min(open, close, Math.round(Math.min(open, close) * (1 - Math.abs(randNormal(state)) * dv * 0.6))));
  s.open = open;
  s.high = high;
  s.low = low;
  s.price = close;
  s.volume = Math.round(s.avgVolume * (0.6 + nextRandom(state) * 0.8 + Math.abs(r) * 20));
  s.avgVolume = Math.round(s.avgVolume * 0.98 + s.volume * 0.02);
  s.fairPE = fairPE(state, s);
  pushCandle(s, { d: state.day, o: open, h: high, l: low, c: close, v: s.volume });
}

/** Modifica la vela del día (impacto de una orden del jugador o de un evento). */
function adjustClose(s: Stock, newPrice: Cents): void {
  s.price = Math.max(1, newPrice);
  s.high = Math.max(s.high, s.price);
  s.low = Math.min(s.low, s.price);
  const c = s.history[s.history.length - 1];
  if (c) {
    c.c = s.price;
    c.h = Math.max(c.h, s.price);
    c.l = Math.min(c.l, s.price);
  }
}

function processEarnings(state: GameState): void {
  for (const s of state.stocks.stocks) {
    if (s.status !== 'activa' || state.day < s.nextEarnings) continue;
    const macroEff = (state.macro.gdpGrowth - 0.025) * 2 * s.beta + stockSectorDrift(state, s.sector) / 4;
    const noise = s.earningsNoise ?? randNormal(state);
    delete s.earningsNoise;
    const surprise = clamp(noise * 0.07 + macroEff * 0.3 + (s.health - 60) / 1500, -0.6, 0.6);
    resolveEarningsHints(state, s.id, surprise);
    const exp = s.expectedQEps;
    const actual = Math.round(exp + Math.abs(exp) * surprise);
    s.lastQEps = actual;
    s.eps = Math.round(s.eps * 0.75 + actual);
    s.growth = clamp(s.growth * 0.9 + 0.06 * 0.1 + surprise * 0.05, -0.3, 0.5);
    const recession = state.macro.phase === 'recesion' ? 1.5 : 0;
    s.health = clamp(s.health + surprise * 25 + (s.eps < 0 ? -4 : 0.6) - recession * s.debtRatio, 0, 100);
    s.expectedQEps = Math.round((s.eps / 4) * (1 + s.growth / 4));
    const jump = clamp(surprise * 1.2, -0.35, 0.35);
    adjustClose(s, Math.round(s.price * (1 + jump)));
    const pct = Math.round(surprise * 100);
    news(s, state.day, `Resultados trimestrales: beneficio por acción de ${fmtMoney(actual)} (${pct >= 0 ? '+' : ''}${pct} % frente a lo esperado).`, jump);
    if (holdingsOf(state, 'stocks')[s.id]) addLog(state, jump >= 0 ? 'info' : 'warning', '📊', `${s.name} (${s.id}) presentó resultados ${pct >= 0 ? 'mejores' : 'peores'} de lo esperado: la acción ${jump >= 0 ? 'subió' : 'cayó'} ${fmtPct(Math.abs(jump), 1)}.`);
    if (s.payout > 0 && s.eps > 0) {
      s.dividend = Math.max(1, Math.round((s.eps / 4) * s.payout));
      s.exDay = state.day + 14;
    } else s.dividend = 0;
    s.nextEarnings += 91;
    // Split 2×1 cuando el precio se vuelve muy alto (no cambia el valor de nada).
    if (s.price > usd(400 * state.macro.priceIndex)) split(state, s, 2);
    // Quiebra: salud muy baja con pérdidas.
    if (s.health < 4 && s.eps < 0) bankrupt(state, s);
  }
}

function split(state: GameState, s: Stock, ratio: number): void {
  s.shares *= ratio;
  s.price = Math.round(s.price / ratio);
  s.prevClose = Math.round(s.prevClose / ratio);
  s.eps = Math.round(s.eps / ratio);
  s.expectedQEps = Math.round(s.expectedQEps / ratio);
  s.lastQEps = Math.round(s.lastQEps / ratio);
  s.dividend = Math.round(s.dividend / ratio);
  s.avgVolume *= ratio;
  for (const c of [...s.history, ...s.weekly]) {
    c.o = Math.round(c.o / ratio);
    c.h = Math.round(c.h / ratio);
    c.l = Math.round(c.l / ratio);
    c.c = Math.round(c.c / ratio);
    c.v *= ratio;
  }
  const h = state.stocks.holdings[s.id];
  if (h) {
    h.qty *= ratio;
    for (const l of h.lots) l.qty *= ratio;
  }
  for (const o of state.stocks.orders) {
    if (o.stockId !== s.id || o.status !== 'abierta') continue;
    o.qty *= ratio;
    if (o.limit) o.limit = Math.round(o.limit / ratio);
    if (o.stop) o.stop = Math.round(o.stop / ratio);
    if (o.trailRef) o.trailRef = Math.round(o.trailRef / ratio);
  }
  mandatesOnSplit(state, s.id, ratio);
  s.splits.push({ day: state.day, ratio });
  news(s, state.day, `Split ${ratio}×1: cada acción se dividió en ${ratio}. El valor de tu inversión no cambia.`, 0);
  if (h) addLog(state, 'info', '✂️', `${s.name} hizo un split ${ratio}×1: ahora tenés ${h.qty} acciones (mismo valor total).`);
}

function bankrupt(state: GameState, s: Stock): void {
  s.status = 'quebrada';
  s.dividend = 0;
  adjustClose(s, Math.max(1, Math.round(s.price * 0.06)));
  news(s, state.day, 'La empresa se declaró en quiebra. Los accionistas probablemente pierdan casi todo.', -0.94);
  addLog(state, holdingsOf(state, 'stocks')[s.id] ? 'danger' : 'warning', '💥', `${s.name} (${s.id}) quebró. Su acción se desplomó y dejará de cotizar en 60 días; sus bonos entran en impago.`, undefined, 'inversiones');
  s.nextEarnings = state.day + 60; // fecha de exclusión de la bolsa
  for (const o of state.stocks.orders) if (o.stockId === s.id && o.status === 'abierta' && o.side === 'compra') o.status = 'cancelada';
}

function processDividends(state: GameState): void {
  const j = residence(state);
  for (const s of state.stocks.stocks) {
    if (s.exDay !== state.day || s.dividend <= 0) continue;
    const h = state.stocks.holdings[s.id];
    if (h && h.qty > 0) {
      const gross = roundCents(h.qty * s.dividend);
      const tax = roundCents(gross * j.dividendRate);
      if (gross > 0) {
        post(state.ledger, {
          day: state.day, memo: `Dividendo de ${s.name} (${h.qty} acciones)`, cf: 'operating', tag: 'invest:dividend',
          lines: [{ account: 'checking', debit: gross - tax }, ...(tax > 0 ? [{ account: 'dividend_tax' as const, debit: tax }] : []), { account: 'dividend_income', credit: gross }],
        });
        state.tax.ytd.dividends = (state.tax.ytd.dividends ?? 0) + gross;
        state.stocks.dividendsReceived += gross - tax;
        addLog(state, 'income', '💸', `Cobraste dividendos de ${s.name}: ${fmtMoney(gross)}${tax ? ` (retención ${fmtPct(j.dividendRate, 0)}: ${fmtMoney(tax)})` : ''}.`, gross - tax);
      }
    }
    mandatesOnDividend(state, s.id, s.dividend);
    adjustClose(s, s.price - s.dividend);
  }
}

function updateIndex(state: GameState): void {
  const idx = state.stocks.index;
  idx.level = Math.round((indexCap(state) / idx.base) * 100) / 100;
  idx.history.push({ d: state.day, v: idx.level });
  if (idx.history.length > 1300) idx.history.splice(0, idx.history.length - 1300);
}

function delistAndIpo(state: GameState): void {
  const m = state.stocks;
  for (const s of m.stocks) {
    if (s.status === 'quebrada' && state.day >= s.nextEarnings) {
      const h = m.holdings[s.id];
      if (h) {
        bookSell(state, 'stocks', s.id, h.qty, 0, 0, `${s.name} deja de cotizar tras su quiebra (pérdida total)`);
        addLog(state, 'danger', '🪦', `${s.name} dejó de cotizar. Tu inversión se dio de baja como pérdida realizada.`, undefined, 'inversiones');
      }
      for (const o of m.orders) if (o.stockId === s.id && o.status === 'abierta') o.status = 'cancelada';
    }
  }
  const before = indexCap(state);
  const removed = m.stocks.filter((s) => s.status === 'quebrada' && state.day >= s.nextEarnings);
  if (removed.length) {
    m.stocks = m.stocks.filter((s) => !removed.includes(s));
    const after = indexCap(state);
    if (after > 0 && before > 0) m.index.base *= after / before;
  }
  // Salidas a bolsa: ~1 cada 9 meses si hay candidatos.
  if (chance(state, 1 / 190)) {
    const pool = IPO_POOL.filter((d) => !m.stocks.some((s) => s.id === d.id));
    if (pool.length) {
      const d = pool[randInt(state, 0, pool.length - 1)];
      const capBefore = indexCap(state);
      const s = makeStock(state, d, state.day);
      s.nextEarnings = state.day + 60;
      s.history = [{ d: state.day, o: s.price, h: s.price, l: s.price, c: s.price, v: s.avgVolume }];
      m.stocks.push(s);
      m.index.base *= indexCap(state) / capBefore;
      addLog(state, 'info', '🔔', `Salida a bolsa: ${s.name} (${s.id}, ${SECTOR_NAMES[s.sector]}) empieza a cotizar a ${fmtMoney(s.price)} por acción.`);
    }
  }
}

// ------------------------------------------------------------ Ejecución de órdenes

export interface MarketQuote {
  price: Cents;
  gross: Cents;
  fee: Cents;
  spread: number;
  impact: number;
  total: Cents;
}

/** Diferencial compra/venta: más amplio en acciones poco negociadas o volátiles. */
export function spreadOf(s: Stock): number {
  return clamp(0.0008 + s.vol * 0.004 + (s.avgVolume < 300_000 ? 0.002 : 0), 0.0008, 0.01);
}

/** Impacto de precio de una orden según su tamaño frente al volumen diario promedio. */
export function impactOf(s: Stock, qty: number): number {
  const dv = s.vol / Math.sqrt(TRADING_DAYS);
  return clamp(0.5 * dv * Math.sqrt(qty / Math.max(1, s.avgVolume)), 0, 0.2);
}

/** Mejor ejecución con experiencia en bolsa: −0,4 % del costo por nivel, hasta −40 %. */
export function executionSkillFactor(state: GameState): number {
  return Math.max(0.6, 1 - (state.skills.stocks?.level ?? 1) * 0.004);
}

export function quoteMarket(state: GameState, s: Stock, side: OrderSide, qty: number, ref = s.price): MarketQuote {
  const k = executionSkillFactor(state);
  const spread = spreadOf(s) * k;
  const impact = impactOf(s, qty) * k;
  const dir = side === 'compra' ? 1 : -1;
  const price = Math.max(1, Math.round(ref * (1 + dir * (spread / 2 + impact))));
  const gross = roundCents(price * qty);
  const fee = brokerFee(state, gross);
  return { price, gross, fee, spread, impact, total: side === 'compra' ? gross + fee : gross - fee };
}

/** Ejecuta una operación a un precio dado. Devuelve null si se pudo, o el motivo del rechazo. */
function execute(state: GameState, s: Stock, side: OrderSide, qty: number, price: Cents, type: OrderType): string | null {
  const gross = roundCents(price * qty);
  const fee = brokerFee(state, gross);
  if (side === 'compra') {
    if (s.status !== 'activa') return 'La acción no cotiza normalmente.';
    if (!canPayFromChecking(state, gross + fee)) return `Fondos insuficientes: necesitás ${fmtMoney(gross + fee)}.`;
    revalueInvestments(state, ['stocks']);
    bookBuy(state, 'stocks', s.id, qty, gross, fee, `Compra de ${qty} ${s.id} a ${fmtMoney(price)}`, type);
  } else {
    const h = state.stocks.holdings[s.id];
    if (!h || h.qty < qty) return 'No tenés suficientes acciones.';
    revalueInvestments(state, ['stocks']);
    bookSell(state, 'stocks', s.id, qty, gross, fee, `Venta de ${qty} ${s.id} a ${fmtMoney(price)}`, type);
  }
  // Impacto permanente: la mitad del impacto queda en el precio (oferta y demanda).
  const imp = impactOf(s, qty) * 0.5;
  if (imp > 0.0005) adjustClose(s, Math.round(s.price * (1 + (side === 'compra' ? imp : -imp))));
  practice(state, 'trade', 'stocks', 40);
  return null;
}

export interface OrderInput {
  stockId: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limit?: Cents;
  stop?: Cents;
  trailPct?: number;
  days?: number;
  /** Para crear un par OCO (stop loss + take profit) en una sola acción. */
  oco?: { stop: Cents; takeProfit: Cents };
}

/**
 * Coloca una orden. Las de mercado se ejecutan al instante en día hábil (al
 * precio de cierre ± diferencial e impacto) o en la apertura del siguiente día hábil.
 */
/** Acciones ya comprometidas en órdenes de venta abiertas (de un par OCO cuenta una sola pata). */
export function reservedForSale(state: GameState, stockId: string): number {
  return state.stocks.orders.filter((x) => x.stockId === stockId && x.side === 'venta' && x.status === 'abierta' && (!x.oco || x.type === 'stop')).reduce((t, x) => t + x.qty, 0);
}

export function placeStockOrder(state: GameState, o: OrderInput): ActionResult {
  const s = stockById(state, o.stockId);
  if (!s) return FAIL('Acción inexistente.');
  if (!Number.isInteger(o.qty) || o.qty <= 0) return FAIL('La cantidad debe ser un número entero de acciones mayor a cero.');
  if (s.status !== 'activa' && o.side === 'compra') return FAIL('No se pueden comprar acciones de una empresa en quiebra.');
  if (state.legal?.prison) return FAIL('Desde prisión no podés operar en bolsa.');
  const h = state.stocks.holdings[s.id];
  if (o.side === 'venta') {
    const reserved = reservedForSale(state, s.id);
    if (!h || h.qty - reserved < o.qty) return FAIL(`Solo tenés ${h ? h.qty - reserved : 0} acciones disponibles para vender (el resto ya está en órdenes de venta abiertas).`);
  }
  const days = clamp(o.days ?? 30, 1, 90);
  if (o.type === 'mercado') {
    if (isTradingDay(state.day)) {
      const q = quoteMarket(state, s, o.side, o.qty);
      const err = execute(state, s, o.side, o.qty, q.price, 'mercado');
      if (err) return FAIL(err);
      return OK(`${o.side === 'compra' ? 'Compraste' : 'Vendiste'} ${o.qty} ${s.id} a ${fmtMoney(q.price)} (comisión ${fmtMoney(q.fee)}).`);
    }
    if (o.side === 'compra' && !canPayFromChecking(state, quoteMarket(state, s, 'compra', o.qty).total)) return FAIL('Fondos insuficientes para la orden.');
    state.stocks.orders.push({ id: state.meta.nextId++, stockId: s.id, side: o.side, type: 'mercado', qty: o.qty, createdDay: state.day, expiresDay: state.day + 4, status: 'abierta', note: 'Mercado cerrado: se ejecuta en la próxima apertura.' });
    return OK('La bolsa está cerrada (fin de semana): la orden se ejecutará en la próxima apertura.');
  }
  if (o.type === 'limite' || o.type === 'take_profit') {
    if (!o.limit || o.limit <= 0) return FAIL('Indicá el precio límite.');
    if (o.type === 'take_profit' && o.side !== 'venta') return FAIL('La toma de ganancias es una orden de venta.');
  }
  if (o.type === 'stop' || o.type === 'stop_limite') {
    if (!o.stop || o.stop <= 0) return FAIL('Indicá el precio de activación (stop).');
    if (o.type === 'stop_limite' && (!o.limit || o.limit <= 0)) return FAIL('Indicá el precio límite de la orden stop-límite.');
  }
  if (o.type === 'trailing') {
    if (o.side !== 'venta') return FAIL('El stop dinámico es una orden de venta.');
    if (!o.trailPct || o.trailPct < 0.01 || o.trailPct > 0.5) return FAIL('El stop dinámico debe estar entre 1 % y 50 % por debajo del máximo.');
  }
  if (o.side === 'compra') {
    const ref = o.limit ?? o.stop ?? s.price;
    const need = roundCents(ref * o.qty) + brokerFee(state, roundCents(ref * o.qty));
    if (spendable(state) < need) return FAIL(`Fondos insuficientes para cubrir la orden (${fmtMoney(need)}).`);
  }
  const base: Order = {
    id: state.meta.nextId++, stockId: s.id, side: o.side, type: o.type, qty: o.qty, limit: o.limit, stop: o.stop, trailPct: o.trailPct,
    trailRef: o.type === 'trailing' ? s.price : undefined, createdDay: state.day, expiresDay: state.day + days, status: 'abierta',
  };
  state.stocks.orders.push(base);
  practice(state, 'order', 'stocks', 20);
  return OK(`Orden ${typeLabel(o.type).toLowerCase()} registrada (vence en ${days} días).`);
}

/** Crea un par OCO: stop loss + toma de ganancias sobre acciones que ya tenés. */
export function placeBracket(state: GameState, stockId: string, qty: number, stop: Cents, takeProfit: Cents, days = 60): ActionResult {
  const s = stockById(state, stockId);
  if (!s) return FAIL('Acción inexistente.');
  const h = state.stocks.holdings[stockId];
  if (!h || qty <= 0 || !Number.isInteger(qty)) return FAIL('Cantidad inválida.');
  const free = h.qty - reservedForSale(state, stockId);
  if (free < qty) return FAIL(`Solo tenés ${Math.max(0, free)} acciones libres para proteger (el resto ya está en órdenes de venta abiertas).`);
  if (!(stop < s.price && takeProfit > s.price)) return FAIL('El stop debe estar por debajo del precio actual y la toma de ganancias por encima.');
  const a: Order = { id: state.meta.nextId++, stockId, side: 'venta', type: 'stop', qty, stop, createdDay: state.day, expiresDay: state.day + days, status: 'abierta' };
  const b: Order = { id: state.meta.nextId++, stockId, side: 'venta', type: 'take_profit', qty, limit: takeProfit, createdDay: state.day, expiresDay: state.day + days, status: 'abierta' };
  a.oco = b.id;
  b.oco = a.id;
  state.stocks.orders.push(a, b);
  practice(state, 'order', 'stocks', 30);
  return OK(`Protección OCO creada: stop en ${fmtMoney(stop)} y toma de ganancias en ${fmtMoney(takeProfit)}. Si se ejecuta una, la otra se cancela.`);
}

export function cancelOrder(state: GameState, id: number): ActionResult {
  const o = state.stocks.orders.find((x) => x.id === id && x.status === 'abierta');
  if (!o) return FAIL('La orden ya no está abierta.');
  o.status = 'cancelada';
  if (o.oco) {
    const p = state.stocks.orders.find((x) => x.id === o.oco && x.status === 'abierta');
    if (p) p.status = 'cancelada';
  }
  return OK('Orden cancelada.');
}

function fill(state: GameState, o: Order, s: Stock, price: Cents): void {
  const err = execute(state, s, o.side, o.qty, price, o.type);
  if (err) {
    o.status = 'rechazada';
    o.note = err;
    addLog(state, 'warning', '📑', `Orden ${typeLabel(o.type).toLowerCase()} de ${o.side} de ${o.qty} ${s.id} rechazada: ${err}`);
    return;
  }
  o.status = 'ejecutada';
  o.filledPrice = price;
  o.filledDay = state.day;
  addLog(state, 'info', '📑', `Se ejecutó tu orden ${typeLabel(o.type).toLowerCase()}: ${o.side} de ${o.qty} ${s.id} a ${fmtMoney(price)}.`);
  if (o.oco) {
    const p = state.stocks.orders.find((x) => x.id === o.oco && x.status === 'abierta');
    if (p) p.status = 'cancelada';
  }
}

function runMarketOnOpen(state: GameState): void {
  for (const o of state.stocks.orders) {
    if (o.status !== 'abierta' || o.type !== 'mercado') continue;
    const s = stockById(state, o.stockId);
    if (!s) {
      o.status = 'cancelada';
      continue;
    }
    fill(state, o, s, quoteMarket(state, s, o.side, o.qty, s.open).price);
  }
}

/** Órdenes condicionales contra el rango del día (apertura, máximo, mínimo). */
function processOrders(state: GameState): void {
  for (const o of [...state.stocks.orders]) {
    if (o.status !== 'abierta' || o.type === 'mercado') continue;
    const s = stockById(state, o.stockId);
    if (!s) {
      o.status = 'cancelada';
      continue;
    }
    const slip = spreadOf(s) / 2;
    if (o.type === 'limite' || o.type === 'take_profit') {
      if (o.side === 'compra' && s.low <= o.limit!) fill(state, o, s, Math.min(s.open, o.limit!));
      else if (o.side === 'venta' && s.high >= o.limit!) fill(state, o, s, Math.max(s.open, o.limit!));
    } else if (o.type === 'stop') {
      if (o.side === 'venta' && s.low <= o.stop!) fill(state, o, s, Math.round(Math.min(s.open, o.stop!) * (1 - slip)));
      else if (o.side === 'compra' && s.high >= o.stop!) fill(state, o, s, Math.round(Math.max(s.open, o.stop!) * (1 + slip)));
    } else if (o.type === 'stop_limite') {
      const triggered = o.side === 'venta' ? s.low <= o.stop! : s.high >= o.stop!;
      if (triggered) {
        o.type = 'limite';
        o.note = `Stop activado en ${fmtMoney(o.stop!)}: ahora es una orden límite.`;
        if (o.side === 'venta' && s.high >= o.limit! && s.low <= o.stop!) fill(state, o, s, o.limit!);
        else if (o.side === 'compra' && s.low <= o.limit! && s.high >= o.stop!) fill(state, o, s, o.limit!);
      }
    } else if (o.type === 'trailing') {
      o.trailRef = Math.max(o.trailRef ?? s.high, s.high);
      const stop = Math.round(o.trailRef * (1 - o.trailPct!));
      if (s.low <= stop) fill(state, o, s, Math.round(Math.min(s.open, stop) * (1 - slip)));
    }
  }
}

function expireOrders(state: GameState): void {
  for (const o of state.stocks.orders) {
    if (o.status === 'abierta' && state.day > o.expiresDay) {
      o.status = 'vencida';
      addLog(state, 'info', '⌛', `Venció tu orden ${typeLabel(o.type).toLowerCase()} de ${o.side} de ${o.qty} ${o.stockId} sin ejecutarse.`);
    }
  }
  if (state.stocks.orders.length > 200) {
    const open = state.stocks.orders.filter((o) => o.status === 'abierta');
    const closed = state.stocks.orders.filter((o) => o.status !== 'abierta').slice(-120);
    state.stocks.orders = [...closed, ...open];
  }
}

export function typeLabel(t: OrderType): string {
  return { mercado: 'De mercado', limite: 'Límite', stop: 'Stop loss', stop_limite: 'Stop-límite', take_profit: 'Toma de ganancias', trailing: 'Stop dinámico' }[t];
}

// ------------------------------------------------------------ Análisis (predicción con habilidad)

export interface AnalystView {
  fairEstimate: Cents;
  low: Cents;
  high: Cents;
  expected3m: number;
  errorPct: number;
  rating: 'compra' | 'mantener' | 'venta';
  confidence: 'baja' | 'media' | 'alta';
  pe: number | null;
  dividendYield: number;
  explanation: string;
}

/**
 * Estimación del valor justo con ERROR que depende de tu habilidad de
 * Predicción bursátil (y de un asesor financiero contratado). Nunca es exacta:
 * el error mínimo es del 6 % y el futuro además tiene ruido propio.
 * El error es estable durante una semana (no cambia al volver a mirar).
 */
export function analystView(state: GameState, s: Stock): AnalystView {
  const skill = state.skills.prediction.level;
  const adv = hiredPro(state, 'asesor', 'personal');
  const skillEff = Math.max(skill, adv ? 40 + adv.quality * 0.5 : 0);
  const errorPct = clamp(0.35 * (1 - skillEff / 120), 0.06, 0.35);
  const week = Math.floor(state.day / 7);
  const z = clamp(hashNormal(`${state.seed}:${s.id}:${week}`), -2.5, 2.5);
  const fv = fairValue(state, s);
  const fairEstimate = Math.max(1, Math.round(fv * (1 + z * errorPct)));
  const low = Math.max(1, Math.round(fairEstimate * (1 - errorPct * 1.3)));
  const high = Math.round(fairEstimate * (1 + errorPct * 1.3));
  // A 3 meses el precio recorre ~10 % de la distancia al valor justo, más la deriva del mercado.
  const drift = stockMarketDrift(state).drift * s.beta * 0.25;
  const expected3m = clamp(Math.log(fairEstimate / Math.max(1, s.price)) * 0.1 + drift, -0.6, 0.6);
  const rating = expected3m > 0.03 ? 'compra' : expected3m < -0.03 ? 'venta' : 'mantener';
  const confidence = errorPct < 0.12 ? 'alta' : errorPct < 0.22 ? 'media' : 'baja';
  const pe = s.eps > 0 ? s.price / s.eps : null;
  const dividendYield = s.price > 0 ? (s.dividend * 4) / s.price : 0;
  const explanation = `Con tu nivel de Predicción bursátil (${skill}${adv ? ` y el apoyo de ${adv.name}` : ''}), el margen de error de esta estimación es de ±${Math.round(errorPct * 100)} %. Aunque el valor justo fuera exacto, el precio también depende de noticias, del ciclo y del ánimo del mercado: ninguna predicción es segura.`;
  return { fairEstimate, low, high, expected3m, errorPct, rating, confidence, pe, dividendYield, explanation };
}

export function studyStock(state: GameState, id: string): ActionResult {
  const s = stockById(state, id);
  if (!s) return FAIL('Acción inexistente.');
  const xp = practice(state, `analysis:${id}`, 'prediction', 35);
  return OK(xp > 0 ? `Analizaste ${s.name}: +${Math.round(xp)} XP de Predicción bursátil.` : 'Ya analizaste esta acción hoy: la práctica repetida no suma más experiencia.');
}

/** Retorno porcentual de una acción en N días hábiles. */
export function returnOver(s: Stock, n: number): number | null {
  const h = s.history;
  if (h.length <= n) return null;
  return s.price / h[h.length - 1 - n].c - 1;
}

export function orderSummary(o: Order): string {
  const parts = [`${o.side === 'compra' ? 'Compra' : 'Venta'} ${o.qty} ${o.stockId}`, typeLabel(o.type)];
  if (o.limit) parts.push(`límite ${fmtMoney(o.limit)}`);
  if (o.stop) parts.push(`stop ${fmtMoney(o.stop)}`);
  if (o.trailPct) parts.push(`${Math.round(o.trailPct * 100)} % bajo el máximo`);
  return parts.join(' · ');
}

export const _test = { stepStock, processOrders, split, bankrupt };
