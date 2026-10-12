/**
 * Fase 0 · variante de Google Play (auditoría D7): sin actualizaciones propias ni
 * enlaces a APK. La comprobación sobre el paquete compilado la hace
 * `npm run build:play` (scripts/verifyDistribution.mjs); aquí se prueba la pieza que
 * la hace posible: el alias de compilación y el módulo sustituto.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PLAY_OTA_ALIAS, distributionOf } from '../vite.config';
import * as playOta from '../src/persistence/ota.play';
import { DISTRIBUTION, SELF_UPDATES } from '../src/distribution';

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? sources(join(dir, d.name)) : /\.tsx?$/.test(d.name) ? [join(dir, d.name)] : []));
}

describe('Variante de distribución', () => {
  it('sin variable, la compilación es la de Play (nunca lleva las actualizaciones propias por descuido)', () => {
    expect(distributionOf({})).toBe('play');
    expect(distributionOf({ VITE_DISTRIBUTION: 'cualquier-cosa' })).toBe('play');
    expect(distributionOf({ VITE_DISTRIBUTION: 'github' })).toBe('github');
    expect(DISTRIBUTION).toBe('play');
    expect(SELF_UPDATES).toBe(false);
  });

  it('el alias de Play atrapa TODAS las importaciones de ota.ts que hace la app, y nada más', () => {
    const imports = sources('src')
      .filter((f) => !f.endsWith('ota.play.ts') && !f.endsWith(join('persistence', 'ota.ts')))
      .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(/from '([^']*\/ota)'/g)].map((m) => m[1]));
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) expect(PLAY_OTA_ALIAS.find.test(spec), spec).toBe(true);
    for (const other of ['./ota-keys.json', './otaSignature', '../persistence/save', './persistence/offline', 'ota']) expect(PLAY_OTA_ALIAS.find.test(other), other).toBe(false);
    expect(PLAY_OTA_ALIAS.replacement).toMatch(/ota\.play\.ts$/);
  });

  it('el sustituto de Play solo importa TIPOS de ota.ts (nada de su código entra al paquete)', () => {
    const text = readFileSync('src/persistence/ota.play.ts', 'utf8');
    const runtimeImports = text.split('\n').filter((l) => /^import\s/.test(l) && !/^import type\s/.test(l));
    expect(runtimeImports).toEqual([]);
    expect(text).not.toMatch(/githubusercontent|releases\/latest|ota-channel|setServerBasePath/);
  });

  it('en Play no se busca, no se descarga y no hay enlace a una APK', async () => {
    expect(playOta.APK_DOWNLOAD_URL).toBeNull();
    expect(await playOta.checkForUpdate(true)).toEqual({ kind: 'web' });
    expect(await playOta.applyUpdate({} as never, async () => true)).toMatch(/Google Play/);
    expect(playOta.otaStore.get()).toMatchObject({ check: null, native: null, justUpdated: null, rolledBack: null });
    await expect(playOta.otaBoot()).resolves.toBeUndefined();
    await expect(playOta.autoCheck()).resolves.toBeUndefined();
  });
});
