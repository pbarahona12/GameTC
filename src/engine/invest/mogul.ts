import type { GameState } from '../state';
import type { MogulAsset } from './types';
import type { Property } from '../realestate/types';
import { Cents, clamp, roundCents, usd } from '../money';
import { dateOf, isLastDayOfMonth } from '../time/calendar';
import { chance, randInt, randNormal, randRange } from '../rng';
import { generateListing, companyDay, companyMonthEnd } from '../business/simulate';
import { valuation, coIncomeStatement } from '../business/reports';
import { maxDistribution } from '../business/ownership';
import { isOpen } from '../business/common';
import { coPost } from '../business/companyLedger';
import { appraise, marketRent, marketVacancy, monthlyEconomics } from '../realestate/realestate';
import { ZONES } from '../../content/realestate';
import { ActionResult, FAIL, OK } from '../result';
import { fmtMoney, fmtPct } from '../format';
import { addLog } from '../log';
import { canPayFromChecking } from '../finance/payments';
import { bookBuy, bookSell, brokerFee, revalueInvestments } from './portfolio';
import { post } from '../ledger/ledger';
import { practice } from '../skills/skills';
import { residence } from '../tax/taxEngine';
import { startOfMonth } from '../time/calendar';

/**
 * MOGUL EXCHANGE: mercado de PARTICIPACIONES FRACCIONADAS en activos privados.
 *
 * Tipos de activo (todos simulados con los mismos motores del juego):
 *  - Empresa: una empresa real del simulador, gestionada por un gerente. Reparte
 *    el 60 % de sus ganancias mensuales. Su valor por participación sale de la
 *    misma valoración empresarial que usás para tus empresas.
 *  - Inmueble: un edificio con muchas unidades en alquiler. Reparte el 90 % de
 *    su resultado neto mensual; su valor sigue la tasación de la zona.
 *  - Regalías: derechos sobre ingresos futuros (catálogo musical, viñedo). Cobran
 *    un flujo que decae con el tiempo; se valúan por valor presente.
 *
 * Los valores se actualizan una vez por mes (tasación), no a cada instante:
 * son activos poco líquidos, con un diferencial compra/venta mayor que la bolsa.
 */
const UNITS = 10_000;
const MAX_ACTIVE = 6;

export function mogulAsset(state: GameState, id: string): MogulAsset | undefined {
  return state.mogul.assets.find((a) => a.id === id);
}

function buildingProperty(state: GameState, name: string): Property {
  const z = ZONES[randInt(state, 0, 3)];
  const type = chance(state, 0.6) ? 'vivienda' : 'local';
  const p: Property = {
    id: state.meta.nextId++, name, type, zoneId: z.id, jurisdiction: z.jurisdiction, m2: randInt(state, 1200, 3000), grade: randInt(state, 2, 4), condition: randInt(state, 70, 95), landShare: 0.25,
    owner: { kind: 'mogul', id: '' }, purchasePrice: 0, purchaseDay: state.day, closingCosts: 0, costBasis: 0, appraisal: 0, carrying: 0, accumDepreciation: 0,
    lease: null, askingRent: 0, listedForRent: false, vacantSince: null, management: 'agencia', usedBy: null, forSale: null, renovation: null, mortgageId: null,
    nextTaxDay: 0, nextTaxAmount: 0, monthly: [], totals: { rent: 0, expenses: 0, tax: 0, interest: 0 }, hiddenDefect: null, evictionUntil: null, development: null,
  };
  p.appraisal = appraise(state, p);
  return p;
}

const ROYALTIES = [
  { name: 'Catálogo musical Ritmo Sur', description: 'Derechos de 240 canciones: cobra regalías de radio, plataformas y publicidad. Decae lentamente con los años.', monthly: 9000, decay: 0.05, vol: 0.12, years: 15, risk: 3 },
  { name: 'Viñedo Alto Valle', description: 'Participación en la cosecha y venta de vino de un viñedo. Ingresos variables según el clima.', monthly: 11000, decay: -0.02, vol: 0.3, years: 20, risk: 4 },
  { name: 'Patente Filtro Aqua', description: 'Regalías por una patente de filtros de agua licenciada a fabricantes. Vence en 12 años.', monthly: 7000, decay: 0.02, vol: 0.15, years: 12, risk: 3 },
];

