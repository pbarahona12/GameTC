import { describe, it, expect } from 'vitest';
import { makeGame, expectConsistent, forceHire } from './helpers';
import type { GameState } from '../src/engine/state';
import { newGame } from '../src/engine/state';
import { post } from '../src/engine/ledger/ledger';
import { usd } from '../src/engine/money';
import { simulateDays } from '../src/engine/simulation';
import { balanceSheet } from '../src/engine/reports/statements';
import { foundCompany } from '../src/engine/business/ownership';
import { coPost } from '../src/engine/business/companyLedger';
import { rivalry, rivalryMonth, startPriceWar, nemesisOf, warsIn } from '../src/engine/saga/rivalry';
import { hostilityFactor } from '../src/engine/world/rivals';
import { decide, TEMPLATE_BY_ID, openDilemma } from '../src/engine/saga/dilemmas';
import { medalFor, CHALLENGE_BY_ID, describeResult, resultCode, checkChallenge } from '../src/engine/saga/challenges';
import { heirProfile, heirs, succession, life, monthlyDeathRisk, setMortality } from '../src/engine/saga/life';
import { execAdjustment, effectiveManagerSkill } from '../src/engine/business/common';
import { hireExecTeam, execMonth, execCost } from '../src/engine/saga/executive';
import { issueBonds, bondBlocker, mergeCompanies, mergeBlocker } from '../src/engine/saga/corporate';
import { processCoLoans } from '../src/engine/business/finance';
import { payExpense } from '../src/engine/finance/payments';
import { onStage } from '../src/engine/saga/index';
import { generateCandidates, hire } from '../src/engine/business/staff';

function gift(s: GameState, dollars: number): void {
  post(s.ledger, { day: s.day, memo: 'Aporte de prueba', cf: 'internal', tag: 'opening', lines: [{ account: 'checking', debit: usd(dollars) }, { account: 'opening_equity', credit: usd(dollars) }] });
}

/** Historia ficticia de 24 meses con ganancias (para habilitar bonos, socios, etc.). */
function fakeHistory(co: GameState['companies'][number], months = 24, net = 20_000, revenue = 60_000): void {
  const base = co.history[0] ?? { day: 0, revenue: 0, grossProfit: 0, netIncome: 0, cash: 0, equity: 0, inventory: 0, employees: 0, share: 0, quality: 50, reputation: 50, awareness: 0 };
  for (let i = 0; i < months; i++) co.history.push({ ...base, netIncome: usd(net), revenue: usd(revenue) });
}

