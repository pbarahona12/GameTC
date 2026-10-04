import { supplierCostIndex } from '../economy/economy';
import { supplierShockMult } from '../world/rivals';
import type { GameState } from '../state';
import type { Company, Lot, PurchaseOrder } from './types';
import { sectorOf, px, coLog, countRole, workingAssets, equipDef, coPay } from './common';
import { coPost } from './companyLedger';
import { Cents, roundCents, usd } from '../money';
import { ActionResult, FAIL, OK } from '../result';
import { fmtMoney } from '../format';
import { chance, randInt } from '../rng';
import type { SupplierDef } from '../../content/sectors';
import { practice } from '../skills/skills';
import { dealDiscount } from '../saga/integration';

const EPS = 1e-9;

export function onHand(co: Company, item: string): number {
  let q = 0;
  for (const l of co.inventory) if (l.item === item) q += l.qty;
  return q;
}

export function inTransit(co: Company, item: string): number {
  return co.orders.filter((o) => o.item === item).reduce((s, o) => s + o.qty, 0);
}

export function inventoryValue(co: Company): Cents {
  let v = 0;
  for (const l of co.inventory) v += l.value;
  for (const p of co.products) for (const l of p.finished) v += l.value;
  return v;
}

/** Retira `qty` de una lista de lotes en orden FIFO. Devuelve el costo exacto retirado. */
export function takeFifo(lots: Lot[], item: string, qty: number): { cost: Cents; taken: number; quality: number } {
  let need = qty;
  let cost = 0;
  let qsum = 0;
  for (const l of lots) {
    if (need <= EPS) break;
    if (l.item !== item || l.qty <= EPS) continue;
    const q = Math.min(l.qty, need);
    const c = q >= l.qty - EPS ? l.value : roundCents((l.value * q) / l.qty);
    l.value -= c;
    l.qty -= q;
    if (l.qty <= EPS) {
      l.qty = 0;
      cost += l.value; // absorbe residuos de redondeo del lote
      l.value = 0;
    }
    cost += c;
    need -= q;
    qsum += q * l.quality;
  }
  const taken = qty - Math.max(0, need);
  for (let i = lots.length - 1; i >= 0; i--) if (lots[i].qty <= EPS && lots[i].value === 0) lots.splice(i, 1);
  return { cost, taken, quality: taken > 0 ? qsum / taken : 0 };
}

export function shelfLifeMult(state: GameState, co: Company): number {
  let m = 1;
  for (const a of workingAssets(state, co)) m = Math.max(m, equipDef(co, a.equipId).shelfLifeMult ?? 1);
  return m;
}

export function supplierFor(co: Company, supplierId: string): SupplierDef | undefined {
  return sectorOf(co).suppliers.find((s) => s.id === supplierId);
}

export function supplierUnitCost(state: GameState, s: SupplierDef, co?: Company): Cents {
  // 1.4: con un minimercado propio como proveedor, la cafetería paga menos sus insumos.
  return usd(s.unitCost * state.macro.priceIndex * supplierCostIndex(state) * supplierShockMult(state, s.id) * (1 - dealDiscount(state, co, 'insumos')));
}

export function leadDays(co: Company, s: SupplierDef): number {
  return Math.max(1, s.leadDays - (countRole(co, 'logistica') > 0 ? 1 : 0));
}

export function deliveryFee(state: GameState, co: Company, s: SupplierDef): Cents {
  const cut = countRole(co, 'logistica') > 0 ? 0.3 : 0;
  return roundCents(px(state, s.deliveryFee) * (1 - cut));
}

export function supplierAccessible(state: GameState, s: SupplierDef): boolean {
  return state.player.attributes.network >= (s.networkRequired ?? 0);
}

