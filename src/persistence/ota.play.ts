/**
 * Variante de Google Play de ota.ts (ver src/distribution.ts).
 *
 * En la compilación para Play, vite.config.ts resuelve TODAS las importaciones de
 * `persistence/ota` a este archivo. Tiene la misma forma pública que ota.ts, pero
 * no descarga, no verifica ni cambia la página del juego: las actualizaciones
 * llegan únicamente por Google Play. Solo importa TIPOS de ota.ts (se borran al
 * compilar), así nada de aquel módulo entra en el paquete.
 */
import type * as Ota from './ota';
import type { OtaCheck, OtaManifest, OtaView } from './ota';

export type { OtaCheck, OtaManifest, OtaView, OtaPhase, BootDecision } from './ota';

/** En Play no hay enlace para descargar una APK por fuera de la tienda. */
export const APK_DOWNLOAD_URL: string | null = null;

const view: OtaView = { phase: 'idle', check: null, progress: 0, message: null, justUpdated: null, rolledBack: null, native: null, confirmed: true };

export const otaStore: typeof Ota.otaStore = {
  subscribe: () => () => false,
  get: () => view,
};

export async function otaBoot(): Promise<void> {}

export function failBoot(_reason: string): void {}

/** No hay actualización propia que confirmar; la página instalada es la de Play. */
export function markHealthy(_onConfirmed?: () => void): void {}

export async function dismissUpdateNotes(): Promise<void> {}

export async function autoCheck(): Promise<void> {}

export async function checkForUpdate(_manual: boolean): Promise<OtaCheck> {
  return { kind: 'web' };
}

export async function applyUpdate(_man: OtaManifest, _beforeSwitch: () => Promise<boolean>): Promise<string | null> {
  return 'Esta versión se actualiza desde Google Play.';
}

/**
 * Comprobación de tipos: lo que la interfaz usa de ota.ts existe aquí con la misma
 * firma. Si ota.ts cambia su API, typecheck falla hasta actualizar este archivo.
 */
const _sameApi = {
  otaStore, otaBoot, failBoot, markHealthy, dismissUpdateNotes, autoCheck, checkForUpdate, applyUpdate, APK_DOWNLOAD_URL,
} satisfies Pick<typeof Ota, 'otaStore' | 'otaBoot' | 'failBoot' | 'markHealthy' | 'dismissUpdateNotes' | 'autoCheck' | 'checkForUpdate' | 'applyUpdate' | 'APK_DOWNLOAD_URL'>;
void _sameApi;
