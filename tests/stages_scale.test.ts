/**
 * 1.6 · Etapas altas alcanzables (auditoría E3, D2) y fortuna estimada (E1, D3).
 */
import { describe, it, expect } from 'vitest';
import { makeGame, expectConsistent } from './helpers';
import { post } from '../src/engine/ledger/ledger';
import { usd } from '../src/engine/money';
import { advanceDay } from '../src/engine/simulation';
import { isLastDayOfMonth } from '../src/engine/time/calendar';
import { STAGES, citiesPresent } from '../src/engine/progression/progression';
import { computeMetrics } from '../src/engine/reports/metrics';
import { foundCompany } from '../src/engine/business/ownership';
import { fortuneAdjustment, listedFortune } from '../src/engine/saga/ranking';
import { valuation } from '../src/engine/business/reports';
import { runBot } from './bots/strategies';
import type { GameState } from '../src/engine/state';

const money = (crit: { label: string }) => Number(crit.label.replace(/[^\d]/g, '').slice(0, 12));

describe('Etapas 8–12', () => {
  it('los saltos de fortuna entre etapas altas son de 2,5 a 5 veces (antes 20)', () => {
    const s = makeGame('herencia', 'stages-ratio');
    const m = computeMetrics(s);
    const t = [7, 8, 9, 10, 11, 12].map((n) => money(STAGES[n - 1].criteria(s, m)[0]));
    for (let i = 1; i < t.length; i++) {
      expect(t[i] / t[i - 1]).toBeGreaterThanOrEqual(2.5);
      expect(t[i] / t[i - 1]).toBeLessThanOrEqual(5);
    }
  });

  it('cada etapa alta pide algo más que dinero, con caminos alternativos', () => {
    const s = makeGame('herencia', 'stages-alt');
    const m = computeMetrics(s);
    for (const n of [8, 9, 10, 11, 12]) {
      const c = STAGES[n - 1].criteria(s, m);
      expect(c.length).toBeGreaterThanOrEqual(3);
    }
    // Etapa 8 sin empresas: rentas que cubren el doble de los gastos.
    const label = STAGES[7].criteria(s, m)[2].label;
    expect(label).toMatch(/rentas/);
    // Inmuebles en dos ciudades cuentan como presencia.
    expect(citiesPresent(s)).toBe(0);
  });

  it('un emprendedor que se expande llega a la etapa 8 en menos de 10 años', () => {
    const r = runBot('emprendedor', 'tecnico', 'stages-exp', 10, { expand: true });
    expect(r.stageDays[8]).toBeDefined();
    expect(r.stageDays[8]! / 365).toBeLessThan(10);
  }, 600_000);
});

describe('Fortuna estimada', () => {
  function withCompany(seed: string): GameState {
    const s = makeGame('herencia', seed);
    post(s.ledger, { day: 0, memo: 'Capital', cf: 'internal', lines: [{ account: 'checking', debit: usd(300_000) }, { account: 'opening_equity', credit: usd(300_000) }] });
    expect(foundCompany(s, { sector: 'cafeteria', name: 'Café Fortuna', legalForm: 'srl', capital: usd(150_000) }).ok).toBe(true);
    return s;
  }

  it('valúa tus empresas a lo que valen y no toca tu balance', () => {
    const s = withCompany('fortune-1');
    for (let d = 0; d < 200; d++) advanceDay(s);
    const co = s.companies[0];
    const adj = fortuneAdjustment(s);
    expect(adj).toBe(Math.round(valuation(s, co).value * co.ownership) - co.carrying);
    const nw = computeMetrics(s).netWorth;
    while (!isLastDayOfMonth(s.day)) advanceDay(s);
    expect(s.saga.ranking.fortuneAdj).toBeDefined();
    expect(listedFortune(s, nw)).toBe(nw + s.saga.ranking.fortuneAdj!);
    expectConsistent(s);
  });

  it('sin empresas, la fortuna estimada es el patrimonio', () => {
    const s = makeGame('herencia', 'fortune-0');
    for (let d = 0; d < 40; d++) advanceDay(s);
    expect(s.saga.ranking.fortuneAdj ?? 0).toBe(0);
    expect(listedFortune(s, 12345)).toBe(12345);
  });

  it('el puesto estimado queda registrado cada mes aunque estés fuera de la lista', () => {
    const s = makeGame('herencia', 'fortune-est');
    for (let d = 0; d < 70; d++) advanceDay(s);
    const marks = s.saga.ranking.history;
    expect(marks.length).toBeGreaterThan(0);
    expect(marks[marks.length - 1].est).toBeGreaterThan(100);
  });
});

describe('Guardado v7 (1.6)', () => {
  it('una partida v6 se migra: sucursales, elenco y fortuna estimada vacíos, y sigue jugando', async () => {
    const { migrate } = await import('../src/persistence/migrations');
    const { serialize, deserialize } = await import('../src/persistence/save');
    const { SAVE_VERSION } = await import('../src/engine/state');
    const s = makeGame('herencia', 'mig-v7');
    post(s.ledger, { day: 0, memo: 'Capital', cf: 'internal', lines: [{ account: 'checking', debit: usd(300_000) }, { account: 'opening_equity', credit: usd(300_000) }] });
    foundCompany(s, { sector: 'cafeteria', name: 'Café Viejo', legalForm: 'srl', capital: usd(100_000) });
    for (let d = 0; d < 40; d++) advanceDay(s);
    const raw = JSON.parse(JSON.stringify(s));
    raw.version = 6;
    for (const co of raw.companies) delete co.branches;
    delete raw.saga.cast;
    delete raw.saga.ranking.fortuneAdj;
    const { state, migratedFrom } = migrate(raw);
    expect(migratedFrom).toBe(6);
    expect(state.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(7);
    expect(state.companies[0].branches).toEqual([]);
    expect(state.saga.cast).toEqual([]);
    expect(state.saga.ranking.fortuneAdj).toBe(0);
    for (let d = 0; d < 60; d++) advanceDay(state);
    expectConsistent(state);
    const back = deserialize(serialize(state, 1));
    expect(back.ok).toBe(true);
  });
});
