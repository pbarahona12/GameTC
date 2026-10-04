import type { GameState } from '../state';
import type { Company } from './types';
import { CO_ACCOUNTS, CO_ACCOUNT_IDS, CoAccountId, coPeriodTotals, coGroup, CO_CHART } from './companyLedger';
import { gEntryDelta, gBucketShare } from '../ledger/core';
import { Cents, roundCents } from '../money';
import { sectorOf, coEquity, monthlyPayroll, monthlyFixed, isOpen, premisesBase } from './common';
import { inventoryValue } from './inventory';
import { companyShareEstimate } from './market';
import { averageMorale } from './staff';

export interface CoLine {
  account: CoAccountId;
  name: string;
  amount: Cents;
}

export interface CoIncomeStatement {
  from: number;
  to: number;
  revenue: Cents;
  otherIncome: Cents;
  cogs: CoLine[];
  totalCogs: Cents;
  grossProfit: Cents;
  grossMargin: number;
  opex: CoLine[];
  totalOpex: Cents;
  ebitda: Cents;
  depreciation: Cents;
  operatingProfit: Cents;
  financial: CoLine[];
  totalFinancial: Cents;
  preTax: Cents;
  tax: Cents;
  netIncome: Cents;
  netMargin: number;
}

function lines(t: Record<CoAccountId, Cents>, group: string): CoLine[] {
  return CO_ACCOUNT_IDS.filter((id) => coGroup(id) === group && t[id] !== 0).map((id) => ({ account: id, name: CO_ACCOUNTS[id].name, amount: t[id] }));
}

const sum = (l: CoLine[]) => l.reduce((s, x) => s + x.amount, 0);

/**
 * Estado de resultados empresarial, en la escalera clásica:
 * Ventas − Costo de ventas = Beneficio bruto
 * − Gastos operativos = EBITDA − Depreciación = Beneficio operativo
 * − Intereses y recargos (+ otros ingresos) = Beneficio antes de impuestos
 * − Impuesto empresarial = Beneficio neto
 */
export function coIncomeStatement(co: Company, from: number, to: number): CoIncomeStatement {
  const t = coPeriodTotals(co.ledger, from, to);
  const revenue = t.sales;
  const otherIncome = t.other_income + t.rental_income + t.gain_on_sale + t.ic_income + t.subsidiary_results;
  const cogs = lines(t, 'cogs');
  const opex = lines(t, 'opex');
  const financial = lines(t, 'fin');
  const totalCogs = sum(cogs);
  const totalOpex = sum(opex);
  const grossProfit = revenue - totalCogs;
  const ebitda = grossProfit - totalOpex;
  const depreciation = t.depreciation;
  const operatingProfit = ebitda - depreciation;
  const totalFinancial = sum(financial);
  const preTax = operatingProfit - totalFinancial + otherIncome;
  const tax = t.corporate_tax;
  const netIncome = preTax - tax;
  return {
    from, to, revenue, otherIncome, cogs, totalCogs, grossProfit, grossMargin: revenue > 0 ? grossProfit / revenue : 0, opex, totalOpex, ebitda,
    depreciation, operatingProfit, financial, totalFinancial, preTax, tax, netIncome, netMargin: revenue > 0 ? netIncome / revenue : 0,
  };
}

export interface CoBalanceSheet {
  assets: CoLine[];
  liabilities: CoLine[];
  totalAssets: Cents;
  totalLiabilities: Cents;
  capital: Cents;
  distributions: Cents;
  retained: Cents;
  equity: Cents;
  workingCapital: Cents;
  currentRatio: number | null;
  debtRatio: number;
  balanced: boolean;
}

export function coBalanceSheet(co: Company): CoBalanceSheet {
  const b = co.ledger.balances;
  const pick = (type: string) => CO_ACCOUNT_IDS.filter((id) => CO_CHART[id].type === type && b[id] !== 0).map((id) => ({ account: id, name: CO_ACCOUNTS[id].name, amount: b[id] }));
  const assets = pick('asset');
  const liabilities = pick('liability');
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  let retained = 0;
  for (const id of CO_ACCOUNT_IDS) {
    const tt = CO_CHART[id].type;
    if (tt === 'income') retained += b[id];
    else if (tt === 'expense') retained -= b[id];
  }
  const equity = totalAssets - totalLiabilities;
  const currentAssets = b.cash + b.receivables + b.inventory + b.in_transit;
  // Deuda de corto plazo: las cuotas de 12 meses (y un bono entero si vence dentro de un año).
  const loanCurrent = co.loans.reduce((s, l) => s + (l.bullet ? (l.termMonths - l.paymentsMade - l.missed <= 12 ? l.balance : 0) : Math.min(l.balance, l.payment * 12)), 0);
  const currentLiab = b.payables + b.arrears + b.taxes_payable + loanCurrent;
  return {
    assets, liabilities, totalAssets, totalLiabilities, capital: b.capital, distributions: b.distributions, retained, equity,
    workingCapital: currentAssets - currentLiab, currentRatio: currentLiab > 0 ? currentAssets / currentLiab : null,
    debtRatio: totalAssets > 0 ? totalLiabilities / totalAssets : totalLiabilities > 0 ? Infinity : 0,
    balanced: equity === b.capital + b.distributions + retained,
  };
}