function newAsset(state: GameState, kind: MogulAsset['kind']): MogulAsset | null {
  const id = `MX-${state.meta.nextId++}`;
  const base = { id, units: UNITS, history: [] as Array<{ d: number; v: number }>, distributions: [] as Array<{ d: number; perUnit: number }>, status: 'activo' as const, createdDay: state.day, cash: 0 };
  if (kind === 'empresa') {
    const l = generateListing(state);
    if (!l) return null;
    const co = l.company;
    co.name = `${co.name}`;
    co.npc = true;
    co.dividendPolicy = { frequency: 'none', payout: 0.6, reserveDays: 45 };
    const a: MogulAsset = { ...base, kind, name: co.name, description: `Participación en ${co.name}, una empresa en marcha gestionada por un gerente profesional. Reparte el 60 % de sus ganancias mensuales.`, nav: 0, risk: 4, spread: 0.04, company: co };
    a.nav = companyNav(state, a);
    return a;
  }
  if (kind === 'inmueble') {
    const names = ['Edificio Mirador', 'Torre Alameda', 'Galería Norte', 'Residencias del Parque', 'Complejo Puerto Azul'];
    const name = names.filter((n) => !state.mogul.assets.some((x) => x.name === n))[0] ?? `Edificio ${state.meta.nextId}`;
    const p = buildingProperty(state, name);
    p.owner = { kind: 'mogul', id };
    const a: MogulAsset = { ...base, kind, name, description: `Edificio de ${p.m2} m² (${p.type === 'vivienda' ? 'departamentos' : 'locales'}) en ${ZONES.find((z) => z.id === p.zoneId)!.name}, administrado por una inmobiliaria. Reparte el 90 % de su resultado neto.`, nav: 0, risk: 2, spread: 0.03, property: p };
    a.occupancy = 1 - marketVacancy(state, p.zoneId, p.type);
    a.nav = propertyNav(state, a);
    return a;
  }
  const r = ROYALTIES.filter((x) => !state.mogul.assets.some((a) => a.name === x.name && a.status === 'activo'))[0];
  if (!r) return null;
  const a: MogulAsset = { ...base, kind, name: r.name, description: r.description, nav: 0, risk: r.risk, spread: 0.05, royalty: { monthly: usd(r.monthly * state.macro.priceIndex), decay: r.decay, vol: r.vol, years: r.years } };
  a.nav = royaltyNav(state, a);
  return a;
}

export function initMogul(state: GameState): void {
  const kinds: MogulAsset['kind'][] = ['empresa', 'inmueble', 'regalias', 'inmueble', 'regalias', 'empresa'];
  const saved = state.listings.slice();
  for (const k of kinds) {
    const a = newAsset(state, k);
    if (a) {
      a.history.push({ d: state.day, v: Math.round(a.nav) });
      state.mogul.assets.push(a);
    }
  }
  state.listings = saved;
}

// ------------------------------------------------------------ Valoración

function companyNav(state: GameState, a: MogulAsset): number {
  const co = a.company!;
  if (!isOpen(co)) return 0;
  return Math.max(1, valuation(state, co).value / a.units);
}

function propertyNav(_state: GameState, a: MogulAsset): number {
  const p = a.property!;
  return Math.max(1, (p.appraisal + a.cash) / a.units);
}

function royaltyNav(state: GameState, a: MogulAsset): number {
  const r = a.royalty!;
  const rate = state.macro.policyRate + 0.045;
  const monthsLeft = Math.max(0, Math.round(r.years * 12 - (state.day - a.createdDay) / 30.4));
  let pv = 0;
  for (let m = 1; m <= monthsLeft; m++) pv += (r.monthly * Math.pow(1 - r.decay, m / 12)) / Math.pow(1 + rate / 12, m);
  return Math.max(0.01, (pv + a.cash) / a.units);
}

export interface MogulValuation {
  method: string;
  inputs: Array<{ label: string; value: string }>;
  value: Cents;
  perUnit: number;
}

