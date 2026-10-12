import { store } from './store';

/**
 * ABRIR UNA PARTIDA DESDE OTRA APP (Android).
 *
 * Tocar el archivo exportado en WhatsApp, Archivos o Drive y elegir «Abrir con
 * Ultimate Realistic Tycoon» lanza la app con un intent VIEW (ver los filtros en
 * AndroidManifest.xml). El plugin App lo entrega como `appUrlOpen` (o como
 * `getLaunchUrl` si la app estaba cerrada) con una dirección content://, que se
 * lee con Filesystem. La partida NO se importa sola: el jugador ve cuál es y
 * confirma (store.offerImport → IncomingImportSheet).
 */

/** Partidas exportadas de varios años pesan algunos MB; más de esto no es una partida. */
export const MAX_INCOMING_BYTES = 60 * 1024 * 1024;

/** ¿La dirección apunta a un archivo local (no a una página web)? */
export function isFileUrl(url: string | undefined | null): url is string {
  return !!url && /^(content|file):\/\//i.test(url);
}

/** Nombre legible del archivo a partir de la dirección (si se puede). */
export function fileLabel(url: string): string {
  try {
    const last = decodeURIComponent(url.split(/[/?#]/).filter(Boolean).pop() ?? '');
    return /\.json$/i.test(last) ? `«${last}»` : 'la partida recibida';
  } catch {
    return 'la partida recibida';
  }
}

async function readShared(url: string): Promise<string> {
  const { Filesystem, Encoding } = await import('@capacitor/filesystem');
  const r = await Filesystem.readFile({ path: url, encoding: Encoding.UTF8 });
  const text = typeof r.data === 'string' ? r.data : await r.data.text();
  if (text.length > MAX_INCOMING_BYTES) throw new Error('el archivo es demasiado grande para ser una partida');
  return text;
}

async function handle(url: string | undefined | null): Promise<void> {
  if (!isFileUrl(url)) return;
  try {
    store.offerImport(await readShared(url), fileLabel(url));
  } catch (e) {
    store.toast(`No se pudo abrir el archivo: ${(e as Error).message}. Probá importarlo desde Ajustes → Guardado y copias.`, 'error');
  }
}

let installed = false;
/** Se llama una vez, después de cargar la partida (store.boot). */
export async function installOpenWith(): Promise<void> {
  if (installed) return;
  installed = true;
  try {
    const { Capacitor } = await import('@capacitor/core');
    if (!Capacitor.isNativePlatform()) return;
    const { App } = await import('@capacitor/app');
    await App.addListener('appUrlOpen', ({ url }) => void handle(url));
    const launch = await App.getLaunchUrl();
    await handle(launch?.url);
  } catch {
    /* sin el plugin: se sigue importando desde Ajustes */
  }
}