describe('1.4 · Rivalidad: némesis, guerras de precios y coaliciones', () => {
  it('un rival con rencor ≥ 75 se vuelve némesis, ataca más y se vence al comprarlo', () => {
    const s = makeGame('herencia', 'nem-1');
    const r = s.world.rivals.find((x) => x.id === 'altamira')!;
    gift(s, 100_000);
    foundCompany(s, { sector: 'cafeteria', name: 'Café', legalForm: 'srl', capital: usd(40_000) });
    const before = hostilityFactor(s, 'cafeteria');
    r.attitude = 80;
    rivalryMonth(s);
    expect(nemesisOf(s)?.id).toBe('altamira');
    expect(hostilityFactor(s, 'cafeteria')).toBeGreaterThan(before + 0.79);
    expect(s.saga.chronicle.some((c) => c.title.includes('némesis'))).toBe(true);
    r.acquired = { day: s.day, price: 1 };
    rivalryMonth(s);
    expect(nemesisOf(s)).toBeUndefined();
    expect(rivalry(s).beaten).toContain('altamira');
  });

  it('la guerra de precios baja los precios del rival (o abre un local), abre la decisión y al terminar todo vuelve', () => {
    const s = makeGame('herencia', 'war-1');
    gift(s, 100_000);
    foundCompany(s, { sector: 'cafeteria', name: 'Café Uno', legalForm: 'srl', capital: usd(40_000) });
    const co = s.companies[0];
    const r = s.world.rivals.find((x) => x.id === 'altamira')!;
    const m = s.markets.cafeteria;
    const n0 = m.competitors.filter((c) => c.active).length;
    const war = startPriceWar(s, r, 'cafeteria', 150)!;
    expect(war).toBeTruthy();
    expect(warsIn(s, 'cafeteria').length).toBe(1);
    if (war.battleId !== null) expect(m.competitors.filter((c) => c.active).length).toBe(n0 + 1);
    else expect(war.cut.length).toBeGreaterThan(0);
    const d = openDilemma(s, 'guerra_precios', { rivalId: r.id, rival: r.name, companyId: co.id, company: co.name, sector: 'cafeteria', sectorName: 'Cafetería', until: war.until }, 10)!;
    const price = co.products[0].price;
    expect(decide(s, d.id, 'igualar').ok).toBe(true);
    expect(co.products[0].price).toBe(Math.round(price * 0.9));
    s.day = war.until + 1;
    rivalryMonth(s);
    expect(warsIn(s, 'cafeteria').length).toBe(0);
    expect(m.competitors.filter((c) => c.active).length).toBe(n0);
    expect(rivalry(s).warsSurvived).toBe(1);
  });

  it('siendo dominante, los dos grupos con más rencor pueden aliarse contra vos', () => {
    const s = makeGame('herencia', 'coal-1');
    s.progression.stage = 9;
    s.world.rivals[0].attitude = 50;
    s.world.rivals[1].attitude = 40;
    for (let i = 0; i < 400 && !rivalry(s).coalition; i++) rivalryMonth(s);
    const c = rivalry(s).coalition!;
    expect(c).toBeTruthy();
    expect(c.until - c.from).toBe(1095);
    expect(c.members.length).toBe(2);
  });

  it('un aliado no te ataca: su hostilidad no cuenta', () => {
    const s = makeGame('herencia', 'ally-1');
    for (const r of s.world.rivals) if (r.sectors.includes('saas')) r.ally = { from: 0, until: 9999, against: null };
    expect(hostilityFactor(s, 'saas')).toBe(0);
  });
});

describe('1.4 · Desafíos que crecen con la fortuna (dilemas nuevos)', () => {
  function withCompany(seed: string) {
    const s = makeGame('herencia', seed);
    gift(s, 500_000);
    foundCompany(s, { sector: 'minimarket', name: 'Gran Almacén', legalForm: 'srl', capital: usd(200_000) });
    const co = s.companies[0];
    fakeHistory(co, 12);
    return { s, co };
  }

  it('hay al menos 30 plantillas de decisiones con plazo', () => {
    expect(Object.keys(TEMPLATE_BY_ID).length).toBeGreaterThanOrEqual(30);
  });

  it('posición dominante: el acuerdo es una multa a la empresa y la contabilidad cuadra', () => {
    const { s, co } = withCompany('dom-1');
    const d = openDilemma(s, 'posicion_dominante', { companyId: co.id, company: co.name, share: 40, revenue: usd(720_000) }, 15)!;
    const cash = co.ledger.balances.cash;
    expect(decide(s, d.id, 'acuerdo').ok).toBe(true);
    expect(cash - co.ledger.balances.cash).toBe(usd(14_400));
    expect(co.ledger.balances.fines).toBe(usd(14_400));
    expectConsistent(s);
  });

  it('socio con capital: entra dinero a la caja, se diluye tu parte y cuadra', () => {
    const { s, co } = withCompany('socio-1');
    const d = openDilemma(s, 'socio_capital', { companyId: co.id, company: co.name, investor: 'Ana Ruiz', money: usd(100_000), k: 100 }, 14)!;
    const cash = co.ledger.balances.cash;
    expect(decide(s, d.id, 'aceptar').ok).toBe(true);
    expect(co.ledger.balances.cash - cash).toBe(usd(100_000));
    expect(co.ownership).toBeCloseTo(0.8, 5);
    expectConsistent(s);
  });

  it('horas extra suben el desempeño (y el estrés)', () => {
    const s = makeGame('egresado', 'ot-1');
    forceHire(s, 'ventas_asistente');
    s.career.job!.performance = 50;
    const stress = s.player.attributes.stress;
    const d = openDilemma(s, 'horas_extra', { project: 'el cierre' }, 6)!;
    decide(s, d.id, 'aceptar');
    expect(s.career.job!.performance).toBe(62);
    expect(s.player.attributes.stress).toBeGreaterThan(stress);
  });
});

