import { SECTOR_BY_ID, SectorDef, roleDef, EMPLOYER_PAYROLL_RATE, LEGAL_FORM_BY_ID } from '../../content/sectors';
import type { GameState, LogCategory, LogKind } from '../state';
import type { Company, Arrear } from './types';
import { Cents, clamp, roundCents, usd, applyRate } from '../money';
import { coPost, CoAccountId, CO_ACCOUNT_IDS, CO_CHART } from './companyLedger';
import type { CashFlowClass } from '../ledger/core';
import { addLog } from '../log';
import { dealDiscount } from '../saga/integration';
import { jurisdictionById } from '../../content/jurisdictions';

export const ARREARS_FEE = 0.03;

export function sectorOf(co: Company): SectorDef {
  return SECTOR_BY_ID[co.sector];
}

/** USD de precios base → centavos a precios actuales (índice de inflación). */
export function px(state: GameState, dollars: number): Cents {
  return usd(dollars * state.macro.priceIndex);
}

export function coLog(state: GameState, co: Company, kind: LogKind, icon: string, text: string, amount?: Cents, cat?: LogCategory): void {
  if (state.meta.projection || co.status === 'sold') return;
  if (state.listings.some((l) => l.company === co)) return;
  addLog(state, kind, icon, `${co.name}: ${text}`, amount, cat);
  state.log[state.log.length - 1].company = co.id;
}

export function coEquity(co: Company): Cents {
  let e = 0;
  for (const id of CO_ACCOUNT_IDS) {
    const t = CO_CHART[id].type;
    const b = co.ledger.balances[id];
    if (t === 'asset') e += b;
    else if (t === 'liability') e -= b;
  }
  return e;
}

/** Beneficio distribuible: resultados acumulados menos lo ya repartido. */
export function distributableProfit(co: Company): Cents {
  let r = 0;
  for (const id of CO_ACCOUNT_IDS) {
    const t = CO_CHART[id].type;
    if (t === 'income') r += co.ledger.balances[id];
    else if (t === 'expense') r -= co.ledger.balances[id];
  }
  return r + co.ledger.balances.distributions;
}

export function isOpen(co: Company): boolean {
  return co.status === 'active' || co.status === 'insolvent';
}

/**
 * Pago de la empresa desde su caja. Si no alcanza y se permite, el monto queda
 * como deuda vencida (con 3 % de recargo). El dinero nunca se inventa.
 */
export function coPay(
  state: GameState, co: Company, account: CoAccountId, amount: Cents,
  opt: { memo: string; tag?: string; cf?: CashFlowClass; kind?: Arrear['kind']; allowArrears?: boolean },
): boolean {
  if (amount <= 0) return true;
  const cf = opt.cf ?? 'operating';
  if (co.ledger.balances.cash >= amount) {
    coPost(co.ledger, { day: state.day, memo: opt.memo, cf, tag: opt.tag, lines: [{ account, debit: amount }, { account: 'cash', credit: amount }] });
    return true;
  }
  if (opt.allowArrears === false) return false;
  const paid = Math.max(0, co.ledger.balances.cash);
  const owed = amount - paid;
  const fee = Math.max(100, applyRate(owed, ARREARS_FEE));
  coPost(co.ledger, {
    day: state.day, memo: `${opt.memo} (impago parcial)`, cf, tag: opt.tag,
    lines: [{ account, debit: amount }, { account: 'penalties', debit: fee }, { account: 'cash', credit: paid }, { account: 'arrears', credit: owed + fee }],
  });
  co.arrears.push({ id: state.meta.nextId++, kind: opt.kind ?? 'otros', amount: owed + fee, since: state.day, label: opt.memo });
  coLog(state, co, 'danger', '⛔', `sin caja para "${opt.memo}": quedó una deuda vencida.`, owed + fee);
  return false;
}

