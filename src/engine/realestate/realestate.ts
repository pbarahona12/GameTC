import type { GameState } from '../state';
import type { Property, PropertyType, PropertyOwner, Mortgage, Lease, ZoneState, PropertyListing } from './types';
import { ZONES, ZONE_BY_ID, ZoneDef, PROPERTY_TYPE_NAMES, MORTGAGE_BANKS, MORTGAGE_BANK_BY_ID, MortgageBank, BUILD_COST, TENANT_NAMES } from '../../content/realestate';
import { jurisdictionById } from '../../content/jurisdictions';
import { Cents, clamp, roundCents, usd } from '../money';
import { addMonths, dateOf, formatDate } from '../time/calendar';
import { housingDrift, vacancyPressure, creditSpread, creditTightness } from '../economy/economy';
import { chance, randInt, randNormal, randRange } from '../rng';
import { post } from '../ledger/ledger';
import { payExpense, canPayFromChecking, spendable } from '../finance/payments';
import { coPay, coEquity } from '../business/common';
import { coPost } from '../business/companyLedger';
import type { Company } from '../business/types';
import { ActionResult, FAIL, OK } from '../result';
import { fmtMoney, fmtPct } from '../format';
import { addLog } from '../log';
import { amortizedPayment } from '../finance/loans';
import { monthlyGrossIncome } from '../career/career';
import { monthlyDebtPayments } from '../finance/loans';
import { recordInquiry, recordLate, recordOnTime, refreshCreditScore } from '../finance/credit';
import { practice } from '../skills/skills';
import { hiredPro } from '../pros/lookup';
import { applyHomeRent } from '../finance/budget';
import { coMetrics } from '../business/reports';
import { residence } from '../tax/taxEngine';

/**
 * BIENES RAÍCES (Fase 3).
 *
 * Valor de un inmueble (tasación) = m² × precio base de la zona × índice de la zona
 *   × categoría (0,8 + 0,1 × grado) × estado de conservación (0,75 + estado/400).
 * El índice de cada zona se mueve cada mes con el ciclo, las tasas, la inflación
 * y los eventos (economy.ts → housingDrift) más un sesgo y ruido propios.
 *
 * Dueños posibles: el jugador (el inmueble va a su balance a valor de tasación)
 * o una empresa (al costo menos depreciación del edificio, en el libro de la empresa).
 * Mensualmente: alquiler (si el inquilino paga), administración, mantenimiento,
 * reparaciones aleatorias, deterioro, impuesto inmobiliario trimestral e hipoteca.
 */
export const AGENCY_FEE = 0.08;
export const SALE_COMMISSION = 0.03;
/** Venta rápida: se cobra hoy este porcentaje de la tasación. */
export const QUICK_SALE_RATIO = 0.92;

/**
 * Probabilidad semanal de que aparezca un comprador para un inmueble publicado.
 * Sube exponencialmente al bajar el precio frente a la tasación y tiene tope:
 * por debajo de cierto precio, vender más barato ya no acelera la venta.
 */
export function buyerWeeklyChance(state: GameState, price: Cents, appraisal: Cents): number {
  const ratio = price / Math.max(1, appraisal);
  let prob = 0.22 * Math.exp(-7 * (ratio - 1));
  if (state.macro.phase === 'recesion') prob *= 0.55;
  if (state.macro.phase === 'auge') prob *= 1.3;
  return clamp(prob, 0.005, 0.7);
}

/** Costo de reparar un vicio oculto ya detectado (lo paga el comprador al escriturar). */
export function knownRepairCost(p: Property): Cents {
  return p.hiddenDefect?.discovered ? p.hiddenDefect.cost : 0;
}

/** Precio que cobra la venta rápida (hoy, sin esperar comprador). */
export function quickSalePrice(p: Property): Cents {
  return roundCents(p.appraisal * QUICK_SALE_RATIO);
}
export const NOTARY_RATE = 0.01;
export const FORECLOSURE_DISCOUNT = 0.75;
export const MISSED_TO_FORECLOSE = 3;

// ------------------------------------------------------------ Mercado

export function zoneDef(id: string): ZoneDef {
  return ZONE_BY_ID[id];
}

export function zoneState(state: GameState, id: string): ZoneState {
  let z = state.realEstate.zones.find((x) => x.id === id);
  if (!z) {
    z = { id, index: state.macro.priceIndex, rentIndex: state.macro.priceIndex, history: [] };
    state.realEstate.zones.push(z);
  }
  return z;
}

export function initRealEstate(state: GameState): void {
  state.realEstate.zones = ZONES.map((z) => ({ id: z.id, index: state.macro.priceIndex, rentIndex: state.macro.priceIndex, history: [{ d: state.day, index: state.macro.priceIndex, rentIndex: state.macro.priceIndex }] }));
  refreshPropertyListings(state);
}

const gradeMult = (g: number) => 0.8 + 0.1 * g;
const condMult = (c: number) => 0.75 + c / 400;

/** Tasación actual. Los terrenos no dependen del estado de conservación. */
export function appraise(state: GameState, p: Pick<Property, 'zoneId' | 'type' | 'm2' | 'grade' | 'condition'>): Cents {
  const z = zoneDef(p.zoneId);
  const zs = zoneState(state, p.zoneId);
  const base = p.m2 * z.price[p.type] * zs.index * gradeMult(p.grade) * (p.type === 'terreno' ? 1 : condMult(p.condition));
  return roundCents(base * 100);
}

/** Alquiler de mercado mensual. */
export function marketRent(state: GameState, p: Pick<Property, 'zoneId' | 'type' | 'm2' | 'grade' | 'condition'>): Cents {
  const z = zoneDef(p.zoneId);
  const zs = zoneState(state, p.zoneId);
  return roundCents(p.m2 * z.rent[p.type] * zs.rentIndex * gradeMult(p.grade) * (p.type === 'terreno' ? 1 : condMult(p.condition)) * 100);
}

/** Alquiler mensual de referencia de una publicación: el del contrato vigente o el de mercado (los terrenos no rentan). */
export function listingRent(state: GameState, l: PropertyListing): Cents {
  const p = l.property;
  return p.lease?.rent ?? (p.type === 'terreno' ? 0 : marketRent(state, p));
}

/** Rendimiento bruto anual de una publicación al precio pedido (alquiler × 12 / precio). */
export function listingGrossYield(state: GameState, l: PropertyListing): number {
  return l.askPrice > 0 ? (listingRent(state, l) * 12) / l.askPrice : 0;
}

/** Vacancia esperada del mercado para ese tipo en esa zona. */
export function marketVacancy(state: GameState, zoneId: string, type: PropertyType): number {
  return clamp(zoneDef(zoneId).vacancy[type] + vacancyPressure(state), 0.01, 0.8);
}

/** Paso mensual de los índices de cada zona. */
export function monthlyZones(state: GameState): void {
  const drift = housingDrift(state);
  for (const z of ZONES) {
    const zs = zoneState(state, z.id);
    const r = (drift + z.bias) / 12 + (z.vol / Math.sqrt(12)) * 0.6 * randNormal(state);
    zs.index = Math.max(0.2, zs.index * Math.exp(r));
    const rentR = (state.macro.inflation * 0.9 - vacancyPressure(state) * 0.5 + z.bias * 0.3) / 12 + 0.004 * randNormal(state);
    zs.rentIndex = Math.max(0.2, zs.rentIndex * Math.exp(rentR));
    zs.history.push({ d: state.day, index: Math.round(zs.index * 1e6) / 1e6, rentIndex: Math.round(zs.rentIndex * 1e6) / 1e6 });
    if (zs.history.length > 240) zs.history.shift();
  }
}