describe('1.4 · Medallas, herederos y mortalidad', () => {
  it('las medallas premian la eficiencia y aparecen en el resultado', () => {
    expect(medalFor('millon', 365 * 7)).toBe('oro');
    expect(medalFor('millon', 365 * 11)).toBe('plata');
    expect(medalFor('millon', 365 * 19)).toBe('bronce');
    expect(medalFor('recesion', 60_000)).toBe('oro');
    expect(medalFor('recesion', 1_000)).toBeNull();
    expect(describeResult('millon', 365 * 7)).toMatch(/oro/);
    expect(CHALLENGE_BY_ID.deudas.learn?.questions.length).toBeGreaterThan(1);
    const s = newGame({ name: 'T', background: 'egresado', style: 'libre', seed: 'x', nowReal: 1, challenge: 'colchon' });
    s.ledger.balances.savings += 0; // sin cambios: todavía no cumple
    checkChallenge(s);
    expect(s.saga.challenge?.medal).toBeUndefined();
    expect(resultCode('millon', 100)).toMatch(/^MILLON-100-/);
  });

  it('el perfil de cada heredero es el que recibe en la sucesión', () => {
    const s = makeGame('tecnico', 'heir-1');
    life(s).birthDay = s.day - Math.round(62 * 365.25);
    const h = heirs(s)[0];
    const p = heirProfile(s, h.id);
    expect(heirProfile(s, h.id)).toEqual(p);
    expect(p.strengths.length).toBeGreaterThan(0);
    expect(p.weaknesses.length).toBe(1);
    succession(s, h.id, 'retiro');
    for (const k of Object.keys(p.skills)) expect(s.skills[k as keyof typeof s.skills].level).toBe(p.skills[k as keyof typeof p.skills]);
  });

  it('con el fallecimiento apagado no hay riesgo de muerte', () => {
    const s = makeGame('egresado', 'mort-1');
    life(s).birthDay = s.day - Math.round(85 * 365.25);
    expect(monthlyDeathRisk(s)).toBeGreaterThan(0);
    setMortality(s, false);
    expect(monthlyDeathRisk(s)).toBe(0);
  });
});

