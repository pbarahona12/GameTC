import { describe, it, expect } from 'vitest';
import { makeGame, expectConsistent, forceHire } from './helpers';
import { newGame, GameState } from '../src/engine/state';
import { post } from '../src/engine/ledger/ledger';
import { usd } from '../src/engine/money';
import { simulateDays, advanceDay } from '../src/engine/simulation';
import { isLastDayOfMonth } from '../src/engine/time/calendar';
import { CITY_SIZE, cityTable, globalTable, magnateWealth, playerPosition, rankingMonth, curveWealth, estimateRank } from '../src/engine/saga/ranking';
import { CITIES } from '../src/content/cities';
import { chooseGoal, dropGoal, checkGoals, MAX_ACTIVE_GOALS, GOAL_BY_ID, suggestedGoals } from '../src/engine/saga/goals';
import { computeMetrics } from '../src/engine/reports/metrics';
import { dilemmasDay, decide, dilemmaView, TEMPLATE_BY_ID, checkTruces } from '../src/engine/saga/dilemmas';
import { agenda } from '../src/engine/saga/agenda';
import { firstMonthSteps, firstMonthActive, markFirstStep } from '../src/engine/saga/firstMonth';
import { CHALLENGE_BY_ID, checkChallenge, resultCode, verifyCode } from '../src/engine/saga/challenges';
import { migrate } from '../src/persistence/migrations';
import { evaluateStage, stageThreshold, updateProgression } from '../src/engine/progression/progression';
import { hostilityFactor } from '../src/engine/world/rivals';
import { balanceSheet } from '../src/engine/reports/statements';

/** Le da patrimonio al jugador (aporte de capital: la contabilidad sigue cuadrando). */
function gift(s: GameState, dollars: number): void {
  post(s.ledger, { day: s.day, memo: 'Aporte de prueba', cf: 'internal', tag: 'opening', lines: [{ account: 'checking', debit: usd(dollars) }, { account: 'opening_equity', credit: usd(dollars) }] });
}

function toMonthEnd(s: GameState): void {
  do advanceDay(s);
  while (!isLastDayOfMonth(s.day));
}