export function newProperty(state: GameState, zoneId: string, type: PropertyType, small = false): Property {
  const m2 = small ? randInt(state, 18, 34) : type === 'vivienda' ? randInt(state, 40, 160) : type === 'local' ? randInt(state, 30, 220) : type === 'oficina' ? randInt(state, 50, 400) : type === 'cochera' ? randInt(state, 11, 15) : randInt(state, 200, 2500);
  const grade = small || type === 'cochera' ? randInt(state, 1, 3) : randInt(state, 1, 5);
  const condition = type === 'terreno' ? 100 : randInt(state, 40, 98);
  const z = zoneDef(zoneId);
  const names: Record<PropertyType, string[]> = {
    vivienda: ['Departamento', 'Casa', 'Dúplex', 'PH'], local: ['Local', 'Local a la calle', 'Esquina comercial'], oficina: ['Oficina', 'Piso de oficinas', 'Estudio profesional'], terreno: ['Terreno', 'Lote', 'Parcela'],
    cochera: ['Cochera', 'Cochera cubierta', 'Box de garaje'],
  };
  const streets = ['Av. Libertad', 'Calle Olmos', 'Pasaje Sol', 'Av. del Puerto', 'Calle Colón', 'Bv. Norte', 'Calle Rivadavia', 'Av. Central', 'Calle Mar Azul'];
  const p: Property = {
    id: state.meta.nextId++, name: `${small ? (m2 < 26 ? 'Estudio' : 'Monoambiente') : names[type][randInt(state, 0, names[type].length - 1)]} ${streets[randInt(state, 0, streets.length - 1)]} ${randInt(state, 100, 2999)}`,
    type, zoneId, jurisdiction: z.jurisdiction, m2, grade, condition, landShare: type === 'terreno' ? 1 : randRange(state, 0.2, 0.4),
    owner: { kind: 'personal' }, purchasePrice: 0, purchaseDay: state.day, closingCosts: 0, costBasis: 0, appraisal: 0, carrying: 0, accumDepreciation: 0,
    lease: null, askingRent: 0, listedForRent: false, vacantSince: null, management: 'propia', usedBy: null, forSale: null, renovation: null, mortgageId: null,
    nextTaxDay: 0, nextTaxAmount: 0, monthly: [], totals: { rent: 0, expenses: 0, tax: 0, interest: 0 }, hiddenDefect: null, evictionUntil: null, development: null,
  };
  p.appraisal = appraise(state, p);
  p.askingRent = marketRent(state, p);
  if (chance(state, 0.14) && type !== 'terreno') p.hiddenDefect = { cost: roundCents(p.appraisal * randRange(state, 0.02, 0.08)), discovered: false };
  // Algunos se venden con inquilino.
  if (type !== 'terreno' && chance(state, 0.35)) p.lease = newLease(state, p, p.askingRent, state.day - randInt(state, 30, 300));
  return p;
}

function newLease(state: GameState, p: Property, rent: Cents, start = state.day): Lease {
  const z = zoneDef(p.zoneId);
  const months = p.type === 'vivienda' ? 12 : p.type === 'terreno' ? 12 : 24;
  return {
    tenant: TENANT_NAMES[randInt(state, 0, TENANT_NAMES.length - 1)],
    rent, startDay: start, endDay: addMonths(start, months),
    // Las cocheras tienen inquilinos más cumplidores (el monto es chico y se corta el acceso si no pagan).
    reliability: clamp(randRange(state, 0.9, 0.995) - z.tenantRisk * randRange(state, 0, p.type === 'cochera' ? 0.04 : 0.12), 0.7, 0.995), unpaidMonths: 0,
  };
}

export function refreshPropertyListings(state: GameState): void {
  const re = state.realEstate;
  re.listings = re.listings.filter((l) => l.expiresDay > state.day);
  const types: PropertyType[] = ['vivienda', 'vivienda', 'vivienda', 'local', 'oficina', 'terreno', 'cochera'];
  let guard = 0;
  while (re.listings.length < 8 && guard++ < 20) {
    const z = ZONES[randInt(state, 0, ZONES.length - 1)];
    const type = types[randInt(state, 0, types.length - 1)];
    const p = newProperty(state, z.id, type);
    const ask = roundCents(p.appraisal * randRange(state, 0.92, 1.15));
    re.listings.push({ id: state.meta.nextId++, property: p, askPrice: ask, expiresDay: state.day + randInt(state, 30, 90), negotiated: false, note: p.lease ? `Se vende con inquilino (${fmtMoney(p.lease.rent)}/mes hasta ${formatDate(p.lease.endDay)}).` : 'Se entrega desocupado.' });
  }
  // Opciones de entrada (1.2): siempre hay al menos una cochera y un estudio baratos,
  // para que invertir en inmuebles no requiera cientos de miles desde el primer día.
  const pi = state.macro.priceIndex;
  const cheap = [...ZONES].sort((a, b) => a.price.vivienda - b.price.vivienda).slice(0, 4);
  const ensure = (type: 'cochera' | 'vivienda', max: number, note: string) => {
    let g = 0;
    while (!re.listings.some((l) => l.property.type === type && l.askPrice <= usd(max * pi) && (type === 'cochera' || l.property.m2 <= 34)) && g++ < 8) {
      const z = type === 'cochera' ? ZONES[randInt(state, 0, ZONES.length - 1)] : cheap[randInt(state, 0, cheap.length - 1)];
      const p = newProperty(state, z.id, type, type === 'vivienda');
      const ask = roundCents(p.appraisal * randRange(state, 0.94, 1.06));
      if (ask > usd(max * pi)) continue;
      re.listings.push({ id: state.meta.nextId++, property: p, askPrice: ask, expiresDay: state.day + randInt(state, 45, 90), negotiated: false, note: `${note} ${p.lease ? `Se vende con inquilino (${fmtMoney(p.lease.rent)}/mes).` : 'Se entrega desocupado.'}` });
    }
  };
  ensure('cochera', 26000, 'Opción de entrada: cochera (poco mantenimiento, inquilinos cumplidores).');
  ensure('vivienda', 60000, 'Opción de entrada: estudio económico.');
  const entry = usd(90000 * pi);
  guard = 0;
  while (re.listings.filter((l) => l.askPrice <= entry).length < 3 && guard++ < 6) {
    const z = cheap[randInt(state, 0, cheap.length - 1)];
    const p = newProperty(state, z.id, 'vivienda', true);
    const ask = roundCents(p.appraisal * randRange(state, 0.94, 1.08));
    re.listings.push({ id: state.meta.nextId++, property: p, askPrice: ask, expiresDay: state.day + randInt(state, 45, 90), negotiated: false, note: `Opción de entrada: monoambiente económico. ${p.lease ? `Se vende con inquilino (${fmtMoney(p.lease.rent)}/mes).` : 'Se entrega desocupado.'}` });
  }
}

// ------------------------------------------------------------ Dueños (personal o empresa)

export function ownerCompany(state: GameState, owner: PropertyOwner): Company | null {
  return owner.kind === 'company' ? state.companies.find((c) => c.id === owner.id) ?? null : null;
}

export function ownerLabel(state: GameState, owner: PropertyOwner): string {
  if (owner.kind === 'personal') return 'Vos (a título personal)';
  if (owner.kind === 'company') return ownerCompany(state, owner)?.name ?? 'Empresa';
  return 'Fondo Mogul';
}

function isRental(p: Property): boolean {
  return p.usedBy === null;
}

/** Gasto del dueño. Personal: con cadena de pagos (puede generar atrasos). Empresa: caja de la empresa. */
function ownerExpense(state: GameState, p: Property, kind: 'expense' | 'tax' | 'legal', amount: Cents, memo: string): boolean {
  if (amount <= 0) return true;
  if (p.owner.kind === 'personal') {
    const account = kind === 'tax' ? 'property_tax' : kind === 'legal' ? 'legal_costs' : 'property_expenses';
    const r = payExpense(state, account, amount, { memo, tag: `property:${kind}`, method: 'checking' });
    if (isRental(p) && kind !== 'legal') state.tax.ytd.rentalExpenses = (state.tax.ytd.rentalExpenses ?? 0) + amount;
    return r.ok;
  }
  const co = ownerCompany(state, p.owner);
  if (!co) return false;
  return coPay(state, co, kind === 'tax' ? 'property_tax' : 'property_costs', amount, { memo, tag: `property:${kind}`, kind: 'otros' });
}

function ownerIncome(state: GameState, p: Property, amount: Cents, memo: string): void {
  if (amount <= 0) return;
  if (p.owner.kind === 'personal') {
    post(state.ledger, { day: state.day, memo, cf: 'operating', tag: 'property:rent', lines: [{ account: 'checking', debit: amount }, { account: 'rental_income', credit: amount }] });
    state.tax.ytd.rentalIncome = (state.tax.ytd.rentalIncome ?? 0) + amount;
    return;
  }
  const co = ownerCompany(state, p.owner);
  if (co) coPost(co.ledger, { day: state.day, memo, cf: 'operating', tag: 'property:rent', lines: [{ account: 'cash', debit: amount }, { account: 'rental_income', credit: amount }] });
}

export function ownerCash(state: GameState, owner: PropertyOwner): Cents {
  if (owner.kind === 'personal') return spendable(state);
  return ownerCompany(state, owner)?.ledger.balances.cash ?? 0;
}

// ------------------------------------------------------------ Día y mes

