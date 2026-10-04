import { describe, it, expect } from 'vitest';
import { makeGame, expectConsistent } from './helpers';
import type { GameState } from '../src/engine/state';
import { post } from '../src/engine/ledger/ledger';
import { usd } from '../src/engine/money';
import { advanceDay, simulateDays } from '../src/engine/simulation';
import { isLastDayOfMonth } from '../src/engine/time/calendar';
import { balanceSheet } from '../src/engine/reports/statements';
import { foundCompany } from '../src/engine/business/ownership';
import { SECTOR_BY_ID } from '../src/content/sectors';
import { life, ageOf, monthlyDeathRisk, heirs, estateTax, succession, retire, createFoundation, donateToFoundation, foundationReputation, lifeMonth, ageHealthPenalty, RETIRE_AGE, setHeir, designatedHeir, setMortality } from '../src/engine/saga/life';
import { agenda } from '../src/engine/saga/agenda';
import { ipoBlocker, goPublic, marketCap, listedMonth, acquireRival, rivalBlocker, rivalPrice, activeRivals, buyBackShares } from '../src/engine/saga/corporate';
import { erasMonth, currentEra } from '../src/engine/saga/eras';
import { signDeal, possibleDeals, dealDiscount, dealsMonth, endDeal } from '../src/engine/saga/integration';
import { supplierUnitCost } from '../src/engine/business/inventory';
import { surplusBreakdown, investSurplus } from '../src/engine/saga/quick';
import { explainCompany } from '../src/engine/reports/explain';
import { CHALLENGE_BY_ID } from '../src/engine/saga/challenges';
import { newGame } from '../src/engine/state';
import { dilemmasDay, TEMPLATE_BY_ID, decide } from '../src/engine/saga/dilemmas';
import { hostilityFactor } from '../src/engine/world/rivals';
import { migrate } from '../src/persistence/migrations';
import { spendable } from '../src/engine/finance/payments';

function gift(s: GameState, dollars: number): void {
  post(s.ledger, { day: s.day, memo: 'Aporte de prueba', cf: 'internal', tag: 'opening', lines: [{ account: 'checking', debit: usd(dollars) }, { account: 'opening_equity', credit: usd(dollars) }] });
}

function setAge(s: GameState, years: number): void {
  life(s).birthDay = s.day - Math.round(years * 365.25);
}

function toMonthEnd(s: GameState): void {
  do advanceDay(s);
  while (!isLastDayOfMonth(s.day));
}

