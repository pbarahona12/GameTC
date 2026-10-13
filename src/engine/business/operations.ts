import type { GameState } from '../state';
import { locales, presence, citiesOf, CITY_MARKET } from './locations';
import type { JurisdictionId } from '../../content/jurisdictions';
import type { Company, DayStats } from './types';
import { sectorOf, px, coLog, coPay, capacity, computeQuality, countRole, workingAssets, equipDef, isOpen, premisesBase } from './common';
import { coPost } from './companyLedger';
import { attractiveness, rivalsAttraction, demandFactor } from './market';
import { cityDemand } from '../economy/economy';
import { takeFifo, onHand, receiveOrders, payDuePayables, expireLots, runReorderRules, monthlyStorage } from './inventory';
import { dailyMarketing, promoActive, loyaltyActive } from './marketing';
import { dailyStaff } from './staff';
import { Cents, clamp, roundCents } from '../money';
import { chance, nextRandom, randInt } from '../rng';
import type { ProductDef, SectorDef } from '../../content/sectors';
import { ActionResult, FAIL, OK } from '../result';
import { fmtMoney } from '../format';

/** Redondeo estocástico: 3,4 unidades → 3 con 60 % y 4 con 40 %. */
function stochasticRound(state: GameState, x: number): number {
  const f = Math.floor(x);
  return f + (nextRandom(state) < x - f ? 1 : 0);
}

export function refPrice(state: GameState, p: ProductDef): Cents {
  return px(state, p.refPrice);
}

export function effectivePrice(state: GameState, co: Company, productId: string): Cents {
  const ps = co.products.find((p) => p.id === productId)!;
  return promoActive(state, co) ? roundCents(ps.price * 0.9) : ps.price;
}

export function salesBonus(state: GameState, co: Company): number {
  let b = Math.min(0.24, countRole(co, 'vendedor') * 0.08);
  if (promoActive(state, co)) b += 0.15;
  if (loyaltyActive(state, co)) b += 0.05;
  return b;
}

/** Atractivo de la empresa para un producto a un precio dado. */
export function companyAttraction(state: GameState, co: Company, p: ProductDef, price: Cents): number {
  const ratio = price / Math.max(1, refPrice(state, p));
  return attractiveness(ratio, co.quality, co.reputation, co.awareness, p.elasticity, salesBonus(state, co));
}

/**
 * Cuota esperada del producto (0–1) en UNA ciudad, frente a rivales IA y a tus otras
 * empresas del rubro que tengan locales ahí (1.6, ver locations.ts).
 */
export function cityShare(state: GameState, co: Company, p: ProductDef, price: Cents, city: JurisdictionId, day = state.day): number {
  const n = locales(co, day)[city] ?? 0;
  if (!n) return 0;
  const market = state.markets[co.sector];
  const { rivals, outside } = rivalsAttraction(market, p.elasticity);
  let own = 0;
  for (const other of state.companies) {
    if (other.id === co.id || other.sector !== co.sector || !isOpen(other)) continue;
    const m = locales(other, day)[city] ?? 0;
    if (!m) continue;
    const op = other.products.find((x) => x.id === p.id);
    if (op?.active) own += companyAttraction(state, other, p, effectivePrice(state, other, p.id)) * presence(m);
  }
  const a = companyAttraction(state, co, p, price) * presence(n);
  return a / (a + rivals + outside + own);
}

/**
 * Cuota esperada ponderada por el mercado de cada ciudad donde vende la empresa
 * (multiplica la demanda de la capital). Con solo el local principal es la cuota de
 * siempre (0–1); con sucursales puede superar 1 (vende en más de un mercado).
 */
export function expectedShare(state: GameState, co: Company, p: ProductDef, price: Cents, day = state.day): number {
  let s = 0;
  for (const city of citiesOf(co, day)) s += CITY_MARKET[city] * cityDemand(state, city) * cityShare(state, co, p, price, city, day);
  return s;
}

