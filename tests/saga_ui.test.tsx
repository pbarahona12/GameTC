// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, beforeAll, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { store } from '../src/ui/store';
import { navStore } from '../src/ui/nav';
import { serialize } from '../src/persistence/save';
import { makeGame, forceHire } from './helpers';
import { post } from '../src/engine/ledger/ledger';
import { usd } from '../src/engine/money';
import { dilemmasDay, TEMPLATE_BY_ID } from '../src/engine/saga/dilemmas';
import { celebrate } from '../src/engine/saga/chronicle';
import { Home } from '../src/ui/screens/Home';
import { RankingScreen } from '../src/ui/screens/saga/RankingScreen';
import { DilemmaSheet, GoalsView, ChronicleView, ExplainView } from '../src/ui/screens/saga/sagaSheets';
import { Celebrations } from '../src/ui/screens/saga/Celebrations';
import { Onboarding } from '../src/ui/screens/Onboarding';
import type { GameState } from '../src/engine/state';

async function loadGame(g: GameState) {
  await act(async () => {
    // Cada prueba importa una partida nueva: se borran las anteriores para no llegar al máximo.
    for (const slot of [...store.ui.slots]) if (slot.id !== store.ui.activeSlot) await store.deleteSlotById(slot.id);
    const r = await store.importText(serialize(g, Date.now()));
    if (!r.ok) throw new Error(r.error);
  });
  store.stopClock();
}

beforeAll(async () => {
  localStorage.clear();
  await store.boot();
  store.stopClock();
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  navStore.reset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function rich(seed: string): GameState {
  const g = makeGame('tecnico', seed);
  forceHire(g, 'ventas_asistente');
  post(g.ledger, { day: 0, memo: 'Aporte', cf: 'internal', tag: 'opening', lines: [{ account: 'checking', debit: usd(200_000) }, { account: 'opening_equity', credit: usd(200_000) }] });
  g.progression.stage = 3;
  for (const t of Object.keys(TEMPLATE_BY_ID)) if (t !== 'donacion') g.saga.dilemmas.lastByTemplate[t] = 0;
  g.saga.dilemmas.nextDay = 0;
  dilemmasDay(g);
  g.saga.firstMonth.dismissed = true;
  return g;
}

describe('1.4 · Interfaz de la historia', () => {
  it('Inicio muestra la agenda con la decisión, tu lugar en la lista y la invitación a elegir metas', async () => {
    await loadGame(rich('ui-home'));
    render(<Home />);
    expect(screen.getByLabelText('Agenda de pendientes')).toBeTruthy();
    expect(screen.getAllByText(/Te piden una donación/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Tu lugar en Valdoria/)).toBeTruthy();
    expect(screen.getByText(/Elegí tus metas de vida/)).toBeTruthy();
  });

  it('la hoja de la decisión aplica la opción elegida y la deja en la crónica', async () => {
    await loadGame(rich('ui-dilemma'));
    const id = store.ui.state!.saga.dilemmas.open[0].id;
    render(<DilemmaSheet id={id} />);
    fireEvent.click(screen.getByText('Donar una parte'));
    const s = store.ui.state!;
    expect(s.saga.dilemmas.open.length).toBe(0);
    expect(s.saga.stats.donated).toBeGreaterThan(0);
    expect(s.saga.chronicle.some((c) => c.kind === 'dilema')).toBe(true);
  });

  it('metas: elegir desde la hoja las pone en curso', async () => {
    await loadGame(rich('ui-goals'));
    render(<GoalsView />);
    fireEvent.click(screen.getAllByText('Elegir')[0]);
    expect(store.ui.state!.saga.goals.active.length).toBe(1);
  });

  it('la lista de fortunas muestra 20 y se expande a 100; tu fila aparece cuando entrás', async () => {
    const g = rich('ui-rank');
    post(g.ledger, { day: 0, memo: 'Aporte', cf: 'internal', tag: 'opening', lines: [{ account: 'checking', debit: usd(30_000_000) }, { account: 'opening_equity', credit: usd(30_000_000) }] });
    await loadGame(g);
    render(<RankingScreen />);
    expect(document.querySelectorAll('.rank-row').length).toBe(21);
    expect(document.querySelector('.rank-row.me')).toBeTruthy();
    fireEvent.click(screen.getByText('Ver los 100'));
    expect(document.querySelectorAll('.rank-row').length).toBe(100);
    fireEvent.click(screen.getByText('Mundo'));
    expect(document.querySelectorAll('.rank-row').length).toBe(100);
  });

  it('un festejo grande se muestra y se cierra; la crónica y la explicación se dibujan', async () => {
    const g = rich('ui-cel');
    g.saga.celebrations = [];
    celebrate(g, 'big', 'crown', 'Prueba de festejo', 'Texto del festejo.');
    await loadGame(g);
    render(<Celebrations />);
    expect(screen.getByText('Prueba de festejo')).toBeTruthy();
    fireEvent.click(screen.getByText('¡Seguimos!'));
    expect(store.ui.state!.saga.celebrations.some((c) => c.title === 'Prueba de festejo')).toBe(false);
    cleanup();
    render(<ChronicleView />);
    expect(screen.getByText(/Empieza la historia/)).toBeTruthy();
    cleanup();
    render(<ExplainView />);
    expect(screen.getByText(/Por qué cambió tu patrimonio/)).toBeTruthy();
  });

  it('la partida nueva ofrece desafíos con semilla', () => {
    render(<Onboarding />);
    fireEvent.click(screen.getByRole('radio', { name: /Desafío con semilla/ }));
    expect(screen.getAllByText(/El primer millón/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: /Empezar el desafío/ })).toBeTruthy();
  });
});