export interface CoCashFlow {
  from: number;
  to: number;
  opening: Cents;
  closing: Cents;
  operating: Array<{ label: string; amount: Cents }>;
  investing: Array<{ label: string; amount: Cents }>;
  financing: Array<{ label: string; amount: Cents }>;
  totalOperating: Cents;
  totalInvesting: Cents;
  totalFinancing: Cents;
  freeCashFlow: Cents;
  netChange: Cents;
}

const CF_LABELS: Array<[string, string]> = [
  ['sales', 'Cobros de ventas al contado'], ['collection', 'Cobros a clientes'], ['purchase', 'Pagos anticipados a proveedores'], ['payable', 'Pagos a proveedores'],
  ['freight', 'Fletes'], ['payroll', 'Sueldos y cargas'], ['severance', 'Liquidaciones de personal'], ['rent', 'Alquiler'], ['utilities', 'Servicios'],
  ['maintenance', 'Mantenimiento'], ['repair', 'Reparaciones'], ['marketing', 'Marketing'], ['research', 'Estudios de mercado'], ['variable', 'Costos variables'],
  ['fees', 'Comisiones de cobro'], ['storage', 'Almacenamiento'], ['admin', 'Administración y licencias'], ['hiring', 'Reclutamiento'], ['training', 'Capacitación'],
  ['arrears', 'Pago de deudas vencidas'], ['cotax', 'Impuesto empresarial'], ['capex', 'Compra de equipos'], ['asset_sale', 'Venta de equipos'], ['deposit', 'Depósito del local'],
  ['capital', 'Aportes de capital'], ['dividend', 'Dividendos y retiros'], ['coloan:disburse', 'Préstamos recibidos'], ['coloan:payment', 'Cuotas de préstamos'], ['liquidation', 'Liquidación'],
];

export function cfLabel(tag: string | undefined, memo: string): string {
  const t = tag ?? '';
  for (const [k, v] of CF_LABELS) if (t === k || t.startsWith(k)) return v;
  return memo;
}

export function coCashFlow(co: Company, from: number, to: number): CoCashFlow {
  const g = { operating: new Map<string, Cents>(), investing: new Map<string, Cents>(), financing: new Map<string, Cents>() };
  let opening = 0;
  let closing = 0;
  for (const b of co.ledger.archive?.buckets ?? []) {
    const sh = gBucketShare(b, from, to);
    const net = Object.values(b.cash).reduce((s, x) => s + Object.values(x ?? {}).reduce((y, v) => y + v, 0), 0);
    opening += Math.round(net * sh.before);
    closing += Math.round(net * (sh.before + sh.inside));
    if (sh.inside <= 0) continue;
    for (const cf of ['operating', 'investing', 'financing'] as const) {
      for (const [label, v] of Object.entries(b.cash[cf] ?? {})) g[cf].set(label, (g[cf].get(label) ?? 0) + Math.round(v * sh.inside));
    }
  }
  for (const e of co.ledger.entries) {
    if (e.day > to) break;
    const d = gEntryDelta(CO_CHART, e, 'cash');
    if (e.day < from) {
      opening += d;
      closing += d;
      continue;
    }
    closing += d;
    if (!d || e.cf === 'internal') continue;
    const m = g[e.cf];
    const l = cfLabel(e.tag, e.memo);
    m.set(l, (m.get(l) ?? 0) + d);
  }
  const arr = (m: Map<string, Cents>) => [...m.entries()].map(([label, amount]) => ({ label, amount })).sort((a, b) => b.amount - a.amount);
  const operating = arr(g.operating);
  const investing = arr(g.investing);
  const financing = arr(g.financing);
  const tot = (a: Array<{ amount: Cents }>) => a.reduce((s, x) => s + x.amount, 0);
  const totalOperating = tot(operating);
  const totalInvesting = tot(investing);
  return {
    from, to, opening, closing, operating, investing, financing, totalOperating, totalInvesting,
    totalFinancing: tot(financing), freeCashFlow: totalOperating + totalInvesting, netChange: closing - opening,
  };
}

