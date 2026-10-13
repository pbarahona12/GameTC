// @vitest-environment jsdom
/** Fase 1 · E5/F2: el mes como turno, con un informe que cuenta una historia. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeGame, forceHire, expectConsistent } from './helpers';
import { advanceDay } from '../src/engine/simulation';
import { monthReport } from '../src/engine/saga/monthReport';
import { chronicle } from '../src/engine/saga/chronicle';
import { openDilemma } from '../src/engine/saga/dilemmas';
import { isLastDayOfMonth } from '../src/engine/time/calendar';
import { GameStore } from '../src/ui/store';
import { JOBS } from '../src/content/jobs';
import type { GameState } from '../src/engine/state';

const toMonthEnd = (s: GameState) => { do advanceDay(s); while (!isLastDayOfMonth(s.day)); };

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('Informe del mes', () => {
  it('solo existe el último día del mes, con titular, tres datos y como mucho dos decisiones', () => {
    const s = makeGame('egresado', 'mr-basic');
    forceHire(s, JOBS[0].id);
    advanceDay(s);
    expect(monthReport(s)).toBeNull();
    openDilemma(s, 'horas_extra', { project: 'el cierre' }, 45); // vence después del cierre
    toMonthEnd(s);
    const r = monthReport(s)!;
    expect(r.month).toBe('enero 2026');
    expect(r.headline.length).toBeGreaterThan(5);
    expect(r.facts).toHaveLength(3);
    expect(r.facts[0].label).toBe('Patrimonio');
    expect(r.decisions.length).toBeGreaterThanOrEqual(1);
    expect(r.decisions.length).toBeLessThanOrEqual(2);
    expectConsistent(s);
  });

  it('el titular cuenta lo más importante del mes (un hito de la crónica gana a lo demás)', () => {
    const s = makeGame('herencia', 'mr-headline');
    advanceDay(s);
    chronicle(s, 'etapa', 'crown', 'Llegaste a la etapa 3: Inversor', 'Tu patrimonio superó los $50.000.');
    toMonthEnd(s);
    const r = monthReport(s)!;
    expect(r.headline).toBe('Llegaste a la etapa 3: Inversor');
    expect(r.deck).toMatch(/\$50\.000/);
  });

  it('dice cuánto falta para entrar en la lista de fortunas y compara con el mes anterior', () => {
    const s = makeGame('egresado', 'mr-rank');
    forceHire(s, JOBS[0].id);
    toMonthEnd(s);
    advanceDay(s);
    toMonthEnd(s);
    const r = monthReport(s)!;
    expect(r.rank).toMatch(/te faltan \$/);
    expect(r.vsPlan).toMatch(/mes anterior/);
  });
});

describe('El tiempo se detiene al cerrar el mes', () => {
  it('corriendo a 4×: se pausa el último día del mes, muestra el informe y «Seguir» lo reanuda', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const st = new GameStore();
    try {
      await st.boot();
      await st.startNewGame({ name: 'Turno', background: 'herencia', style: 'libre', seed: 'turn' });
      st.updateSettings({ autoPause: false });
      st.setSpeed(4);
      vi.advanceTimersByTime(30_000); // 60 días posibles a 4×
      const ui = st.getSnapshot();
      expect(ui.speed).toBe(0);
      expect(isLastDayOfMonth(ui.state!.day)).toBe(true);
      expect(ui.state!.day).toBe(30);
      expect(ui.monthReport?.month).toBe('enero 2026');
      st.closeMonthReport(true);
      expect(st.getSnapshot().monthReport).toBeNull();
      expect(st.getSnapshot().speed).toBe(4);
      vi.advanceTimersByTime(30_000);
      expect(st.getSnapshot().state!.day).toBe(58); // 28 de febrero
      expect(st.getSnapshot().monthReport?.month).toBe('febrero 2026');
    } finally {
      st.stopClock();
    }
  });

  it('un salto de días se detiene en el cierre del mes; desactivado, no se detiene', async () => {
    const st = new GameStore();
    try {
      await st.boot();
      await st.startNewGame({ name: 'Salto', background: 'herencia', style: 'libre', seed: 'jump' });
      st.updateSettings({ autoPause: false });
      st.step(25);
      st.step(10); // cruza el 31 de enero
      expect(st.getSnapshot().state!.day).toBe(30);
      expect(st.getSnapshot().monthReport).not.toBeNull();
      st.closeMonthReport();
      expect(st.getSnapshot().speed).toBe(0);
      st.updateSettings({ monthTurn: false });
      st.step(40);
      expect(st.getSnapshot().state!.day).toBe(70);
      expect(st.getSnapshot().monthReport).toBeNull();
    } finally {
      st.stopClock();
    }
  });
});
