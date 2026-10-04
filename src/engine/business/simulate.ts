import { forecastMonthEnd } from '../advisor/businessForecast';
import { compactCompany, NPC_KEEP_MONTHS } from '../ledger/compaction';
import type { GameState } from '../state';
import type { Company, Listing } from './types';
import { SECTORS, BizSectorId, LegalForm, LEGAL_FORM_BY_ID } from '../../content/sectors';
import { isOpen, sectorOf, px, maintenanceCost, coEquity, hasManager } from './common';
import { dailyOperations, monthStartCosts, monthlyStorage, monthlyAssets } from './operations';
import { runPayroll, monthlyStaff, generateCandidates, hire } from './staff';
import { processCoLoans, processCoTaxes, insolvencyCheck, closeCompanyYear } from './finance';
import { weeklyManager } from './manager';
import { coIncomeStatement } from './reports';
import { companyShareEstimate, monthlyMarkets } from './market';
import { revalue, autoDividends, buildCompany, installCompany, liquidate, maxDistribution, distribute } from './ownership';
import { depthOf, groupMonthEnd, icLoansMonthEnd } from './groups';
import { valuation } from './reports';
import { inventoryValue, receiveOrders, runReorderRules, payDuePayables } from './inventory';
import { coPost } from './companyLedger';
import { dateOf, startOfMonth } from '../time/calendar';
import { randInt, randRange, nextRandom } from '../rng';
import { roundCents } from '../money';
import { jurisdictionById } from '../../content/jurisdictions';
import { dealDiscount } from '../saga/integration';

/** Día de todas las empresas del jugador. */
export function companiesDay(state: GameState): void {
  const g = dateOf(state.day);
  for (const co of [...state.companies]) companyDay(state, co, g.d === 1);
}

/** Administración mensual: forma legal + agente residente si la empresa está registrada fuera de tu residencia. */
export function adminFee(state: GameState, co: Company): number {
  const base = roundCents(px(state, LEGAL_FORM_BY_ID[co.legalForm].monthlyAdmin) * (1 - dealDiscount(state, co, 'gestion')));
  const foreign = !co.npc && co.jurisdiction !== state.tax.jurisdiction ? px(state, jurisdictionById(co.jurisdiction).foreignCompanyAdmin) : 0;
  return base + foreign;
}

export function companyDay(state: GameState, co: Company, monthStart: boolean): void {
  if (!isOpen(co)) return;
  const sec = sectorOf(co);
  if (co.suspendedUntil !== null && state.day < co.suspendedUntil) {
    // Licencia suspendida por sanción judicial: no vende, pero sigue pagando costos fijos y deudas.
    if (monthStart) monthStartCosts(state, co, sec, adminFee(state, co), maintenanceCost(state, co));
    processCoLoans(state, co);
    processCoTaxes(state, co);
    if (insolvencyCheck(state, co) && !co.npc) liquidate(state, co, 'bankruptcy');
    return;
  }
  if (monthStart && state.day >= co.openDay) monthStartCosts(state, co, sec, adminFee(state, co), maintenanceCost(state, co));
  processCoLoans(state, co);
  processCoTaxes(state, co);
  if (state.day >= co.openDay) {
    dailyOperations(state, co);
    if (state.day - co.lastWeeklyDay >= 7) {
      co.lastWeeklyDay = state.day;
      weeklyManager(state, co);
    }
  } else {
    // Período de instalación: llegan pedidos, no se vende.
    dailyOperationsSetup(state, co);
  }
  if (insolvencyCheck(state, co) && !co.npc) liquidate(state, co, 'bankruptcy');
}

/** Durante la instalación se reciben pedidos y se ejecutan las reglas de reposición, pero no se vende. */
function dailyOperationsSetup(state: GameState, co: Company): void {
  receiveOrders(state, co);
  payDuePayables(state, co);
  runReorderRules(state, co);
}