export interface CoMetrics {
  cash: Cents;
  equity: Cents;
  revenue30: Cents;
  revenuePrev30: Cents;
  salesTrend: number | null;
  net30: Cents;
  grossMargin30: number;
  wageShare: number | null;
  payrollMonthly: Cents;
  fixedMonthly: Cents;
  /** Consumo neto de caja operativo diario (positivo = pierde caja). */
  burnPerDay: Cents;
  runwayDays: number | null;
  runwayRange: [number, number] | null;
  inventoryValue: Cents;
  inventoryDays: number | null;
  receivableDays: number | null;
  payablesDue7: Cents;
  utilization: number | null;
  lostShare: number;
  lostReason: string;
  share: number;
  morale: number;
  breakEvenRevenue: Cents | null;
  consecutiveLossMonths: number;
  arrears: Cents;
  daysOpen: number;
  sampleDays: number;
}

export function coMetrics(state: GameState, co: Company): CoMetrics {
  const to = state.day;
  const from30 = Math.max(co.openDay, to - 29);
  const is30 = coIncomeStatement(co, from30, to);
  const prevFrom = Math.max(co.openDay, to - 59);
  const isPrev = prevFrom <= to - 30 ? coIncomeStatement(co, prevFrom, to - 30) : null;
  const days = Math.max(1, to - from30 + 1);
  // Consumo de caja: promedio de los últimos 90 días (incluye alquileres y nóminas completos),
  // sin contar aportes, dividendos ni préstamos (financiamiento).
  const from90 = Math.max(co.openDay, to - 89);
  const cf = coCashFlow(co, from90, to);
  const burn = -Math.round((cf.totalOperating + cf.totalInvesting) / Math.max(1, to - from90 + 1));
  const cash = co.ledger.balances.cash;
  const runway = burn > 0 ? cash / burn : null;
  const payroll = monthlyPayroll(state, co);
  const fixed = monthlyFixed(state, co);
  const recent = co.stats.slice(-30);
  let d = 0;
  let lost = 0;
  let capUsed = 0;
  let cap = 0;
  for (const s of recent) {
    for (const k of Object.keys(s.demand)) { d += s.demand[k]; lost += s.lost[k] ?? 0; }
    capUsed += s.capacityUsed;
    cap += s.capacity;
  }
  const reasons = recent.slice(-7).map((s) => s.lostReason).filter(Boolean);
  let lossMonths = 0;
  for (let i = co.history.length - 1; i >= 0 && co.history[i].netIncome < 0; i--) lossMonths++;
  const cogsDaily = is30.totalCogs / days;
  const invVal = inventoryValue(co);
  const revDaily = is30.revenue / days;
  const sec = sectorOf(co);
  return {
    cash, equity: coEquity(co), revenue30: is30.revenue, revenuePrev30: isPrev?.revenue ?? 0,
    salesTrend: isPrev && isPrev.revenue > 0 && to - co.openDay >= 60 ? is30.revenue / isPrev.revenue - 1 : null,
    net30: is30.netIncome, grossMargin30: is30.grossMargin,
    wageShare: is30.revenue > 0 ? (is30.opex.filter((l) => l.account === 'wages' || l.account === 'payroll_taxes').reduce((s, l) => s + l.amount, 0)) / is30.revenue : null,
    payrollMonthly: payroll, fixedMonthly: fixed, burnPerDay: burn, runwayDays: runway,
    runwayRange: runway !== null ? [cash / (burn * 1.2), cash / Math.max(1, burn * 0.85)] : null,
    inventoryValue: invVal, inventoryDays: cogsDaily > 0 ? invVal / cogsDaily : invVal > 0 ? Infinity : null,
    receivableDays: revDaily > 0 && sec.receivableDays > 0 ? co.ledger.balances.receivables / revDaily : null,
    payablesDue7: co.payables.filter((p) => p.dueDay <= to + 7).reduce((s, p) => s + p.amount, 0),
    utilization: cap > 0 ? capUsed / cap : null,
    lostShare: sec.model === 'subscription' ? 0 : d > 0 ? lost / d : 0,
    lostReason: reasons[reasons.length - 1] ?? '',
    share: companyShareEstimate(co),
    morale: averageMorale(co),
    breakEvenRevenue: is30.grossMargin > 0 ? roundCents((payroll + fixed) / is30.grossMargin) : null,
    consecutiveLossMonths: lossMonths,
    arrears: co.ledger.balances.arrears,
    daysOpen: Math.max(0, to - co.openDay),
    sampleDays: recent.length,
  };
}

const MULTIPLES: Record<string, number> = { cafeteria: 3, minimarket: 3, muebles: 4, saas: 5, consultora: 3, holding: 0 };

export interface Valuation {
  book: Cents;
  ebitdaAnnual: Cents;
  revenueAnnual: Cents;
  monthsOfData: number;
  multiple: number;
  earningsValue: Cents;
  assetValue: Cents;
  recurringValue: Cents | null;
  value: Cents;
  method: string;
}