/** Valoración detallada (consultable por el jugador). */
export function mogulValuation(state: GameState, a: MogulAsset): MogulValuation {
  if (a.kind === 'empresa' && a.company) {
    const v = valuation(state, a.company);
    return { method: `Valoración empresarial por ${v.method}`, value: v.value, perUnit: a.nav, inputs: [
      { label: 'EBITDA anualizado', value: fmtMoney(v.ebitdaAnnual) }, { label: 'Múltiplo del sector', value: `${v.multiple.toFixed(1)}×` },
      { label: 'Valor por ganancias', value: fmtMoney(v.earningsValue) }, { label: 'Valor de activos', value: fmtMoney(v.assetValue) }, { label: 'Patrimonio contable', value: fmtMoney(v.book) },
    ] };
  }
  if (a.kind === 'inmueble' && a.property) {
    const p = a.property;
    const occ = a.occupancy ?? 0.9;
    return { method: 'Tasación del edificio + caja del vehículo', value: p.appraisal + a.cash, perUnit: a.nav, inputs: [
      { label: 'Tasación', value: fmtMoney(p.appraisal) }, { label: 'Superficie', value: `${p.m2} m²` }, { label: 'Ocupación', value: fmtPct(occ, 0) },
      { label: 'Alquiler potencial mensual', value: fmtMoney(marketRent(state, p)) }, { label: 'Caja sin distribuir', value: fmtMoney(a.cash) },
    ] };
  }
  const r = a.royalty!;
  return { method: 'Valor presente de las regalías futuras', value: roundCents(a.nav * a.units), perUnit: a.nav, inputs: [
    { label: 'Ingreso mensual actual', value: fmtMoney(r.monthly) }, { label: 'Decaimiento anual', value: fmtPct(r.decay, 0) },
    { label: 'Tasa de descuento', value: fmtPct(state.macro.policyRate + 0.045, 1) }, { label: 'Vida restante', value: `${Math.max(0, r.years - (state.day - a.createdDay) / 365).toFixed(1)} años` },
  ] };
}

// ------------------------------------------------------------ Simulación

export function mogulDay(state: GameState): void {
  const g = dateOf(state.day);
  const monthEnd = isLastDayOfMonth(state.day);
  for (const a of state.mogul.assets) {
    if (a.status !== 'activo') continue;
    if (a.kind === 'empresa' && a.company) {
      const co = a.company;
      const saved = state.meta.projection;
      state.meta.projection = true; // sin notificaciones de empresas ajenas
      try {
        companyDay(state, co, g.d === 1);
        if (monthEnd) companyMonthEnd(state, co);
      } finally {
        state.meta.projection = saved;
      }
      if (co.insolventSince !== null && state.day - co.insolventSince > 60) liquidateAsset(state, a, 'La empresa quebró.');
    }
    if (monthEnd && a.status === 'activo') monthEndAsset(state, a);
  }
  if (monthEnd) {
    state.mogul.assets = state.mogul.assets.filter((a) => a.status === 'activo' || state.mogul.holdings[a.id] || state.day - a.createdDay < 400);
    const active = state.mogul.assets.filter((a) => a.status === 'activo').length;
    if (active < MAX_ACTIVE && chance(state, 0.15)) {
      const kinds: MogulAsset['kind'][] = ['empresa', 'inmueble', 'regalias'];
      const saved = state.listings.slice();
      const a = newAsset(state, kinds[randInt(state, 0, 2)]);
      state.listings = saved;
      if (a) {
        a.history.push({ d: state.day, v: Math.round(a.nav) });
        state.mogul.assets.push(a);
        addLog(state, 'info', '🧩', `Mogul Exchange: nuevo activo disponible, ${a.name} (${fmtMoney(Math.round(a.nav))} por participación).`);
      }
    }
  }
}

