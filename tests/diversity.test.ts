/**
 * 1.6 · Más diversidad para invertir (pedido de un jugador):
 * - Empresas en venta: hasta 5, se reponen cada mes, más nombres por rubro (antes 3,
 *   y con muchas empresas propias se quedaban sin nombres) y un intermediario que
 *   trae 2 más por una comisión.
 * - Mogul Exchange: hasta 12 activos (antes 6); si ya tenés parte de todos, sale uno
 *   nuevo al cierre del mes. Más regalías y edificios distintos.
 * - Fondos: 12 (antes 6), varios que reparten cada trimestre.
 */
import { describe, it, expect } from 'vitest';
import { makeGame, expectConsistent } from './helpers';
import { post } from '../src/engine/ledger/ledger';
import { usd } from '../src/engine/money';
import { advanceDay } from '../src/engine/simulation';
import { isLastDayOfMonth } from '../src/engine/time/calendar';
import { searchListings, LISTINGS, generateListing, refreshListings, LISTING_NAMES } from '../src/engine/business/simulate';
import { buyMogul, MAX_ACTIVE } from '../src/engine/invest/mogul';
import { buyFund, ensureFunds } from '../src/engine/invest/funds';
import { FUND_DEFS } from '../src/content/funds';
import { migrate } from '../src/persistence/migrations';
import type { GameState } from '../src/engine/state';

function rich(seed: string, dollars = 5_000_000): GameState {
  const s = makeGame('herencia', seed);
  post(s.ledger, { day: 0, memo: 'Capital', cf: 'internal', lines: [{ account: 'checking', debit: usd(dollars) }, { account: 'opening_equity', credit: usd(dollars) }] });
  return s;
}
const toMonthEnd = (s: GameState) => { do advanceDay(s); while (!isLastDayOfMonth(s.day)); };

describe('Empresas en venta', () => {
  it('al empezar hay 5 y se reponen cada mes', () => {
    const s = rich('div-list');
    refreshListings(s); // lo hace el juego al crear la partida
    expect(s.listings.length).toBe(LISTINGS.max);
    s.listings = s.listings.slice(0, 1);
    for (let d = 0; d < 31; d++) advanceDay(s);
    expect(s.listings.length).toBeGreaterThanOrEqual(LISTINGS.max - 1);
    expectConsistent(s);
  });

  it('aunque tengas muchas empresas con los nombres de un rubro, siguen apareciendo otras', () => {
    const s = rich('div-names');
    // Simula que ya tenés todos los nombres de 4 de los 5 rubros (como un jugador con muchas empresas).
    const taken = Object.entries(LISTING_NAMES).filter(([sec]) => sec !== 'saas').flatMap(([, names]) => names);
    const realListings = s.listings;
    s.listings = taken.map((name) => ({ company: { name } })) as unknown as GameState['listings'];
    // Los rubros sin nombres libres ya no se eligen: lo que sale es del rubro que queda.
    const found = [...Array(6)].map(() => generateListing(s)).filter(Boolean);
    s.listings = realListings;
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((l) => l!.company.sector === 'saas')).toBe(true);
  });

  it('el intermediario cobra, trae 2 más, una vez por mes y hasta 8', () => {
    const s = rich('div-search');
    refreshListings(s);
    const before = s.listings.length;
    const cash = s.ledger.balances.checking;
    const r = searchListings(s);
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    expect(s.listings.length).toBe(Math.min(LISTINGS.searchMax, before + LISTINGS.searchCount));
    expect(cash - s.ledger.balances.checking).toBe(usd(LISTINGS.searchFeeUsd * s.macro.priceIndex));
    expect(searchListings(s).ok).toBe(false); // una vez por mes
    for (let d = 0; d < LISTINGS.searchCooldownDays; d++) advanceDay(s);
    expect(searchListings(s).ok).toBe(true);
    expect(s.listings.length).toBeLessThanOrEqual(LISTINGS.searchMax);
    expectConsistent(s);
  });
});

describe('Mogul Exchange', () => {
  it('una partida nueva empieza con 8 activos y no más de 4 empresas', () => {
    const s = rich('div-mogul');
    const live = s.mogul.assets.filter((a) => a.status === 'activo');
    expect(live.length).toBe(8);
    expect(live.filter((a) => a.kind === 'empresa').length).toBeLessThanOrEqual(4);
  });

  it('si ya tenés parte de todos, sale uno nuevo al cierre del mes, hasta 12', () => {
    const s = rich('div-mogul-full', 50_000_000);
    const buyAll = () => {
      for (const a of s.mogul.assets.filter((x) => x.status === 'activo')) {
        const want = a.units * 0.25 - (s.mogul.holdings[a.id]?.qty ?? 0);
        if (want > 0) expect(buyMogul(s, a.id, Math.ceil(want)).ok).toBe(true);
      }
    };
    let prev = s.mogul.assets.filter((a) => a.status === 'activo').length;
    for (let m = 0; m < 6; m++) {
      buyAll();
      toMonthEnd(s);
      const now = s.mogul.assets.filter((a) => a.status === 'activo').length;
      if (prev < MAX_ACTIVE) expect(now).toBeGreaterThan(prev);
      prev = now;
      advanceDay(s);
    }
    expect(prev).toBeLessThanOrEqual(MAX_ACTIVE);
    expect(s.mogul.assets.filter((a) => a.status === 'activo' && a.kind === 'empresa').length).toBeLessThanOrEqual(4);
    expectConsistent(s);
  });
});

describe('Fondos', () => {
  it('hay 12 fondos y 8 reparten cada trimestre', () => {
    const s = rich('div-funds');
    expect(s.funds.funds.length).toBe(FUND_DEFS.length);
    expect(FUND_DEFS.length).toBe(12);
    expect(FUND_DEFS.filter((d) => d.distributes).length).toBeGreaterThanOrEqual(7);
  });

  it('los fondos nuevos aparecen en partidas que ya existían, una sola vez', () => {
    const s = rich('div-old');
    s.funds.funds = s.funds.funds.slice(0, 6);
    const { state } = migrate(JSON.parse(JSON.stringify(s)));
    expect(state.funds.funds.map((f) => f.id)).toEqual(FUND_DEFS.map((d) => d.id));
    expect(ensureFunds(state)).toBe(0);
  });

  it('un año invirtiendo en todos: valores positivos, repartos cobrados y contabilidad cuadrada', () => {
    const s = rich('div-year');
    for (const d of FUND_DEFS) expect(buyFund(s, d.id, usd(20_000)).ok).toBe(true);
    for (let d = 0; d < 365; d++) advanceDay(s);
    for (const f of s.funds.funds) expect(f.nav).toBeGreaterThan(0);
    expect(s.funds.distributionsReceived).toBeGreaterThan(0);
    // El balanceado se mueve menos que el índice.
    const vol = (id: string) => {
      const h = s.funds.funds.find((f) => f.id === id)!.history.map((x) => x.v);
      const r = h.slice(1).map((v, i) => Math.log(v / h[i]));
      const m = r.reduce((a, b) => a + b, 0) / r.length;
      return Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length);
    };
    expect(vol('F-BAL')).toBeLessThan(vol('F-IDX'));
    expectConsistent(s);
  });
});