/** Demanda esperada (sin ruido) para un producto en un día. */
export function expectedDemand(state: GameState, co: Company, p: ProductDef, price: Cents, day = state.day): number {
  const sec = sectorOf(co);
  return p.marketDaily * demandFactor(state, sec, day) * expectedShare(state, co, p, price, day);
}

function recordStats(co: Company, s: DayStats): void {
  co.stats.push(s);
  if (co.stats.length > 90) co.stats.splice(0, co.stats.length - 90);
}

function consumeRecipe(co: Company, p: ProductDef, units: number): { cost: Cents; quality: number } {
  let cost = 0;
  let q = 0;
  let n = 0;
  for (const r of p.recipe) {
    const t = takeFifo(co.inventory, r.item, r.qty * units);
    cost += t.cost;
    if (t.taken > 0) {
      q += t.quality;
      n++;
    }
  }
  return { cost, quality: n ? q / n : 0 };
}

function maxUnitsByMaterials(co: Company, p: ProductDef): number {
  let max = Infinity;
  for (const r of p.recipe) max = Math.min(max, onHand(co, r.item) / r.qty);
  return max === Infinity ? 0 : Math.floor(max + 1e-9);
}

function logisticsCut(state: GameState, co: Company): number {
  let c = 0;
  for (const a of workingAssets(state, co)) c = Math.max(c, equipDef(co, a.equipId).logisticsCut ?? 0);
  return c;
}

function shrinkageFactor(state: GameState, co: Company): number {
  let cut = 0;
  for (const a of workingAssets(state, co)) cut += equipDef(co, a.equipId).shrinkageCut ?? 0;
  if (countRole(co, 'contador') > 0) cut += 0.2;
  return Math.max(0, 1 - Math.min(0.85, cut));
}

/**
 * Operación diaria: demanda → producción/servicio → ventas → costos.
 * Toda venta se registra en el libro de la empresa en un único asiento diario.
 */
