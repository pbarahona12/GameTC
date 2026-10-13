import type { GameState } from '../state';
import type { Company } from './types';
import type { JurisdictionId } from '../../content/jurisdictions';
import { roleDef } from '../../content/sectors';
import { coPost } from './companyLedger';
import { px, coLog, sectorOf, isOpen, hasManager } from './common';
import { generateCandidates, hire } from './staff';
import { SETUP_DAYS } from './ownership';
import { ActionResult, FAIL, OK } from '../result';
import { fmtMoney } from '../format';
import { formatDate } from '../time/calendar';
import { practice } from '../skills/skills';
import { chronicle } from '../saga/chronicle';
import { cityName } from '../saga/ranking';
import { roundCents, type Cents } from '../money';
import { CITY_MARKET, MAX_BRANCHES, MAX_PER_CITY, HOME_CITY, locales, type Branch } from './locations';

/**
 * SUCURSALES (1.6, auditoría E2): abrir un local más en la capital o en otra ciudad.
 *
 * Abrir cuesta (licencia, depósito, equipos y personal como al fundar), tarda dos
 * semanas en instalarse y exige un gerente. Cada local paga alquiler y servicios
 * todos los meses. Un local en otra ciudad abre ese mercado (ver locations.ts); uno
 * más en la misma ciudad suma presencia con rendimientos decrecientes. Todo pasa por
 * el libro mayor de la empresa.
 */
export const BRANCH_SETUP_DAYS = SETUP_DAYS * 2;
/** Meses de historia que necesita la empresa antes de abrir sucursales. */
export const BRANCH_MIN_MONTHS = 3;

export interface BranchCosts {
  license: Cents;
  deposit: Cents;
  equipment: Cents;
  hiring: Cents;
  total: Cents;
  /** Alquiler y servicios de cada mes. */
  monthly: Cents;
  /** Sueldos del personal inicial del local (por mes). */
  payroll: Cents;
}

export function branchCosts(state: GameState, co: Company): BranchCosts {
  const sec = sectorOf(co);
  const license = px(state, sec.license);
  const deposit = px(state, sec.rent * sec.depositMonths);
  const equipment = sec.starterEquipment.reduce((s, id) => s + px(state, sec.equipment.find((e) => e.id === id)!.cost), 0);
  let payroll = 0;
  let hiring = 0;
  for (const [role, n] of Object.entries(sec.starterStaff)) {
    const wage = px(state, roleDef(sec, role).baseWage);
    payroll += wage * n;
    hiring += roundCents(wage * 0.25) * n;
  }
  return { license, deposit, equipment, hiring, total: license + deposit + equipment + hiring, monthly: px(state, sec.rent + sec.utilities), payroll };
}

/** Por qué no se puede abrir una sucursal en esa ciudad (null = se puede). */
export function branchBlocker(state: GameState, co: Company, city: JurisdictionId): string | null {
  if (state.legal?.prison) return 'Desde prisión no podés expandir tus empresas.';
  if (co.npc || !isOpen(co) || co.status === 'insolvent') return 'La empresa tiene que estar operando con normalidad.';
  if (co.sector === 'holding') return 'Una holding no tiene locales: abrí sucursales en sus empresas.';
  if (!(city in CITY_MARKET)) return 'Ciudad desconocida.';
  if (co.history.length < BRANCH_MIN_MONTHS) return `La empresa necesita ${BRANCH_MIN_MONTHS} meses de historia antes de expandirse.`;
  if (!hasManager(co)) return 'Hace falta un gerente que coordine los locales.';
  const branches = co.branches ?? [];
  if (branches.length >= MAX_BRANCHES) return `Ya tiene ${MAX_BRANCHES} sucursales.`;
  const inCity = branches.filter((b) => b.city === city).length;
  if (inCity >= MAX_PER_CITY) return `Ya tiene ${MAX_PER_CITY} sucursales en ${cityName(city)}.`;
  const c = branchCosts(state, co);
  if (co.ledger.balances.cash < c.total) return `La empresa necesita ${fmtMoney(c.total, { decimals: false })} en caja (tiene ${fmtMoney(co.ledger.balances.cash, { decimals: false })}).`;
  return null;
}

