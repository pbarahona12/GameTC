/**
 * 1.6 · Elenco que vuelve (auditoría F3, D11): las personas de los dilemas
 * recuerdan lo que hiciste y vuelven.
 */
import { describe, it, expect } from 'vitest';
import { makeGame, expectConsistent } from './helpers';
import { post } from '../src/engine/ledger/ledger';
import { usd } from '../src/engine/money';
import { advanceDay } from '../src/engine/simulation';
import { foundCompany } from '../src/engine/business/ownership';
import { generateCandidates, hire } from '../src/engine/business/staff';
import { decide, dilemmaView, TEMPLATE_BY_ID } from '../src/engine/saga/dilemmas';
import { castFor, castOf, remember, returning, CAST_MAX, RETURN_GAP } from '../src/engine/saga/cast';
import { srng } from '../src/engine/saga/ranking';
import type { GameState } from '../src/engine/state';
import type { Dilemma } from '../src/engine/saga/types';

function withCompany(seed: string, staff = 5): GameState {
  const s = makeGame('herencia', seed);
  post(s.ledger, { day: 0, memo: 'Capital', cf: 'internal', lines: [{ account: 'checking', debit: usd(300_000) }, { account: 'opening_equity', credit: usd(300_000) }] });
  expect(foundCompany(s, { sector: 'cafeteria', name: 'Café Elenco', legalForm: 'srl', capital: usd(150_000) }).ok).toBe(true);
  const co = s.companies[0];
  while (co.employees.filter((e) => e.role !== 'gerente').length < staff) {
    const c = generateCandidates(s, co, 'mesero')[0];
    expect(hire(s, co, c.id, true).ok).toBe(true);
  }
  for (let d = 0; d < 30; d++) advanceDay(s);
  return s;
}

/** Abre un dilema de la plantilla (como lo haría el ciclo diario). */
function open(s: GameState, template: string): Dilemma {
  const t = TEMPLATE_BY_ID[template];
  expect(t.eligible(s)).toBe(true);
  const made = t.create(s, srng(s));
  expect(made).not.toBeNull();
  const d: Dilemma = { id: s.meta.nextId++, template, day: s.day, deadline: s.day + made!.days, params: made!.params, status: 'abierto' };
  s.saga.dilemmas.open.push(d);
  return d;
}

const wait = (s: GameState, days: number) => {
  for (let i = 0; i < days; i++) advanceDay(s);
};

describe('Elenco', () => {
  it('una persona nueva queda en el elenco; con nombre dado siempre es la misma', () => {
    const s = makeGame('herencia', 'cast-basic');
    const g = srng(s);
    const a = castFor(s, 'empleado', g, 'empleado de X', 'Ana Ruiz');
    const b = castFor(s, 'empleado', g, 'empleado de X', 'Ana Ruiz');
    expect(b).toBe(a);
    remember(s, a.id, 40, 'Le pagaste una capacitación');
    expect(a.bond).toBe(40);
    expect(a.memories[0].text).toMatch(/capacitación/);
    for (let i = 0; i < CAST_MAX + 5; i++) castFor(s, 'contacto', g, 'contacto', `Persona ${i}`);
    expect(castOf(s).length).toBeLessThanOrEqual(CAST_MAX);
    // Quien dejó huella no se olvida.
    expect(castOf(s)).toContain(a);
  });

  it('despedir a alguien en un dilema lo deja resentido y con memoria; el dilema muestra a la persona', () => {
    const s = withCompany('cast-fire');
    const d = open(s, 'error_empleado');
    expect(dilemmaView(s, d)!.person?.name).toBe(String(d.params.name));
    expect(decide(s, d.id, 'despedir').ok).toBe(true);
    const m = castOf(s).find((c) => c.name === d.params.name)!;
    expect(m.bond).toBeLessThanOrEqual(-40);
    expect(m.memories.slice(-1)[0].text).toMatch(/despediste/i);
    expectConsistent(s);
  });
});