export function placeOrder(state: GameState, co: Company, supplierId: string, qty: number, silent = false): ActionResult {
  const s = supplierFor(co, supplierId);
  if (!s) return FAIL('Proveedor inexistente.');
  if (!supplierAccessible(state, s)) return FAIL(`Necesitás red de contactos ${s.networkRequired} para trabajar con ${s.name}.`);
  if (!(qty > 0) || !Number.isFinite(qty)) return FAIL('Cantidad inválida.');
  if (qty < s.minOrder) return FAIL(`Pedido mínimo de ${s.name}: ${s.minOrder}.`);
  const unit = supplierUnitCost(state, s, co);
  const total = roundCents(unit * qty);
  const fee = deliveryFee(state, co, s);
  const credit = s.paymentDays > 0 && !co.blockedSuppliers.includes(s.id);
  const needCash = (credit ? 0 : total) + fee;
  if (co.ledger.balances.cash < needCash) return FAIL(`${co.name} necesita ${fmtMoney(needCash)} en caja para este pedido${credit ? ' (flete)' : ''}.`);
  if (!credit) {
    coPost(co.ledger, { day: state.day, memo: `Pedido pagado a ${s.name}`, cf: 'operating', tag: 'purchase', lines: [{ account: 'in_transit', debit: total }, { account: 'cash', credit: total }] });
  }
  coPay(state, co, 'logistics', fee, { memo: `Flete de ${s.name}`, tag: 'freight', allowArrears: false });
  const o: PurchaseOrder = { id: state.meta.nextId++, supplierId, item: s.itemId, qty, unitCost: unit, total, orderDay: state.day, eta: state.day + leadDays(co, s), prepaid: !credit, delayed: false };
  co.orders.push(o);
  if (!silent) practice(state, 'purchase_order', 'management', 30);
  if (!silent) coLog(state, co, 'info', '📦', `pedido de ${qty} ${s.itemId} a ${s.name} (${credit ? `a pagar en ${s.paymentDays} días` : 'pagado'}). Llega en ${o.eta - state.day} días.`, total);
  return OK(`Pedido realizado: ${fmtMoney(total)}${credit ? ` a ${s.paymentDays} días` : ''} + flete ${fmtMoney(fee)}.`);
}

export function receiveOrders(state: GameState, co: Company): void {
  const mult = shelfLifeMult(state, co);
  const sec = sectorOf(co);
  for (const o of [...co.orders]) {
    if (o.eta > state.day) continue;
    const s = supplierFor(co, o.supplierId)!;
    if (!o.delayed && !chance(state, s.reliability)) {
      o.delayed = true;
      o.eta = state.day + randInt(state, 1, 4);
      coLog(state, co, 'warning', '🚚', `${s.name} demoró la entrega del pedido (${o.eta - state.day} días más).`);
      continue;
    }
    const item = sec.items.find((i) => i.id === o.item)!;
    co.inventory.push({ item: o.item, qty: o.qty, unitCost: o.unitCost, value: o.total, expires: item.shelfLifeDays ? state.day + Math.round(item.shelfLifeDays * mult) : null, quality: s.quality });
    if (o.prepaid) {
      coPost(co.ledger, { day: state.day, memo: `Recepción de mercadería (${s.name})`, cf: 'internal', tag: 'receipt', lines: [{ account: 'inventory', debit: o.total }, { account: 'in_transit', credit: o.total }] });
    } else {
      coPost(co.ledger, { day: state.day, memo: `Recepción a crédito (${s.name})`, cf: 'internal', tag: 'receipt', lines: [{ account: 'inventory', debit: o.total }, { account: 'payables', credit: o.total }] });
      co.payables.push({ id: state.meta.nextId++, supplierId: s.id, amount: o.total, dueDay: state.day + s.paymentDays });
    }
    co.materialQuality = co.materialQuality * 0.7 + s.quality * 0.3;
    co.orders = co.orders.filter((x) => x.id !== o.id);
  }
}

export function payDuePayables(state: GameState, co: Company): void {
  for (const p of [...co.payables]) {
    if (p.dueDay > state.day) continue;
    const s = supplierFor(co, p.supplierId);
    if (co.ledger.balances.cash >= p.amount) {
      coPost(co.ledger, { day: state.day, memo: `Pago a proveedor ${s?.name ?? ''}`, cf: 'operating', tag: 'payable', lines: [{ account: 'payables', debit: p.amount }, { account: 'cash', credit: p.amount }] });
    } else {
      const fee = Math.max(100, roundCents(p.amount * 0.03));
      coPost(co.ledger, {
        day: state.day, memo: `Factura vencida sin pagar (${s?.name ?? ''})`, cf: 'internal', tag: 'payable:late',
        lines: [{ account: 'payables', debit: p.amount }, { account: 'penalties', debit: fee }, { account: 'arrears', credit: p.amount + fee }],
      });
      co.arrears.push({ id: state.meta.nextId++, kind: 'proveedor', amount: p.amount + fee, since: state.day, label: `Factura de ${s?.name ?? 'proveedor'}` });
      if (!co.blockedSuppliers.includes(p.supplierId)) co.blockedSuppliers.push(p.supplierId);
      coLog(state, co, 'danger', '⛔', `no pudo pagar a ${s?.name ?? 'un proveedor'}: la factura venció y ese proveedor ya no vende a crédito hasta que pagues.`, p.amount);
    }
    co.payables = co.payables.filter((x) => x.id !== p.id);
  }
}