export function operateDay(state: GameState, co: Company): void {
  const sec = sectorOf(co);
  co.quality = computeQuality(state, co);
  const cap = capacity(state, co);
  const stats: DayStats = { day: state.day, demand: {}, sold: {}, lost: {}, used: {}, revenue: 0, capacityUsed: 0, capacity: 0, serviceUsed: 0, serviceCapacity: 0, lostReason: '' };
  const noise = () => 0.85 + nextRandom(state) * 0.3;
  const demand: Record<string, number> = {};
  for (const ps of co.products) {
    const p = sec.products.find((x) => x.id === ps.id)!;
    demand[p.id] = ps.active ? expectedDemand(state, co, p, effectivePrice(state, co, p.id)) * noise() : 0;
    stats.demand[p.id] = demand[p.id];
  }
  let revenueCash = 0;
  let revenueCredit = 0;
  let cogs = 0;
  let unitsSold = 0;
  const reasons = new Set<string>();

  const sell = (p: ProductDef, units: number) => {
    const price = effectivePrice(state, co, p.id);
    const r = price * units;
    if (sec.receivableDays > 0) revenueCredit += r;
    else revenueCash += r;
    stats.sold[p.id] = (stats.sold[p.id] ?? 0) + units;
    unitsSold += units;
  };

  if (sec.model === 'food_service' || sec.model === 'retail') {
    const labor = sec.products.reduce((s, p) => s + (demand[p.id] ?? 0) * p.laborUnits, 0);
    const service = sec.products.reduce((s, p) => s + (demand[p.id] ?? 0), 0);
    let scale = 1;
    if (labor > 0 && cap.production < labor) { scale = Math.min(scale, cap.production / labor); reasons.add('capacidad de producción'); }
    if (service > 0 && cap.service < service) { scale = Math.min(scale, cap.service / service); reasons.add('capacidad de atención'); }
    stats.capacity = cap.production;
    stats.serviceCapacity = cap.service;
    for (const p of sec.products) {
      const d = demand[p.id] ?? 0;
      if (d <= 0) continue;
      let want = stochasticRound(state, d * scale);
      const byMat = maxUnitsByMaterials(co, p);
      if (want > byMat) { want = byMat; reasons.add(`falta de ${p.recipe.map((r) => r.item).join('/')}`); }
      if (want > 0) {
        const c = consumeRecipe(co, p, want);
        cogs += c.cost;
        for (const r of p.recipe) stats.used[r.item] = (stats.used[r.item] ?? 0) + r.qty * want;
        sell(p, want);
      }
      stats.lost[p.id] = Math.max(0, d - want);
      stats.capacityUsed += want * p.laborUnits;
      stats.serviceUsed += want;
    }
    // Mermas por robo y errores (sobre lo vendido).
    if (sec.shrinkage > 0 && unitsSold > 0) {
      let shrinkCost = 0;
      const f = sec.shrinkage * shrinkageFactor(state, co);
      for (const p of sec.products) {
        const s = stats.sold[p.id] ?? 0;
        if (!s) continue;
        for (const r of p.recipe) {
          const t = takeFifo(co.inventory, r.item, s * r.qty * f);
          shrinkCost += t.cost;
        }
      }
      if (shrinkCost > 0) coPost(co.ledger, { day: state.day, memo: 'Mermas por robo y errores', cf: 'internal', tag: 'shrinkage', lines: [{ account: 'waste', debit: shrinkCost }, { account: 'inventory', credit: shrinkCost }] });
    }
  } else if (sec.model === 'manufacturing') {
    // 1) Producción según el plan, limitada por capacidad e insumos.
    let capLeft = cap.production;
    stats.capacity = cap.production;
    for (const ps of co.products) {
      const p = sec.products.find((x) => x.id === ps.id)!;
      if (ps.plan <= 0) continue;
      let units = Math.min(ps.plan, Math.floor(capLeft / p.laborUnits + 1e-9));
      if (units < ps.plan) reasons.add('capacidad de producción');
      const byMat = maxUnitsByMaterials(co, p);
      if (units > byMat) { units = byMat; reasons.add('falta de insumos'); }
      if (units <= 0) continue;
      const c = consumeRecipe(co, p, units);
      for (const r of p.recipe) stats.used[r.item] = (stats.used[r.item] ?? 0) + r.qty * units;
      ps.finished.push({ item: p.id, qty: units, unitCost: roundCents(c.cost / units), value: c.cost, expires: null, quality: co.quality });
      capLeft -= units * p.laborUnits;
      stats.capacityUsed += units * p.laborUnits;
    }
    // 2) Ventas desde producto terminado.
    for (const ps of co.products) {
      const p = sec.products.find((x) => x.id === ps.id)!;
      const d = demand[p.id] ?? 0;
      if (d <= 0) continue;
      let want = stochasticRound(state, d);
      const stock = Math.floor(ps.finished.reduce((s, l) => s + l.qty, 0) + 1e-9);
      if (want > stock) { want = stock; reasons.add('sin stock de producto terminado'); }
      if (want > 0) {
        const t = takeFifo(ps.finished, p.id, want);
        cogs += t.cost;
        sell(p, want);
      }
      stats.lost[p.id] = Math.max(0, d - want);
    }
  } else if (sec.model === 'subscription') {
    const p = sec.products[0];
    const signups = demand[p.id] ?? 0;
    const support = 1 - Math.min(0.6, countRole(co, 'soporte') * 0.25);
    const ps = co.products[0];
    const priceFactor = Math.sqrt(Math.max(0.3, ps.price / refPrice(state, p)));
    const churnM = (sec.baseChurn ?? 0.05) * (1.6 - co.quality / 100) * support * (loyaltyActive(state, co) ? 0.7 : 1) * priceFactor;
    const churned = co.subscribers * (churnM / 30);
    co.subscribers = Math.max(0, co.subscribers + signups - churned);
    stats.sold[p.id] = signups;
    stats.lost[p.id] = churned;
    stats.capacity = cap.users;
    stats.capacityUsed = co.subscribers;
    if (co.subscribers > cap.users) reasons.add('servidores y equipo saturados');
    revenueCash += roundCents((co.subscribers * effectivePrice(state, co, p.id)) / 30);
  } else if (sec.model === 'services') {
    const p = sec.products[0];
    const d = demand[p.id] ?? 0;
    const hours = Math.min(d, cap.hours);
    if (hours < d) reasons.add('horas de consultores');
    const billed = Math.round(hours * 10) / 10;
    revenueCredit += roundCents(billed * effectivePrice(state, co, p.id));
    stats.sold[p.id] = billed;
    stats.lost[p.id] = Math.max(0, d - billed);
    stats.capacity = cap.hours;
    stats.capacityUsed = billed;
  }

  const revenue = revenueCash + revenueCredit;
  stats.revenue = revenue;
  stats.lostReason = [...reasons].join(', ');
  if (revenue > 0 || cogs > 0) {
    const lines: Array<{ account: 'cash' | 'receivables' | 'sales' | 'cogs' | 'inventory'; debit?: Cents; credit?: Cents }> = [];
    if (revenueCash) lines.push({ account: 'cash', debit: revenueCash });
    if (revenueCredit) lines.push({ account: 'receivables', debit: revenueCredit });
    if (revenue) lines.push({ account: 'sales', credit: revenue });
    if (cogs) {
      lines.push({ account: 'cogs', debit: cogs });
      lines.push({ account: 'inventory', credit: cogs });
    }
    coPost(co.ledger, { day: state.day, memo: 'Ventas del día', cf: 'operating', tag: 'sales', lines });
    if (revenueCredit) {
      const days = Math.max(10, sec.receivableDays - (countRole(co, 'contador') > 0 ? 7 : 0));
      co.receivables.push({ id: state.meta.nextId++, amount: revenueCredit, dueDay: state.day + days });
    }
  }
  // Costos variables directos y comisiones de cobro.
  const variable = sec.model === 'subscription'
    ? roundCents((co.subscribers * px(state, sec.variableCost)) / 30)
    : roundCents(unitsSold * px(state, sec.variableCost) * (1 - logisticsCut(state, co)));
  if (variable > 0) coPay(state, co, 'variable_costs', variable, { memo: sec.variableCostLabel, tag: 'variable', kind: 'otros' });
  const fees = roundCents(revenue * sec.salesFeeRate * (countRole(co, 'contador') > 0 ? 0.85 : 1));
  if (fees > 0) coPay(state, co, 'sales_fees', fees, { memo: 'Comisiones de cobro con tarjeta', tag: 'fees', kind: 'otros' });

  recordStats(co, stats);
}