describe('1.4 · Vida, legado y sucesión', () => {
  it('la edad empieza según el origen y la salud pesa desde los 50; el riesgo de morir aparece a los 68', () => {
    const s = makeGame('tecnico', 'life-1');
    expect(Math.round(ageOf(s))).toBe(21);
    expect(ageHealthPenalty(s)).toBe(0);
    setAge(s, 60);
    expect(ageHealthPenalty(s)).toBeCloseTo(6, 0);
    setAge(s, 67);
    expect(monthlyDeathRisk(s)).toBe(0);
    setAge(s, 75);
    const healthy = monthlyDeathRisk(s);
    expect(healthy).toBeGreaterThan(0);
    s.player.attributes.health = 20;
    expect(monthlyDeathRisk(s)).toBeGreaterThan(healthy);
    setAge(s, 90);
    expect(monthlyDeathRisk(s)).toBeGreaterThan(healthy);
  });

  it('no se puede jubilar ni pasar la posta antes de los 60', () => {
    const s = makeGame('egresado', 'life-2');
    expect(retire(s).ok).toBe(false);
    expect(succession(s, 'sobrino', 'retiro').ok).toBe(false);
    setAge(s, RETIRE_AGE + 1);
    expect(retire(s).ok).toBe(true);
    expect(life(s).retired).toBe(true);
  });

  it('la sucesión cobra el impuesto a la herencia de la residencia (contado) y cuadra la contabilidad', () => {
    const s = makeGame('egresado', 'life-3');
    gift(s, 20_000_000);
    s.tax.jurisdiction = 'norvalia';
    setAge(s, 62);
    const t = estateTax(s);
    expect(t.rate).toBe(0.25);
    expect(t.tax).toBe(Math.round((balanceSheet(s).netWorth - usd(500_000)) * 0.25));
    const nw0 = balanceSheet(s).netWorth;
    const heir = heirs(s)[0];
    expect(heir.id).toBe('sobrino');
    const r = succession(s, heir.id, 'retiro');
    expect(r.ok).toBe(true);
    expect(s.player.name).toBe(heir.name);
    expect(life(s).generation).toBe(2);
    expect(life(s).ancestors.length).toBe(1);
    expect(s.ledger.balances.inheritance_tax).toBe(t.tax);
    expect(balanceSheet(s).netWorth).toBe(nw0 - t.tax);
    expect(s.legal.fines.length).toBe(0);
    expect(Math.round(ageOf(s))).toBe(26);
    expect(s.saga.chronicle.some((c) => c.title.startsWith('Generación 2'))).toBe(true);
    expectConsistent(s);
  });

  it('si el efectivo no alcanza, el impuesto se paga en 24 cuotas; en Isla Coral no hay impuesto', () => {
    const s = makeGame('egresado', 'life-4');
    gift(s, 20_000_000);
    expect(foundCompany(s, { sector: 'minimarket', name: 'Holding Familiar', legalForm: 'srl', capital: usd(19_990_000) }).ok).toBe(true);
    s.tax.jurisdiction = 'norvalia';
    setAge(s, 70);
    const t = estateTax(s);
    succession(s, 'sobrino', 'fallecimiento');
    const fine = s.legal.fines.find((f) => f.label === 'Impuesto a la herencia');
    expect(fine).toBeTruthy();
    expect(fine!.balance).toBe(t.tax);
    expect(fine!.installment).toBe(Math.round(t.tax / 24));
    expectConsistent(s);

    const z = makeGame('egresado', 'life-5');
    gift(z, 5_000_000);
    z.tax.jurisdiction = 'isla_coral';
    setAge(z, 64);
    const before = balanceSheet(z).netWorth;
    succession(z, 'sobrino', 'retiro');
    expect(balanceSheet(z).netWorth).toBe(before);
  });

  it('con pareja nacen hijos (y cuestan); un hijo adulto es el primer heredero', () => {
    const s = makeGame('egresado', 'life-6');
    gift(s, 50_000);
    setAge(s, 30);
    life(s).partner = 'Lucía';
    for (let i = 0; i < 400 && life(s).children.length === 0; i++) lifeMonth(s);
    expect(life(s).children.length).toBeGreaterThan(0);
    const cash = spendable(s);
    lifeMonth(s);
    expect(spendable(s)).toBeLessThan(cash);
    life(s).children[0].born = s.day - Math.round(25 * 365.25);
    expect(heirs(s)[0].id).toBe(life(s).children[0].id);
    expectConsistent(s);
  });

  it('la fundación exige patrimonio, las donaciones salen del libro y suman reputación', () => {
    const s = makeGame('egresado', 'life-7');
    expect(createFoundation(s, 'Fundación Tester').ok).toBe(false);
    gift(s, 3_000_000);
    expect(createFoundation(s, 'Fundación Tester').ok).toBe(true);
    const nw = balanceSheet(s).netWorth;
    expect(donateToFoundation(s, usd(1_000_000)).ok).toBe(true);
    expect(balanceSheet(s).netWorth).toBe(nw - usd(1_000_000));
    expect(foundationReputation(s)).toBeCloseTo(3, 1);
    expectConsistent(s);
  });
});

