/**
 * Fase 1 · E7 (auditoría D10): los primeros diez minutos.
 * - Las vacantes iniciales se diferencian de verdad (sueldo, comisión, seguro, horas,
 *   habilidad que enseñan y probabilidad de entrar).
 * - Hay un objetivo inmediato con reloj (el próximo alquiler).
 * - El primer sueldo llega dentro del primer minuto real a 1× (30 días de juego).
 */
import { describe, it, expect } from 'vitest';
import { makeGame, expectConsistent } from './helpers';
import { JOBS } from '../src/content/jobs';
import { checkRequirements, applicationChance, apply, acceptOffer, FIRST_PAYCHECK_DAYS } from '../src/engine/career/career';
import { advanceDay } from '../src/engine/simulation';
import { firstGoal, firstMonthSteps } from '../src/engine/saga/firstMonth';
import { MS_PER_DAY_1X } from '../src/ui/store';
import type { GameState } from '../src/engine/state';

const entryJobs = (s: GameState) => JOBS.filter((j) => j.level === 1 && checkRequirements(s, j).ok);

describe('Vacantes iniciales distintas', () => {
  it('para un recién egresado hay al menos 4 vacantes con diferencias reales', () => {
    const s = makeGame('egresado', 'entry');
    const jobs = entryJobs(s);
    expect(jobs.length).toBeGreaterThanOrEqual(4);
    const salaries = jobs.map((j) => j.baseSalary);
    expect(Math.max(...salaries) / Math.min(...salaries)).toBeGreaterThanOrEqual(1.5); // antes: 1.000–1.150
    expect(jobs.some((j) => (j.commission ?? 0) >= 0.3)).toBe(true); // sueldo fijo contra comisión
    expect(jobs.some((j) => j.healthInsurance) && jobs.some((j) => !j.healthInsurance)).toBe(true);
    expect(new Set(jobs.map((j) => j.hoursPerWeek)).size).toBeGreaterThanOrEqual(3);
    expect(jobs.every((j) => j.pitch && j.pitch.length > 20)).toBe(true);
    // Probabilidades distintas (antes todas 41 %).
    const chances = new Set(jobs.map((j) => Math.round(applicationChance(s, j) * 100)));
    expect(chances.size).toBeGreaterThanOrEqual(3);
  });
});

describe('Objetivo con reloj', () => {
  it('sin ingresos: llegar al alquiler del 1 de febrero, con días y meses cubiertos', () => {
    const s = makeGame('egresado', 'goal');
    const g = firstGoal(s)!;
    expect(g.dueDay).toBe(31);
    expect(g.daysLeft).toBe(31);
    expect(g.monthCost).toBeGreaterThan(0);
    expect(g.monthsCovered).toBeCloseTo(Math.floor((g.cash / g.monthCost) * 10) / 10, 5);
    for (let d = 0; d < 10; d++) advanceDay(s);
    expect(firstGoal(s)!.daysLeft).toBe(21);
    // El primer paso ya no es una lectura: es postularse.
    expect(firstMonthSteps(s)[0].id).toBe('postular');
  });
});

describe('Primer sueldo en el primer minuto', () => {
  it('quien se postula el día 0 cobra su primer sueldo antes del día 30 (60 s reales a 1×), y el mes suma exacto', () => {
    expect(30 * MS_PER_DAY_1X).toBe(60_000);
    let paidBefore30 = 0;
    const seeds = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    for (const seed of seeds) {
      const s = makeGame('egresado', seed);
      for (const j of entryJobs(s)) apply(s, j.id);
      let firstPayDay: number | null = null;
      for (let d = 0; d < 45 && firstPayDay === null; d++) {
        const offer = s.career.applications.find((a) => a.status === 'offer');
        if (offer && !s.career.job) expect(acceptOffer(s, offer.id).ok).toBe(true);
        const before = s.ledger.entries.filter((e) => e.tag === 'payroll').length;
        advanceDay(s);
        if (s.ledger.entries.filter((e) => e.tag === 'payroll').length > before) firstPayDay = s.day;
      }
      if (firstPayDay !== null && firstPayDay < 30) paidBefore30++;
      expectConsistent(s);
    }
    expect(paidBefore30).toBeGreaterThanOrEqual(seeds.length - 1);
  });

  it('la quincena y el cierre del mes suman exactamente el sueldo de los días trabajados', () => {
    const s = makeGame('egresado', 'quincena');
    const job = entryJobs(s).find((j) => !j.commission)!;
    s.career.applications.push({ id: s.meta.nextId++, jobId: job.id, appliedDay: 0, resolveDay: 0, status: 'offer', chance: 1, offerSalary: 100_000, offerExpiresDay: 7, negotiated: false });
    acceptOffer(s, s.career.applications[0].id);
    const start = s.career.job!.startDay;
    const gross = () => s.ledger.entries.filter((e) => e.tag === 'payroll').reduce((sum, e) => sum + e.lines.reduce((a, l) => a + (l.account === 'salary_income' ? (l.credit ?? 0) - (l.debit ?? 0) : 0), 0), 0);
    while (s.day < start + FIRST_PAYCHECK_DAYS - 1) advanceDay(s);
    expect(s.ledger.entries.some((e) => e.tag === 'payroll')).toBe(true);
    while (s.day < 30) advanceDay(s); // 31 de enero: cierre
    const worked = 31 - start; // días 'start'..30 de enero
    expect(gross()).toBe(Math.round((100_000 * worked) / 31));
    expectConsistent(s);
  });
});