describe('1.4 · Clasificaciones de fortunas', () => {
  it('cada ciudad tiene 100 fortunas con nombre, ordenadas según su curva, y los rivales tienen cara', () => {
    const s = makeGame('egresado', 'rank-1');
    expect(s.saga.ranking.magnates.length).toBe(CITY_SIZE * CITIES.length);
    for (const c of CITIES) {
      const t = cityTable(s, c.id, null);
      expect(t.length).toBe(CITY_SIZE);
      // El número 1 y el 100 están cerca de la curva de la ciudad (±10 % + el grupo rival).
      expect(t[0].wealth / usd(c.top1)).toBeGreaterThan(0.8);
      expect(t[0].wealth / usd(c.top1)).toBeLessThan(1.25);
      expect(t[CITY_SIZE - 1].wealth / usd(c.top100)).toBeGreaterThan(0.8);
      expect(t[CITY_SIZE - 1].wealth / usd(c.top100)).toBeLessThan(1.25);
    }
    const names = new Set(s.saga.ranking.magnates.map((m) => m.name));
    expect(names.size).toBe(s.saga.ranking.magnates.length);
    const heads = s.saga.ranking.magnates.filter((m) => m.rivalId);
    expect(heads.map((m) => m.rivalId).sort()).toEqual(['altamira', 'duarte', 'ferran', 'nexo']);
    const duarte = heads.find((m) => m.rivalId === 'duarte')!;
    // La fortuna del dueño incluye su grupo (capital + lo comprado).
    const group = s.world.rivals.find((r) => r.id === 'duarte')!;
    expect(magnateWealth(s, duarte)).toBe(duarte.wealth + group.capital + (group.assetsValue ?? 0));
    expect(Math.abs(cityTable(s, 'valdoria', null).findIndex((r) => r.m === duarte) + 1 - 7)).toBeLessThanOrEqual(2);
  });

  it('fuera del top 100 se estima un puesto que mejora al crecer el patrimonio', () => {
    const s = makeGame('egresado', 'rank-2');
    const p1 = playerPosition(s, balanceSheet(s).netWorth);
    expect(p1.exact).toBe(false);
    expect(p1.rank).toBeGreaterThan(CITY_SIZE);
    const floor = p1.floor;
    expect(estimateRank('valdoria', usd(50_000), floor)).toBeLessThan(estimateRank('valdoria', usd(5_000), floor));
    expect(estimateRank('valdoria', usd(5_000), floor)).toBeLessThanOrEqual(Math.round(2_100_000 * 0.6));
    expect(estimateRank('valdoria', floor + 1, floor)).toBe(CITY_SIZE + 1);
    expect(curveWealth('valdoria', 1)).toBeCloseTo(3_200_000_000, -3);
  });

  it('las fortunas siguen al mercado de la partida mes a mes y la contabilidad no cambia', () => {
    const s = makeGame('tecnico', 'rank-3');
    const before = new Map(s.saga.ranking.magnates.map((m) => [m.id, m.wealth]));
    simulateDays(s, 365);
    expectConsistent(s);
    const moved = s.saga.ranking.magnates.filter((m) => m.wealth !== before.get(m.id)).length;
    expect(moved).toBeGreaterThan(350);
    expect(s.saga.ranking.history.length).toBe(12);
    // Siempre hay exactamente 100 por ciudad, aunque algunos se renueven.
    for (const c of CITIES) expect(cityTable(s, c.id, null).length).toBe(CITY_SIZE);
    expect(s.world.news.some((n) => n.topic === 'fortunas')).toBe(true);
  });

  it('entrar en la lista se festeja, se anuncia, queda en la crónica y desbloquea logros', () => {
    const s = makeGame('egresado', 'rank-4');
    const floor = cityTable(s, 'valdoria', null)[CITY_SIZE - 1].wealth;
    gift(s, (floor / 100) * 1.5);
    toMonthEnd(s);
    const p = s.saga.ranking.player;
    expect(p.city).not.toBeNull();
    expect(p.city!).toBeLessThanOrEqual(CITY_SIZE);
    expect(s.saga.ranking.milestones.some((m) => m.startsWith('city:valdoria:'))).toBe(true);
    expect(s.saga.celebrations.some((c) => /lista|Top/.test(c.title))).toBe(true);
    expect(s.saga.chronicle.some((c) => c.kind === 'ranking')).toBe(true);
    expect(s.world.news.some((n) => n.topic === 'fortunas' && n.title.includes('Tester'))).toBe(true);
    expect(s.progression.achievements.rank_city_100).toBeDefined();
    expectConsistent(s);
  });

  it('superar a un rival: lo recuerdan, y ser el número 1 trae retadores y la defensa del trono', () => {
    const s = makeGame('egresado', 'rank-5');
    const top = cityTable(s, 'valdoria', null)[0].wealth;
    gift(s, (top / 100) * 3);
    toMonthEnd(s);
    expect(s.saga.ranking.player.city).toBe(1);
    expect(s.saga.ranking.overtaken).toEqual(expect.arrayContaining(['duarte', 'altamira']));
    const duarte = s.world.rivals.find((r) => r.id === 'duarte')!;
    expect(duarte.attitude).toBeGreaterThan(0);
    expect(duarte.memory?.length).toBeGreaterThan(0);
    expect(s.progression.achievements.rank_city_1).toBeDefined();
    expect(s.progression.achievements.rival_beaten).toBeDefined();
    for (let i = 0; i < 12; i++) toMonthEnd(s);
    expect(s.saga.ranking.reignMonths).toBeGreaterThanOrEqual(12);
    updateProgression(s);
    expect(s.progression.achievements.rank_reign_12).toBeDefined();
    // El rencor hace más probables los ataques en sus sectores.
    duarte.attitude = 80;
    expect(hostilityFactor(s, 'muebles')).toBeCloseTo(1.8, 5);
    expectConsistent(s);
  });

  it('el ranking global junta las cuatro ciudades y acepta al jugador', () => {
    const s = makeGame('egresado', 'rank-6');
    const g = globalTable(s, usd(10_000_000_000));
    expect(g.length).toBe(CITY_SIZE * 4 + 1);
    expect(g[0].kind).toBe('player');
    rankingMonth(s);
    expect(s.saga.ranking.history.length).toBe(1);
  });
});

