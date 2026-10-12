// @vitest-environment jsdom
/**
 * Exportar la partida (fase 0): la migración a la llave nueva de GitHub exige
 * exportar e importar, así que el archivo tiene que ser liviano. Se exporta
 * comprimido (gzip, como el guardado interno) y se importa igual que antes.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { GameStore } from '../src/ui/store';
import { parseImport, serialize } from '../src/persistence/save';
import { exportToFile } from '../src/persistence/platformStorage';
import { advanceDay } from '../src/engine/simulation';

vi.mock('../src/persistence/platformStorage', async (orig) => {
  const actual = await orig<typeof import('../src/persistence/platformStorage')>();
  return { ...actual, exportToFile: vi.fn(async () => ({ ok: true, message: 'ok' })) };
});

afterEach(() => localStorage.clear());

describe('Exportar partida', () => {
  it('el archivo va comprimido, pesa bastante menos y se importa con la misma partida', async () => {
    const st = new GameStore();
    try {
      await st.boot();
      await st.startNewGame({ name: 'Exporta', background: 'herencia', style: 'libre', seed: 'export-size' });
      const s = st.getSnapshot().state!;
      for (let d = 0; d < 400; d++) advanceDay(s);
      await st.exportFile();
      const [text, name] = vi.mocked(exportToFile).mock.calls.at(-1)!;
      expect(name).toMatch(/\.json$/);
      expect(JSON.parse(text).encoding).toBe('gzip-b64');
      expect(text.length).toBeLessThan(serialize(s, Date.now()).length / 2);
      const back = await parseImport(text);
      expect(back.ok).toBe(true);
      if (back.ok) {
        expect(back.state.day).toBe(s.day);
        expect(JSON.stringify(back.state)).toBe(JSON.stringify(s));
      }
      // «Mostrar como texto» usa el mismo formato.
      expect(JSON.parse((await st.exportText())!).encoding).toBe('gzip-b64');
    } finally {
      st.stopClock();
    }
  });

  it('una exportación vieja sin comprimir se sigue importando', async () => {
    const st = new GameStore();
    try {
      await st.boot();
      await st.startNewGame({ name: 'Vieja', background: 'egresado', style: 'libre', seed: 'export-old' });
      const plain = serialize(st.getSnapshot().state!, Date.now());
      expect((await parseImport(plain)).ok).toBe(true);
    } finally {
      st.stopClock();
    }
  });
});
