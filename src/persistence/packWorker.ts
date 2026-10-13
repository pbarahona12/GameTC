/// <reference lib="webworker" />
/**
 * Hilo aparte para el guardado (ver pack.ts): recibe el JSON de la partida y
 * devuelve su suma de verificación y su versión comprimida (gzip + base64).
 * Es exactamente el mismo cálculo que hace save.ts en el hilo principal; acá no
 * congela la pantalla mientras el jugador juega.
 */
import { fnv1a, gzipText } from './codec';

self.onmessage = async (ev: MessageEvent<{ id: number; payload: string }>) => {
  const { id, payload } = ev.data;
  try {
    const checksum = fnv1a(payload);
    const packed = await gzipText(payload);
    (self as unknown as Worker).postMessage({ id, checksum, packed });
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, error: (e as Error).message || 'error al comprimir' });
  }
};