/** Paga deudas vencidas en orden de antigüedad con la caja disponible. */
export function settleArrears(state: GameState, co: Company, budget?: Cents): Cents {
  let available = Math.min(co.ledger.balances.cash, budget ?? Infinity);
  let paid = 0;
  co.arrears.sort((a, b) => a.since - b.since);
  for (const a of co.arrears) {
    if (available <= 0) break;
    const pay = Math.min(a.amount, available);
    coPost(co.ledger, { day: state.day, memo: `Pago de deuda vencida: ${a.label}`, cf: 'operating', tag: 'arrears', lines: [{ account: 'arrears', debit: pay }, { account: 'cash', credit: pay }] });
    a.amount -= pay;
    available -= pay;
    paid += pay;
  }
  co.arrears = co.arrears.filter((a) => a.amount > 0);
  if (co.arrears.filter((a) => a.kind === 'proveedor').length === 0) co.blockedSuppliers = [];
  return paid;
}

// ---------------------------------------------------------------- Personal

export function employeeProductivity(state: GameState, co: Company, empId: number): number {
  const e = co.employees.find((x) => x.id === empId)!;
  if (e.absentUntil > state.day || e.trainingUntil > state.day) return 0;
  return (0.5 + e.skill / 100) * (0.7 + (0.3 * e.morale) / 100);
}

export function countRole(co: Company, role: string): number {
  return co.employees.filter((e) => e.role === role).length;
}

export function hasManager(co: Company): boolean {
  return co.employees.some((e) => e.role === 'gerente');
}

export function managerSkill(co: Company): number {
  const m = co.employees.filter((e) => e.role === 'gerente');
  return m.length ? Math.max(...m.map((x) => x.skill)) : 0;
}

/** Empresas a partir de las cuales hace falta un equipo directivo (1.4). */
export const EXEC_FREE_COMPANIES = 4;

/**
 * COSTO DE LA COMPLEJIDAD (1.4): con más de 4 empresas operando, delegar sin
 * supervisión cuesta: cada empresa extra resta 8 puntos a la habilidad efectiva
 * de los gerentes (hasta 30). Un equipo directivo lo evita y suma 5 puntos.
 */
export function execAdjustment(state: GameState): number {
  if (!state.saga) return 0;
  if (state.saga.exec?.hired) return 5;
  const n = state.companies.filter((c) => (c.status === 'active' || c.status === 'insolvent') && !c.npc && c.sector !== 'holding').length;
  const over = Math.max(0, n - EXEC_FREE_COMPANIES);
  return -Math.min(30, over * 8);
}

/** Habilidad del gerente con el efecto del equipo directivo (o de su falta). */
export function effectiveManagerSkill(state: GameState, co: Company): number {
  const base = managerSkill(co);
  return base ? clamp(base + execAdjustment(state), 1, 100) : 0;
}

export function workingAssets(state: GameState, co: Company) {
  return co.assets.filter((a) => a.brokenUntil <= state.day);
}

export function equipDef(co: Company, equipId: string) {
  return sectorOf(co).equipment.find((e) => e.id === equipId)!;
}

export interface Capacity {
  production: number;
  service: number;
  hours: number;
  users: number;
  equipmentBonus: number;
}

export function capacity(state: GameState, co: Company): Capacity {
  const sec = sectorOf(co);
  let bonus = 0;
  for (const a of workingAssets(state, co)) bonus += equipDef(co, a.equipId).capacityBonus * (0.5 + a.condition / 200);
  const mgr = hasManager(co) ? 1 + (effectiveManagerSkill(state, co) - 50) / 500 : 1;
  const cap: Capacity = { production: 0, service: 0, hours: 0, users: 0, equipmentBonus: bonus };
  for (const e of co.employees) {
    const r = roleDef(sec, e.role);
    if (!r.capacity) continue;
    const p = employeeProductivity(state, co, e.id);
    cap[r.capacity.kind] += r.capacity.perDay * p;
  }
  cap.production *= (1 + bonus) * mgr;
  cap.service *= (1 + bonus) * mgr;
  cap.hours *= (1 + bonus) * mgr;
  cap.users *= (1 + bonus) * mgr;
  return cap;
}