describe('1.4 · Metas de vida', () => {
  it('se eligen hasta tres, se abandonan y se cumplen por el estado real (con reputación y crónica)', () => {
    const s = makeGame('egresado', 'goals-1');
    const m = computeMetrics(s);
    expect(suggestedGoals(s, m).length).toBeGreaterThan(5);
    expect(chooseGoal(s, 'universidad').ok).toBe(true);
    expect(chooseGoal(s, 'universidad').ok).toBe(false);
    expect(chooseGoal(s, 'maestria').ok).toBe(true);
    expect(chooseGoal(s, 'top100').ok).toBe(true);
    expect(chooseGoal(s, 'filantropo').ok).toBe(false);
    expect(s.saga.goals.active.length).toBe(MAX_ACTIVE_GOALS);
    expect(dropGoal(s, 'top100').ok).toBe(true);
    const rep = s.player.attributes.reputation;
    s.education.level = 'universitario';
    checkGoals(s, computeMetrics(s));
    expect(s.saga.goals.completed.universidad).toBe(s.day);
    expect(s.saga.goals.active.map((g) => g.id)).toEqual(['maestria']);
    expect(s.player.attributes.reputation).toBe(rep + 3);
    expect(s.saga.celebrations.some((c) => c.title.includes('Título universitario'))).toBe(true);
    expect(s.saga.chronicle.some((c) => c.kind === 'meta' && c.title.startsWith('Meta cumplida'))).toBe(true);
  });

  it('las metas que ya no se pueden cumplir lo dicen, y las de rivales miden la distancia real', () => {
    const s = makeGame('egresado', 'goals-2');
    s.legal.acts.push({ id: 1, kind: 'evasion', day: 0, label: 'x', benefit: 0, amount: 1, evidence: 1, severity: 1, witnesses: 0, jurisdiction: 'valdoria', statuteDay: 100, status: 'oculto' });
    expect(GOAL_BY_ID.fortuna_limpia.check(s, computeMetrics(s)).failed).toBe(true);
    const p = GOAL_BY_ID.vencer_duarte.check(s, computeMetrics(s));
    expect(p.done).toBe(false);
    expect(p.progress).toBeGreaterThanOrEqual(0);
    expect(p.progress).toBeLessThan(1);
  });
});