describe('1.4 · Salida a bolsa y adquisiciones', () => {
  function bigCorp(): { s: GameState; id: number } {
    const s = makeGame('herencia', 'ipo-1');
    gift(s, 7_000_000);
    const r = foundCompany(s, { sector: 'minimarket', name: 'Gran Mercado', legalForm: 'corporacion', capital: usd(6_500_000) });
    expect(r.ok).toBe(true);
    const co = s.companies[s.companies.length - 1];
    return { s, id: co.id };
  }

  it('los requisitos se explican; con historia y ganancias sale a bolsa: entra dinero, se diluye y la contabilidad cuadra', () => {
    const { s, id } = bigCorp();
    const co = s.companies.find((c) => c.id === id)!;
    expect(ipoBlocker(s, co)).toMatch(/24 meses/);
    for (let i = 0; i < 24; i++) co.history.push({ ...(co.history[0] ?? { day: 0, revenue: 0, grossProfit: 0, cash: 0, equity: 0, inventory: 0, employees: 0, share: 0, quality: 50, reputation: 50, awareness: 0 }), netIncome: usd(20_000) });
    expect(ipoBlocker(s, co)).toBeNull();
    expect(goPublic(s, id, 0.5).ok).toBe(false);
    const cash0 = co.ledger.balances.cash;
    const rep0 = s.player.attributes.reputation;
    const r = goPublic(s, id, 0.2);
    expect(r.ok).toBe(true);
    expect(co.listed).toBeTruthy();
    expect(co.ownership).toBeCloseTo(0.8, 5);
    expect(co.ledger.balances.cash).toBeGreaterThan(cash0);
    expect(s.player.attributes.reputation).toBe(Math.min(100, rep0 + 8));
    expect(marketCap(s, co)).toBeGreaterThan(0);
    expect(ipoBlocker(s, co)).toMatch(/Ya cotiza/);
    expectConsistent(s);
    listedMonth(s, 3);
    expect(co.listed!.caps.length).toBe(2);
    expect(s.world.news.some((n) => n.title.includes(co.listed!.ticker))).toBe(true);
    gift(s, 2_000_000);
    expect(buyBackShares(s, co, 0.05).ok).toBe(true);
    expect(co.ownership).toBeCloseTo(0.85, 5);
    expectConsistent(s);
  });

  it('comprar un grupo rival: desde la etapa 8, con prima de control; deja de atacar y su dueño sigue en la lista', () => {
    const s = makeGame('herencia', 'acq-1');
    const r = s.world.rivals.find((x) => x.id === 'altamira')!;
    expect(rivalBlocker(s, r)).toMatch(/etapa 8/);
    s.progression.stage = 8;
    const price = rivalPrice(r);
    expect(acquireRival(s, 'altamira').ok).toBe(false); // sin dinero
    gift(s, Math.ceil(price / 100) + 10_000);
    const nw = balanceSheet(s).netWorth;
    const head = s.saga.ranking.magnates.find((m) => m.rivalId === 'altamira')!;
    const w0 = head.wealth;
    expect(acquireRival(s, 'altamira').ok).toBe(true);
    expect(r.acquired).toBeTruthy();
    expect(activeRivals(s).some((x) => x.id === 'altamira')).toBe(false);
    expect(head.wealth).toBe(w0 + price);
    // La prima es una pérdida de valor de mercado, pero la holding queda en el balance a costo.
    expect(balanceSheet(s).netWorth).toBeLessThanOrEqual(nw);
    expect(s.world.intents.some((i) => i.rivalId === 'altamira')).toBe(false);
    for (const sec of r.sectors) expect(hostilityFactor(s, sec)).toBeGreaterThanOrEqual(1);
    expectConsistent(s);
    simulateDays(s, 60);
    expect(s.world.intents.some((i) => i.rivalId === 'altamira')).toBe(false);
    expectConsistent(s);
  });
});

