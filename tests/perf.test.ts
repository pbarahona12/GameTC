// @vitest-environment jsdom
/**
 * Fase 1 · E11 (auditoría D13): rendimiento en teléfonos.
 * Las optimizaciones no cambian el resultado: estas pruebas fijan que siguen
 * siendo exactas y que no vuelven los costos que se midieron.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { makeGame, expectConsistent } from './helpers';
import { advanceDay, advanceDaySafe } from '../src/engine/simulation';
import { takeSnapshot } from '../src/engine/snapshot';
import { compactLedgers } from '../src/engine/ledger/compaction';
import { isLastDayOfMonth } from '../src/engine/time/calendar';
import { fnv1a, gzipText, gunzipText } from '../src/persistence/codec';
import { packPayload } from '../src/persistence/pack';
import { serializeCompact, deserializeAny } from '../src/persistence/save';
import { GameStore, RENDER_EVERY_MS } from '../src/ui/store';
import { runBot } from './bots/strategies';
import type { GameState } from '../src/engine/state';

/** Partida de varios años con empresas (archivos contables con muchos meses). */
function longGame(): GameState {
  let s: GameState | null = null;
  runBot('emprendedor' as never, 'tecnico' as never, 'perf', 6, { onMonth: (x) => { s = x; } });
  return s!;
}

afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe('Archivos contables: copia al escribir', () => {
  it('compactar nunca modifica el archivo anterior ni sus baldes', () => {
    const s = longGame();
    const before = s.ledger.archive;
    const frozen = JSON.stringify(before);
    const coBefore = s.companies.map((c) => ({ ref: c.ledger.archive, json: JSON.stringify(c.ledger.archive) }));
    // Llegar a fin de año (compacta también el libro personal) y compactar empresas.
    while (!(isLastDayOfMonth(s.day) && new Date(Date.UTC(2026, 0, 1 + s.day + 1)).getUTCMonth() === 0)) advanceDay(s);
    compactLedgers(s);
    expect(JSON.stringify(before)).toBe(frozen);
    coBefore.forEach((x) => expect(JSON.stringify(x.ref)).toBe(x.json));
    expectConsistent(s);
  });

  it('la instantánea comparte los archivos y restaura el estado exacto, aun si el día compactó', () => {
    const s = longGame();
    while (!isLastDayOfMonth(s.day + 1)) advanceDay(s); // el próximo día cierra el mes (compacta)
    const original = JSON.stringify(s);
    const snap = takeSnapshot(s);
    advanceDay(s); // cierre de mes con compactación
    expect(JSON.stringify(s)).not.toBe(original);
    const back = snap.restore();
    expect(JSON.stringify(back)).toBe(original);
    // La compactación de ese día creó archivos nuevos en las empresas; la copia restaurada conserva los viejos.
    expect(s.companies.some((c, i) => c.ledger.archive && c.ledger.archive !== back.companies[i]?.ledger.archive)).toBe(true);
    expectConsistent(back);
  });

  it('un día que falla al cerrar el mes vuelve exactamente al día anterior', () => {
    const s = longGame();
    while (!isLastDayOfMonth(s.day + 1)) advanceDay(s);
    const original = JSON.stringify(s);
    const r = advanceDaySafe(s, (x) => {
      advanceDay(x);
      throw new Error('falla de prueba en el cierre');
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r.state)).toBe(original);
  });

  it('la instantánea de cada día es barata: no copia el archivo contable', () => {
    const s = longGame();
    const archiveSize = JSON.stringify(s.ledger.archive ?? null).length + s.companies.reduce((a, c) => a + JSON.stringify(c.ledger.archive ?? null).length, 0);
    expect(archiveSize).toBeGreaterThan(10_000);
    const spy = vi.spyOn(globalThis, 'structuredClone');
    takeSnapshot(s);
    const cloned = JSON.stringify(spy.mock.calls[0][0]);
    expect(cloned).not.toContain('"buckets"');
    spy.mockRestore();
  });
});

describe('Guardado en un hilo aparte', () => {
  it('el resultado es idéntico con o sin hilo (sin Worker se hace en el hilo principal)', async () => {
    expect(typeof Worker).toBe('undefined');
    const s = makeGame('herencia', 'pack');
    for (let d = 0; d < 60; d++) advanceDay(s);
    const payload = JSON.stringify(s);
    const p = await packPayload(payload);
    expect(p.checksum).toBe(fnv1a(payload));
    expect(await gunzipText(p.packed)).toBe(payload);
    expect(await gunzipText(await gzipText(payload))).toBe(payload);
    const r = await deserializeAny(await serializeCompact(s, Date.now()));
    expect(r.ok).toBe(true);
  });

  it('si el hilo falla, el guardado se hace igual en el hilo principal', async () => {
    vi.resetModules();
    class BrokenWorker {
      onmessage: ((e: MessageEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage() { setTimeout(() => this.onerror?.(), 0); }
      terminate() {}
    }
    vi.stubGlobal('Worker', BrokenWorker);
    vi.doMock('../src/persistence/packWorker?worker&inline', () => ({ default: BrokenWorker }));
    const { packPayload: pack } = await import('../src/persistence/pack');
    const payload = JSON.stringify({ hola: 'mundo', n: [1, 2, 3] });
    const p = await pack(payload);
    expect(p.checksum).toBe(fnv1a(payload));
    expect(await gunzipText(p.packed)).toBe(payload);
    vi.unstubAllGlobals();
    vi.doUnmock('../src/persistence/packWorker?worker&inline');
  });
});

describe('Dibujar menos a velocidades altas', () => {
  it('a 8× la pantalla se redibuja como mucho cada medio segundo; pausas y cierres de mes se ven ya', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'performance', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    const st = new GameStore();
    try {
      await st.boot();
      await st.startNewGame({ name: 'Rápida', background: 'herencia', style: 'libre', seed: 'render' });
      st.updateSettings({ autoPause: false, monthTurn: false });
      let emits = 0;
      st.subscribe(() => emits++);
      st.setSpeed(8);
      const day0 = st.getSnapshot().state!.day;
      emits = 0;
      vi.advanceTimersByTime(10_000); // 10 s reales a 8× ≈ 40 días
      const days = st.getSnapshot().state!.day - day0;
      expect(days).toBeGreaterThanOrEqual(35);
      // Sin el límite serían ≥ 40 dibujos (uno por día); con el límite, ~2 por segundo
      // más los cierres de mes y los avisos.
      expect(emits).toBeLessThan(days);
      expect(emits).toBeLessThanOrEqual(10_000 / RENDER_EVERY_MS[8]! + 6);
      // Lo que se ve está al día al pausar.
      st.setSpeed(0);
      expect(st.getSnapshot().state!.day - day0).toBe(days);
      expectConsistent(st.getSnapshot().state!);
    } finally {
      st.stopClock();
    }
  });
});