/**
 * Cierre de mes de todas las empresas del jugador. Orden: primero las
 * subsidiarias más profundas (para que su resultado llegue a la matriz), luego
 * la administración del grupo (honorarios, dividendos a la matriz, caja
 * centralizada, intereses intragrupo) y al final una revaluación de abajo hacia arriba.
 */
export function companiesMonthEnd(state: GameState): void {
  const byDepth = () => [...state.companies].sort((a, b) => depthOf(state, b) - depthOf(state, a));
  for (const co of byDepth()) if (state.companies.includes(co)) companyMonthEnd(state, co);
  groupMonthEnd(state, (sub, amount) => {
    const a = Math.min(amount, maxDistribution(state, sub).max);
    if (a > 0) distribute(state, sub, a, true);
  });
  icLoansMonthEnd(state);
  for (const co of byDepth()) if (!co.npc && isOpen(co)) revalue(state, co);
  monthlyMarkets(state);
}

export function companyMonthEnd(state: GameState, co: Company): void {
  if (!isOpen(co)) return;
  // Las empresas simuladas (mercado de compraventa, Mogul) reemplazan a su gerente si renuncia.
  if (co.npc && !hasManager(co) && co.ledger.balances.cash > px(state, 2400) * 2) {
    const c = generateCandidates(state, co, 'gerente').sort((a, b) => b.skill - a.skill)[0];
    if (c) hire(state, co, c.id, true);
  }
  runPayroll(state, co);
  monthlyAssets(state, co);
  monthlyStorage(state, co);
  const recent = co.stats.slice(-30);
  const util = recent.length ? recent.reduce((s, x) => s + (x.capacity > 0 ? x.capacityUsed / x.capacity : 0), 0) / recent.length : 0;
  monthlyStaff(state, co, util);
  snapshot(state, co);
  autoDividends(state, co, dateOf(state.day).m);
  if (!co.npc) revalue(state, co);
}

export function snapshot(state: GameState, co: Company): void {
  const from = Math.max(startOfMonth(state.day), co.foundedDay);
  const is = coIncomeStatement(co, from, state.day);
  co.history.push({
    day: state.day, revenue: is.revenue, grossProfit: is.grossProfit, netIncome: is.netIncome, cash: co.ledger.balances.cash, equity: coEquity(co),
    inventory: inventoryValue(co), employees: co.employees.length, share: companyShareEstimate(co), quality: co.quality, reputation: co.reputation, awareness: co.awareness,
    subscribers: sectorOf(co).model === 'subscription' ? Math.round(co.subscribers) : undefined,
  });
  forecastMonthEnd(state, co);
  if (co.history.length > 120) co.history.shift();
}

/** 1 de enero: impuestos empresariales y resultado de empresas transparentes (antes de la declaración personal). */
export function companiesYearStart(state: GameState): void {
  const year = dateOf(state.day).y - 1;
  for (const co of state.companies) if (isOpen(co)) closeCompanyYear(state, co, year);
}

// ------------------------------------------------------------ Mercado de compraventa

const LISTING_NAMES: Record<BizSectorId, string[]> = {
  cafeteria: ['Café Rincón Verde', 'La Esquina del Grano', 'Cafetería Alborada'],
  minimarket: ['Minimarket Los Álamos', 'Almacén Santa Fe', 'Súper Barrio Norte'],
  muebles: ['Muebles Artesanos Unidos', 'Taller El Cedro', 'Carpintería Moderna'],
  saas: ['Agendly', 'Cobranza Fácil', 'StockSmart'],
  consultora: ['Consultores del Centro', 'Estudio Contable Ríos', 'Asesoría Integral'],
  holding: [],
};

const REASONS = [
  'El dueño se retira y no tiene sucesor.',
  'Los socios quieren dedicarse a otro proyecto.',
  'El dueño necesita liquidez para una emergencia familiar.',
  'Venden para concentrarse en otra ciudad.',
  'El fundador perdió interés tras varios meses difíciles.',
];

/**
 * Genera empresas en venta SIMULÁNDOLAS con el mismo motor durante varios
 * meses, gestionadas por un gerente. Así sus estados financieros son reales,
 * no inventados. El precio pedido parte de la valoración y del optimismo del vendedor.
 */