export function realEstateDay(state: GameState): void {
  const re = state.realEstate;
  const monthStart = dateOf(state.day).d === 1;
  if (monthStart) monthlyZones(state);
  for (const m of re.mortgages) if (m.status === 'activa' && m.nextDueDay === state.day) processMortgagePayment(state, m);
  for (const p of [...re.properties]) {
    if (!re.properties.includes(p)) continue;
    if (p.renovation && state.day >= p.renovation.until) finishRenovation(state, p);
    if (p.development && state.day >= p.development.until) finishDevelopment(state, p);
    if (p.evictionUntil !== null && state.day >= p.evictionUntil) {
      p.evictionUntil = null;
      p.vacantSince = state.day;
      addLog(state, 'info', '🔑', `${p.name}: terminó el desalojo, el inmueble quedó libre.`);
    }
    if (state.day % 7 === 0) weeklyTenantSearch(state, p);
    if (p.forSale && state.day % 7 === 3) weeklyBuyerSearch(state, p);
    if (monthStart && re.properties.includes(p)) monthlyProperty(state, p);
  }
  if (monthStart) {
    refreshPropertyListings(state);
    revaluePersonalProperties(state);
  }
  re.mortgages = re.mortgages.filter((m) => m.status === 'activa' || state.day - m.startDay < 3650);
}

const TENANT = { base: 0.35, slope: 6, min: 0.01, max: 0.9 };

/** Multiplicador de la probabilidad de inquilino por estado del inmueble, vacancia de la zona y administración. */
function tenantFactor(state: GameState, p: Property): number {
  const vac = marketVacancy(state, p.zoneId, p.type);
  return (0.5 + p.condition / 200) * (1 - vac * 2) * (p.management === 'agencia' ? 1.5 : 1);
}

/**
 * Probabilidad semanal de conseguir inquilino con un alquiler pedido: baja si
 * pedís más que el mercado o el estado es malo; tiene tope.
 */
export function tenantWeeklyChance(state: GameState, p: Property, rent: Cents): number {
  const mr = marketRent(state, p);
  const ratio = rent / Math.max(1, mr);
  let prob = TENANT.base * Math.exp(-TENANT.slope * (ratio - 1)) * (0.5 + p.condition / 200) * (1 - marketVacancy(state, p.zoneId, p.type) * 2);
  if (p.management === 'agencia') prob *= 1.5;
  return clamp(prob, TENANT.min, TENANT.max);
}

/**
 * Alquiler por debajo del cual pedir menos ya no consigue inquilino más rápido
 * (la probabilidad semanal llegó a su tope): solo baja el ingreso.
 */
export function rentNoFasterBelow(state: GameState, p: Property): Cents {
  const k = tenantFactor(state, p);
  if (k <= 0) return 0;
  const ratio = 1 - Math.log(TENANT.max / (TENANT.base * k)) / TENANT.slope;
  return Math.max(0, roundCents(marketRent(state, p) * ratio));
}

function weeklyTenantSearch(state: GameState, p: Property): void {
  if (!p.listedForRent || p.lease || p.usedBy !== null || p.renovation || p.development || p.evictionUntil !== null || p.type === 'terreno' && p.m2 < 100) return;
  if (chance(state, tenantWeeklyChance(state, p, p.askingRent))) {
    p.lease = newLease(state, p, p.askingRent);
    p.vacantSince = null;
    if (p.owner.kind !== 'mogul') addLog(state, 'success', '🤝', `${p.name}: nuevo inquilino (${p.lease.tenant}) por ${fmtMoney(p.lease.rent)}/mes hasta ${formatDate(p.lease.endDay)}.`);
  }
}

function weeklyBuyerSearch(state: GameState, p: Property): void {
  if (chance(state, buyerWeeklyChance(state, p.forSale!.price, p.appraisal))) completeSale(state, p, p.forSale!.price, 'mercado');
}

/** Economía mensual de un inmueble (sin contabilizar). Sirve también para Mogul y proyecciones. */
export function monthlyEconomics(_state: GameState, p: Property): { rent: Cents; maintenance: Cents; agency: Cents; tax: Cents } {
  const rent = p.lease ? p.lease.rent : 0;
  const building = p.type === 'terreno' ? 0 : p.appraisal * (1 - p.landShare);
  const maintenance = roundCents(building * 0.001 * (p.condition < 60 ? 1.5 : 1));
  const agency = p.management === 'agencia' ? roundCents(rent * AGENCY_FEE) : 0;
  const tax = roundCents((p.appraisal * jurisdictionById(p.jurisdiction).propertyTaxRate) / 12);
  return { rent, maintenance, agency, tax };
}

function monthlyProperty(state: GameState, p: Property): void {
  const g = dateOf(state.day);
  let rent = 0;
  let expenses = 0;
  let tax = 0;
  // 1. Alquiler
  if (p.lease) {
    const unemp = state.macro.unemployment;
    const pPay = clamp(p.lease.reliability - Math.max(0, unemp - 0.05) * 2, 0.4, 0.999);
    if (chance(state, pPay)) {
      rent = p.lease.rent;
      p.lease.unpaidMonths = 0;
      ownerIncome(state, p, rent, `Alquiler de ${p.name} (${p.lease.tenant})`);
      if (p.management === 'agencia') {
        const fee = roundCents(rent * AGENCY_FEE);
        ownerExpense(state, p, 'expense', fee, `Administración de ${p.name} (8 %)`);
        expenses += fee;
      }
    } else {
      p.lease.unpaidMonths++;
      addLog(state, 'warning', '🧾', `${p.name}: ${p.lease.tenant} no pagó el alquiler (${p.lease.unpaidMonths} ${p.lease.unpaidMonths === 1 ? 'mes' : 'meses'}).`);
      if (p.lease.unpaidMonths >= 2) startEviction(state, p);
    }
    if (p.lease && state.day >= p.lease.endDay) {
      const mr = marketRent(state, p);
      if (chance(state, 0.6)) {
        const newRent = roundCents(Math.max(p.lease.rent, mr * 0.97));
        p.lease = { ...p.lease, rent: newRent, startDay: state.day, endDay: addMonths(state.day, p.type === 'vivienda' ? 12 : 24) };
        addLog(state, 'info', '📝', `${p.name}: el inquilino renovó el contrato por ${fmtMoney(newRent)}/mes.`);
      } else {
        addLog(state, 'info', '📦', `${p.name}: ${p.lease.tenant} terminó el contrato y se mudó.`);
        p.lease = null;
        p.vacantSince = state.day;
        p.listedForRent = p.usedBy === null;
        p.askingRent = mr;
      }
    }
  }
  // 2. Mantenimiento y deterioro
  if (p.type !== 'terreno') {
    const econ = monthlyEconomics(state, p);
    ownerExpense(state, p, 'expense', econ.maintenance, `Mantenimiento de ${p.name}`);
    expenses += econ.maintenance;
    p.condition = clamp(p.condition - (p.lease || p.usedBy !== null ? 0.4 : 0.25), 0, 100);
    if (chance(state, 0.035)) {
      const repair = roundCents(p.appraisal * randRange(state, 0.003, 0.015));
      ownerExpense(state, p, 'expense', repair, `Reparación imprevista en ${p.name}`);
      expenses += repair;
      addLog(state, 'warning', '🔧', `${p.name}: reparación imprevista.`, repair);
    }
    if (p.hiddenDefect && !p.hiddenDefect.discovered && chance(state, 0.15)) {
      p.hiddenDefect.discovered = true;
      ownerExpense(state, p, 'expense', p.hiddenDefect.cost, `Vicio oculto descubierto en ${p.name}`);
      expenses += p.hiddenDefect.cost;
      addLog(state, 'danger', '🧱', `${p.name}: apareció un vicio oculto (humedad estructural). La reparación costó ${fmtMoney(p.hiddenDefect.cost)}. Una inspección o un abogado lo habrían detectado antes de comprar.`, p.hiddenDefect.cost);
    }
  }
  // 3. Impuesto inmobiliario trimestral (marzo, junio, septiembre, diciembre)
  if (g.m % 3 === 0) {
    tax = roundCents((p.appraisal * jurisdictionById(p.jurisdiction).propertyTaxRate) / 4);
    ownerExpense(state, p, 'tax', tax, `Impuesto inmobiliario de ${p.name}`);
  }
  p.nextTaxDay = nextTaxDay(state.day);
  p.nextTaxAmount = roundCents((p.appraisal * jurisdictionById(p.jurisdiction).propertyTaxRate) / 4);
  // 4. Depreciación fiscal (base) y contable (empresas)
  if (p.owner.kind === 'personal' && isRental(p) && p.type !== 'terreno') {
    state.tax.ytd.rentalBuildingDays = (state.tax.ytd.rentalBuildingDays ?? 0) + p.costBasis * (1 - p.landShare) * 30;
  }
  if (p.owner.kind === 'company' && p.type !== 'terreno') {
    const co = ownerCompany(state, p.owner);
    const dep = Math.min(p.carrying - roundCents(p.costBasis * p.landShare), roundCents((p.costBasis * (1 - p.landShare)) / 480));
    if (co && dep > 0) {
      coPost(co.ledger, { day: state.day, memo: `Depreciación de ${p.name}`, cf: 'internal', tag: 'property:dep', lines: [{ account: 'depreciation', debit: dep }, { account: 'real_estate', credit: dep }] });
      p.carrying -= dep;
      p.accumDepreciation += dep;
    }
  }
  // 5. Tasación y registro mensual
  p.appraisal = developmentAware(state, p);
  const m = state.realEstate.mortgages.find((x) => x.id === p.mortgageId);
  const interest = m ? roundCents((m.balance * m.apr) / 12) : 0;
  p.totals.rent += rent;
  p.totals.expenses += expenses;
  p.totals.tax += tax;
  p.totals.interest += interest;
  p.monthly.push({ d: state.day, rent, expenses, tax, interest, net: rent - expenses - tax - interest, value: p.appraisal, occupied: !!p.lease || p.usedBy !== null });
  if (p.monthly.length > 60) p.monthly.shift();
}