export function expireLots(state: GameState, co: Company): void {
  let waste = 0;
  const lost: Record<string, number> = {};
  for (const l of co.inventory) {
    if (l.expires !== null && l.expires <= state.day && l.qty > 0) {
      waste += l.value;
      lost[l.item] = (lost[l.item] ?? 0) + l.qty;
      l.qty = 0;
      l.value = 0;
    }
  }
  co.inventory = co.inventory.filter((l) => l.qty > 0 || l.value > 0);
  if (waste > 0) {
    coPost(co.ledger, { day: state.day, memo: 'Mercadería vencida descartada', cf: 'internal', tag: 'waste', lines: [{ account: 'waste', debit: waste }, { account: 'inventory', credit: waste }] });
    const items = Object.entries(lost).map(([k, q]) => `${q.toFixed(1)} ${k}`).join(', ');
    coLog(state, co, 'warning', '🗑️', `se vencieron ${items}. Pérdida: ${fmtMoney(waste)}.`, waste);
  }
}

export function runReorderRules(state: GameState, co: Company): void {
  const failed: string[] = [];
  for (const r of co.rules) {
    if (!r.enabled || r.orderQty <= 0) continue;
    if (onHand(co, r.item) + inTransit(co, r.item) > r.reorderPoint) continue;
    const res = placeOrder(state, co, r.supplierId, r.orderQty, true);
    if (!res.ok) failed.push(r.item);
  }
  if (failed.length && state.day % 7 === 0) coLog(state, co, 'warning', '🔁', `no hay caja para reponer ${failed.join(', ')}: habrá faltantes.`);
}

export function monthlyStorage(state: GameState, co: Company): void {
  const sec = sectorOf(co);
  let cost = 0;
  for (const l of co.inventory) cost += px(state, (sec.items.find((i) => i.id === l.item)?.storageCost ?? 0) * l.qty);
  for (const p of co.products) for (const l of p.finished) cost += px(state, 0.5 * l.qty);
  if (cost > 0) coPay(state, co, 'storage', cost, { memo: 'Costo de almacenamiento', tag: 'storage', kind: 'otros' });
}

export interface ItemPlan {
  item: string;
  name: string;
  unit: string;
  onHand: number;
  inTransit: number;
  committed: number;
  usage: number;
  leadDays: number;
  safetyStock: number;
  reorderPoint: number;
  coverDays: number;
  expiringSoon: number;
  holdingCost: Cents;
  risk: 'alto' | 'medio' | 'bajo';
  value: Cents;
}

/** Planificación de inventario con datos reales de consumo (últimos 14 días). */
export function itemPlan(state: GameState, co: Company, item: string): ItemPlan {
  const sec = sectorOf(co);
  const def = sec.items.find((i) => i.id === item)!;
  const recent = co.stats.slice(-14);
  const used = recent.reduce((s, d) => s + (d.used[item] ?? 0) + (d.lost[`item:${item}`] ?? 0), 0);
  const usage = recent.length ? used / recent.length : 0;
  const rule = co.rules.find((r) => r.item === item);
  const sup = supplierFor(co, rule?.supplierId ?? '') ?? sec.suppliers.find((s) => s.itemId === item)!;
  const lead = leadDays(co, sup);
  const safety = usage * lead * 0.5;
  const oh = onHand(co, item);
  const value = co.inventory.filter((l) => l.item === item).reduce((s, l) => s + l.value, 0);
  const cover = usage > 0 ? oh / usage : oh > 0 ? Infinity : 0;
  return {
    item, name: def.name, unit: def.unit, onHand: oh, inTransit: inTransit(co, item), committed: 0, usage, leadDays: lead,
    safetyStock: safety, reorderPoint: usage * lead + safety, coverDays: cover,
    expiringSoon: co.inventory.filter((l) => l.item === item && l.expires !== null && l.expires - state.day <= 2).reduce((s, l) => s + l.qty, 0),
    holdingCost: px(state, def.storageCost * oh),
    risk: usage === 0 ? 'bajo' : cover < lead ? 'alto' : cover < lead + safety / Math.max(usage, 1e-6) ? 'medio' : 'bajo',
    value,
  };
}