describe('1.4 · Dilemas con plazo', () => {
  function withDilemma(seed: string, template: string): GameState {
    const s = makeGame('herencia', seed);
    gift(s, 100_000);
    s.progression.stage = 3;
    forceHire(s, 'ventas_asistente');
    s.career.job!.monthsInRole = 12;
    s.career.job!.performance = 70;
    // Solo la plantilla pedida está disponible.
    for (const t of Object.keys(TEMPLATE_BY_ID)) if (t !== template) s.saga.dilemmas.lastByTemplate[t] = s.day;
    s.saga.dilemmas.nextDay = s.day;
    dilemmasDay(s);
    return s;
  }

  it('aparece en la agenda, se decide con efectos reales y queda en la crónica', () => {
    const s = withDilemma('dil-1', 'ascenso');
    const d = s.saga.dilemmas.open[0];
    expect(d?.template).toBe('ascenso');
    expect(agenda(s).some((a) => a.target.kind === 'dilemma')).toBe(true);
    expect(s.log.some((l) => l.cat === 'decisiones')).toBe(true);
    const v = dilemmaView(s, d)!;
    expect(v.options.length).toBe(2);
    const salary = s.career.job!.salary;
    const r = decide(s, d.id, 'aceptar');
    expect(r.ok).toBe(true);
    expect(s.career.job!.salary).toBe(Math.round(salary * 1.16));
    expect(s.saga.dilemmas.open.length).toBe(0);
    expect(s.saga.chronicle.some((c) => c.kind === 'dilema')).toBe(true);
    expect(s.saga.stats.decisions).toBe(1);
    expectConsistent(s);
  });

  it('si vence, se aplica la opción por defecto (que nunca cuesta dinero)', () => {
    const s = withDilemma('dil-2', 'donacion');
    const d = s.saga.dilemmas.open[0];
    expect(d.template).toBe('donacion');
    const cash = s.ledger.balances.checking + s.ledger.balances.savings;
    s.day = d.deadline + 1;
    dilemmasDay(s);
    expect(s.saga.dilemmas.past[0].status).toBe('vencido');
    expect(s.saga.dilemmas.past[0].choice).toBe('no');
    expect(s.ledger.balances.checking + s.ledger.balances.savings).toBe(cash);
  });

  it('una inversión en la startup se paga ahora y su desenlace llega meses después por el libro mayor', () => {
    const s = withDilemma('dil-3', 'startup');
    const d = s.saga.dilemmas.open[0];
    expect(d.template).toBe('startup');
    expect(decide(s, d.id, 'todo').ok).toBe(true);
    expect(s.saga.dilemmas.pending.length).toBe(1);
    s.saga.dilemmas.pending[0].day = s.day;
    dilemmasDay(s);
    expect(s.saga.dilemmas.pending.length).toBe(0);
    expect(s.saga.chronicle.some((c) => c.title === 'El desenlace de la startup')).toBe(true);
    expectConsistent(s);
  });

  it('una opción sin dinero suficiente no se puede elegir', () => {
    const s = withDilemma('dil-4', 'startup');
    const d = s.saga.dilemmas.open[0];
    s.ledger.balances.checking = 0; // solo para la vista: no se simula después
    s.ledger.balances.savings = 0;
    s.ledger.balances.cash_wallet = 0;
    expect(dilemmaView(s, d)!.options.find((o) => o.id === 'todo')!.blocked).toMatch(/Necesitás/);
  });

  it('una tregua frena los ataques del rival en ese sector, y romperla tiene consecuencias', () => {
    const s = makeGame('herencia', 'dil-5');
    const r = s.world.rivals.find((x) => x.id === 'altamira')!;
    r.attitude = 90;
    expect(hostilityFactor(s, 'cafeteria')).toBeCloseTo(1.9, 5);
    r.truce = { sector: 'cafeteria', from: s.day, until: s.day + 730 };
    // Durante la tregua, su rencor no cuenta en ese sector (los otros grupos siguen igual).
    expect(hostilityFactor(s, 'cafeteria')).toBe(1);
    expect(hostilityFactor(s, 'minimarket')).toBeCloseTo(1.9, 5);
    s.day += 10;
    s.companies.push({ ...JSON.parse('{}'), id: 999, npc: false, sector: 'cafeteria', foundedDay: s.day, acquiredDay: null, status: 'active' });
    const rep = s.player.attributes.reputation;
    checkTruces(s);
    s.companies = s.companies.filter((c) => c.id !== 999);
    expect(r.truce).toBeNull();
    expect(r.attitude).toBeGreaterThanOrEqual(60);
    expect(s.player.attributes.reputation).toBe(rep - 5);
  });

  it('en dos años de juego aparecen dilemas y la contabilidad cuadra', () => {
    const s = makeGame('herencia', 'dil-6');
    forceHire(s, 'ventas_asistente');
    simulateDays(s, 730);
    expect(s.saga.dilemmas.past.length + s.saga.dilemmas.open.length).toBeGreaterThanOrEqual(5);
    expectConsistent(s);
  });
});

