import { mandatesOnDistribution } from './managed';
import type { GameState } from '../state';
import type { FundState } from './types';
import { FUND_DEFS, FUND_BY_ID, FundDef } from '../../content/funds';
import { roundCents, usd } from '../money';
import { dateOf } from '../time/calendar';
import { isTradingDay } from './stocks';
import { ActionResult, FAIL, OK } from '../result';
import { fmtMoney } from '../format';
import { addLog } from '../log';
import { canPayFromChecking } from '../finance/payments';
import { bookBuy, bookSell, revalueInvestments } from './portfolio';
import { post } from '../ledger/ledger';
import { randNormal } from '../rng';
import { practice } from '../skills/skills';
import { residence } from '../tax/taxEngine';

/**
 * FONDOS DE INVERSIÓN. Cada fondo tiene un valor por participación (VL) que
 * se mueve con lo que tiene adentro, menos una comisión anual que se descuenta
 * todos los días. Los fondos "de distribución" reparten cada trimestre lo que
 * cobraron (dividendos, cupones o alquileres); los de "acumulación" lo reinvierten.
 */
const START_NAV = 10_000; // $100,00 por participación

export function initFunds(state: GameState): void {
  state.funds.funds = FUND_DEFS.map((d) => ({ id: d.id, nav: START_NAV * state.macro.priceIndex, history: [{ d: state.day, v: START_NAV * state.macro.priceIndex }], lastDistribution: state.day, ref: refValue(state, d), accrued: 0 }));
}

function refValue(state: GameState, d: FundDef): number {
  if (d.kind === 'inmobiliario') {
    const z = state.realEstate.zones;
    return z.length ? z.reduce((s, x) => s + x.index, 0) / z.length : 1;
  }
  return 0;
}

/** Retorno total del día de un conjunto de acciones (precio + dividendo), pesos iguales. */
function basketReturn(state: GameState, ids: string[] | null): { price: number; income: number } {
  const stocks = state.stocks.stocks.filter((s) => (ids ? ids.includes(s.id) : true) && s.prevClose > 0);
  if (!stocks.length) return { price: 0, income: 0 };
  if (!ids) {
    // Índice: ponderado por capitalización.
    let cap0 = 0;
    let cap1 = 0;
    let div = 0;
    for (const s of stocks) {
      cap0 += s.prevClose * s.shares;
      cap1 += s.price * s.shares;
      if (s.exDay === state.day) div += s.dividend * s.shares;
    }
    return { price: cap0 > 0 ? cap1 / cap0 - 1 + div / cap0 : 0, income: 0 };
  }
  let pr = 0;
  let inc = 0;
  for (const s of stocks) {
    const div = s.exDay === state.day ? s.dividend : 0;
    pr += (s.price + div) / s.prevClose - 1 - div / s.prevClose;
    inc += div / s.prevClose;
  }
  return { price: pr / stocks.length, income: inc / stocks.length };
}

function govBondReturn(state: GameState): { price: number; income: number } {
  const gov = state.bonds.issues.filter((b) => b.issuerKind === 'gobierno' && b.status === 'vigente' && b.history.length >= 1 && b.issuer !== 'isla_coral');
  if (!gov.length) return { price: 0, income: 0 };
  // Aproximación: el rendimiento del bono se devenga cada día y su precio sigue los cambios de tasa.
  let inc = 0;
  let pr = 0;
  for (const b of gov) {
    inc += b.coupon / 365;
    const prev = b.prevYield ?? b.yield;
    const years = Math.max(0.2, (b.maturityDay - state.day) / 365);
    const dur = years / (1 + b.yield / 2);
    pr += -dur * (b.yield - prev);
  }
  return { price: pr / gov.length, income: inc / gov.length };
}

export function fundsDay(state: GameState): void {
  const trading = isTradingDay(state.day);
  const g = dateOf(state.day);
  for (const f of state.funds.funds) {
    const d = FUND_BY_ID[f.id];
    if (!d) continue;
    let price = 0;
    let income = 0;
    if (d.kind === 'indice') {
      if (trading) price = basketReturn(state, null).price;
    } else if (d.kind === 'sector' || d.kind === 'dividendos') {
      if (trading) {
        const r = basketReturn(state, d.holdings ?? []);
        price = r.price;
        income = r.income;
        if (!d.distributes) {
          price += income;
          income = 0;
        }
      }
    } else if (d.kind === 'bonos') {
      const r = govBondReturn(state);
      price = r.price;
      income = r.income;
    } else if (d.kind === 'monetario') {
      price = Math.max(0, state.macro.policyRate - 0.002) / 365;
    } else if (d.kind === 'inmobiliario') {
      const now = refValue(state, d);
      if (f.ref && now !== f.ref) price += now / f.ref - 1;
      f.ref = now;
      income = 0.05 / 365;
      price += randNormal(state) * 0.004;
    }
    const fee = d.fee / 365;
    f.nav = Math.max(1, f.nav * (1 + price + income - fee));
    if (d.distributes) f.accrued = (f.accrued ?? 0) + f.nav * income;
    // Distribución trimestral (último día de marzo, junio, septiembre y diciembre).
    if (d.distributes && g.m % 3 === 0 && g.d === new Date(Date.UTC(g.y, g.m, 0)).getUTCDate()) distribute(state, f, d);
    if (g.weekday === 5 || state.day - (f.history[f.history.length - 1]?.d ?? 0) >= 7) {
      f.history.push({ d: state.day, v: Math.round(f.nav) });
      if (f.history.length > 520) f.history.shift();
    }
  }
}