/**
 * Valoración empresarial: el mayor entre
 *  - valor por ganancias: EBITDA anualizado × múltiplo del sector + caja − deudas;
 *  - valor de activos: lo que se recuperaría vendiendo activos, menos deudas;
 *  - (suscripciones) ingresos recurrentes anuales × 2 ajustados por calidad − deudas.
 */
export function valuation(state: GameState, co: Company): Valuation {
  const to = state.day;
  const from = Math.max(co.openDay, to - 364);
  const is = coIncomeStatement(co, from, to);
  const months = Math.max(0, (to - from + 1) / 30.4);
  const annual = months >= 1 ? 12 / months : 0;
  const ebitdaAnnual = roundCents(is.ebitda * annual);
  const revenueAnnual = roundCents(is.revenue * annual);
  const b = co.ledger.balances;
  const debt = b.loans + b.arrears + b.payables + b.taxes_payable + b.mortgages + b.ic_payable;
  // Una auditoría limpia vigente da confianza a compradores e inversores (+10 % al múltiplo).
  const audited = (state.pros?.audits ?? []).some((a) => a.companyId === co.id && a.clean && a.validUntil >= state.day);
  const multiple = (MULTIPLES[co.sector] ?? 3) * (audited ? 1.1 : 1);
  // Activos no operativos: inmuebles a valor de mercado, subsidiarias y préstamos al grupo.
  const props = propertyMarketValue(state, co);
  const subs = subsidiariesValue(state, co);
  // Si la empresa usa un inmueble propio como local, su EBITDA no paga alquiler: se imputa para no contar dos veces.
  const imputedRent = ownPremisesRentAnnual(state, co);
  const earningsValue = Math.max(0, ebitdaAnnual - imputedRent) * multiple + b.cash + props + subs + b.ic_receivable - debt;
  const assetValue = b.cash + roundCents(b.receivables * 0.9 + b.inventory * 0.7 + b.fixed_assets * 0.6) + b.deposits_paid + b.in_transit + b.ic_receivable + props + subs - debt;
  let recurringValue: Cents | null = null;
  if (sectorOf(co).model === 'subscription') {
    const mrr = roundCents(co.subscribers * (co.products[0]?.price ?? 0));
    recurringValue = roundCents(mrr * 12 * 2 * (co.quality / 70)) + props + subs - debt;
  }
  const candidates: Array<[Cents, string]> = [[earningsValue, 'ganancias (EBITDA × múltiplo)'], [assetValue, 'valor de activos']];
  if (recurringValue !== null) candidates.push([recurringValue, 'ingresos recurrentes']);
  candidates.sort((a, b2) => b2[0] - a[0]);
  return { book: coEquity(co), ebitdaAnnual, revenueAnnual, monthsOfData: months, multiple, earningsValue, assetValue, recurringValue, value: Math.max(0, candidates[0][0]), method: candidates[0][1] };
}

/** Valor de mercado de los inmuebles de la empresa (tasación). */
export function propertyMarketValue(state: GameState, co: Company): Cents {
  return (state.realEstate?.properties ?? []).filter((p) => p.owner.kind === 'company' && p.owner.id === co.id).reduce((s, p) => s + p.appraisal, 0);
}

/** Valor de las subsidiarias según su propia valoración × participación. */
export function subsidiariesValue(state: GameState, co: Company): Cents {
  let v = 0;
  for (const sub of state.companies) if (sub.parentId === co.id && isOpen(sub)) v += roundCents(valuation(state, sub).value * sub.ownership);
  return v;
}

/** Alquiler anual que la empresa se ahorra por usar un inmueble propio. */
export function ownPremisesRentAnnual(state: GameState, co: Company): Cents {
  const used = (state.realEstate?.properties ?? []).some((p) => p.usedBy === co.id);
  return used ? roundCents(premisesBase(state, co).rent * 100 * state.macro.priceIndex * 12) : 0;
}

export interface Consolidated {
  companies: number;
  revenue: Cents;
  netIncome: Cents;
  attributableNet: Cents;
  cash: Cents;
  equity: Cents;
  attributableEquity: Cents;
  employees: number;
}

/** Vista consolidada del grupo (100 % de cada empresa) y la parte atribuible al jugador. */
export function consolidated(state: GameState, from: number, to: number): Consolidated {
  const out: Consolidated = { companies: 0, revenue: 0, netIncome: 0, attributableNet: 0, cash: 0, equity: 0, attributableEquity: 0, employees: 0 };
  for (const co of state.companies) {
    if (!isOpen(co)) continue;
    const is = coIncomeStatement(co, from, to);
    out.companies++;
    out.revenue += is.revenue;
    out.netIncome += is.netIncome;
    out.attributableNet += roundCents(is.netIncome * co.ownership);
    out.cash += co.ledger.balances.cash;
    const eq = coEquity(co);
    out.equity += eq;
    out.attributableEquity += roundCents(eq * co.ownership);
    out.employees += co.employees.length;
  }
  return out;
}
