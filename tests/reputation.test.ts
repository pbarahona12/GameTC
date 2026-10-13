/**
 * Fase 1 · E4 (auditoría D4): la reputación también nace de tu imperio.
 * Criterio de la auditoría: un jugador sin empleo con 3 empresas rentables llega a 60.
 */
import { describe, it, expect } from 'vitest';
import { makeGame, forceHire, expectConsistent } from './helpers';
import { post } from '../src/engine/ledger/ledger';
import { usd } from '../src/engine/money';
import { foundCompany } from '../src/engine/business/ownership';
import { reputationSources } from '../src/engine/reputation';
import { monthlyAttributes } from '../src/engine/world';
import { JOBS, JOB_BY_ID } from '../src/content/jobs';
import { LIFESTYLE_BY_ID } from '../src/content/lifestyle';
import { imageScore } from '../src/engine/lifestyle/effects';
import { foundationReputation } from '../src/engine/saga/life';
import type { GameState } from '../src/engine/state';

function rich(seed: string): GameState {
  const s = makeGame('herencia', seed);
  post(s.ledger, { day: 0, memo: 'Capital', cf: 'internal', lines: [{ account: 'checking', debit: usd(600_000) }, { account: 'opening_equity', credit: usd(600_000) }] });
  return s;
}

/** Tres empresas reales; su rentabilidad y reputación se fijan para aislar la regla. */
function threeCompanies(s: GameState, profit: number, rep: number) {
  for (const [i, sector] of (['cafeteria', 'minimarket', 'cafeteria'] as const).entries()) {
    const r = foundCompany(s, { sector, name: `Empresa ${i}`, legalForm: 'srl', capital: usd(60_000) });
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
  }
  for (const co of s.companies) {
    co.reputation = rep;
    for (let m = 0; m < 3; m++) co.history.push({ ...(co.history[0] ?? {}), day: s.day, revenue: usd(20_000), grossProfit: usd(9_000), netIncome: profit, cash: usd(10_000), equity: usd(50_000), inventory: 0, employees: co.employees.length, share: 0.1, quality: 60, reputation: rep, awareness: 40 });
  }
}

/** Fórmula de la 1.5 (solo carrera): para comprobar que no cambia para quien no tiene empresas. */
function oldTarget(s: GameState): number {
  const job = s.career.job ? JOB_BY_ID[s.career.job.jobId] : null;
  return (job ? job.level * 12 : 5) + s.education.certificates.length * 2 + LIFESTYLE_BY_ID[s.budget.lifestyle].reputation * 3 + imageScore(s) / 10 + foundationReputation(s);
}

describe('Reputación que nace de tu imperio', () => {
  it('sin empresas, el objetivo es el mismo de antes (con y sin empleo)', () => {
    const a = rich('rep-old-a');
    expect(reputationSources(a).target).toBeCloseTo(oldTarget(a), 1);
    const b = rich('rep-old-b');
    forceHire(b, JOBS[JOBS.length - 1].id);
    expect(reputationSources(b).target).toBeCloseTo(oldTarget(b), 1);
  });

  it('un jugador SIN empleo con 3 empresas rentables llega a 60 (criterio de la auditoría)', () => {
    const s = rich('rep-3co');
    expect(s.career.job).toBeNull();
    threeCompanies(s, usd(4_000), 55);
    const src = reputationSources(s);
    expect(src.career).toBe(0);
    expect(src.companies).toBe(60);
    expect(src.target).toBeGreaterThan(62);
    s.player.attributes.reputation = 20;
    let months = 0;
    while (s.player.attributes.reputation < 60 && months < 120) {
      monthlyAttributes(s);
      months++;
    }
    expect(s.player.attributes.reputation).toBeGreaterThanOrEqual(60);
    expect(months).toBeLessThanOrEqual(120);
    expectConsistent(s);
  });

  it('las empresas que pierden plata pesan menos, y el empleo suma un 30 % encima del imperio', () => {
    const losing = rich('rep-loss');
    threeCompanies(losing, -usd(2_000), 55);
    const winning = rich('rep-win');
    threeCompanies(winning, usd(2_000), 55);
    expect(reputationSources(losing).companies).toBeLessThan(reputationSources(winning).companies * 0.5);
    const both = rich('rep-both');
    threeCompanies(both, usd(2_000), 55);
    const before = reputationSources(both);
    forceHire(both, JOBS[0].id);
    const after = reputationSources(both);
    const career = after.career;
    expect(after.professional).toBeCloseTo(Math.max(before.professional, career) + 0.3 * Math.min(career, before.professional), 0);
  });

  it('las listas de fortunas suman: top 100, top 10 y número 1 de la ciudad', () => {
    const s = rich('rep-rank');
    const base = reputationSources(s).ranking;
    expect(base).toBe(0);
    s.saga.ranking.player = { ...s.saga.ranking.player, city: 80, global: null };
    expect(reputationSources(s).ranking).toBe(5);
    s.saga.ranking.player = { ...s.saga.ranking.player, city: 7, global: 90 };
    expect(reputationSources(s).ranking).toBe(15);
    s.saga.ranking.player = { ...s.saga.ranking.player, city: 1, global: 12 };
    expect(reputationSources(s).ranking).toBe(20);
  });
});