/** Próximo 1 de marzo, junio, septiembre o diciembre estrictamente posterior a `day` (el de hoy ya se cobró). */
function nextTaxDay(day: number): number {
  const g = dateOf(day);
  let m = g.m + 1;
  while (m % 3 !== 0) m++;
  return m > 12 ? dateOfFirst(g.y + 1, m - 12) : dateOfFirst(g.y, m);
}

function dateOfFirst(y: number, m: number): number {
  return Math.round((Date.UTC(y, m - 1, 1) - Date.UTC(2026, 0, 1)) / 86_400_000);
}

function developmentAware(state: GameState, p: Property): Cents {
  if (p.development) return roundCents(appraise(state, p) + p.development.cost * 0.9);
  return appraise(state, p);
}

function startEviction(state: GameState, p: Property): void {
  if (!p.lease) return;
  const lawyer = p.owner.kind === 'personal' ? hiredPro(state, 'abogado', 'personal') : p.owner.kind === 'company' ? hiredPro(state, 'abogado', p.owner.id) ?? hiredPro(state, 'abogado', 'personal') : null;
  const days = lawyer ? clamp(Math.round(75 - lawyer.quality * 0.4), 30, 75) : 90;
  const cost = usd((lawyer ? 400 : 1500) * state.macro.priceIndex);
  ownerExpense(state, p, 'legal', cost, `Juicio de desalojo en ${p.name}`);
  addLog(state, 'danger', '⚖️', `${p.name}: iniciaste el desalojo de ${p.lease.tenant} por falta de pago. Durará unos ${days} días${lawyer ? ` (con ${lawyer.name})` : ''}.`, cost, 'legal');
  p.lease = null;
  p.evictionUntil = state.day + days;
  p.listedForRent = true;
}

// ------------------------------------------------------------ Valuación personal

/** Lleva los inmuebles personales a su tasación contra "Revalorización no realizada". */
export function revaluePersonalProperties(state: GameState): void {
  let delta = 0;
  for (const p of state.realEstate.properties) {
    if (p.owner.kind !== 'personal') continue;
    const target = p.appraisal;
    delta += target - p.carrying;
    p.carrying = target;
  }
  if (delta === 0) return;
  post(state.ledger, {
    day: state.day, memo: 'Revalorización de inmuebles (tasación)', cf: 'internal', tag: 'property:mark',
    lines: delta > 0 ? [{ account: 'real_estate', debit: delta }, { account: 'unrealized_gains', credit: delta }] : [{ account: 'unrealized_gains', debit: -delta }, { account: 'real_estate', credit: -delta }],
  });
}

// ------------------------------------------------------------ Hipotecas

export interface MortgageQuote {
  bank: MortgageBank;
  approved: boolean;
  reasons: string[];
  amount: Cents;
  maxAmount: Cents;
  apr: number;
  payment: Cents;
  fee: Cents;
  totalInterest: Cents;
  ltv: number;
  dti: number | null;
}

export function quoteMortgage(state: GameState, bankId: string, owner: PropertyOwner, price: Cents, amount: Cents, years: number, rateType: 'fija' | 'variable', type: PropertyType, expectedRent: Cents): MortgageQuote {
  const bank = MORTGAGE_BANK_BY_ID[bankId];
  const reasons: string[] = [];
  const maxLtv = type === 'terreno' ? bank.maxLtvLand : bank.maxLtv;
  const maxAmount = roundCents(price * maxLtv);
  const spread = (rateType === 'fija' ? bank.fixedSpread + 0.004 + 0.0004 * years : bank.variableSpread) + creditSpread(state);
  let apr = state.macro.policyRate + spread;
  const months = years * 12;
  const payment = amount > 0 ? amortizedPayment(amount, apr, months) : 0;
  let dti: number | null = null;
  if (owner.kind === 'personal') {
    if (bank.forCompanies) reasons.push('Este banco solo financia a empresas.');
    const need = bank.minScore + creditTightness(state);
    if (state.credit.score < need) reasons.push(`Puntaje insuficiente: el banco pide ${need} (tenés ${state.credit.score}).`);
    const leases = state.realEstate.properties.filter((p) => p.owner.kind === 'personal' && p.lease).reduce((s, p) => s + p.lease!.rent, 0);
    const income = monthlyGrossIncome(state) + roundCents((leases + expectedRent) * 0.7);
    const otherDebt = monthlyDebtPayments(state) + state.realEstate.mortgages.filter((m) => m.owner.kind === 'personal' && m.status === 'activa').reduce((s, m) => s + m.payment, 0);
    dti = income > 0 ? (otherDebt + payment) / income : null;
    if (dti === null) reasons.push('Sin ingresos demostrables (empleo o alquileres) no se aprueba una hipoteca personal.');
    else if (dti > bank.maxDti) reasons.push(`Tus cuotas serían el ${Math.round(dti * 100)} % de tus ingresos (máximo ${Math.round(bank.maxDti * 100)} %).`);
    if (state.bank.loans.some((l) => l.status === 'default') || state.ledger.balances.arrears > 0) reasons.push('Tenés deudas impagas o atrasos.');
  } else if (owner.kind === 'company') {
    if (!bank.forCompanies) reasons.push('Este banco solo presta a personas; elegí el banco corporativo.');
    const co = ownerCompany(state, owner);
    if (co) {
      const m = coMetrics(state, co);
      const ebitdaMonthly = m.net30 + m.payrollMonthly * 0; // aproximación conservadora: beneficio neto mensual
      const cover = (Math.max(0, ebitdaMonthly) + expectedRent * 0.7) / Math.max(1, payment);
      if (co.status !== 'active') reasons.push('La empresa está insolvente.');
      if (cover < 1.2 && coEquity(co) < price) reasons.push(`La empresa no demuestra flujo suficiente (cobertura ${cover.toFixed(2)}×, mínimo 1.2×) ni patrimonio que respalde el préstamo.`);
    }
  }
  if (amount > maxAmount) reasons.push(`Financian como máximo el ${Math.round(maxLtv * 100)} % del precio (${fmtMoney(maxAmount)}).`);
  // 1.2: los bancos no dan hipotecas chicas (el costo de tramitarlas no lo justifica).
  const minAmount = usd(15000 * state.macro.priceIndex);
  if (amount > 0 && amount < minAmount) reasons.push(`El monto mínimo de una hipoteca es ${fmtMoney(minAmount, { decimals: false })}: para inmuebles chicos, pagá al contado o con un préstamo personal.`);
  if (years > bank.maxYears || years < 5) reasons.push(`Plazo entre 5 y ${bank.maxYears} años.`);
  const fee = roundCents(amount * bank.fee);
  let totalInterest = 0;
  let bal = amount;
  for (let i = 0; i < months && bal > 0; i++) {
    const int = roundCents((bal * apr) / 12);
    totalInterest += int;
    bal -= Math.min(bal, payment - int);
  }
  apr = Math.round(apr * 10000) / 10000;
  return { bank, approved: reasons.length === 0, reasons, amount, maxAmount, apr, payment, fee, totalInterest, ltv: price > 0 ? amount / price : 0, dti };
}

