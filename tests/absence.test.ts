// @vitest-environment jsdom
/**
 * Fase 0 · E8 (auditoría D6): el progreso sin conexión no castiga a quien cierra la app.
 * Reproduce el experimento de la auditoría (oferta que vence en 7 días, 8 horas fuera)
 * y comprueba que ninguna decisión ni pago de la agenda vence mientras el jugador no está.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { GameStore } from '../src/ui/store';
import { saveGame } from '../src/persistence/save';
import { DEFAULT_OFFLINE, offlineDays } from '../src/persistence/offline';
import { advanceDay } from '../src/engine/simulation';
import { simulateAbsence, pendingChoices, paymentDueTomorrow } from '../src/engine/absence';
import { openDilemma } from '../src/engine/saga/dilemmas';
import { agenda } from '../src/engine/saga/agenda';
import { post } from '../src/engine/ledger/ledger';
import { usd } from '../src/engine/money';
import { JOBS } from '../src/content/jobs';
import { makeGame, expectConsistent } from './helpers';
import type { GameState } from '../src/engine/state';

const EIGHT_HOURS = 8 * 60 * 60 * 1000;

class LocalKV {
  async get(k: string) { return localStorage.getItem(k); }
  async set(k: string, v: string) { localStorage.setItem(k, v); }
  async remove(k: string) { localStorage.removeItem(k); }
}

const stores: GameStore[] = [];
function make() {
  const st = new GameStore();
  stores.push(st);
  return st;
}
beforeEach(() => localStorage.clear());
afterEach(() => {
  while (stores.length) stores.pop()!.stopClock();
});

/** Oferta de empleo vigente que vence en `days` días (como en el experimento de la auditoría). */
function withJobOffer(s: GameState, days = 7) {
  const id = s.meta.nextId++;
  s.career.applications.push({ id, jobId: JOBS[0].id, appliedDay: s.day, resolveDay: s.day, status: 'offer', chance: 1, offerSalary: usd(1100), offerExpiresDay: s.day + days, negotiated: false });
  return s.career.applications.find((a) => a.id === id)!;
}

