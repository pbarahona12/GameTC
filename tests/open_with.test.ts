// @vitest-environment jsdom
/**
 * Abrir una partida desde otra app (WhatsApp, Archivos, Drive): la partida llega,
 * se muestra cuál es y solo se importa si el jugador confirma.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { GameStore } from '../src/ui/store';
import { serialize, serializeCompact } from '../src/persistence/save';
import { isFileUrl, fileLabel } from '../src/ui/openWith';
import { advanceDay } from '../src/engine/simulation';
import { makeGame } from './helpers';

const stores: GameStore[] = [];
async function booted() {
  const st = new GameStore();
  stores.push(st);
  await st.boot();
  return st;
}
afterEach(() => {
  while (stores.length) stores.pop()!.stopClock();
  localStorage.clear();
});

describe('Abrir con Ultimate Realistic Tycoon', () => {
  it('reconoce archivos locales y no páginas web', () => {
    expect(isFileUrl('content://com.whatsapp.provider.media/item/123')).toBe(true);
    expect(isFileUrl('file:///storage/emulated/0/Download/urt-ana-dia-30.json')).toBe(true);
    expect(isFileUrl('https://example.com/partida.json')).toBe(false);
    expect(isFileUrl(undefined)).toBe(false);
    expect(fileLabel('file:///storage/emulated/0/Download/urt-ana-dia-30.json')).toBe('«urt-ana-dia-30.json»');
    expect(fileLabel('content://com.whatsapp.provider.media/item/123')).toBe('la partida recibida');
  });

  it('la partida recibida se muestra y solo se importa al confirmar (comprimida o no)', async () => {
    const g = makeGame('herencia', 'open-with');
    for (let d = 0; d < 120; d++) advanceDay(g);
    for (const text of [await serializeCompact(g, Date.now()), serialize(g, Date.now())]) {
      const st = await booted();
      expect(st.getSnapshot().state).toBeNull();
      st.offerImport(text, '«urt-tester-dia-120.json»');
      const inc = st.getSnapshot().incomingImport!;
      expect(inc.summary).toMatchObject({ name: 'Tester', day: 120 });
      expect(st.getSnapshot().state).toBeNull(); // todavía no se importó
      const r = await st.acceptIncomingImport();
      expect(r.ok).toBe(true);
      expect(st.getSnapshot().state?.day).toBe(120);
      expect(st.getSnapshot().incomingImport).toBeNull();
      localStorage.clear();
    }
  });

  it('cancelar no toca nada, y un archivo que no es una partida no se importa', async () => {
    const st = await booted();
    await st.startNewGame({ name: 'Actual', background: 'egresado', style: 'libre', seed: 'open-cancel' });
    const slots = st.getSnapshot().slots.length;
    st.offerImport('{"no":"es una partida"}', 'la partida recibida');
    expect(st.getSnapshot().incomingImport?.summary).toBeNull();
    const r = await st.acceptIncomingImport();
    expect(r.ok).toBe(false);
    expect(st.getSnapshot().slots.length).toBe(slots);
    expect(st.getSnapshot().state?.player.name).toBe('Actual');
    st.dismissIncomingImport();
    expect(st.getSnapshot().incomingImport).toBeNull();
  });

  it('ningún selector de archivos filtra por tipo (Android marca los .json de WhatsApp como «desconocido»)', () => {
    for (const f of ['src/ui/sheets.tsx', 'src/ui/screens/Onboarding.tsx']) {
      const src = readFileSync(f, 'utf8');
      expect(src).toMatch(/type="file"/);
      expect(src, f).not.toMatch(/type="file"[^>]*accept=/);
    }
  });

  it('el manifiesto de Android ofrece abrir archivos .json de otras apps', () => {
    const xml = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
    expect(xml).toMatch(/android\.intent\.action\.VIEW/);
    for (const m of ['application/json', 'application/octet-stream']) expect(xml).toContain(`android:mimeType="${m}"`);
  });
});
