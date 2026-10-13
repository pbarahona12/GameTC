// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { useState } from 'react';
import { AmountInput, NumInput } from '../src/ui/components/common';
import { store } from '../src/ui/store';
import { navStore } from '../src/ui/nav';
import { serialize } from '../src/persistence/save';
import { makeGame, forceHire } from './helpers';
import { post } from '../src/engine/ledger/ledger';
import { usd } from '../src/engine/money';
import { takeLoan } from '../src/engine/finance/loans';
import { foundCompany } from '../src/engine/business/ownership';
import { BANKS } from '../src/content/banks';
import { Finance } from '../src/ui/screens/Finance';
import { RealEstateScreen } from '../src/ui/screens/invest/RealEstate';
import { Business } from '../src/ui/screens/Business';
import type { GameState } from '../src/engine/state';

function input(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!(el instanceof HTMLInputElement)) throw new Error(`No existe el campo #${id}`);
  return el;
}

function type(el: HTMLInputElement, text: string) {
  fireEvent.change(el, { target: { value: text } });
}

async function loadGame(g: GameState) {
  await act(async () => {
    await store.importText(serialize(g, Date.now()));
  });
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Fase 2 · campo de montos', () => {
  function Harness({ onValue }: { onValue: (c: number) => void }) {
    const [v, setV] = useState(0);
    return <AmountInput id="amt" value={v} onChange={(c) => { setV(c); onValue(c); }} />;
  }

  it('"150,000" son ciento cincuenta mil y se muestra el valor interpretado', () => {
    const seen: number[] = [];
    render(<Harness onValue={(c) => seen.push(c)} />);
    const el = input('amt');
    fireEvent.focus(el);
    type(el, '150,000');
    expect(seen.at(-1)).toBe(15000000);
    expect(screen.getByText(/Valor interpretado/).textContent).toContain('$150,000.00');
    // El texto que escribió el jugador no se reemplaza mientras escribe.
    expect(el.value).toBe('150,000');
  });

  it('un formato inválido muestra el error, informa 0 y no borra lo escrito', () => {
    const seen: number[] = [];
    render(<Harness onValue={(c) => seen.push(c)} />);
    const el = input('amt');
    type(el, '1,500,50');
    expect(seen.at(-1)).toBe(0);
    expect(el.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByText(/separador/)).toBeTruthy();
    expect(el.value).toBe('1,500,50');
  });

  it('al salir del campo se normaliza el formato', () => {
    render(<Harness onValue={() => {}} />);
    const el = input('amt');
    fireEvent.focus(el);
    type(el, '150000');
    fireEvent.blur(el);
    expect(el.value).toBe('150,000');
  });
});

describe('Fase 2 · campo numérico con borrador', () => {
  it('no aplica cada tecla: aplica una sola vez al salir del campo', () => {
    const calls: number[] = [];
    render(<NumInput id="n" value={10} onChange={(n) => calls.push(n)} />);
    const el = input('n');
    type(el, '1');
    type(el, '12');
    type(el, '120');
    expect(calls).toEqual([]);
    fireEvent.blur(el);
    expect(calls).toEqual([120]);
  });

  it('Enter también aplica, y un campo vacío vuelve al valor anterior sin aplicar 0', () => {
    const calls: number[] = [];
    render(<NumInput id="n" value={10} onChange={(n) => calls.push(n)} />);
    const el = input('n');
    type(el, '');
    fireEvent.blur(el);
    expect(calls).toEqual([]);
    expect(el.value).toBe('10');
    type(el, '1,500');
    fireEvent.keyDown(el, { key: 'Enter' });
    expect(calls).toEqual([1500]);
  });

  it('en modo inmediato respeta el mínimo sin "saltar" mientras se escribe', () => {
    function H() {
      const [y, setY] = useState(25);
      return <><NumInput id="y" live value={y} onChange={setY} min={5} max={30} /><span data-testid="y">{y}</span></>;
    }
    render(<H />);
    const el = input('y');
    type(el, '3');
    expect(screen.getByTestId('y').textContent).toBe('25');
    expect(el.value).toBe('3');
    expect(screen.getByText('El mínimo es 5.')).toBeTruthy();
    type(el, '30');
    expect(screen.getByTestId('y').textContent).toBe('30');
  });
});

describe('Fase 2 · formularios entre entidades', () => {
  it('cada préstamo tiene su propio monto de amortización', async () => {
    const g = makeGame('herencia', 'forms-loans');
    g.credit.score = 760;
    forceHire(g, 'ind_operario'); // sueldo fijo: alcanza para dos préstamos (ventas pasó a sueldo bajo + comisión)
    const banks = BANKS.slice(0, 3).map((b) => b.id);
    let taken = 0;
    for (const b of banks) if (takeLoan(g, b, usd(2000), 12).ok) taken++;
    expect(taken).toBeGreaterThanOrEqual(2);
    await loadGame(g);
    navStore.setSub('finance', 'loans');
    render(<Finance />);
    const ids = store.getSnapshot().state!.bank.loans.map((l) => l.id);
    type(input(`prepay-${ids[0]}`), '500');
    expect(input(`prepay-${ids[0]}`).value).toBe('500');
    expect(input(`prepay-${ids[1]}`).value).toBe('');
  });

  it('cambiar de inmueble en el mercado reinicia la oferta (no arrastra la anterior)', async () => {
    const g = makeGame('herencia', 'forms-re');
    await loadGame(g);
    const ls = store.getSnapshot().state!.realEstate.listings;
    const [a, b] = [ls[0], ls.find((l) => l.askPrice !== ls[0].askPrice)!];
    const view = render(<RealEstateScreen param={`list:${a.id}`} />);
    type(input('offer'), '9,000');
    expect(input('offer').value).toBe('9,000');
    view.rerender(<RealEstateScreen param={`list:${b.id}`} />);
    const shown = input('offer').value;
    expect(shown).not.toBe('9,000');
    expect(shown.replace(/,/g, '')).toBe(String(b.askPrice / 100).replace(/\.0+$/, ''));
  });

  it('cambiar de empresa reinicia los borradores de precios', async () => {
    const g = makeGame('herencia', 'forms-co');
    post(g.ledger, { day: 0, memo: 'Capital', cf: 'internal', lines: [{ account: 'checking', debit: usd(400000) }, { account: 'opening_equity', credit: usd(400000) }] });
    expect(foundCompany(g, { sector: 'cafeteria', name: 'Café A', legalForm: 'srl', capital: usd(60000) }).ok).toBe(true);
    expect(foundCompany(g, { sector: 'cafeteria', name: 'Café B', legalForm: 'srl', capital: usd(60000) }).ok).toBe(true);
    await loadGame(g);
    const [ca, cb] = store.getSnapshot().state!.companies;
    const prod = ca.products[0].id;
    act(() => navStore.setSub('business', `co:${ca.id}:ops`));
    render(<Business />);
    type(input(`price-${ca.id}-${prod}`), '777');
    act(() => navStore.setSub('business', `co:${cb.id}:ops`));
    const el = input(`price-${cb.id}-${prod}`);
    expect(el.value).not.toBe('777');
  });
});
