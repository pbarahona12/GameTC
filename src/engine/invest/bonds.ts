import type { GameState } from '../state';
import type { BondIssue } from './types';
import { Cents, clamp, roundCents, usd } from '../money';
import { addMonths, dateOf, formatDate } from '../time/calendar';
import { creditSpread } from '../economy/economy';
import { JURISDICTION_BY_ID, JurisdictionId } from '../../content/jurisdictions';
import { ActionResult, FAIL, OK } from '../result';
import { fmtMoney, fmtPct } from '../format';
import { addLog } from '../log';
import { canPayFromChecking } from '../finance/payments';
import { bookBuy, bookSell, brokerFee, revalueInvestments } from './portfolio';
import { post } from '../ledger/ledger';
import { chance, randNormal } from '../rng';
import { practice } from '../skills/skills';

/**
 * BONOS (renta fija).
 * - Cada bono paga un cupón semestral (tasa fija sobre el nominal de $1.000) y
 *   devuelve el nominal al vencimiento.
 * - Su PRECIO es el valor presente de los pagos que faltan, descontados al
 *   rendimiento que hoy exige el mercado:
 *       rendimiento = tasa de política + prima por plazo + diferencial de crédito
 *   Si las tasas suben, los bonos existentes valen menos (y al revés). Cuanto
 *   más largo el plazo, mayor el efecto (duración).
 * - Riesgo de impago: los bonos de empresas quiebran con su emisor (se recupera
 *   ~40 %); los de gobiernos riesgosos también pueden reestructurarse.
 * - Precio "sucio": incluye el cupón devengado; cae el día que se paga el cupón.
 */
export const BOND_FACE = usd(1000);

interface BondSpec {
  issuerKind: 'gobierno' | 'empresa';
  issuer: string;
  years: number;
}

export const GOV_SPREAD: Record<JurisdictionId, number> = { valdoria: 0.003, norvalia: 0, meridia: 0.002, isla_coral: 0.025 };
const GOV_RATING: Record<JurisdictionId, string> = { valdoria: 'AA', norvalia: 'AAA', meridia: 'AA+', isla_coral: 'BB+' };

const INITIAL: BondSpec[] = [
  { issuerKind: 'gobierno', issuer: 'valdoria', years: 1 },
  { issuerKind: 'gobierno', issuer: 'valdoria', years: 2 },
  { issuerKind: 'gobierno', issuer: 'valdoria', years: 5 },
  { issuerKind: 'gobierno', issuer: 'valdoria', years: 10 },
  { issuerKind: 'gobierno', issuer: 'norvalia', years: 10 },
  { issuerKind: 'gobierno', issuer: 'meridia', years: 3 },
  { issuerKind: 'gobierno', issuer: 'isla_coral', years: 5 },
  { issuerKind: 'empresa', issuer: 'BVAL', years: 3 },
  { issuerKind: 'empresa', issuer: 'PTRS', years: 5 },
  { issuerKind: 'empresa', issuer: 'SOLR', years: 7 },
  { issuerKind: 'empresa', issuer: 'CRDN', years: 2 },
  { issuerKind: 'empresa', issuer: 'ACRV', years: 4 },
  { issuerKind: 'empresa', issuer: 'ONDA', years: 5 },
  { issuerKind: 'empresa', issuer: 'URBE', years: 3 },
];

export function termPremium(years: number): number {
  return 0.0025 * Math.pow(Math.max(0.1, years), 0.7);
}

/** Diferencial de crédito de una empresa según salud y endeudamiento. */
export function corporateSpread(state: GameState, ticker: string): number {
  const s = state.stocks.stocks.find((x) => x.id === ticker);
  if (!s) return 0.05;
  if (s.status === 'quebrada') return 0.5;
  return clamp(0.006 + ((100 - s.health) / 100) * 0.06 * (0.5 + s.debtRatio), 0.004, 0.25);
}

export function ratingFromSpread(sp: number): string {
  if (sp < 0.002) return 'AAA';
  if (sp < 0.005) return 'AA';
  if (sp < 0.01) return 'A';
  if (sp < 0.02) return 'BBB';
  if (sp < 0.035) return 'BB';
  if (sp < 0.06) return 'B';
  if (sp < 0.12) return 'CCC';
  return 'D';
}