export function collectReceivables(state: GameState, co: Company): void {
  const badP = 0.015 * (countRole(co, 'contador') > 0 ? 0.4 : 1);
  for (const r of [...co.receivables]) {
    if (r.dueDay > state.day) continue;
    if (chance(state, badP)) {
      coPost(co.ledger, { day: state.day, memo: 'Cliente incobrable', cf: 'internal', tag: 'baddebt', lines: [{ account: 'bad_debts', debit: r.amount }, { account: 'receivables', credit: r.amount }] });
      coLog(state, co, 'warning', '🧾', `un cliente no pagó su factura: ${fmtMoney(r.amount)} incobrables.`, r.amount);
    } else {
      coPost(co.ledger, { day: state.day, memo: 'Cobro a clientes', cf: 'operating', tag: 'collection', lines: [{ account: 'cash', debit: r.amount }, { account: 'receivables', credit: r.amount }] });
    }
    co.receivables = co.receivables.filter((x) => x.id !== r.id);
  }
}

/** Averías: la probabilidad crece cuando la condición del equipo es baja. */
export function equipmentDay(state: GameState, co: Company): void {
  for (const a of co.assets) {
    if (a.brokenUntil > state.day) continue;
    const p = a.condition < 50 ? (50 - a.condition) / 1500 : 0.0004;
    if (chance(state, p)) {
      const def = equipDef(co, a.equipId);
      a.brokenUntil = state.day + randInt(state, 3, 7);
      const repair = roundCents(a.cost * 0.08);
      coPay(state, co, 'maintenance', repair, { memo: `Reparación de ${def.name}`, tag: 'repair', kind: 'otros' });
      a.condition = Math.min(100, a.condition + 25);
      coLog(state, co, 'warning', '🔧', `se averió ${def.name}: fuera de servicio ${a.brokenUntil - state.day} días. Reparación ${fmtMoney(repair)}.`, repair);
    }
  }
}