export function allMortgageQuotes(state: GameState, owner: PropertyOwner, price: Cents, amount: Cents, years: number, rateType: 'fija' | 'variable', type: PropertyType, expectedRent: Cents): MortgageQuote[] {
  return MORTGAGE_BANKS.map((b) => quoteMortgage(state, b.id, owner, price, amount, years, rateType, type, expectedRent));
}

function processMortgagePayment(state: GameState, m: Mortgage): void {
  // Hipoteca variable: la tasa se revisa en cada aniversario.
  if (m.rateType === 'variable' && m.paymentsMade > 0 && m.paymentsMade % 12 === 0) {
    const newApr = Math.round((state.macro.policyRate + m.spread + creditSpread(state)) * 10000) / 10000;
    const oldApr = m.apr;
    if (Math.abs(newApr - oldApr) >= 0.0005) {
      const oldPayment = m.payment;
      m.apr = newApr;
      m.payment = amortizedPayment(m.balance, m.apr, m.termMonths - m.paymentsMade);
      const up = newApr > oldApr;
      const p = state.realEstate.properties.find((x) => x.id === m.propertyId);
      addLog(state, up ? 'warning' : 'info', '🏦', `La hipoteca variable de ${p?.name ?? 'tu inmueble'} ${up ? 'subió' : 'bajó'} del ${fmtPct(oldApr, 2)} al ${fmtPct(newApr, 2)}: la cuota pasa de ${fmtMoney(oldPayment)} a ${fmtMoney(m.payment)}.`);
    }
  }
  const interest = roundCents((m.balance * m.apr) / 12);
  const principal = Math.min(m.balance, Math.max(0, m.payment - interest));
  const total = interest + principal;
  const p = state.realEstate.properties.find((x) => x.id === m.propertyId);
  let paid = false;
  if (m.owner.kind === 'personal') {
    if (canPayFromChecking(state, total)) {
      post(state.ledger, {
        day: state.day, memo: `Cuota de hipoteca (${p?.name ?? 'inmueble'})`, cf: 'financing', tag: 'mortgage:payment',
        lines: [{ account: 'mortgages', debit: principal }, { account: 'interest_expense', debit: interest }, { account: 'checking', credit: total }],
      });
      if (p && isRental(p)) state.tax.ytd.rentalInterest = (state.tax.ytd.rentalInterest ?? 0) + interest;
      recordOnTime(state);
      paid = true;
    }
  } else if (m.owner.kind === 'company') {
    const co = ownerCompany(state, m.owner);
    if (co && co.ledger.balances.cash >= total) {
      coPost(co.ledger, {
        day: state.day, memo: `Cuota de hipoteca (${p?.name ?? 'inmueble'})`, cf: 'financing', tag: 'mortgage:payment',
        lines: [{ account: 'mortgages', debit: principal }, { account: 'interest', debit: interest }, { account: 'cash', credit: total }],
      });
      paid = true;
    }
  }
  if (paid) {
    m.balance -= principal;
    m.interestPaid += interest;
    m.paymentsMade++;
    m.missed = 0;
    if (m.balance <= 0) {
      m.status = 'pagada';
      if (p) p.mortgageId = null;
      addLog(state, 'success', '🎉', `¡Terminaste de pagar la hipoteca de ${p?.name ?? 'tu inmueble'}!`);
    }
  } else {
    m.missed++;
    const fee = usd(50 * state.macro.priceIndex);
    if (m.owner.kind === 'personal') {
      recordLate(state);
      payExpense(state, 'late_fees', fee, { memo: 'Recargo por cuota hipotecaria impaga', tag: 'mortgage:late', method: 'checking' });
    } else {
      const co = ownerCompany(state, m.owner);
      if (co) coPay(state, co, 'penalties', fee, { memo: 'Recargo por cuota hipotecaria impaga', tag: 'mortgage:late', kind: 'prestamo' });
    }
    addLog(state, 'danger', '🏦', `No se pudo pagar la cuota de la hipoteca de ${p?.name ?? 'tu inmueble'} (${m.missed} de ${MISSED_TO_FORECLOSE} antes del embargo).`);
    if (m.missed >= MISSED_TO_FORECLOSE && p) {
      foreclose(state, p, m);
      return;
    }
  }
  m.nextDueDay = addMonths(m.nextDueDay, 1);
}

/**
 * Ejecución hipotecaria (embargo): el banco remata el inmueble al 75 % de su
 * tasación, cobra la deuda y gastos (5 %) y devuelve el sobrante al dueño.
 * Si no alcanza y la hipoteca es CON recurso, la diferencia se sigue debiendo.
 */
function foreclose(state: GameState, p: Property, m: Mortgage): void {
  const price = roundCents(p.appraisal * FORECLOSURE_DISCOUNT);
  const costs = roundCents(price * 0.05);
  const net = price - costs;
  const debt = m.balance;
  const surplus = Math.max(0, net - debt);
  const deficiency = Math.max(0, debt - net);
  m.status = 'ejecutada';
  if (p.owner.kind === 'personal') {
    const carrying = p.carrying;
    const unreal = carrying - p.costBasis;
    const realized = price - p.costBasis;
    const lines: Array<{ account: 'checking' | 'mortgages' | 'acquisition_costs' | 'real_estate' | 'unrealized_gains' | 'realized_gains' | 'arrears' | 'other_income'; debit?: Cents; credit?: Cents }> = [];
    lines.push({ account: 'mortgages', debit: debt });
    if (costs) lines.push({ account: 'acquisition_costs', debit: costs });
    if (surplus) lines.push({ account: 'checking', debit: surplus });
    lines.push({ account: 'real_estate', credit: carrying });
    if (unreal > 0) lines.push({ account: 'unrealized_gains', debit: unreal });
    if (unreal < 0) lines.push({ account: 'unrealized_gains', credit: -unreal });
    if (realized > 0) lines.push({ account: 'realized_gains', credit: realized });
    if (realized < 0) lines.push({ account: 'realized_gains', debit: -realized });
    if (deficiency > 0) {
      if (m.recourse) lines.push({ account: 'arrears', credit: deficiency });
      else lines.push({ account: 'other_income', credit: deficiency });
    }
    post(state.ledger, { day: state.day, memo: `Ejecución hipotecaria de ${p.name}`, cf: 'investing', tag: 'mortgage:foreclosure', lines });
    addGain(state, p, realized);
    state.credit.defaults++;
    state.credit.arrearsEvents += deficiency > 0 && m.recourse ? 1 : 0;
    refreshCreditScore(state);
    state.player.attributes.stress = Math.min(100, state.player.attributes.stress + 20);
    state.player.attributes.reputation = Math.max(0, state.player.attributes.reputation - 8);
  } else if (p.owner.kind === 'company') {
    const co = ownerCompany(state, p.owner);
    if (co) {
      const book = p.carrying;
      const gain = price - book;
      coPost(co.ledger, {
        day: state.day, memo: `Ejecución hipotecaria de ${p.name}`, cf: 'investing', tag: 'mortgage:foreclosure',
        lines: [
          { account: 'mortgages', debit: debt },
          ...(costs ? [{ account: 'property_costs' as const, debit: costs }] : []),
          ...(surplus ? [{ account: 'cash' as const, debit: surplus }] : []),
          { account: 'real_estate', credit: book },
          ...(gain > 0 ? [{ account: 'gain_on_sale' as const, credit: gain }] : []),
          ...(gain < 0 ? [{ account: 'gain_on_sale' as const, debit: -gain }] : []),
          ...(deficiency > 0 ? [{ account: m.recourse ? ('arrears' as const) : ('other_income' as const), credit: deficiency }] : []),
        ],
      });
      if (deficiency > 0 && m.recourse) co.arrears.push({ id: state.meta.nextId++, kind: 'prestamo', amount: deficiency, since: state.day, label: `Saldo de hipoteca tras remate (${p.name})` });
    }
  }
  removeProperty(state, p);
  addLog(state, 'danger', '🔨', `EMBARGO: el banco remató ${p.name} por ${fmtMoney(price)}. ${surplus ? `Recibiste el sobrante de ${fmtMoney(surplus)}.` : ''}${deficiency ? (m.recourse ? ` Seguís debiendo ${fmtMoney(deficiency)} (hipoteca con recurso).` : ` La diferencia de ${fmtMoney(deficiency)} la asume el banco (sin recurso).`) : ''}`, undefined, 'peligro');
}

function removeProperty(state: GameState, p: Property): void {
  const wasHome = p.usedBy === 'jugador';
  state.realEstate.properties = state.realEstate.properties.filter((x) => x.id !== p.id);
  if (wasHome) applyHomeRent(state);
}