function issuerName(state: GameState, spec: { issuerKind: string; issuer: string }): string {
  if (spec.issuerKind === 'gobierno') return `Tesoro de ${JURISDICTION_BY_ID[spec.issuer as JurisdictionId].name.replace(/^(República|Reino|Principado|Federación) de /, '')}`;
  return state.stocks.stocks.find((s) => s.id === spec.issuer)?.name ?? spec.issuer;
}

export function requiredYield(state: GameState, b: Pick<BondIssue, 'issuerKind' | 'issuer' | 'maturityDay'>): number {
  const years = Math.max(0, (b.maturityDay - state.day) / 365);
  const credit = b.issuerKind === 'gobierno' ? GOV_SPREAD[b.issuer as JurisdictionId] ?? 0.01 : corporateSpread(state, b.issuer) + creditSpread(state);
  return Math.max(0.001, state.macro.policyRate + termPremium(years) + credit);
}

/** Próximas fechas de cupón (semestrales desde la emisión) posteriores a `day`. */
export function couponDates(b: Pick<BondIssue, 'issueDay' | 'maturityDay'>, after: number): number[] {
  const out: number[] = [];
  for (let k = 1; k <= 80; k++) {
    const d = addMonths(b.issueDay, 6 * k);
    if (d > b.maturityDay + 3) break;
    if (d > after) out.push(Math.min(d, b.maturityDay));
  }
  return out;
}

/** Precio sucio de un bono (centavos por bono) descontando cupones y nominal. */
export function bondPrice(state: GameState, b: BondIssue, y = b.yield): Cents {
  if (b.status === 'impago') return roundCents(b.face * (b.recovery ?? 0.4));
  if (b.status === 'vencido') return 0;
  const cpn = (b.face * b.coupon) / 2;
  let pv = 0;
  const dates = couponDates(b, state.day);
  dates.forEach((d, i) => {
    const t = (d - state.day) / 365;
    const cash = cpn + (i === dates.length - 1 ? b.face : 0);
    pv += cash / Math.pow(1 + y / 2, 2 * t);
  });
  return Math.max(1, Math.round(pv));
}

/** Duración modificada aproximada: % que cae el precio si el rendimiento sube 1 pp. */
export function duration(state: GameState, b: BondIssue): number {
  const p0 = bondPrice(state, b, b.yield);
  const p1 = bondPrice(state, b, b.yield + 0.01);
  return p0 > 0 ? (p0 - p1) / p0 / 0.01 : 0;
}

function makeIssue(state: GameState, spec: BondSpec, day: number): BondIssue {
  const maturityDay = addMonths(day, spec.years * 12);
  const partial = { issuerKind: spec.issuerKind, issuer: spec.issuer, maturityDay };
  const y = requiredYield({ ...state, day } as GameState, partial);
  const coupon = Math.round(y * 800) / 800; // múltiplos de 0,125 %
  const g = dateOf(day);
  const id = `${spec.issuerKind === 'gobierno' ? spec.issuer.slice(0, 3).toUpperCase() : spec.issuer}-${spec.years}A-${g.y}${String(g.m).padStart(2, '0')}`;
  const credit = spec.issuerKind === 'gobierno' ? GOV_RATING[spec.issuer as JurisdictionId] : ratingFromSpread(corporateSpread(state, spec.issuer));
  const b: BondIssue = {
    id, issuerKind: spec.issuerKind, issuer: spec.issuer, name: `${issuerName(state, spec)} ${fmtPct(coupon, 3)} ${g.y + spec.years}`,
    coupon, face: BOND_FACE, issueDay: day, maturityDay, yield: y, price: 0, rating: credit, status: 'vigente', history: [],
  };
  b.price = bondPrice({ ...state, day } as GameState, b);
  return b;
}

export function initBonds(state: GameState): void {
  // Emisiones escalonadas en el pasado para que haya vencimientos a lo largo del juego.
  state.bonds.issues = INITIAL.map((spec, i) => {
    const age = Math.min(spec.years * 12 - 3, (i % 4) * 5);
    const issueDay = addMonths(state.day, -Math.max(0, age));
    const b = makeIssue(state, spec, issueDay);
    b.yield = requiredYield(state, b);
    b.price = bondPrice(state, b);
    b.history = [{ d: state.day, p: b.price, y: b.yield }];
    return b;
  });
}

