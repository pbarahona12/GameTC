/**
 * 1.6 · Crisis según tu exposición (auditoría F5): la recesión golpea según la
 * concentración y la diversificación protege.
 */
import { describe, it, expect } from 'vitest';
import { makeGame, expectConsistent } from './helpers';
import { post } from '../src/engine/ledger/ledger';
import { usd } from '../src/engine/money';
import { advanceDay } from '../src/engine/simulation';
import { foundCompany } from '../src/engine/business/ownership';
import { exposure, exposureChance, exposureMonth, exposureCrisis, EXPOSURE_MIN_TOTAL } from '../src/engine/saga/exposure';
import { consumerDemand, cityDemand, type EconEvent } from '../src/engine/economy/economy';
import { expectedDemand } from '../src/engine/business/operations';
import { monthlyZones } from '../src/engine/realestate/realestate';
import { SECTOR_BY_ID } from '../src/content/sectors';
import { ZONES } from '../src/content/realestate';
import { analyzeWorld } from '../src/engine/advisor/advisorWorld';
import type { GameState } from '../src/engine/state';

function player(seed: string, total: number, inCompany: number): GameState {
  const s = makeGame('herencia', seed);
  post(s.ledger, { day: 0, memo: 'Capital', cf: 'internal', lines: [{ account: 'checking', debit: usd(total) }, { account: 'opening_equity', credit: usd(total) }] });
  const r = foundCompany(s, { sector: 'cafeteria', name: 'Café Expuesto', legalForm: 'srl', capital: usd(inCompany) });
  expect(r.ok, r.ok ? '' : r.error).toBe(true);
  for (let d = 0; d < 40; d++) advanceDay(s);
  return s;
}

function enterRecession(s: GameState): void {
  s.macro.phase = 'recesion';
  s.macro.phaseMonths = 0;
}

const crises = (s: GameState) => s.macro.events.filter((e) => e.kind.startsWith('exposicion_'));

describe('Exposición', () => {
  it('mide cuánto de tu patrimonio depende de un sector y una ciudad', () => {
    const s = player('exp-conc', 900_000, 800_000);
    const e = exposure(s);
    expect(e.total).toBeGreaterThan(EXPOSURE_MIN_TOTAL);
    expect(e.top).not.toBeNull();
    expect(e.top!.kind).toBe('sector'); // empate con la ciudad: primero el sector
    expect(e.top!.key).toBe('cafeteria');
    expect(e.top!.share).toBeGreaterThan(0.6);
    expect(e.buckets.find((b) => b.kind === 'city')!.key).toBe('valdoria');
  });

  it('diversificado no tiene concentración que castigar', () => {
    const s = player('exp-div', 900_000, 150_000);
    const e = exposure(s);
    expect(e.top).toBeNull();
    expect(exposureChance(e, 'recesion')).toBe(0);
  });

  it('cuanto más concentrado, más probable; la desaceleración pesa menos; debajo de $500 mil no cuenta', () => {
    const mk = (share: number, total = EXPOSURE_MIN_TOTAL * 2) => ({ total, buckets: [], top: { kind: 'sector' as const, key: 'cafeteria', label: 'cafetería', value: Math.round(total * share), share } });
    expect(exposureChance(mk(0.5), 'recesion')).toBeLessThan(exposureChance(mk(0.8), 'recesion'));
    expect(exposureChance(mk(0.8), 'desaceleracion')).toBeLessThan(exposureChance(mk(0.8), 'recesion'));
    expect(exposureChance(mk(1), 'recesion')).toBeLessThanOrEqual(0.9);
    expect(exposureChance(mk(0.9, EXPOSURE_MIN_TOTAL - 1), 'recesion')).toBe(0);
  });
});