function monthEndAsset(state: GameState, a: MogulAsset): void {
  let distributable = 0;
  if (a.kind === 'empresa' && a.company) {
    const co = a.company;
    const is = coIncomeStatement(co, startOfMonth(state.day), state.day);
    if (is.netIncome > 0 && co.ledger.balances.arrears === 0) {
      const amount = Math.min(maxDistribution(state, co).max, roundCents(is.netIncome * 0.6));
      if (amount > 0) {
        coPost(co.ledger, { day: state.day, memo: 'Distribución a participantes de Mogul Exchange', cf: 'financing', tag: 'dividend', lines: [{ account: 'distributions', debit: amount }, { account: 'cash', credit: amount }] });
        distributable = amount;
      }
    }
    a.nav = companyNav(state, a);
  } else if (a.kind === 'inmueble' && a.property) {
    const p = a.property;
    const ext = a;
    const target = 1 - marketVacancy(state, p.zoneId, p.type);
    ext.occupancy = clamp((ext.occupancy ?? target) + (target - (ext.occupancy ?? target)) * 0.3 + randNormal(state) * 0.02, 0.4, 1);
    p.appraisal = appraise(state, p);
    const e = monthlyEconomics(state, p);
    const rent = roundCents(marketRent(state, p) * ext.occupancy);
    const agency = roundCents(rent * 0.08);
    const repairs = chance(state, 0.1) ? roundCents(p.appraisal * randRange(state, 0.001, 0.004)) : 0;
    const net = rent - agency - e.maintenance - e.tax - repairs;
    a.cash += net;
    p.condition = clamp(p.condition - 0.3, 50, 100);
    if (p.condition < 70) {
      const cost = roundCents(p.appraisal * 0.02);
      a.cash -= cost;
      p.condition = 90;
    }
    distributable = Math.max(0, roundCents(a.cash * 0.9));
    a.cash -= distributable;
    a.nav = propertyNav(state, a);
  } else if (a.royalty) {
    const r = a.royalty;
    const factor = Math.max(0, 1 + randNormal(state) * r.vol);
    const income = roundCents(r.monthly * factor);
    r.monthly = roundCents(r.monthly * Math.pow(1 - r.decay, 1 / 12) * (1 + state.macro.inflation / 12));
    distributable = income;
    const lifeLeft = r.years * 12 - (state.day - a.createdDay) / 30.4;
    a.nav = royaltyNav(state, a);
    if (lifeLeft <= 0) {
      // El último mes también se reparte antes de extinguir los derechos.
      if (distributable > 0) payDistribution(state, a, distributable);
      distributable = 0;
      liquidateAsset(state, a, 'Se extinguieron los derechos.');
    }
  }
  if (distributable > 0 && a.status === 'activo') payDistribution(state, a, distributable);
  a.history.push({ d: state.day, v: Math.round(a.nav * 100) / 100 });
  if (a.history.length > 240) a.history.shift();
}

function payDistribution(state: GameState, a: MogulAsset, total: Cents): void {
  const perUnit = total / a.units;
  a.distributions.push({ d: state.day, perUnit });
  if (a.distributions.length > 120) a.distributions.shift();
  const h = state.mogul.holdings[a.id];
  if (!h || h.qty <= 0) return;
  const gross = roundCents(perUnit * h.qty);
  if (gross <= 0) return;
  const asDividend = a.kind === 'empresa';
  const tax = asDividend ? roundCents(gross * residence(state).dividendRate) : 0;
  post(state.ledger, {
    day: state.day, memo: `Distribución de ${a.name} (Mogul Exchange)`, cf: 'operating', tag: 'invest:mogul_dist',
    lines: [{ account: 'checking', debit: gross - tax }, ...(tax ? [{ account: 'dividend_tax' as const, debit: tax }] : []), { account: asDividend ? 'dividend_income' : 'rental_income', credit: gross }],
  });
  if (asDividend) state.tax.ytd.dividends = (state.tax.ytd.dividends ?? 0) + gross;
  else state.tax.ytd.rentalIncome = (state.tax.ytd.rentalIncome ?? 0) + gross;
  state.mogul.distributionsReceived += gross - tax;
  addLog(state, 'income', '🧩', `${a.name} (Mogul) te distribuyó ${fmtMoney(gross)}.`, gross - tax);
}

function liquidateAsset(state: GameState, a: MogulAsset, reason: string): void {
  let perUnit: number;
  if (a.kind === 'empresa' && a.company) {
    const co = a.company;
    const b = co.ledger.balances;
    const rec = Math.max(0, b.cash + roundCents(b.inventory * 0.3 + b.fixed_assets * 0.4 + b.receivables * 0.7) - b.loans - b.arrears - b.payables);
    perUnit = rec / a.units;
    co.status = 'bankrupt';
  } else perUnit = Math.max(0, a.cash) / a.units;
  a.nav = perUnit;
  a.status = 'liquidado';
  const h = state.mogul.holdings[a.id];
  if (h && h.qty > 0) {
    revalueInvestments(state, ['mogul']);
    const gross = roundCents(h.qty * perUnit);
    bookSell(state, 'mogul', a.id, h.qty, gross, 0, `Liquidación de ${a.name} (Mogul Exchange)`);
    addLog(state, 'danger', '🧩', `${a.name} fue liquidado en Mogul Exchange (${reason}). Recuperaste ${fmtMoney(gross)}.`, gross, 'inversiones');
  }
}