describe('Ausencia de 8 horas (experimento de la auditoría)', () => {
  it('8 horas son más días de los que dura la oferta: sin arreglo, vencería', () => {
    // 8 h a 10 min por día = 48 días, con tope de 30: más que los 7 días de la oferta.
    expect(offlineDays(Date.now() - EIGHT_HOURS, Date.now(), DEFAULT_OFFLINE)).toBe(30);
  });

  it('al abrir después de 8 horas la oferta sigue abierta, con el mismo plazo, y se avisa por qué', async () => {
    const g = makeGame('egresado', 'absence-offer');
    for (let d = 0; d < 3; d++) advanceDay(g);
    const offer = withJobOffer(g, 7);
    await saveGame(new LocalKV(), g, Date.now() - EIGHT_HOURS);
    const st = make();
    await st.boot();
    const ui = st.getSnapshot();
    const a = ui.state!.career.applications.find((x) => x.id === offer.id)!;
    expect(a.status).toBe('offer');
    expect(a.offerExpiresDay! - ui.state!.day).toBe(7);
    expect(ui.absence).toBeNull();
    expect(ui.loadNotice).toMatch(/El tiempo te esperó/);
  });

  it('un dilema abierto no se resuelve solo mientras la app está cerrada', async () => {
    const g = makeGame('egresado', 'absence-dilemma');
    const d = openDilemma(g, 'horas_extra', { project: 'el cierre' }, 6)!;
    expect(d).toBeTruthy();
    await saveGame(new LocalKV(), g, Date.now() - EIGHT_HOURS);
    const st = make();
    await st.boot();
    const s = st.getSnapshot().state!;
    expect(s.saga.dilemmas.open.some((x) => x.id === d.id)).toBe(true);
    expect(s.day).toBe(0);
  });

  it('sin pendientes avanza, pero se detiene el día que aparece algo para decidir (con su plazo completo)', async () => {
    // Varias semillas: cada una avanza hasta su primera decisión nueva o hasta el tope.
    for (const seed of ['abs-a', 'abs-b', 'abs-c', 'abs-d']) {
      const g = makeGame('egresado', seed);
      expect(pendingChoices(g)).toHaveLength(0);
      const run = simulateAbsence(g, 30);
      const s = run.state;
      expect(run.failure).toBeNull();
      expect(s.log.filter((l) => l.id > 0 && /Venció una decisión|venció y se duplicó|EMBARGO/.test(l.text) && l.day > 0)).toHaveLength(0);
      expect(s.career.applications.some((a) => a.status === 'expired')).toBe(false);
      if (run.stop.kind === 'event') {
        // Lo que lo detuvo está a la vista y nada de la agenda está vencido.
        for (const i of agenda(s)) if (i.due !== null && !i.key.startsWith('news:') && !i.key.startsWith('heir')) expect(i.due).toBeGreaterThanOrEqual(s.day);
      } else expect(['complete', 'deadline']).toContain(run.stop.kind);
      expectConsistent(s);
    }
  });

  it('se detiene el día anterior al vencimiento de una multa, así se puede pagar sin embargo', () => {
    const g = makeGame('egresado', 'absence-fine');
    const amount = usd(200);
    post(g.ledger, { day: g.day, memo: 'Multa de prueba', cf: 'internal', tag: 'legal:fine', lines: [{ account: 'fines', debit: amount }, { account: 'fines_payable', credit: amount }] });
    g.legal.fines.push({ id: g.meta.nextId++, caseId: null, label: 'Multa de prueba', balance: amount, original: amount, dueDay: g.day + 5, installment: null, garnishing: false });
    const run = simulateAbsence(g, 30);
    const s = run.state;
    // Puede detenerse antes por otro motivo; nunca después del día previo al vencimiento.
    expect(s.day).toBeLessThanOrEqual(4);
    if (run.stop.kind === 'deadline') expect(run.stop.item.key).toMatch(/^fine:/);
    expect(s.legal.fines[0].garnishing).toBe(false);
    if (s.day === 4) expect(paymentDueTomorrow(s)?.key).toMatch(/^fine:/);
    expectConsistent(s);
  });

  it('volver de segundo plano tiene el mismo trato que abrir la app (y el tiempo queda en pausa)', async () => {
    const g = makeGame('egresado', 'absence-bg');
    await saveGame(new LocalKV(), g, Date.now());
    const st = make();
    await st.boot();
    st.setSpeed(1);
    const offer = withJobOffer(st.getSnapshot().state!, 7);
    const t0 = Date.now();
    st.enterBackground(t0);
    expect(st.getSnapshot().speed).toBe(0);
    await st.resumeFromBackground(t0 + EIGHT_HOURS);
    const s = st.getSnapshot().state!;
    expect(s.career.applications.find((x) => x.id === offer.id)?.status).toBe('offer');
    expect(s.day).toBe(0);
    expect(st.getSnapshot().loadNotice).toMatch(/El tiempo te esperó/);
  });

  it('en segundo plano sin pendientes, al volver se simula la ausencia y se informa', async () => {
    const g = makeGame('egresado', 'absence-bg2');
    await saveGame(new LocalKV(), g, Date.now());
    const st = make();
    await st.boot();
    const t0 = Date.now();
    st.enterBackground(t0);
    await st.resumeFromBackground(t0 + 30 * 60 * 1000); // 30 minutos = 3 días
    const ui = st.getSnapshot();
    expect(ui.state!.day).toBeGreaterThan(0);
    expect(ui.state!.day).toBeLessThanOrEqual(3);
    expect(ui.absence?.toDay).toBe(ui.state!.day);
    // Una segunda reanudación sin nueva ausencia no simula nada más.
    const day = ui.state!.day;
    await st.resumeFromBackground(t0 + 60 * 60 * 1000);
    expect(st.getSnapshot().state!.day).toBe(day);
  });
});

describe('Ausencias largas en partidas avanzadas (varias semillas)', () => {
  it('ninguna decisión, oferta, tentación ni inspección vence durante la ausencia', () => {
    for (const seed of ['long-1', 'long-2', 'long-3']) {
      const g = makeGame('herencia', seed);
      // Medio año de partida "en vivo" sin responder nada (puede dejar cosas abiertas).
      for (let d = 0; d < 180; d++) advanceDay(g);
      const before = g.log.length ? g.log[g.log.length - 1].id : 0;
      const waiting = pendingChoices(g).length;
      const run = simulateAbsence(g, 90);
      const fresh = run.state.log.filter((l) => l.id > before);
      expect(fresh.filter((l) => /Venció una decisión|venció y se duplicó/.test(l.text))).toHaveLength(0);
      if (waiting) expect(run.daysDone).toBe(0);
      expectConsistent(run.state);
    }
  });
});