function addGain(state: GameState, p: Property, realized: Cents): void {
  const j = residence(state);
  const long = j.capitalGains.longAfterDays > 0 && state.day - p.purchaseDay >= j.capitalGains.longAfterDays;
  const y = state.tax.ytd;
  if (long) y.gainsLong = (y.gainsLong ?? 0) + realized;
  else y.gainsShort = (y.gainsShort ?? 0) + realized;
}

// ------------------------------------------------------------ Compra y venta

export interface BuyOptions {
  owner: PropertyOwner;
  offer?: Cents;
  financing?: { bankId: string; amount: Cents; years: number; rateType: 'fija' | 'variable' } | null;
}

export function closingCosts(_state: GameState, price: Cents, jurisdictionId: string): { transfer: Cents; notary: Cents; total: Cents } {
  const j = jurisdictionById(jurisdictionId);
  const transfer = roundCents(price * j.transferTaxRate);
  const notary = roundCents(price * NOTARY_RATE);
  return { transfer, notary, total: transfer + notary };
}

/** Inspección técnica antes de comprar: revela vicios ocultos. Con abogado contratado es gratis y además negocia el precio. */
export function inspectListing(state: GameState, listingId: number): ActionResult {
  const l = state.realEstate.listings.find((x) => x.id === listingId);
  if (!l) return FAIL('El inmueble ya no está en venta.');
  if (l.property.hiddenDefect?.discovered) return FAIL('Ya inspeccionaste este inmueble: el vicio oculto está detectado.');
  const lawyer = hiredPro(state, 'abogado', 'personal');
  const cost = lawyer ? 0 : usd(400 * state.macro.priceIndex);
  if (cost && !canPayFromChecking(state, cost)) return FAIL(`La inspección cuesta ${fmtMoney(cost)}.`);
  if (cost) post(state.ledger, { day: state.day, memo: `Inspección técnica de ${l.property.name}`, cf: 'operating', tag: 'property:inspection', lines: [{ account: 'property_expenses', debit: cost }, { account: 'checking', credit: cost }] });
  practice(state, 'inspection', 'realEstate', 40);
  const d = l.property.hiddenDefect;
  if (!d) return OK(`Inspección sin hallazgos relevantes en ${l.property.name}.`);
  // Inspeccionar INFORMA: el vicio sigue ahí y, si comprás igual, la reparación se paga al escriturar.
  d.discovered = true;
  if (lawyer) {
    // Con abogado, una sola consecuencia: rebaja equivalente al costo de reparar.
    const cut = Math.min(d.cost, l.askPrice - 1);
    l.askPrice = Math.max(1, l.askPrice - cut);
    return OK(`${lawyer.name} detectó un vicio oculto y negoció una rebaja de ${fmtMoney(cut)}, lo que cuesta repararlo. Si comprás, la reparación se paga al escriturar.`);
  }
  return OK(`La inspección encontró un vicio oculto: repararlo cuesta ${fmtMoney(d.cost)} y, si comprás, se paga al escriturar. Tenelo en cuenta en tu oferta.`);
}

export function buyProperty(state: GameState, listingId: number, o: BuyOptions): ActionResult {
  const re = state.realEstate;
  const l = re.listings.find((x) => x.id === listingId);
  if (!l) return FAIL('El inmueble ya no está en venta.');
  if (state.legal?.prison) return FAIL('Desde prisión no podés comprar inmuebles.');
  let price = l.askPrice;
  if (o.offer !== undefined && !(o.offer > 0)) return FAIL('La oferta debe ser mayor a cero.');
  if (o.offer !== undefined && o.offer < l.askPrice) {
    if (l.negotiated) return FAIL('El vendedor ya rechazó una contraoferta: solo acepta el precio publicado.');
    l.negotiated = true;
    const p = clamp((o.offer / l.askPrice - 0.85) / 0.15 + state.skills.negotiation.level * 0.004 + state.skills.realEstate.level * 0.002, 0, 0.95);
    practice(state, 'property_negotiation', 'negotiation', 80);
    if (!chance(state, p)) return FAIL(`El vendedor rechazó ${fmtMoney(o.offer)} (probabilidad estimada ${Math.round(p * 100)} %).`);
    // Aceptada: el precio acordado queda firme aunque la compra falle después (por ejemplo, la hipoteca).
    l.askPrice = o.offer;
    price = o.offer;
  }
  const p = l.property;
  const cc = closingCosts(state, price, p.jurisdiction);
  const f = o.financing ?? null;
  const loan = f ? f.amount : 0;
  let quote: MortgageQuote | null = null;
  if (f && loan > 0) {
    quote = quoteMortgage(state, f.bankId, o.owner, price, loan, f.years, f.rateType, p.type, listingRent(state, l));
    if (!quote.approved) return FAIL(`Hipoteca rechazada: ${quote.reasons.join(' ')}`);
  }
  const fee = quote?.fee ?? 0;
  const cashNeeded = price - loan + cc.total + fee;
  // Un vicio oculto ya detectado se repara al escriturar, a cargo del comprador.
  const repair = knownRepairCost(p);
  if (ownerCash(state, o.owner) < cashNeeded + repair) return FAIL(`Se necesitan ${fmtMoney(cashNeeded + repair)} (anticipo ${fmtMoney(price - loan)} + gastos de escritura e impuestos ${fmtMoney(cc.total)}${fee ? ` + comisión hipotecaria ${fmtMoney(fee)}` : ''}${repair ? ` + reparación del vicio oculto ${fmtMoney(repair)}` : ''}).`);
  if (o.owner.kind === 'personal') {
    if (!canPayFromChecking(state, cashNeeded + repair)) return FAIL('Fondos insuficientes en la cuenta corriente.');
    post(state.ledger, {
      day: state.day, memo: `Compra de ${p.name}`, cf: 'investing', tag: 'property:buy',
      lines: [
        { account: 'real_estate', debit: price },
        { account: 'acquisition_costs', debit: cc.total + fee },
        { account: 'checking', credit: cashNeeded },
        ...(loan > 0 ? [{ account: 'mortgages' as const, credit: loan }] : []),
      ],
    });
    if (loan > 0) recordInquiry(state);
  } else if (o.owner.kind === 'company') {
    const co = ownerCompany(state, o.owner);
    if (!co) return FAIL('Empresa inexistente.');
    coPost(co.ledger, {
      day: state.day, memo: `Compra de ${p.name}`, cf: 'investing', tag: 'property:buy',
      lines: [
        { account: 'real_estate', debit: price + cc.total },
        ...(fee ? [{ account: 'property_costs' as const, debit: fee }] : []),
        { account: 'cash', credit: cashNeeded },
        ...(loan > 0 ? [{ account: 'mortgages' as const, credit: loan }] : []),
      ],
    });
  } else return FAIL('Dueño inválido.');
  p.owner = o.owner;
  p.purchasePrice = price;
  p.purchaseDay = state.day;
  p.closingCosts = cc.total;
  p.costBasis = o.owner.kind === 'company' ? price + cc.total : price;
  p.carrying = o.owner.kind === 'company' ? price + cc.total : price;
  p.listedForRent = !p.lease && p.type !== 'terreno';
  p.vacantSince = p.lease ? null : state.day;
  p.nextTaxDay = nextTaxDay(state.day);
  p.nextTaxAmount = roundCents((p.appraisal * jurisdictionById(p.jurisdiction).propertyTaxRate) / 4);
  if (quote && f && loan > 0) {
    const bank = MORTGAGE_BANK_BY_ID[f.bankId];
    const m: Mortgage = {
      id: state.meta.nextId++, propertyId: p.id, owner: o.owner, bankId: f.bankId, principal: loan, balance: loan, apr: quote.apr, rateType: f.rateType,
      spread: f.rateType === 'fija' ? 0 : bank.variableSpread, termMonths: f.years * 12, payment: quote.payment, startDay: state.day, nextDueDay: addMonths(state.day, 1),
      paymentsMade: 0, missed: 0, interestPaid: 0, recourse: jurisdictionById(p.jurisdiction).mortgageRecourse, status: 'activa',
    };
    re.mortgages.push(m);
    p.mortgageId = m.id;
  }
  re.properties.push(p);
  re.listings = re.listings.filter((x) => x.id !== listingId);
  if (repair > 0) {
    ownerExpense(state, p, 'expense', repair, `Reparación del vicio oculto de ${p.name}`);
    p.hiddenDefect = null;
  }
  practice(state, 'buy_property', 'realEstate', 200);
  addLog(state, 'success', '🏠', `${o.owner.kind === 'personal' ? 'Compraste' : `${ownerLabel(state, o.owner)} compró`} ${p.name} por ${fmtMoney(price)}${loan ? ` con una hipoteca de ${fmtMoney(loan)}` : ''}${repair ? ` y pagaste ${fmtMoney(repair)} para reparar el vicio oculto` : ''}.`, cashNeeded + repair);
  return OK(`Compra escriturada: ${p.name}. Pagaste ${fmtMoney(cashNeeded + repair)} en total${repair ? ' (incluye la reparación del vicio oculto)' : ''}.`);
}