// ------------------------------------------------------------ Operaciones del jugador

export function mogulQuote(state: GameState, a: MogulAsset, units: number, side: 'compra' | 'venta') {
  const price = a.nav * (1 + (side === 'compra' ? a.spread / 2 : -a.spread / 2));
  const gross = roundCents(price * units);
  const fee = brokerFee(state, gross, 0.005);
  return { price, gross, fee, total: side === 'compra' ? gross + fee : gross - fee };
}

export function buyMogul(state: GameState, id: string, units: number): ActionResult {
  const a = mogulAsset(state, id);
  if (!a || a.status !== 'activo') return FAIL('Activo no disponible.');
  if (!(units >= 0.01)) return FAIL('La cantidad mínima es 0.01 participaciones.');
  if (state.legal?.prison) return FAIL('Desde prisión no podés operar.');
  const owned = state.mogul.holdings[id]?.qty ?? 0;
  if (owned + units > a.units * 0.49) return FAIL('Mogul Exchange limita a cada inversor al 49 % de un activo.');
  const q = mogulQuote(state, a, units, 'compra');
  if (!canPayFromChecking(state, q.total)) return FAIL(`Necesitás ${fmtMoney(q.total)}.`);
  revalueInvestments(state, ['mogul']);
  bookBuy(state, 'mogul', id, units, q.gross, q.fee, `Compra de ${units} participaciones de ${a.name} (Mogul)`);
  practice(state, 'mogul', 'finEdu', 30);
  return OK(`Compraste ${units} ${units === 1 ? "participación" : "participaciones"} de ${a.name} por ${fmtMoney(q.total)}.`);
}

export function sellMogul(state: GameState, id: string, units: number): ActionResult {
  const a = mogulAsset(state, id);
  const h = state.mogul.holdings[id];
  if (!a || !h) return FAIL('No tenés participaciones de ese activo.');
  if (a.status !== 'activo') return FAIL('El activo está en liquidación.');
  if (!(units > 0) || units > h.qty + 1e-9) return FAIL('Cantidad inválida.');
  const u = Math.min(units, h.qty);
  const q = mogulQuote(state, a, u, 'venta');
  revalueInvestments(state, ['mogul']);
  const realized = bookSell(state, 'mogul', id, u, q.gross, q.fee, `Venta de participaciones de ${a.name} (Mogul)`);
  return OK(`Vendiste ${u.toFixed(2)} participaciones por ${fmtMoney(q.gross - q.fee)} (resultado ${fmtMoney(realized)}).`);
}

export interface MogulRisk {
  score: number;
  volatility: number | null;
  yieldAnnual: number;
  liquidity: string;
  notes: string[];
}

export function mogulRisk(state: GameState, a: MogulAsset): MogulRisk {
  const h = a.history.slice(-24);
  let vol: number | null = null;
  if (h.length >= 4) {
    const rets = h.slice(1).map((x, i) => Math.log(Math.max(0.01, x.v) / Math.max(0.01, h[i].v)));
    const mean = rets.reduce((s, x) => s + x, 0) / rets.length;
    vol = Math.sqrt((rets.reduce((s, x) => s + (x - mean) ** 2, 0) / rets.length) * 12);
  }
  const last12 = a.distributions.filter((d) => state.day - d.d <= 365).reduce((s, d) => s + d.perUnit, 0);
  const yieldAnnual = a.nav > 0 ? last12 / a.nav : 0;
  const notes: string[] = [];
  if (a.kind === 'empresa') notes.push('Depende del desempeño de una sola empresa pequeña: puede quebrar.');
  if (a.kind === 'inmueble') notes.push('Riesgo de vacancia y de caída de precios inmobiliarios; flujo relativamente estable.');
  if (a.kind === 'regalias') notes.push('El ingreso decae con el tiempo y tiene fecha de fin: el valor tiende a cero al final de su vida.');
  notes.push(`Diferencial compra/venta de ${fmtPct(a.spread, 0)}: vender pronto después de comprar implica pérdida.`);
  return { score: a.risk, volatility: vol, yieldAnnual, liquidity: a.spread <= 0.03 ? 'Media' : 'Baja', notes };
}