/** Día de bonos: rendimientos, precios, cupones, vencimientos e impagos. */
export function bondsDay(state: GameState): void {
  const st = state.bonds;
  if (!st.issues.length) return;
  for (const b of st.issues) {
    if (b.status === 'vencido') continue;
    // Impago de emisores corporativos quebrados.
    if (b.status === 'vigente' && b.issuerKind === 'empresa') {
      const s = state.stocks.stocks.find((x) => x.id === b.issuer);
      if (!s || s.status === 'quebrada') defaultBond(state, b, 0.4);
    }
    // Riesgo soberano: Isla Coral puede reestructurar en recesiones profundas.
    if (b.status === 'vigente' && b.issuerKind === 'gobierno' && GOV_SPREAD[b.issuer as JurisdictionId] > 0.02 && state.macro.phase === 'recesion' && dateOf(state.day).d === 1 && chance(state, 0.004)) {
      defaultBond(state, b, 0.55);
    }
    if (b.status === 'impago') {
      if (b.maturityDay <= state.day) settleDefault(state, b);
      b.price = bondPrice(state, b);
      continue;
    }
    b.prevYield = b.yield;
    b.yield = Math.max(0.001, requiredYield(state, b) + randNormal(state) * 0.0002);
    b.rating = b.issuerKind === 'gobierno' ? GOV_RATING[b.issuer as JurisdictionId] : ratingFromSpread(corporateSpread(state, b.issuer));
    // Cupón
    const due = couponDates(b, state.day - 1)[0];
    if (due === state.day) payCoupon(state, b);
    if (state.day >= b.maturityDay) {
      mature(state, b);
      continue;
    }
    b.price = bondPrice(state, b);
    if (dateOf(state.day).weekday === 5 || !b.history.length) {
      b.history.push({ d: state.day, p: b.price, y: Math.round(b.yield * 1e6) / 1e6 });
      if (b.history.length > 520) b.history.shift();
    }
  }
  st.issues = st.issues.filter((b) => b.status !== 'vencido' || st.holdings[b.id]);
}

function payCoupon(state: GameState, b: BondIssue): void {
  const h = state.bonds.holdings[b.id];
  if (!h || h.qty <= 0) return;
  const amount = roundCents(h.qty * (b.face * b.coupon) / 2);
  if (amount <= 0) return;
  post(state.ledger, { day: state.day, memo: `Cupón de ${b.name} (${h.qty} bonos)`, cf: 'operating', tag: 'invest:coupon', lines: [{ account: 'checking', debit: amount }, { account: 'bond_interest', credit: amount }] });
  state.tax.ytd.bondInterest = (state.tax.ytd.bondInterest ?? 0) + amount;
  state.bonds.couponsReceived += amount;
  addLog(state, 'income', '🎟️', `Cobraste el cupón de ${b.name}.`, amount);
}

function mature(state: GameState, b: BondIssue): void {
  const h = state.bonds.holdings[b.id];
  if (h && h.qty > 0) {
    revalueInvestments(state, ['bonds']);
    const gross = roundCents(h.qty * b.face);
    bookSell(state, 'bonds', b.id, h.qty, gross, 0, `Vencimiento de ${b.name}: devolución del nominal`);
    addLog(state, 'income', '🏁', `Venció ${b.name}: recibiste el nominal de ${fmtMoney(gross)}.`, gross);
  }
  b.status = 'vencido';
  // El emisor refinancia con una emisión nueva al mismo plazo.
  const years = Math.max(1, Math.round((b.maturityDay - b.issueDay) / 365));
  const issuerAlive = b.issuerKind === 'gobierno' || state.stocks.stocks.some((s) => s.id === b.issuer && s.status === 'activa');
  if (issuerAlive) {
    const nb = makeIssue(state, { issuerKind: b.issuerKind, issuer: b.issuer, years }, state.day);
    if (!state.bonds.issues.some((x) => x.id === nb.id)) {
      nb.history = [{ d: state.day, p: nb.price, y: nb.yield }];
      state.bonds.issues.push(nb);
    }
  }
}

