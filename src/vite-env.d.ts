/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "true" solo en la compilación publicada: anuncios reales en vez de los de prueba. */
  readonly VITE_ADS_LIVE?: string;
  /** Variante de distribución: "play" (por defecto) o "github". Ver src/distribution.ts. */
  readonly VITE_DISTRIBUTION?: string;
}
