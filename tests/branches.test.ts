/**
 * 1.6 · Sucursales y mercados por ciudad (auditoría E2, D1).
 */
import { describe, it, expect } from 'vitest';
import { makeGame, expectConsistent } from './helpers';
import { post } from '../src/engine/ledger/ledger';
import { usd } from '../src/engine/money';
import { advanceDay } from '../src/engine/simulation';
import { foundCompany } from '../src/engine/business/ownership';
import { generateCandidates, hire } from '../src/engine/business/staff';
import { openBranch, closeBranch, branchBlocker, branchCosts, BRANCH_SETUP_DAYS, empireFootprint } from '../src/engine/business/branches';
import { addressableWeight, CITY_MARKET, locales } from '../src/engine/business/locations';
import { expectedDemand, expectedShare, cityShare } from '../src/engine/business/operations';
import { SECTOR_BY_ID } from '../src/content/sectors';
import { coPost } from '../src/engine/business/companyLedger';
import type { GameState } from '../src/engine/state';
import type { Company } from '../src/engine/business/types';

function setup(seed: string): { s: GameState; co: Company } {
  const s = makeGame('herencia', seed);
  post(s.ledger, { day: 0, memo: 'Capital', cf: 'internal', lines: [{ account: 'checking', debit: usd(400_000) }, { account: 'opening_equity', credit: usd(400_000) }] });
  const r = foundCompany(s, { sector: 'cafeteria', name: 'Café Prueba', legalForm: 'srl', capital: usd(200_000) });
  expect(r.ok, r.ok ? '' : r.error).toBe(true);
  const co = s.companies[0];
  const c = generateCandidates(s, co, 'gerente')[0];
  expect(hire(s, co, c.id, true).ok).toBe(true);
  for (let d = 0; d < 100; d++) advanceDay(s);
  return { s, co: s.companies[0] };
}

describe('Sucursales', () => {
  it('sin sucursales, la demanda es la de siempre (solo la capital)', () => {
    const { s, co } = setup('br-same');
    const p = SECTOR_BY_ID.cafeteria.products[0];
    const price = co.products[0].price;
    expect(addressableWeight(co, s.day)).toBe(1);
    expect(expectedShare(s, co, p, price)).toBeCloseTo(cityShare(s, co, p, price, 'valdoria'), 12);
    expect(expectedShare(s, co, p, price)).toBeLessThan(1);
  });

  it('una sucursal en otra ciudad cuesta, tarda en abrir y después suma ese mercado', () => {
    const { s, co } = setup('br-open');
    const p = SECTOR_BY_ID.cafeteria.products[0];
    const before = expectedDemand(s, co, p, co.products[0].price);
    const cash = co.ledger.balances.cash;
    const costs = branchCosts(s, co);
    const staff = co.employees.length;
    const r = openBranch(s, co.id, 'norvalia');
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    expect(cash - co.ledger.balances.cash).toBeGreaterThanOrEqual(costs.license + costs.deposit + costs.equipment);
    expect(co.employees.length).toBeGreaterThan(staff);
    // Todavía se está instalando.
    expect(locales(co, s.day).norvalia).toBeUndefined();
    for (let d = 0; d < BRANCH_SETUP_DAYS; d++) advanceDay(s);
    expect(locales(co, s.day).norvalia).toBe(1);
    const after = expectedDemand(s, co, p, co.products[0].price);
    expect(after / before).toBeGreaterThan(1 + CITY_MARKET.norvalia * 0.6);
    expect(empireFootprint(s)).toMatchObject({ cities: 2, branches: 1 });
    expectConsistent(s);
  });

  it('más locales en la misma ciudad captan más, con rendimientos decrecientes', () => {
    const { s, co } = setup('br-same-city');
    coPost(co.ledger, { day: s.day, memo: 'Aporte', cf: 'financing', tag: 'capital', lines: [{ account: 'cash', debit: usd(300_000) }, { account: 'capital', credit: usd(300_000) }] });
    const p = SECTOR_BY_ID.cafeteria.products[0];
    const price = co.products[0].price;
    const s1 = cityShare(s, co, p, price, 'valdoria', s.day);
    expect(openBranch(s, co.id, 'valdoria').ok).toBe(true);
    const later = s.day + BRANCH_SETUP_DAYS;
    const s2 = cityShare(s, co, p, price, 'valdoria', later);
    expect(openBranch(s, co.id, 'valdoria').ok).toBe(true);
    const s3 = cityShare(s, co, p, price, 'valdoria', later);
    expect(s2).toBeGreaterThan(s1);
    expect(s3).toBeGreaterThan(s2);
    expect(s3 - s2).toBeLessThan(s2 - s1);
  });

  it('exige gerente, historia y caja; cerrar devuelve el depósito y deja de cobrar alquiler', () => {
    const { s, co } = setup('br-rules');
    const young = makeGame('herencia', 'br-young');
    post(young.ledger, { day: 0, memo: 'Capital', cf: 'internal', lines: [{ account: 'checking', debit: usd(100_000) }, { account: 'opening_equity', credit: usd(100_000) }] });
    foundCompany(young, { sector: 'cafeteria', name: 'Café Nuevo', legalForm: 'srl', capital: usd(60_000) });
    expect(branchBlocker(young, young.companies[0], 'norvalia')).toMatch(/meses de historia/);
    const mgr = co.employees.find((e) => e.role === 'gerente')!;
    co.employees = co.employees.filter((e) => e !== mgr);
    expect(branchBlocker(s, co, 'norvalia')).toMatch(/gerente/);
    co.employees.push(mgr);
    expect(openBranch(s, co.id, 'meridia').ok).toBe(true);
    const b = co.branches![0];
    const deposits = co.ledger.balances.deposits_paid;
    expect(closeBranch(s, co.id, b.id).ok).toBe(true);
    expect(co.ledger.balances.deposits_paid).toBe(deposits - b.deposit);
    expect(co.branches).toEqual([]);
    expectConsistent(s);
  });

  it('un año con 3 sucursales en 3 ciudades: vende más y la contabilidad cierra todos los meses', () => {
    const { s, co } = setup('br-year');
    coPost(co.ledger, { day: s.day, memo: 'Aporte', cf: 'financing', tag: 'capital', lines: [{ account: 'cash', debit: usd(400_000) }, { account: 'capital', credit: usd(400_000) }] });
    co.delegation = { ...co.delegation, autoReorder: true, autoPricing: true, autoStaffing: true };
    const rev0 = co.history.slice(-1)[0]?.revenue ?? 0;
    for (const city of ['norvalia', 'meridia', 'isla_coral'] as const) expect(openBranch(s, co.id, city).ok).toBe(true);
    for (let d = 0; d < 365; d++) {
      advanceDay(s);
      if (d % 30 === 29) expectConsistent(s);
    }
    const rev1 = co.history.slice(-1)[0].revenue;
    expect(rev1).toBeGreaterThan(rev0 * 1.5);
  });
});