export function reputationDay(_state: GameState, co: Company): void {
  const recent = co.stats.slice(-14);
  let d = 0;
  let s = 0;
  for (const x of recent) for (const k of Object.keys(x.demand)) { d += x.demand[k]; s += x.sold[k] ?? 0; }
  const sec = sectorOf(co);
  const service = sec.model === 'subscription' ? 1 : d > 0 ? s / d : 1;
  const target = co.quality * 0.7 + service * 30 + Math.min(9, countRole(co, 'soporte') * 3);
  co.reputation = clamp(co.reputation + (target - co.reputation) * 0.01, 0, 100);
  const rd = countRole(co, 'investigador');
  if (rd > 0) co.rdBonus = Math.min(15, co.rdBonus + 0.05 * rd);
}

/** Costos fijos del día 1 de cada mes. */
export function monthStartCosts(state: GameState, co: Company, _sec: SectorDef, adminFee: Cents, maintenance: Cents): void {
  // Si la empresa usa un inmueble propio como local, no paga alquiler (paga mantenimiento e impuesto del inmueble).
  const ownPremises = (state.realEstate?.properties ?? []).some((p) => p.usedBy === co.id);
  const pb = premisesBase(state, co);
  if (!ownPremises) coPay(state, co, 'rent', px(state, pb.rent), { memo: co.sector === 'holding' ? 'Oficina y domicilio legal' : 'Alquiler del local', tag: 'rent', kind: 'alquiler' });
  if (pb.branchRent > 0) coPay(state, co, 'rent', px(state, pb.branchRent), { memo: `Alquiler de ${co.branches!.length === 1 ? 'la sucursal' : `${co.branches!.length} sucursales`}`, tag: 'rent', kind: 'alquiler' });
  coPay(state, co, 'utilities', px(state, pb.utilities), { memo: 'Servicios (energía, agua, internet)', tag: 'utilities', kind: 'otros' });
  if (adminFee > 0) coPay(state, co, 'admin', adminFee, { memo: 'Administración legal y contable de la sociedad', tag: 'admin', kind: 'otros' });
  if (maintenance > 0) coPay(state, co, 'maintenance', maintenance, { memo: 'Mantenimiento de equipos', tag: 'maintenance', kind: 'otros' });
}

export function dailyOperations(state: GameState, co: Company): void {
  receiveOrders(state, co);
  payDuePayables(state, co);
  collectReceivables(state, co);
  expireLots(state, co);
  dailyStaff(state, co);
  equipmentDay(state, co);
  operateDay(state, co);
  dailyMarketing(state, co);
  reputationDay(state, co);
  runReorderRules(state, co);
}

export { monthlyStorage };

// -------------------------------------------------------------- Acciones

export function setPrice(state: GameState, co: Company, productId: string, price: Cents): ActionResult {
  const ps = co.products.find((p) => p.id === productId);
  if (!ps) return FAIL('Producto inexistente.');
  if (!(price > 0)) return FAIL('El precio debe ser mayor a cero.');
  const p = sectorOf(co).products.find((x) => x.id === productId)!;
  if (price > refPrice(state, p) * 4) return FAIL('Precio demasiado alto: nadie compraría a más de 4 veces el precio de referencia.');
  ps.price = price;
  return OK(`Nuevo precio de ${p.name}: ${fmtMoney(price)}.`);
}