/** Calidad 5–100: insumos, habilidad del personal, equipos, I+D, gestión y sobrecarga. */
export function computeQuality(state: GameState, co: Company): number {
  const sec = sectorOf(co);
  const prodRoles = co.employees.filter((e) => roleDef(sec, e.role).capacity);
  const staffSkill = prodRoles.length ? prodRoles.reduce((s, e) => s + e.skill, 0) / prodRoles.length : 30;
  let equip = 0;
  for (const a of workingAssets(state, co)) equip += equipDef(co, a.equipId).qualityBonus * (a.condition / 100);
  const matWeight = sec.items.length ? 0.4 : 0;
  const staffWeight = sec.items.length ? 0.3 : 0.55;
  let q = 45 + (co.materialQuality - 60) * matWeight + (staffSkill - 50) * staffWeight + equip + co.rdBonus;
  if (hasManager(co)) q += (effectiveManagerSkill(state, co) - 50) * 0.05;
  if (sec.model === 'subscription') {
    const cap = capacity(state, co).users;
    if (co.subscribers > cap && cap >= 0) q -= Math.min(40, ((co.subscribers - cap) / Math.max(1, cap)) * 60);
  }
  return clamp(Math.round(q * 10) / 10, 5, 100);
}

export function monthlyPayroll(_state: GameState, co: Company): Cents {
  const wages = co.employees.reduce((s, e) => s + e.wage, 0);
  return wages + roundCents(wages * EMPLOYER_PAYROLL_RATE);
}

/**
 * Oficina y servicios (USD base). Una holding (1.2) solo necesita un domicilio legal
 * mientras no tenga subsidiarias; cada subsidiaria suma espacio y servicios de gestión.
 */
export function premisesBase(state: GameState, co: Company): { rent: number; utilities: number } {
  const sec = sectorOf(co);
  if (co.sector !== 'holding') return { rent: sec.rent, utilities: sec.utilities };
  const subs = state.companies.filter((c) => c.parentId === co.id && isOpen(c)).length;
  return { rent: 80 + 150 * subs, utilities: 20 + 30 * subs };
}

/** Administración legal y contable del mes (con el descuento de un proveedor propio y el recargo por estar en otro país). */
export function adminFee(state: GameState, co: Company): number {
  const base = roundCents(px(state, LEGAL_FORM_BY_ID[co.legalForm].monthlyAdmin) * (1 - dealDiscount(state, co, 'gestion')));
  const foreign = !co.npc && co.jurisdiction !== state.tax.jurisdiction ? px(state, jurisdictionById(co.jurisdiction).foreignCompanyAdmin) : 0;
  return base + foreign;
}

/** Costos fijos mensuales (sin sueldos): alquiler, servicios, mantenimiento, administración, préstamos. Igual que lo que se paga el día 1. */
export function monthlyFixed(state: GameState, co: Company): Cents {
  const pb = premisesBase(state, co);
  const ownPremises = (state.realEstate?.properties ?? []).some((p) => p.usedBy === co.id);
  let t = (ownPremises ? 0 : px(state, pb.rent)) + px(state, pb.utilities) + adminFee(state, co);
  t += maintenanceCost(state, co);
  for (const l of co.loans) if (l.balance > 0) t += l.payment;
  return t;
}

export function maintenanceCost(state: GameState, co: Company): Cents {
  const mult = co.maintenance === 'none' ? 0 : co.maintenance === 'basic' ? 0.6 : 1;
  const own = 1 - dealDiscount(state, co, 'equipamiento');
  return roundCents(co.assets.reduce((s, a) => s + px(state, equipDef(co, a.equipId).maintenance * mult), 0) * own);
}