describe('Vuelven', () => {
  it('el resentido vuelve desde un rival a llevarse a tu gente; no hacer nada te cuesta empleados', () => {
    const s = withCompany('cast-grudge', 6);
    const d = open(s, 'error_empleado');
    decide(s, d.id, 'despedir');
    expect(TEMPLATE_BY_ID.reencuentro_rencor.eligible(s)).toBe(false); // recién pasó
    wait(s, RETURN_GAP + 1);
    expect(returning(s).length).toBeGreaterThan(0);
    const r = open(s, 'reencuentro_rencor');
    expect(r.params.kind).toBe('fuga');
    expect(TEMPLATE_BY_ID.reencuentro_rencor.body(s, r)).toMatch(/despediste/i);
    const co = s.companies[0];
    const staff = co.employees.length;
    expect(decide(s, r.id, 'nada').ok).toBe(true);
    expect(co.employees.length).toBe(staff - Number(r.params.n));
    // Ya volvió: no vuelve enseguida otra vez.
    expect(returning(s).some((c) => c.name === d.params.name)).toBe(false);
    expectConsistent(s);
  }, 60_000);

  it('el bono de retención sale de la caja de la empresa y nadie se va', () => {
    const s = withCompany('cast-bonus', 6);
    const d = open(s, 'error_empleado');
    decide(s, d.id, 'despedir');
    wait(s, RETURN_GAP + 1);
    const r = open(s, 'reencuentro_rencor');
    const co = s.companies[0];
    const staff = co.employees.length;
    const cash = co.ledger.balances.cash;
    expect(decide(s, r.id, 'pagar').ok).toBe(true);
    expect(co.employees.length).toBe(staff);
    expect(cash - co.ledger.balances.cash).toBe(Number(r.params.bonus));
    expectConsistent(s);
  }, 60_000);

  it('quien te aprecia vuelve a trabajar con vos, con mucha experiencia', () => {
    const s = withCompany('cast-favor', 4);
    const co = s.companies[0];
    const d = open(s, 'error_empleado');
    decide(s, d.id, 'capacitar');
    const m = castOf(s).find((c) => c.name === d.params.name)!;
    remember(s, m.id, 20, 'Lo ascendiste');
    expect(m.bond).toBeGreaterThanOrEqual(30);
    // Se va de la empresa (por ejemplo, se mudó) y pasa el tiempo.
    co.employees = co.employees.filter((e) => e.name !== m.name);
    wait(s, RETURN_GAP + 1);
    const r = open(s, 'reencuentro_favor');
    expect(r.params.kind).toBe('candidato');
    expect(decide(s, r.id, 'si').ok).toBe(true);
    const back = co.employees.find((e) => e.name === m.name)!;
    expect(back).toBeDefined();
    expect(back.skill).toBeGreaterThanOrEqual(72);
    expectConsistent(s);
  }, 60_000);

  it('el amigo que invirtió con vos vuelve con un negocio; el desenlace pasa por tu contabilidad', () => {
    const s = withCompany('cast-deal', 3);
    const g = srng(s);
    const f = castFor(s, 'amigo', g, 'amigo emprendedor');
    remember(s, f.id, 35, 'Pusiste dinero en su proyecto');
    wait(s, RETURN_GAP + 1);
    const r = open(s, 'reencuentro_favor');
    expect(r.params.kind).toBe('oportunidad');
    const before = s.ledger.balances.checking;
    expect(decide(s, r.id, 'si').ok).toBe(true);
    expect(before - s.ledger.balances.checking).toBe(Number(r.params.amount));
    expect(s.saga.dilemmas.pending.some((p) => p.template === 'reencuentro_favor')).toBe(true);
    wait(s, 460);
    expect(s.saga.dilemmas.pending.some((p) => p.template === 'reencuentro_favor')).toBe(false);
    expectConsistent(s);
  }, 120_000);
});