/** Venta: rápida (QUICK_SALE_RATIO de la tasación, inmediata) o publicada a un precio (espera comprador). */
export function sellProperty(state: GameState, id: number, mode: 'rapida' | 'publicar' | 'retirar', price?: Cents): ActionResult {
  const p = state.realEstate.properties.find((x) => x.id === id);
  if (!p) return FAIL('Inmueble inexistente.');
  if (mode === 'retirar') {
    p.forSale = null;
    return OK('Retiraste el inmueble de la venta.');
  }
  if (p.development) return FAIL('No se puede vender con la obra en curso.');
  if (mode === 'publicar') {
    if (!price || !Number.isSafeInteger(price) || price <= 0) return FAIL('Indicá el precio de venta.');
    p.forSale = { price, since: state.day };
    return OK(`Publicaste ${p.name} a ${fmtMoney(price)} (${fmtPct(price / p.appraisal - 1, 0)} frente a la tasación). Cuanto más cerca de la tasación, más rápido se vende.`);
  }
  return completeSale(state, p, quickSalePrice(p), 'rapida');
}

function completeSale(state: GameState, p: Property, price: Cents, how: 'rapida' | 'mercado'): ActionResult {
  const commission = roundCents(price * SALE_COMMISSION);
  const m = state.realEstate.mortgages.find((x) => x.id === p.mortgageId && x.status === 'activa');
  const payoff = m ? m.balance : 0;
  const net = price - commission - payoff;
  if (p.owner.kind === 'personal') {
    if (net < 0 && !canPayFromChecking(state, -net)) {
      if (how === 'mercado') {
        p.forSale = null;
        addLog(state, 'warning', '🏷️', `Apareció un comprador para ${p.name}, pero el precio no cubre la hipoteca y no tenés fondos para la diferencia.`);
      }
      return FAIL(`La venta no alcanza para cancelar la hipoteca (faltan ${fmtMoney(-net)}).`);
    }
    revaluePersonalProperties(state);
    const carrying = p.carrying;
    const unreal = carrying - p.costBasis;
    const realized = price - p.costBasis;
    post(state.ledger, {
      day: state.day, memo: `Venta de ${p.name}`, cf: 'investing', tag: 'property:sell',
      lines: [
        ...(net > 0 ? [{ account: 'checking' as const, debit: net }] : []),
        ...(net < 0 ? [{ account: 'checking' as const, credit: -net }] : []),
        { account: 'acquisition_costs', debit: commission },
        ...(payoff ? [{ account: 'mortgages' as const, debit: payoff }] : []),
        { account: 'real_estate', credit: carrying },
        ...(unreal > 0 ? [{ account: 'unrealized_gains' as const, debit: unreal }] : []),
        ...(unreal < 0 ? [{ account: 'unrealized_gains' as const, credit: -unreal }] : []),
        ...(realized > 0 ? [{ account: 'realized_gains' as const, credit: realized }] : []),
        ...(realized < 0 ? [{ account: 'realized_gains' as const, debit: -realized }] : []),
      ],
    });
    addGain(state, p, realized - commission);
  } else if (p.owner.kind === 'company') {
    const co = ownerCompany(state, p.owner);
    if (!co) return FAIL('Empresa inexistente.');
    if (net < 0 && co.ledger.balances.cash < -net) return FAIL('La empresa no tiene caja para cubrir la hipoteca restante.');
    const gain = price - p.carrying;
    coPost(co.ledger, {
      day: state.day, memo: `Venta de ${p.name}`, cf: 'investing', tag: 'property:sell',
      lines: [
        ...(net > 0 ? [{ account: 'cash' as const, debit: net }] : []),
        ...(net < 0 ? [{ account: 'cash' as const, credit: -net }] : []),
        { account: 'property_costs', debit: commission },
        ...(payoff ? [{ account: 'mortgages' as const, debit: payoff }] : []),
        { account: 'real_estate', credit: p.carrying },
        ...(gain > 0 ? [{ account: 'gain_on_sale' as const, credit: gain }] : []),
        ...(gain < 0 ? [{ account: 'gain_on_sale' as const, debit: -gain }] : []),
      ],
    });
  }
  if (m) {
    m.balance = 0;
    m.status = 'pagada';
  }
  removeProperty(state, p);
  practice(state, 'sell_property', 'realEstate', 150);
  addLog(state, 'success', '🏷️', `Vendiste ${p.name} por ${fmtMoney(price)} (comisión ${fmtMoney(commission)}${payoff ? `, hipoteca cancelada ${fmtMoney(payoff)}` : ''}).`, Math.max(0, net));
  return OK(`Venta concretada por ${fmtMoney(price)}.`);
}

// ------------------------------------------------------------ Gestión

export function setRent(state: GameState, id: number, rent: Cents, listed = true): ActionResult {
  const p = state.realEstate.properties.find((x) => x.id === id);
  if (!p) return FAIL('Inmueble inexistente.');
  if (p.usedBy !== null) return FAIL('El inmueble está en uso propio.');
  if (!(rent > 0)) return FAIL('Indicá un alquiler mayor a cero.');
  p.askingRent = rent;
  p.listedForRent = listed;
  const mr = marketRent(state, p);
  return OK(`Alquiler pedido: ${fmtMoney(rent)} (mercado: ${fmtMoney(mr)}). ${rent > mr * 1.1 ? 'Por encima del mercado: puede tardar en alquilarse.' : ''}`);
}

export function setManagement(state: GameState, id: number, mode: 'propia' | 'agencia'): ActionResult {
  const p = state.realEstate.properties.find((x) => x.id === id);
  if (!p) return FAIL('Inmueble inexistente.');
  p.management = mode;
  return OK(mode === 'agencia' ? 'Una inmobiliaria administra el inmueble: cobra 8 % del alquiler y consigue inquilinos 50 % más rápido.' : 'Administrás el inmueble vos mismo.');
}

export function renovate(state: GameState, id: number, level: 'ligera' | 'integral'): ActionResult {
  const p = state.realEstate.properties.find((x) => x.id === id);
  if (!p) return FAIL('Inmueble inexistente.');
  if (p.type === 'terreno') return FAIL('Un terreno no se renueva: se puede desarrollar.');
  if (p.renovation) return FAIL('Ya hay una obra en curso.');
  if (level === 'integral' && (p.lease || p.usedBy !== null)) return FAIL('La renovación integral requiere el inmueble desocupado.');
  const rate = level === 'ligera' ? 0.04 : 0.12;
  const cost = roundCents(p.appraisal * rate);
  const months = level === 'ligera' ? 1 : 3;
  if (ownerCash(state, p.owner) < cost) return FAIL(`La obra cuesta ${fmtMoney(cost)}.`);
  capex(state, p, cost, `Renovación ${level} de ${p.name}`);
  p.renovation = { until: addMonths(state.day, months), cost, conditionGain: level === 'ligera' ? 15 : 100, valueGain: level === 'ligera' ? 0 : 1 };
  practice(state, 'renovate', 'realEstate', 60);
  return OK(`Obra iniciada: termina el ${formatDate(p.renovation.until)}.`);
}

/** Inversión de capital en un inmueble (aumenta su costo y su valor contable). */
function capex(state: GameState, p: Property, cost: Cents, memo: string): void {
  if (p.owner.kind === 'personal') {
    canPayFromChecking(state, cost);
    post(state.ledger, { day: state.day, memo, cf: 'investing', tag: 'property:capex', lines: [{ account: 'real_estate', debit: cost }, { account: 'checking', credit: cost }] });
  } else {
    const co = ownerCompany(state, p.owner);
    if (co) coPost(co.ledger, { day: state.day, memo, cf: 'investing', tag: 'property:capex', lines: [{ account: 'real_estate', debit: cost }, { account: 'cash', credit: cost }] });
  }
  p.costBasis += cost;
  p.carrying += cost;
}