describe('1.4 · Eras, proveedores propios y acciones rápidas', () => {
  it('la primera era se anuncia a los 6 años y dura 10–15', () => {
    const s = makeGame('egresado', 'era-1');
    erasMonth(s);
    expect(s.macro.events.some((e) => e.kind.startsWith('era_'))).toBe(false);
    s.day = 365 * 6 + 10;
    erasMonth(s);
    const era = s.macro.events.find((e) => e.kind.startsWith('era_'))!;
    expect(era).toBeTruthy();
    const years = (era.endDay - era.startDay) / 365;
    expect(years).toBeGreaterThanOrEqual(10);
    expect(years).toBeLessThanOrEqual(15);
    erasMonth(s);
    expect(s.macro.events.filter((e) => e.kind.startsWith('era_')).length).toBe(1);
    s.day = era.startDay + 1;
    expect(currentEra(s)?.id).toBe(era.id);
  });

  it('minimercado propio abastece a la cafetería: insumos más baratos y pagos intragrupo que cuadran', () => {
    const s = makeGame('herencia', 'deal-1');
    gift(s, 200_000);
    expect(foundCompany(s, { sector: 'minimarket', name: 'Almacén', legalForm: 'srl', capital: usd(40_000) }).ok).toBe(true);
    expect(foundCompany(s, { sector: 'cafeteria', name: 'Café', legalForm: 'srl', capital: usd(40_000) }).ok).toBe(true);
    const [mini, cafe] = s.companies;
    const opts = possibleDeals(s);
    expect(opts.some((p) => p.kind === 'insumos' && p.supplier.id === mini.id && p.buyer.id === cafe.id)).toBe(true);
    const sup = SECTOR_BY_ID.cafeteria.suppliers[0];
    const before = supplierUnitCost(s, sup, cafe);
    expect(signDeal(s, 'insumos', mini.id, cafe.id).ok).toBe(true);
    expect(signDeal(s, 'insumos', mini.id, cafe.id).ok).toBe(false);
    expect(dealDiscount(s, cafe, 'insumos')).toBe(0.08);
    expect(supplierUnitCost(s, sup, cafe)).toBe(Math.round(before * 0.92));
    cafe.history.push({ ...cafe.history[cafe.history.length - 1] ?? { day: s.day, grossProfit: 0, netIncome: 0, cash: 0, equity: 0, inventory: 0, employees: 0, share: 0, quality: 50, reputation: 50, awareness: 0 }, revenue: usd(40_000) });
    const c0 = mini.ledger.balances.cash;
    dealsMonth(s);
    expect(mini.ledger.balances.cash - c0).toBe(usd(1200));
    expect(mini.ledger.balances.ic_income).toBe(usd(1200));
    expect(cafe.ledger.balances.ic_expense).toBe(usd(1200));
    expectConsistent(s);
    toMonthEnd(s);
    simulateDays(s, 3);
    expectConsistent(s);
    expect(endDeal(s, s.saga.deals![0].id).ok).toBe(true);
    expect(dealDiscount(s, cafe, 'insumos')).toBe(0);
  });

  it('invertir lo que sobra deja la reserva de 6 meses y compra el fondo índice', () => {
    const s = makeGame('egresado', 'surplus-1');
    expect(investSurplus(s).ok).toBe(false);
    gift(s, 30_000);
    const b = surplusBreakdown(s);
    expect(b.surplus).toBeGreaterThan(0);
    expect(b.available - b.surplus).toBeGreaterThanOrEqual(b.reserve);
    expect(investSurplus(s).ok).toBe(true);
    expect(s.ledger.balances.funds).toBeGreaterThan(0);
    expect(spendable(s)).toBeGreaterThanOrEqual(b.reserve * 0.98);
    expectConsistent(s);
  });

  it('explicar una empresa resume sus 30 días con las cuentas reales', () => {
    const s = makeGame('herencia', 'why-co');
    expect(foundCompany(s, { sector: 'minimarket', name: 'Almacén', legalForm: 'individual', capital: usd(14000) }).ok).toBe(true);
    simulateDays(s, 20);
    const e = explainCompany(s.companies[0], s.day);
    expect(e.summary).toMatch(/30 días/);
    expect(e.items.length).toBeGreaterThan(0);
  });
});