export function setPlan(_state: GameState, co: Company, productId: string, plan: number): ActionResult {
  const ps = co.products.find((p) => p.id === productId);
  if (!ps) return FAIL('Producto inexistente.');
  if (!(plan >= 0 && plan <= 500)) return FAIL('Plan inválido.');
  ps.plan = Math.round(plan);
  return OK('Plan de producción actualizado.');
}

export function toggleProduct(_state: GameState, co: Company, productId: string, active: boolean): ActionResult {
  const ps = co.products.find((p) => p.id === productId);
  if (!ps) return FAIL('Producto inexistente.');
  ps.active = active;
  return OK(active ? 'Producto activado.' : 'Producto retirado de la venta.');
}

export function setMaintenance(_state: GameState, co: Company, level: Company['maintenance']): ActionResult {
  co.maintenance = level;
  return OK('Política de mantenimiento actualizada.');
}

export function buyEquipment(state: GameState, co: Company, equipId: string): ActionResult {
  const def = sectorOf(co).equipment.find((e) => e.id === equipId);
  if (!def) return FAIL('Equipo inexistente.');
  const cost = px(state, def.cost);
  if (co.ledger.balances.cash < cost) return FAIL(`${co.name} necesita ${fmtMoney(cost)} en caja.`);
  coPost(co.ledger, { day: state.day, memo: `Compra de ${def.name}`, cf: 'investing', tag: 'capex', lines: [{ account: 'fixed_assets', debit: cost }, { account: 'cash', credit: cost }] });
  co.assets.push({ id: state.meta.nextId++, equipId, cost, bookValue: cost, boughtDay: state.day, condition: 100, brokenUntil: state.day - 1 });
  return OK(`${def.name} comprado por ${fmtMoney(cost)}. Se depreciará en ${def.lifeMonths} meses.`);
}

export function sellEquipment(state: GameState, co: Company, assetId: number): ActionResult {
  const a = co.assets.find((x) => x.id === assetId);
  if (!a) return FAIL('Equipo inexistente.');
  if (a.bookValue <= 0) {
    // Totalmente amortizado: se da de baja sin asiento (no tiene valor en libros ni de reventa).
    co.assets = co.assets.filter((x) => x.id !== assetId);
    return OK(`${equipDef(co, a.equipId).name} dado de baja: ya estaba totalmente amortizado.`);
  }
  const price = roundCents(a.bookValue * 0.6 * (0.5 + a.condition / 200));
  const loss = a.bookValue - price;
  coPost(co.ledger, {
    day: state.day, memo: `Venta de ${equipDef(co, a.equipId).name} usado`, cf: 'investing', tag: 'asset_sale',
    lines: [{ account: 'cash', debit: price }, ...(loss > 0 ? [{ account: 'liquidation_loss' as const, debit: loss }] : []), { account: 'fixed_assets', credit: a.bookValue }],
  });
  co.assets = co.assets.filter((x) => x.id !== assetId);
  return OK(`Vendido por ${fmtMoney(price)} (pérdida contable ${fmtMoney(loss)}).`);
}

/** Depreciación lineal mensual y desgaste de los equipos. */
export function monthlyAssets(state: GameState, co: Company): void {
  let dep = 0;
  for (const a of co.assets) {
    const def = equipDef(co, a.equipId);
    const m = Math.min(a.bookValue, roundCents(a.cost / def.lifeMonths));
    a.bookValue -= m;
    dep += m;
    a.condition = clamp(a.condition + (co.maintenance === 'preventive' ? 0.5 : co.maintenance === 'basic' ? -2 : -5), 0, 100);
  }
  if (dep > 0) coPost(co.ledger, { day: state.day, memo: 'Depreciación mensual de equipos', cf: 'internal', tag: 'depreciation', lines: [{ account: 'depreciation', debit: dep }, { account: 'fixed_assets', credit: dep }] });
}