function finishRenovation(state: GameState, p: Property): void {
  const r = p.renovation!;
  p.condition = r.conditionGain >= 100 ? 100 : clamp(p.condition + r.conditionGain, 0, 100);
  if (r.valueGain) p.grade = Math.min(5, p.grade + 1);
  p.renovation = null;
  p.appraisal = appraise(state, p);
  p.askingRent = marketRent(state, p);
  if (p.owner.kind !== 'mogul') addLog(state, 'success', '🛠️', `Terminó la renovación de ${p.name}. Nueva tasación: ${fmtMoney(p.appraisal)}.`);
}

export function developLand(state: GameState, id: number, to: Exclude<PropertyType, 'terreno'>): ActionResult {
  const p = state.realEstate.properties.find((x) => x.id === id);
  if (!p) return FAIL('Inmueble inexistente.');
  if (p.type !== 'terreno') return FAIL('Solo se puede construir sobre un terreno.');
  if (p.development) return FAIL('Ya hay una obra en curso.');
  const built = Math.round(p.m2 * 0.8);
  const cost = roundCents(built * BUILD_COST[to] * state.macro.priceIndex * 100);
  if (ownerCash(state, p.owner) < cost) return FAIL(`La construcción de ${built} m² cuesta ${fmtMoney(cost)}.`);
  capex(state, p, cost, `Construcción de ${PROPERTY_TYPE_NAMES[to].toLowerCase()} en ${p.name}`);
  p.development = { until: addMonths(state.day, randInt(state, 9, 15)), cost, to, m2: built };
  p.lease = null;
  p.listedForRent = false;
  practice(state, 'develop', 'realEstate', 300);
  return OK(`Obra iniciada: ${built} m² de ${PROPERTY_TYPE_NAMES[to].toLowerCase()}. Termina alrededor del ${formatDate(p.development.until)}.`);
}

function finishDevelopment(state: GameState, p: Property): void {
  const d = p.development!;
  const landValue = appraise(state, p);
  p.type = d.to;
  p.m2 = d.m2;
  p.condition = 100;
  p.development = null;
  p.appraisal = appraise(state, p);
  p.landShare = clamp(landValue / Math.max(1, p.appraisal), 0.1, 0.6);
  p.askingRent = marketRent(state, p);
  p.listedForRent = p.usedBy === null;
  p.vacantSince = state.day;
  if (p.owner.kind !== 'mogul') addLog(state, 'success', '🏗️', `Terminó la obra en ${p.name}: ahora es ${PROPERTY_TYPE_NAMES[p.type].toLowerCase()} de ${p.m2} m², tasada en ${fmtMoney(p.appraisal)}.`);
}

/** Uso propio: vivienda del jugador (deja de pagar alquiler) o local de una empresa. */
export function setUse(state: GameState, id: number, use: 'jugador' | number | null): ActionResult {
  const p = state.realEstate.properties.find((x) => x.id === id);
  if (!p) return FAIL('Inmueble inexistente.');
  if (use !== null && p.lease) return FAIL('El inmueble tiene inquilino: esperá a que termine el contrato.');
  if (use === 'jugador') {
    if (p.owner.kind !== 'personal' || p.type !== 'vivienda') return FAIL('Solo podés vivir en una vivienda que sea tuya a título personal.');
    if (jurisdictionById(p.jurisdiction).id !== state.tax.jurisdiction) return FAIL('La vivienda está en otro país: para vivir allí, primero mudá tu residencia fiscal.');
    for (const x of state.realEstate.properties) if (x.usedBy === 'jugador') x.usedBy = null;
  } else if (typeof use === 'number') {
    const co = state.companies.find((c) => c.id === use);
    if (!co) return FAIL('Empresa inexistente.');
    if (p.owner.kind !== 'company' || p.owner.id !== use) return FAIL('La empresa solo puede usar como local un inmueble que sea suyo.');
    const need: PropertyType = co.sector === 'saas' || co.sector === 'consultora' || co.sector === 'holding' ? 'oficina' : 'local';
    if (p.type !== need) return FAIL(`Para ${co.name} hace falta un inmueble de tipo ${PROPERTY_TYPE_NAMES[need].toLowerCase()}.`);
    for (const x of state.realEstate.properties) if (x.usedBy === use) x.usedBy = null;
  }
  p.usedBy = use;
  p.listedForRent = use === null && p.type !== 'terreno';
  applyHomeRent(state);
  if (use === 'jugador') return OK(`Te mudaste a ${p.name}: dejás de pagar alquiler (seguís pagando mantenimiento, impuesto e hipoteca).`);
  if (typeof use === 'number') return OK(`${p.name} es ahora el local propio de la empresa: deja de pagar alquiler.`);
  return OK('El inmueble quedó disponible para alquilar.');
}

export function prepayMortgage(state: GameState, id: number, amount: Cents): ActionResult {
  const m = state.realEstate.mortgages.find((x) => x.id === id && x.status === 'activa');
  if (!m) return FAIL('Hipoteca inexistente.');
  const pay = Math.min(amount, m.balance);
  if (!(pay > 0)) return FAIL('Monto inválido.');
  if (m.owner.kind === 'personal') {
    if (!canPayFromChecking(state, pay)) return FAIL('Fondos insuficientes.');
    post(state.ledger, { day: state.day, memo: 'Amortización anticipada de hipoteca', cf: 'financing', tag: 'mortgage:prepay', lines: [{ account: 'mortgages', debit: pay }, { account: 'checking', credit: pay }] });
  } else {
    const co = ownerCompany(state, m.owner);
    if (!co || co.ledger.balances.cash < pay) return FAIL('La empresa no tiene caja suficiente.');
    coPost(co.ledger, { day: state.day, memo: 'Amortización anticipada de hipoteca', cf: 'financing', tag: 'mortgage:prepay', lines: [{ account: 'mortgages', debit: pay }, { account: 'cash', credit: pay }] });
  }
  m.balance -= pay;
  if (m.balance <= 0) {
    m.status = 'pagada';
    const p = state.realEstate.properties.find((x) => x.id === m.propertyId);
    if (p) p.mortgageId = null;
    return OK('¡Hipoteca cancelada por completo!');
  }
  m.payment = amortizedPayment(m.balance, m.apr, Math.max(1, m.termMonths - m.paymentsMade));
  return OK(`Amortizaste ${fmtMoney(pay)}. Nueva cuota: ${fmtMoney(m.payment)}.`);
}

// ------------------------------------------------------------ Informes

export interface PropertyReport {
  value: Cents;
  equity: Cents;
  debt: Cents;
  marketRent: Cents;
  grossYield: number;
  netYield: number;
  cashOnCash: number | null;
  capRate: number;
  occupancy: number;
  totalReturn: number;
  annualNoi: Cents;
  annualDebtService: Cents;
  monthlyCashFlow: Cents;
  gainSincePurchase: Cents;
}

/** Rentabilidad de un inmueble con sus propios datos (últimos 12 meses o proyección si no hay historia). */
export function propertyReport(state: GameState, p: Property): PropertyReport {
  const m = state.realEstate.mortgages.find((x) => x.id === p.mortgageId && x.status === 'activa');
  const debt = m?.balance ?? 0;
  const last = p.monthly.slice(-12);
  const months = last.length;
  const econ = monthlyEconomics(state, p);
  const rentAnnual = months ? roundCents(last.reduce((s, x) => s + x.rent, 0) * (12 / months)) : econ.rent * 12;
  const expAnnual = months ? roundCents(last.reduce((s, x) => s + x.expenses + x.tax, 0) * (12 / months)) : (econ.maintenance + econ.agency + econ.tax) * 12;
  const noi = rentAnnual - expAnnual;
  const service = m ? m.payment * 12 : 0;
  const invested = Math.max(1, p.purchasePrice - (m?.principal ?? 0) + p.closingCosts + (p.costBasis - p.purchasePrice - (p.owner.kind === 'company' ? p.closingCosts : 0)));
  const occ = months ? last.filter((x) => x.occupied).length / months : p.lease ? 1 : 0;
  const cum = p.totals.rent - p.totals.expenses - p.totals.tax - p.totals.interest;
  return {
    value: p.appraisal, equity: p.appraisal - debt, debt, marketRent: marketRent(state, p),
    grossYield: p.appraisal > 0 ? rentAnnual / p.appraisal : 0, netYield: p.appraisal > 0 ? noi / p.appraisal : 0,
    cashOnCash: m ? (noi - service) / invested : noi / invested, capRate: p.appraisal > 0 ? noi / p.appraisal : 0, occupancy: occ,
    totalReturn: (p.appraisal - p.costBasis + cum) / invested, annualNoi: noi, annualDebtService: service, monthlyCashFlow: roundCents((noi - service) / 12),
    gainSincePurchase: p.appraisal - p.costBasis,
  };
}

