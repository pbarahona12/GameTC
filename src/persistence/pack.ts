import { fnv1a, gzipText } from './codec';
// Hilo incrustado en la página (blob): funciona igual en la app, en la web y en la
// página única de las actualizaciones por internet, que no lleva archivos aparte.
import PackWorker from './packWorker?worker&inline';

/**
 * Suma de verificación y compresión de una partida para guardarla.
 *
 * En partidas largas comprimir lleva cientos de milisegundos (en un teléfono
 * modesto, segundos): hecho en el hilo principal congela la pantalla. Si hay
 * Web Workers, se hace en un hilo aparte; si no (pruebas, navegadores viejos) o
 * si el hilo falla, se hace acá con el mismo código (codec.ts), así el resultado
 * es idéntico en los dos casos.
 */
export interface Packed {
  checksum: string;
  packed: string;
}

type Pending = { resolve: (p: Packed) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let broken = false;
let nextId = 1;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (broken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new PackWorker();
    worker.onmessage = (ev: MessageEvent<{ id: number; checksum?: string; packed?: string; error?: string }>) => {
      const p = pending.get(ev.data.id);
      if (!p) return;
      pending.delete(ev.data.id);
      if (ev.data.error || ev.data.packed === undefined || ev.data.checksum === undefined) p.reject(new Error(ev.data.error ?? 'respuesta vacía'));
      else p.resolve({ checksum: ev.data.checksum, packed: ev.data.packed });
    };
    worker.onerror = () => fail();
    return worker;
  } catch {
    broken = true;
    return null;
  }
}

/** El hilo no sirve: se rechazan los pedidos en curso (se rehacen acá) y no se vuelve a usar. */
function fail() {
  broken = true;
  worker?.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(new Error('el hilo de guardado falló'));
  pending.clear();
}

async function packHere(payload: string): Promise<Packed> {
  return { checksum: fnv1a(payload), packed: await gzipText(payload) };
}

export async function packPayload(payload: string): Promise<Packed> {
  const w = getWorker();
  if (!w) return packHere(payload);
  try {
    return await new Promise<Packed>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      w.postMessage({ id, payload });
    });
  } catch {
    return packHere(payload);
  }
}