function defaultBond(state: GameState, b: BondIssue, recovery: number): void {
  b.status = 'impago';
  b.recovery = recovery;
  b.maturityDay = state.day + 90; // plazo de liquidación
  b.history.push({ d: state.day, p: bondPrice(state, b), y: Math.round(b.yield * 1e6) / 1e6 });
  const h = state.bonds.holdings[b.id];
  addLog(state, h ? 'danger' : 'warning', '⚠️', `IMPAGO: ${b.name} dejó de pagar. Se estima un recupero del ${Math.round(recovery * 100)} % del nominal en 90 días.`, undefined, 'inversiones');
}

function settleDefault(state: GameState, b: BondIssue): void {
  const h = state.bonds.holdings[b.id];
  if (h && h.qty > 0) {
    revalueInvestments(state, ['bonds']);
    const gross = roundCents(h.qty * b.face * (b.recovery ?? 0.4));
    bookSell(state, 'bonds', b.id, h.qty, gross, 0, `Recupero por impago de ${b.name}`);
    addLog(state, 'warning', '⚖️', `Se liquidó el impago de ${b.name}: recuperaste ${fmtMoney(gross)}.`, gross, 'inversiones');
  }
  b.status = 'vencido';
}

export function bondQuote(state: GameState, b: BondIssue, qty: number, side: 'compra' | 'venta') {
  const spread = b.issuerKind === 'gobierno' ? 0.001 : 0.003;
  const price = Math.round(b.price * (1 + (side === 'compra' ? spread : -spread)));
  const gross = roundCents(price * qty);
  const fee = brokerFee(state, gross, 0.001);
  return { price, gross, fee, total: side === 'compra' ? gross + fee : gross - fee };
}

export function buyBond(state: GameState, id: string, qty: number): ActionResult {
  const b = state.bonds.issues.find((x) => x.id === id);
  if (!b || b.status !== 'vigente') return FAIL('Ese bono no está disponible.');
  if (!Number.isInteger(qty) || qty <= 0) return FAIL('Indicá una cantidad entera de bonos (nominal $1,000 cada uno).');
  if (state.legal?.prison) return FAIL('Desde prisión no podés operar.');
  const q = bondQuote(state, b, qty, 'compra');
  if (!canPayFromChecking(state, q.total)) return FAIL(`Necesitás ${fmtMoney(q.total)}.`);
  revalueInvestments(state, ['bonds']);
  bookBuy(state, 'bonds', id, qty, q.gross, q.fee, `Compra de ${qty} bonos ${b.name}`);
  practice(state, 'bond', 'finEdu', 30);
  return OK(`Compraste ${qty} ${qty === 1 ? "bono" : "bonos"} ${b.name} a ${fmtMoney(q.price)} c/u (rendimiento ${fmtPct(b.yield, 2)}).`);
}

export function sellBond(state: GameState, id: string, qty: number): ActionResult {
  const b = state.bonds.issues.find((x) => x.id === id);
  const h = state.bonds.holdings[id];
  if (!b || !h) return FAIL('No tenés ese bono.');
  if (!Number.isInteger(qty) || qty <= 0 || qty > h.qty) return FAIL(`Podés vender entre 1 y ${h.qty} bonos.`);
  if (b.status === 'impago') return FAIL('El bono está en impago: no hay compradores hasta la liquidación.');
  const q = bondQuote(state, b, qty, 'venta');
  revalueInvestments(state, ['bonds']);
  const realized = bookSell(state, 'bonds', id, qty, q.gross, q.fee, `Venta de ${qty} bonos ${b.name}`);
  return OK(`Vendiste ${qty} bonos por ${fmtMoney(q.gross - q.fee)} (resultado ${fmtMoney(realized)}).`);
}

/** Rendimiento corriente (cupón / precio) y rendimiento al vencimiento. */
export function bondYields(state: GameState, b: BondIssue) {
  return { current: b.price > 0 ? (b.face * b.coupon) / b.price : 0, ytm: b.yield, years: Math.max(0, (b.maturityDay - state.day) / 365), nextCoupon: couponDates(b, state.day)[0] ?? null };
}

export function bondDescription(state: GameState, b: BondIssue): string {
  const y = bondYields(state, b);
  return `${b.issuerKind === 'gobierno' ? 'Bono soberano' : 'Bono corporativo'} con cupón ${fmtPct(b.coupon, 3)} anual (pagos semestrales), vence el ${formatDate(b.maturityDay)} (${y.years.toFixed(1)} años). Calificación ${b.rating}.`;
}