describe('1.4 · Desafíos para aprender y dilemas urgentes', () => {
  it('«Salir de deudas» empieza con el préstamo registrado y la contabilidad cuadra', () => {
    const s = newGame({ name: 'Tester', background: 'egresado', style: 'libre', seed: 'x', nowReal: 1, challenge: 'deudas' });
    expect(s.saga.challenge?.id).toBe('deudas');
    expect(s.bank.loans.filter((l) => l.status === 'active').length).toBe(1);
    expect(s.ledger.balances.personal_loans).toBe(usd(6000));
    expectConsistent(s);
    simulateDays(s, 35);
    expect(s.bank.loans[0].paymentsMade + s.bank.loans[0].missedTotal).toBeGreaterThan(0);
    expectConsistent(s);
    for (const id of ['colchon', 'compuesto']) {
      const g = newGame({ name: 'Tester', background: 'egresado', style: 'libre', seed: 'x', nowReal: 1, challenge: id });
      expect(g.saga.challenge?.id).toBe(CHALLENGE_BY_ID[id].id);
      expectConsistent(g);
    }
  });

  it('sin empleo y con poca plata aparece un trabajo temporal urgente que paga de verdad', () => {
    const s = makeGame('autodidacta', 'changa-1');
    s.day = 15;
    s.saga.dilemmas.nextDay = 9999;
    const extra = s.ledger.balances.checking - usd(100);
    post(s.ledger, { day: s.day, memo: 'Gastos de prueba', cf: 'internal', tag: 'opening', lines: [{ account: 'opening_equity', debit: extra }, { account: 'checking', credit: extra }] });
    const tpl = TEMPLATE_BY_ID.changa;
    expect(tpl.urgent).toBe(true);
    let found = false;
    for (let i = 0; i < 200 && !found; i++) {
      dilemmasDay(s);
      found = s.saga.dilemmas.open.some((d) => d.template === 'changa');
      if (!found) s.day++;
    }
    expect(found).toBe(true);
    const d = s.saga.dilemmas.open.find((x) => x.template === 'changa')!;
    const cash = spendable(s);
    expect(decide(s, d.id, 'aceptar').ok).toBe(true);
    simulateDays(s, 25);
    expect(s.ledger.entries.some((e) => /Trabajo temporal/.test(e.memo)) || spendable(s) !== cash).toBe(true);
    expectConsistent(s);
  });

  it('una partida v6 sin la cuenta nueva de herencia se normaliza al cargar', () => {
    const s = makeGame('egresado', 'mig-1');
    const raw = JSON.parse(JSON.stringify(s));
    delete raw.ledger.balances.inheritance_tax;
    delete raw.saga.life;
    const out = migrate(raw).state;
    expect(out.ledger.balances.inheritance_tax).toBe(0);
    expect(out.saga.life).toBeTruthy();
    expectConsistent(out);
  });
});

describe('1.4 · La edad se ve y avisa antes de que pese', () => {
  it('cumpleaños: aviso cada año y advertencias a los 65 y 68 (peligro)', () => {
    const s = makeGame('egresado', 'bday-1');
    life(s).birthDay = s.day - Math.round(65.02 * 365.25);
    lifeMonth(s);
    expect(s.log.some((l) => /cumplió 65 años/.test(l.text) && l.cat === 'peligro')).toBe(true);
    life(s).birthDay = s.day - Math.round(68.02 * 365.25);
    lifeMonth(s);
    expect(s.log.some((l) => /cumplió 68 años.*riesgo real de fallecer/.test(l.text))).toBe(true);
  });

  it('si fallece, hereda el heredero elegido; el ajuste de fallecimiento se conserva', () => {
    const s = makeGame('egresado', 'heir-2');
    gift(s, 10_000);
    life(s).birthDay = s.day - Math.round(70 * 365.25);
    life(s).children.push({ id: 9001, name: 'Ana Tester', born: s.day - Math.round(40 * 365.25) }, { id: 9002, name: 'Beto Tester', born: s.day - Math.round(35 * 365.25) });
    expect(setHeir(s, 9002).ok).toBe(true);
    expect(designatedHeir(s).id).toBe(9002);
    succession(s, designatedHeir(s).id, 'fallecimiento');
    expect(s.player.name).toBe('Beto Tester');
    expect(s.saga.celebrations.some((c) => c.icon === 'history' && /murió a los 70 años/.test(c.title))).toBe(true);
    const t = makeGame('egresado', 'mort-2');
    life(t).birthDay = t.day - Math.round(62 * 365.25);
    setMortality(t, false);
    succession(t, 'sobrino', 'retiro');
    expect(life(t).mortal).toBe(false);
  });

  it('la agenda pide elegir heredero desde los 65', () => {
    const s = makeGame('egresado', 'agenda-heir');
    life(s).birthDay = s.day - Math.round(66 * 365.25);
    expect(agenda(s).some((a) => a.key === 'heir')).toBe(true);
    setHeir(s, heirs(s)[0].id);
    expect(agenda(s).some((a) => a.key === 'heir')).toBe(false);
  });
});