describe('1.4 · Primer mes, desafíos, crónica y etapas', () => {
  it('el primer mes guiado se completa con lo que pasa en la partida', () => {
    const s = makeGame('egresado', 'fm-1');
    expect(firstMonthActive(s)).toBe(true);
    expect(firstMonthSteps(s).filter((x) => x.done).length).toBe(0);
    markFirstStep(s, 'gastos');
    forceHire(s, 'ventas_asistente');
    toMonthEnd(s);
    gift(s, 10);
    post(s.ledger, { day: s.day, memo: 'Ahorro', cf: 'internal', tag: 'transfer', lines: [{ account: 'savings', debit: usd(10) }, { account: 'checking', credit: usd(10) }] });
    expect(firstMonthSteps(s).every((x) => x.done)).toBe(true);
    expect(firstMonthActive(s)).toBe(false);
  });

  it('un desafío fija el mundo (origen, estilo y semilla) y da un código verificable al cumplirlo', () => {
    const a = newGame({ name: 'Ana', background: 'egresado', style: 'ejecutivo', challenge: 'millon', nowReal: 1 });
    const b = newGame({ name: 'Beto', background: 'herencia', style: 'libre', challenge: 'millon', nowReal: 99 });
    expect(a.player.background).toBe(CHALLENGE_BY_ID.millon.background);
    expect(a.seed).toBe(b.seed);
    expect(a.stocks.stocks.map((x) => x.price)).toEqual(b.stocks.stocks.map((x) => x.price));
    expect(a.saga.challenge?.id).toBe('millon');
    gift(a, 1_000_000);
    checkChallenge(a);
    expect(a.saga.challenge?.completedDay).toBe(0);
    expect(verifyCode(a.saga.challenge!.code!)).toEqual({ id: 'millon', value: 0 });
    expect(verifyCode(resultCode('millon', 100).replace('100', '99'))).toBeNull();
    const c = newGame({ name: 'Caro', background: 'egresado', style: 'libre', challenge: 'recesion', nowReal: 1 });
    expect(c.macro.phase).toBe('recesion');
    const d = newGame({ name: 'Dani', background: 'egresado', style: 'libre', challenge: 'puerto', nowReal: 1 });
    expect(d.tax.jurisdiction).toBe('meridia');
  });

  it('los umbrales de las etapas se miden a precios de hoy', () => {
    const s = makeGame('egresado', 'stage-1');
    expect(stageThreshold(s, 1_000_000)).toBe(usd(1_000_000));
    s.macro.priceIndex = 2.03;
    expect(stageThreshold(s, 1_000_000)).toBe(usd(2_000_000));
    expect(stageThreshold(s, 150_000)).toBe(usd(300_000));
    const ev = evaluateStage(s);
    expect(ev.details[6].criteria[0].label).toContain('a precios de hoy');
  });

  it('la crónica arranca con la partida y cierra cada año con un resumen', () => {
    const s = makeGame('tecnico', 'chron-1');
    expect(s.saga.chronicle[0].kind).toBe('inicio');
    simulateDays(s, 370);
    expect(s.saga.chronicle.some((c) => c.kind === 'anio')).toBe(true);
  });
});

describe('1.4 · Partidas guardadas', () => {
  it('una partida v5 se migra a v6 con fortunas a precios de hoy, sin tocar la economía', () => {
    const s = makeGame('tecnico', 'mig6');
    simulateDays(s, 400);
    const raw = JSON.parse(JSON.stringify(s));
    raw.version = 5;
    delete raw.saga;
    raw.macro.priceIndex = 1.5;
    for (const r of raw.world.rivals) {
      delete r.assetsValue;
      delete r.attitude;
      delete r.memory;
      delete r.truce;
    }
    const { state, migratedFrom } = migrate(raw);
    expect(migratedFrom).toBe(5);
    expect(state.version).toBe(6);
    expect(state.saga.ranking.magnates.length).toBe(400);
    expect(cityTable(state, 'valdoria', null)[CITY_SIZE - 1].wealth).toBeGreaterThan(usd(4_000_000 * 1.2));
    expect(state.saga.dilemmas.nextDay).toBeGreaterThan(state.day);
    expect(state.saga.firstMonth.dismissed).toBe(true);
    expect(state.stocks.stocks.map((x) => x.price)).toEqual(s.stocks.stocks.map((x) => x.price));
    expectConsistent(state);
    simulateDays(state, 60);
    expectConsistent(state);
  });

  it('misma semilla y mismas acciones: exactamente la misma partida (también la historia)', () => {
    const a = makeGame('herencia', 'det-14');
    const b = makeGame('herencia', 'det-14');
    simulateDays(a, 500);
    simulateDays(b, 500);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