function distribute(state: GameState, f: FundState, d: FundDef): void {
  const perUnit = Math.min(f.accrued ?? 0, f.nav * 0.2);
  f.accrued = 0;
  if (perUnit <= 0) return;
  f.nav -= perUnit;
  f.lastDistribution = state.day;
  mandatesOnDistribution(state, f.id, perUnit);
  const h = state.funds.holdings[f.id];
  if (!h || h.qty <= 0) return;
  const gross = roundCents(h.qty * perUnit);
  if (gross <= 0) return;
  // Los repartos de fondos de acciones tributan como dividendos; los de bonos e inmobiliarios, como renta ordinaria.
  const asDividend = d.kind === 'dividendos';
  const tax = asDividend ? roundCents(gross * residence(state).dividendRate) : 0;
  post(state.ledger, {
    day: state.day, memo: `Reparto trimestral de ${d.name}`, cf: 'operating', tag: 'invest:fund_dist',
    lines: [{ account: 'checking', debit: gross - tax }, ...(tax ? [{ account: 'dividend_tax' as const, debit: tax }] : []), { account: asDividend ? 'dividend_income' : 'bond_interest', credit: gross }],
  });
  if (asDividend) state.tax.ytd.dividends = (state.tax.ytd.dividends ?? 0) + gross;
  else state.tax.ytd.bondInterest = (state.tax.ytd.bondInterest ?? 0) + gross;
  state.funds.distributionsReceived += gross - tax;
  addLog(state, 'income', '📬', `${d.name} repartió ${fmtMoney(gross)} por tus participaciones.`, gross - tax);
}

export function fundById(state: GameState, id: string) {
  return state.funds.funds.find((f) => f.id === id);
}

/** Invertir un monto (en centavos) en un fondo al valor liquidativo del día. */
export function buyFund(state: GameState, id: string, amount: number): ActionResult {
  const f = fundById(state, id);
  const d = FUND_BY_ID[id];
  if (!f || !d) return FAIL('Fondo inexistente.');
  if (state.legal?.prison) return FAIL('Desde prisión no podés operar.');
  const min = usd(50 * state.macro.priceIndex);
  if (!(amount >= min)) return FAIL(`La inversión mínima es ${fmtMoney(min)}.`);
  const fee = roundCents(amount * d.entryFee);
  const gross = amount - fee;
  if (!canPayFromChecking(state, amount)) return FAIL(`Necesitás ${fmtMoney(amount)} en la cuenta corriente.`);
  const units = gross / f.nav;
  revalueInvestments(state, ['funds']);
  bookBuy(state, 'funds', id, units, gross, fee, `Suscripción de ${d.name}`);
  practice(state, 'fund', 'finEdu', 25);
  return OK(`Invertiste ${fmtMoney(amount)} en ${d.name}: ${units.toFixed(2)} participaciones a ${fmtMoney(Math.round(f.nav))}.`);
}

/** Rescate de participaciones (cantidad) al valor del día. */
export function sellFund(state: GameState, id: string, units: number): ActionResult {
  const f = fundById(state, id);
  const h = state.funds.holdings[id];
  if (!f || !h) return FAIL('No tenés participaciones de ese fondo.');
  if (!(units > 0) || units > h.qty + 1e-9) return FAIL('Cantidad inválida.');
  const u = Math.min(units, h.qty);
  const gross = roundCents(u * f.nav);
  revalueInvestments(state, ['funds']);
  const realized = bookSell(state, 'funds', id, u, gross, 0, `Rescate de ${FUND_BY_ID[id].name}`);
  return OK(`Rescataste ${fmtMoney(gross)} (resultado ${fmtMoney(realized)}).`);
}

export function fundReturn(f: FundState, days: number): number | null {
  const h = f.history;
  if (h.length < 2) return null;
  const target = h[h.length - 1].d - days;
  // Sin historia suficiente para el período pedido, no hay dato (no se muestra «desde el inicio» como si fuera 12 meses).
  if (h[0].d > target) return null;
  const base = [...h].reverse().find((x) => x.d <= target) ?? h[0];
  return base.v > 0 ? f.nav / base.v - 1 : null;
}
