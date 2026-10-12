import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Variante de distribución (ver src/distribution.ts): `play` por defecto, `github`
 * solo si se pide. En la de Play, toda importación de `persistence/ota` se resuelve
 * a `ota.play.ts`, así las actualizaciones propias no quedan en el paquete. Las
 * pruebas (mode "test") siempre usan el módulo real para poder probarlo.
 */
export const distributionOf = (env: NodeJS.ProcessEnv): 'play' | 'github' => (env.VITE_DISTRIBUTION === 'github' ? 'github' : 'play');
export const PLAY_OTA_ALIAS = { find: /^(\.{1,2}\/)+(persistence\/)?ota$/, replacement: fileURLToPath(new URL('./src/persistence/ota.play.ts', import.meta.url)) };

// `--mode single` produce un único index.html autocontenido (vista previa jugable).
export default defineConfig(({ mode }) => ({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: { alias: distributionOf(process.env) === 'play' && mode !== 'test' ? [PLAY_OTA_ALIAS] : [] },
  plugins: [react(), ...(mode === 'single' ? [viteSingleFile()] : [])],
  build: {
    outDir: mode === 'single' ? 'dist-single' : 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 700,
    rollupOptions: mode === 'single' ? {} : {
      output: {
        // Separar librerías y textos del glosario acelera el primer arranque en Android (se cachean aparte).
        manualChunks(id: string) {
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'vendor';
          if (id.includes('/src/content/glossary')) return 'glossary';
          return undefined;
        },
      },
    },
  },
  test: { globals: true, environment: 'node', include: ['tests/**/*.test.{ts,tsx}'], testTimeout: 120000, hookTimeout: 120000 },
}));