describe('1.4 · Equipo directivo, bonos y fusiones', () => {
  it('con más de 4 empresas y sin equipo, los gerentes rinden menos; el equipo lo corrige y se paga', () => {
    const s = makeGame('herencia', 'exec-1');
    gift(s, 2_000_000);
    for (let i = 0; i < 6; i++) expect(foundCompany(s, { sector: 'minimarket', name: `Almacén ${i}`, legalForm: 'srl', capital: usd(40_000) }).ok).toBe(true);
    expect(execAdjustment(s)).toBe(-16);
    const co = s.companies[0];
    const c = generateCandidates(s, co, 'gerente')[0];
    hire(s, co, c.id, true);
    const base = co.employees.find((e) => e.role === 'gerente')!.skill;
    expect(effectiveManagerSkill(s, co)).toBe(Math.max(1, base - 16));
    expect(hireExecTeam(s).ok).toBe(true);
    expect(effectiveManagerSkill(s, co)).toBe(Math.min(100, base + 5));
    const cost = execCost(s);
    const cash = s.ledger.balances.checking;
    execMonth(s);
    expect(cash - s.ledger.balances.checking).toBe(cost);
    expectConsistent(s);
  });

  it('bonos corporativos: entra la caja, se pagan cupones y el capital al vencer', () => {
    const s = makeGame('herencia', 'bond-1');
    gift(s, 3_000_000);
    foundCompany(s, { sector: 'minimarket', name: 'Mercado SA', legalForm: 'corporacion', capital: usd(2_000_000) });
    const co = s.companies[0];
    expect(bondBlocker(s, co)).toMatch(/24 meses/);
    fakeHistory(co, 24);
    co.openDay = s.day - 400;
    // EBITDA real del último año (ventas registradas en el libro de la empresa).
    coPost(co.ledger, { day: s.day, memo: 'Ventas de prueba', cf: 'operating', tag: 'sales', lines: [{ account: 'cash', debit: usd(800_000) }, { account: 'sales', credit: usd(800_000) }] });
    expect(bondBlocker(s, co)).toBeNull();
    const cash = co.ledger.balances.cash;
    expect(issueBonds(s, co.id, usd(600_000), 3).ok).toBe(true);
    expect(co.ledger.balances.cash - cash).toBe(usd(600_000 * 0.98));
    expect(co.ledger.balances.loans).toBe(usd(600_000));
    const bond = co.loans.find((l) => l.bullet)!;
    s.day = bond.nextDueDay;
    processCoLoans(s, co);
    expect(co.ledger.balances.loans).toBe(usd(600_000));
    bond.paymentsMade = bond.termMonths - 1;
    s.day = bond.nextDueDay;
    processCoLoans(s, co);
    expect(co.ledger.balances.loans).toBe(0);
    expectConsistent(s);
  });

  it('fusión: todo pasa a la absorbente, la otra desaparece y la contabilidad cuadra', () => {
    const s = makeGame('herencia', 'merge-1');
    gift(s, 300_000);
    foundCompany(s, { sector: 'minimarket', name: 'Almacén A', legalForm: 'srl', capital: usd(60_000) });
    foundCompany(s, { sector: 'minimarket', name: 'Almacén B', legalForm: 'srl', capital: usd(60_000) });
    simulateDays(s, 40);
    const [a, b] = s.companies;
    expect(mergeBlocker(s, a, b)).toBeNull();
    const nw = balanceSheet(s).netWorth;
    const staff = a.employees.length + b.employees.length;
    const r = mergeCompanies(s, a.id, b.id);
    expect(r.ok).toBe(true);
    expect(s.companies.length).toBe(1);
    expect(s.companies[0].employees.length).toBe(staff);
    expect(s.formerCompanies.some((f) => f.outcome === 'fusionada')).toBe(true);
    // Solo cambia por el costo de integración (y la revaluación de la participación).
    expect(Math.abs(balanceSheet(s).netWorth - nw)).toBeLessThan(usd(20_000));
    expectConsistent(s);
    simulateDays(s, 35);
    expectConsistent(s);
  });
});

describe('1.4 · Modo tranquilo y cierre de capítulo', () => {
  it('en Fácil, el primer atraso no tiene recargo ni marca en el historial; el segundo sí', () => {
    const s = newGame({ name: 'T', background: 'egresado', style: 'libre', seed: 'calm', nowReal: 1, difficulty: 'facil' });
    const all = s.ledger.balances.checking + s.ledger.balances.cash_wallet + s.ledger.balances.savings;
    const card = s.bank.card ? usd(5000) : 0;
    payExpense(s, 'food', all + card + usd(100), { memo: 'Prueba', tag: 'test', method: 'checking' });
    expect(s.credit.arrearsEvents).toBe(0);
    expect(s.ledger.balances.late_fees).toBe(0);
    payExpense(s, 'food', card + usd(100), { memo: 'Prueba 2', tag: 'test', method: 'checking' });
    expect(s.credit.arrearsEvents).toBe(1);
    expectConsistent(s);
  });

  it('al subir de etapa, la tarjeta dice qué queda abierto para la próxima', () => {
    const s = makeGame('egresado', 'chap-1');
    s.saga.celebrations = [];
    onStage(s, 3, 'Primeros ahorros', [], 'Descripción.', 'llegar a la etapa 4 (Primeras inversiones)');
    const c = s.saga.celebrations[s.saga.celebrations.length - 1];
    expect(c.text).toMatch(/Para la próxima: .*etapa 4/);
  });
});