export function openBranch(state: GameState, companyId: number, city: JurisdictionId): ActionResult {
  const co = state.companies.find((c) => c.id === companyId);
  if (!co) return FAIL('Empresa inexistente.');
  const blocked = branchBlocker(state, co, city);
  if (blocked) return FAIL(blocked);
  const sec = sectorOf(co);
  const c = branchCosts(state, co);
  const firstInCity = !(locales(co, Infinity)[city] ?? 0);
  coPost(co.ledger, { day: state.day, memo: `Licencia del local en ${cityName(city)}`, cf: 'operating', tag: 'branch', lines: [{ account: 'admin', debit: c.license }, { account: 'cash', credit: c.license }] });
  coPost(co.ledger, { day: state.day, memo: `Depósito en garantía del local en ${cityName(city)}`, cf: 'investing', tag: 'deposit', lines: [{ account: 'deposits_paid', debit: c.deposit }, { account: 'cash', credit: c.deposit }] });
  for (const id of sec.starterEquipment) {
    const def = sec.equipment.find((e) => e.id === id)!;
    const cost = px(state, def.cost);
    coPost(co.ledger, { day: state.day, memo: `Compra de ${def.name} (local en ${cityName(city)})`, cf: 'investing', tag: 'capex', lines: [{ account: 'fixed_assets', debit: cost }, { account: 'cash', credit: cost }] });
    co.assets.push({ id: state.meta.nextId++, equipId: id, cost, bookValue: cost, boughtDay: state.day, condition: 100, brokenUntil: state.day - 1 });
  }
  const saved = co.candidates;
  for (const [role, n] of Object.entries(sec.starterStaff)) {
    for (let i = 0; i < n; i++) {
      const cands = generateCandidates(state, co, role);
      const best = cands.sort((a, b) => b.skill - a.skill)[0];
      if (!best) continue;
      best.wage = px(state, roleDef(sec, role).baseWage);
      best.skill = Math.min(best.skill, 60);
      hire(state, co, best.id, true);
    }
  }
  co.candidates = saved;
  const b: Branch = { id: state.meta.nextId++, city, openedDay: state.day, openDay: state.day + BRANCH_SETUP_DAYS, deposit: c.deposit };
  co.branches = [...(co.branches ?? []), b];
  practice(state, 'branch', 'management', 120);
  coLog(state, co, 'success', '🏬', `abre un local en ${cityName(city)} (abre el ${formatDate(b.openDay)}). Inversión: ${fmtMoney(c.total)}.`);
  if (firstInCity && city !== HOME_CITY) chronicle(state, 'empresa', 'business', `${co.name} llega a ${cityName(city)}`, `Primera sucursal fuera de la capital: un mercado nuevo de ${Math.round(CITY_MARKET[city] * 100)} % del tamaño de Valdoria.`);
  return OK(`${co.name} abre un local en ${cityName(city)}: empieza a vender el ${formatDate(b.openDay)}.`);
}

/** Cierra una sucursal: deja de pagar alquiler y recupera el depósito (equipos y personal quedan en la empresa). */
export function closeBranch(state: GameState, companyId: number, branchId: number): ActionResult {
  const co = state.companies.find((c) => c.id === companyId);
  const b = co?.branches?.find((x) => x.id === branchId);
  if (!co || !b) return FAIL('Sucursal inexistente.');
  if (b.deposit > 0) coPost(co.ledger, { day: state.day, memo: `Devolución del depósito del local en ${cityName(b.city)}`, cf: 'investing', tag: 'deposit', lines: [{ account: 'cash', debit: b.deposit }, { account: 'deposits_paid', credit: b.deposit }] });
  co.branches = (co.branches ?? []).filter((x) => x !== b);
  coLog(state, co, 'info', '🏬', `cerró su local en ${cityName(b.city)}. Recuperó el depósito de ${fmtMoney(b.deposit)}; los equipos y el personal siguen en la empresa.`);
  return OK(`Cerraste el local en ${cityName(b.city)}.`);
}

/** Sucursales de todas tus empresas (para etapas y la escena del imperio). */
export function empireFootprint(state: GameState): { locales: number; cities: number; branches: number } {
  const cities = new Set<string>();
  let n = 0;
  let branches = 0;
  for (const co of state.companies) {
    if (co.npc || !isOpen(co) || co.sector === 'holding') continue;
    const l = locales(co, state.day);
    for (const [c, k] of Object.entries(l)) {
      cities.add(c);
      n += k ?? 0;
    }
    branches += co.branches?.length ?? 0;
  }
  return { locales: n, cities: cities.size, branches };
}