describe('Crisis al entrar en recesión', () => {
  it('al concentrado le llega (anunciada) una crisis de su sector; al diversificado, nunca', () => {
    let hits = 0;
    for (let i = 0; i < 8; i++) {
      const s = player(`exp-hit-${i}`, 900_000, 820_000);
      enterRecession(s);
      exposureMonth(s);
      const c = crises(s);
      if (c.length) {
        hits++;
        expect(c[0].kind).toBe('exposicion_cafeteria');
        expect(c[0].startDay).toBeGreaterThan(s.day); // con anticipación
        expect(c[0].effects.demand!.cafeteria).toBeLessThan(1);
        expect(s.saga.chronicle.some((x) => x.title.toLowerCase().includes('crisis del sector'))).toBe(true);
        // Una sola por ciclo.
        exposureMonth(s);
        expect(crises(s).length).toBe(1);
      }
      const d = player(`exp-hit-${i}`, 900_000, 150_000);
      enterRecession(d);
      exposureMonth(d);
      expect(crises(d)).toEqual([]);
    }
    expect(hits).toBeGreaterThanOrEqual(4);
  });

  it('en expansión, en una proyección o en un desafío con economía fija no pasa nada', () => {
    const s = player('exp-none', 900_000, 820_000);
    s.macro.phase = 'expansion';
    s.macro.phaseMonths = 0;
    exposureMonth(s);
    enterRecession(s);
    s.meta.projection = true;
    exposureMonth(s);
    s.meta.projection = false;
    s.macro.forced = { phase: 'recesion', until: s.day + 100 };
    exposureMonth(s);
    expect(crises(s)).toEqual([]);
  });

  it('la crisis del sector recorta un 20 % la demanda del rubro mientras dura', () => {
    const s = player('exp-effect', 900_000, 820_000);
    const before = consumerDemand(s, 'cafeteria');
    const other = consumerDemand(s, 'saas');
    const def = exposureCrisis({ kind: 'sector', key: 'cafeteria', label: 'cafetería', value: 1, share: 0.8 }, 6);
    const ev: EconEvent = { id: 9999, kind: def.kind, name: def.name, icon: def.icon, description: def.description, startDay: s.day, endDay: s.day + 180, effects: def.effects };
    s.macro.events.push(ev);
    expect(consumerDemand(s, 'cafeteria') / before).toBeCloseTo(0.8, 6);
    expect(consumerDemand(s, 'saas')).toBeCloseTo(other, 9);
  });

  it('la crisis regional baja las ventas y los inmuebles solo en esa ciudad', () => {
    const s = player('exp-city', 900_000, 820_000);
    const co = s.companies[0];
    const p = SECTOR_BY_ID.cafeteria.products[0];
    const d0 = expectedDemand(s, co, p, co.products[0].price);
    const twin = structuredClone(s);
    const def = exposureCrisis({ kind: 'city', key: 'valdoria', label: 'Valdoria', value: 1, share: 0.8 }, 6);
    s.macro.events.push({ id: 9998, kind: def.kind, name: def.name, icon: def.icon, description: def.description, startDay: s.day, endDay: s.day + 180, effects: def.effects });
    expect(cityDemand(s, 'valdoria')).toBeCloseTo(0.8, 9);
    expect(cityDemand(s, 'norvalia')).toBe(1);
    expect(expectedDemand(s, co, p, co.products[0].price) / d0).toBeCloseTo(0.8, 6);
    monthlyZones(s);
    monthlyZones(twin);
    for (const z of ZONES) {
      const a = s.realEstate.zones.find((x) => x.id === z.id)!.index;
      const b = twin.realEstate.zones.find((x) => x.id === z.id)!.index;
      if (z.jurisdiction === 'valdoria') expect(a).toBeLessThan(b);
      else expect(a).toBeCloseTo(b, 9);
    }
  });

  it('el asesor avisa del riesgo antes de la recesión y la partida cierra todos los meses', () => {
    const s = player('exp-adv', 900_000, 820_000);
    s.macro.phase = 'desaceleracion';
    const ins = analyzeWorld(s).find((i) => i.id === 'exposure-crisis');
    expect(ins).toBeDefined();
    expect(ins!.what).toMatch(/cafetería/);
    s.macro.phase = 'expansion';
    expect(analyzeWorld(s).find((i) => i.id === 'exposure-crisis')).toBeUndefined();
    // Un año con recesión y crisis por exposición: contabilidad consistente.
    s.macro.phase = 'desaceleracion';
    s.macro.phaseMonths = 30;
    s.macro.forced = null;
    const def = exposureCrisis({ kind: 'sector', key: 'cafeteria', label: 'cafetería', value: 1, share: 0.8 }, 8);
    s.macro.events.push({ id: 9997, kind: def.kind, name: def.name, icon: def.icon, description: def.description, startDay: s.day + 10, endDay: s.day + 250, effects: def.effects });
    for (let d = 0; d < 365; d++) {
      advanceDay(s);
      if (d % 60 === 59) expectConsistent(s);
    }
    expectConsistent(s);
  }, 120_000);
});