export function generateListing(state: GameState): Listing | null {
  const sec = SECTORS[randInt(state, 0, SECTORS.length - 1)];
  const names = LISTING_NAMES[sec.id].filter((n) => !state.listings.some((l) => l.company.name === n) && !state.companies.some((c) => c.name === n));
  if (!names.length) return null;
  const forms: LegalForm[] = ['individual', 'srl', 'srl', 'corporacion'];
  const form = forms[randInt(state, 0, forms.length - 1)];
  const name = names[randInt(state, 0, names.length - 1)];
  const color = ['#7fb2e0', '#4cc093', '#ee7a66', '#b59be0', '#e6d27a'][randInt(state, 0, 4)];
  const months = randInt(state, 6, 18);
  const realDay = state.day;
  const startDay = realDay - months * 30;
  const saved = { day: state.day, projection: state.meta.projection };
  // La empresa se crea en el pasado ("días virtuales") y se simula hasta hoy con el mismo motor:
  // así sus pedidos, empleados, cobros y pagos tienen fechas coherentes con su historia.
  state.meta.projection = true;
  state.day = startDay;
  let co: Company;
  try {
    co = buildCompany(state, sec.id, name, form, color, true);
    co.ownership = 1;
    // La manufactura inmoviliza caja en cuentas por cobrar: sus dueños aportan más capital de trabajo.
    const capMult = sec.model === 'manufacturing' ? 2.2 : 1;
    const capital = roundCents(px(state, sec.recommendedCapital) * randRange(state, 1.0, 1.4) * capMult);
    coPost(co.ledger, { day: state.day, memo: 'Aporte de capital inicial', cf: 'financing', tag: 'capital', lines: [{ account: 'cash', debit: capital }, { account: 'capital', credit: capital }] });
    installCompany(state, co);
    co.openDay = state.day;
    co.awareness = randRange(state, 25, 55);
    co.reputation = randRange(state, 40, 65);
    const mgr = generateCandidates(state, co, 'gerente')[0];
    hire(state, co, mgr.id, true);
    co.delegation = { autoReorder: true, autoPricing: true, autoStaffing: true, targetMarkup: 1.5 + nextRandom(state) };
    co.maintenance = nextRandom(state) < 0.5 ? 'basic' : 'preventive';
    co.lastWeeklyDay = startDay;
    for (let d = startDay + 1; d <= realDay; d++) {
      state.day = d;
      const g = dateOf(d);
      companyDay(state, co, g.d === 1);
      if (!isOpen(co)) break;
      if (g.d === new Date(Date.UTC(g.y, g.m, 0)).getUTCDate()) companyMonthEnd(state, co);
    }
  } finally {
    state.day = saved.day;
    state.meta.projection = saved.projection;
  }
  // Solo se ofrecen empresas en marcha (las insolventes no llegan al mercado de compraventa).
  if (!isOpen(co) || co.status === 'insolvent') return null;
  const v = valuation(state, co);
  const ask = roundCents(Math.max(v.value, coEquity(co) * 0.6, px(state, 3000)) * randRange(state, 0.95, 1.3));
  // Algunas empresas esconden contingencias (juicios laborales, deudas fiscales): un abogado las detecta.
  const hiddenLiability = nextRandom(state) < 0.14 ? roundCents(ask * randRange(state, 0.05, 0.18)) : undefined;
  return { id: state.meta.nextId++, company: co, askPrice: ask, expiresDay: state.day + randInt(state, 45, 90), reason: REASONS[randInt(state, 0, REASONS.length - 1)], negotiated: false, hiddenLiability };
}

export function refreshListings(state: GameState): void {
  state.listings = state.listings.filter((l) => l.expiresDay > state.day);
  let guard = 0;
  while (state.listings.length < 3 && guard++ < 6) {
    const l = generateListing(state);
    if (l) {
      compactCompany(state, l.company, NPC_KEEP_MONTHS);
      state.listings.push(l);
    }
  }
}

