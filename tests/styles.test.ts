/**
 * 1.6 · Estilos parejos (auditoría E10) y grandes proyectos (F1): proyectos
 * inmobiliarios por etapas y puestos de dirección con acciones.
 */
import { describe, it, expect } from 'vitest';
import { makeGame, expectConsistent, forceHire } from './helpers';
import { post } from '../src/engine/ledger/ledger';
import { usd } from '../src/engine/money';
import { advanceDay } from '../src/engine/simulation';
import { buyProperty, refreshPropertyListings, startProject, rushProject, projectPlan, maxUnits, PROJECT_PHASES, financeProject, projectCollateral, PROJECT_LTV } from '../src/engine/realestate/realestate';
import { JOB_BY_ID, JOBS } from '../src/content/jobs';
import { equityGrantValue } from '../src/engine/career/career';
import type { GameState } from '../src/engine/state';
import type { PropertyListing, Property } from '../src/engine/realestate/types';

function fund(s: GameState, dollars: number) {
  post(s.ledger, { day: s.day, memo: 'Fondos de prueba', cf: 'internal', lines: [{ account: 'checking', debit: usd(dollars) }, { account: 'opening_equity', credit: usd(dollars) }] });
}

function land(s: GameState, maxUsd: number): Property {
  for (let i = 0; i < 40; i++) {
    const l = s.realEstate.listings.find((x: PropertyListing) => x.property.type === 'terreno' && x.askPrice < usd(maxUsd) && x.property.zoneId === 'centro');
    if (l) {
      expect(buyProperty(s, l.id, { owner: { kind: 'personal' } }).ok).toBe(true);
      return s.realEstate.properties.find((p) => p.type === 'terreno')!;
    }
    s.realEstate.listings = [];
    refreshPropertyListings(s);
  }
  throw new Error('No hay terrenos');
}

const days = (s: GameState, n: number) => {
  for (let i = 0; i < n; i++) advanceDay(s);
};

describe('Proyecto inmobiliario por etapas', () => {
  it('permisos → estructura → terminaciones, y al terminar se divide en unidades sin perder valor contable', () => {
    const s = makeGame('herencia', 'proj-1');
    fund(s, 3_000_000);
    const t = land(s, 1_200_000);
    const n = Math.min(6, maxUnits(Math.round(t.m2 * 0.8), 'vivienda'));
    const plan = projectPlan(s, t, 'vivienda', n);
    const cash = s.ledger.balances.checking + s.ledger.balances.savings;
    expect(startProject(s, t.id, 'vivienda', n).ok).toBe(true);
    expect(cash - s.ledger.balances.checking - s.ledger.balances.savings).toBe(plan.first);
    expect(t.development!.phase).toBe(0);
    const phases = new Set<number>();
    for (let i = 0; i < 520 && t.development; i++) {
      advanceDay(s);
      if (t.development) phases.add(t.development.phase!);
    }
    expect([...phases].sort()).toEqual([0, 1, 2]);
    expect(t.development).toBeNull();
    const units = s.realEstate.properties.filter((p) => p.name.startsWith(t.name.replace(/ · unidad 1$/, '')));
    expect(units.length).toBe(n);
    expect(units.every((u) => u.type === 'vivienda' && u.listedForRent)).toBe(true);
    // El costo de todo (terreno + obra) quedó repartido entre las unidades.
    expect(units.reduce((a, u) => a + u.costBasis, 0)).toBeGreaterThanOrEqual(plan.budget * 0.95);
    expectConsistent(s);
  }, 120_000);

  it('sin fondos la obra se para y sigue sola cuando alcanza', () => {
    const s = makeGame('herencia', 'proj-2');
    fund(s, 1_400_000);
    const t = land(s, 1_200_000);
    expect(startProject(s, t.id, 'oficina', 1).ok).toBe(true);
    // Se gasta el resto de la plata.
    const left = s.ledger.balances.checking + s.ledger.balances.savings - usd(2000);
    post(s.ledger, { day: s.day, memo: 'Gasto de prueba', cf: 'operating', lines: [{ account: 'other_expense', debit: s.ledger.balances.checking }, { account: 'checking', credit: s.ledger.balances.checking }] });
    expect(left).toBeGreaterThan(0);
    days(s, 120);
    expect(t.development!.waiting).toBe(true);
    expect(t.development!.phase).toBe(0);
    expect(s.log.some((l) => l.text.includes('está parada'))).toBe(true);
    fund(s, 2_000_000);
    days(s, 10);
    expect(t.development!.waiting).toBe(false);
    expect(t.development!.phase).toBe(1);
    expectConsistent(s);
  }, 120_000);

  it('acelerar cuesta y adelanta la etapa (una vez por etapa)', () => {
    const s = makeGame('herencia', 'proj-3');
    fund(s, 3_000_000);
    const t = land(s, 1_200_000);
    expect(startProject(s, t.id, 'vivienda', 2).ok).toBe(true);
    while (t.development!.phase === 0) advanceDay(s);
    const until = t.development!.until;
    const paid = t.development!.cost;
    expect(rushProject(s, t.id).ok).toBe(true);
    expect(t.development!.until).toBeLessThan(until);
    expect(t.development!.cost).toBeGreaterThan(paid);
    expect(rushProject(s, t.id).ok).toBe(false);
    expect(PROJECT_PHASES.reduce((a, p) => a + p.share, 0)).toBeCloseTo(1, 9);
    expectConsistent(s);
  }, 60_000);
});

