// @vitest-environment jsdom
/** Fase 0: registro local de errores (sin telemetría; nunca sale solo del dispositivo). */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { recordError, readErrors, clearErrors, errorLogText, MAX_ERRORS, ERROR_LOG_KEY } from '../src/persistence/errorLog';
import { GameStore } from '../src/ui/store';
import { saveGame } from '../src/persistence/save';
import { advanceDay } from '../src/engine/simulation';
import { makeGame } from './helpers';

class LocalKV {
  async get(k: string) { return localStorage.getItem(k); }
  async set(k: string, v: string) { localStorage.setItem(k, v); }
  async remove(k: string) { localStorage.removeItem(k); }
}

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe('Registro local de errores', () => {
  it('guarda mensaje, lugar, versión, día y una pila recortada', () => {
    const e = new Error('algo falló');
    recordError(e, 'interfaz', { day: 42, now: 1000 });
    const [x] = readErrors();
    expect(x).toMatchObject({ where: 'interfaz', name: 'Error', message: 'algo falló', day: 42, at: 1000 });
    expect(x.stack!.split('\n').length).toBeLessThanOrEqual(8);
    expect(errorLogText()).toMatch(/interfaz · versión .* · día 42\nError: algo falló/);
  });

  it('conserva solo los últimos errores y no repite el mismo error seguido', () => {
    for (let i = 0; i < MAX_ERRORS + 5; i++) recordError(new Error(`e${i}`), 'ventana', { now: i * 10_000 });
    const list = readErrors();
    expect(list).toHaveLength(MAX_ERRORS);
    expect(list[list.length - 1].message).toBe(`e${MAX_ERRORS + 4}`);
    recordError(new Error('repetido'), 'ventana', { now: 1e9 });
    recordError(new Error('repetido'), 'ventana', { now: 1e9 + 100 });
    expect(readErrors().filter((x) => x.message === 'repetido')).toHaveLength(1);
    clearErrors();
    expect(readErrors()).toHaveLength(0);
    expect(errorLogText()).toBe('Sin errores registrados.');
  });

  it('registrar nunca rompe la app, aunque el almacenamiento falle o el registro esté dañado', () => {
    localStorage.setItem(ERROR_LOG_KEY, '{no es json');
    expect(readErrors()).toEqual([]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('lleno'); });
    expect(() => recordError({ raro: true }, 'promesa')).not.toThrow();
    expect(() => recordError(undefined, 'promesa')).not.toThrow();
  });

  it('un día de simulación que falla queda registrado con su día', async () => {
    const g = makeGame('egresado', 'errlog-sim');
    await saveGame(new LocalKV(), g, Date.now());
    const st = new GameStore({ step: (s) => { advanceDay(s); throw new Error('falla de prueba'); } });
    try {
      await st.boot();
      st.step(1);
      const last = readErrors().pop()!;
      expect(last.where).toMatch(/^simulación/);
      expect(last.message).toBe('falla de prueba');
      expect(last.day).toBe(1);
    } finally {
      st.stopClock();
    }
  });
});