describe('Préstamo de obra', () => {
  it('financia hasta el 60 % de terreno + obra, cancela la hipoteca del terreno y paga las etapas', () => {
    const s = makeGame('herencia', 'proj-loan');
    forceHire(s, 'fin_analista', 30_000);
    fund(s, 1_500_000);
    const t = land(s, 1_200_000);
    expect(startProject(s, t.id, 'vivienda', 4).ok).toBe(true);
    const max = Math.round(projectCollateral(s, t) * PROJECT_LTV);
    expect(financeProject(s, t.id, 'bval_hipo', max + 100_00, 15).ok).toBe(false);
    const debt0 = s.ledger.balances.mortgages;
    const r = financeProject(s, t.id, 'bval_hipo', max, 15);
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    expect(s.ledger.balances.mortgages - debt0).toBe(max);
    expect(s.realEstate.mortgages.find((m) => m.id === t.mortgageId)!.principal).toBe(max);
    expectConsistent(s);
    for (let i = 0; i < 520 && t.development; i++) advanceDay(s);
    expect(t.development).toBeNull();
    expect(t.mortgageId).not.toBeNull();
    expectConsistent(s);
  }, 120_000);
});

describe('Puestos de dirección con acciones', () => {
  it('cada puesto de dirección cotiza y se llega por ascenso', () => {
    const dirs = JOBS.filter((j) => j.equity);
    expect(dirs.length).toBeGreaterThanOrEqual(6);
    const s = makeGame('herencia', 'dir-0');
    for (const d of dirs) {
      expect(s.stocks.stocks.some((x) => x.id === d.equity!.stockId)).toBe(true);
      expect(JOBS.some((j) => j.promotesTo === d.id)).toBe(true);
    }
  });

  it('la evaluación anual entrega acciones de la empleadora netas de impuestos', () => {
    const s = makeGame('herencia', 'dir-1');
    const job = JOB_BY_ID.dir_finanzas;
    s.career.job = { jobId: job.id, salary: usd(10_500), startDay: s.day, employedSince: s.day, performance: 75, monthsInRole: 11, lowPerfMonths: 0, lastRaisePct: 0, nextReviewDay: s.day + 1, paidThroughDay: s.day } as GameState['career']['job'];
    const gross = equityGrantValue(s, job, 75);
    expect(gross).toBeGreaterThan(usd(10_500 * 12 * 0.5));
    const qty0 = s.stocks.holdings.BVAL?.qty ?? 0;
    const bonuses0 = s.tax.ytd.bonuses;
    advanceDay(s);
    const h = s.stocks.holdings.BVAL;
    expect(h.qty).toBeGreaterThan(qty0);
    expect(s.tax.ytd.bonuses - bonuses0).toBeGreaterThanOrEqual(gross);
    // Llega menos que el bruto: se retuvo el impuesto.
    expect(h.cost).toBeLessThan(gross);
    expect(s.log.some((l) => l.text.includes('acciones de Banco de Valoria'))).toBe(true);
    expectConsistent(s);
  });
});
