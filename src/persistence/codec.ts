/**
 * Codificación de las partidas: suma de verificación y gzip nativo (sin
 * dependencias). Sin estado ni dependencias del juego: lo usan save.ts en el hilo
 * principal y packWorker.ts en un hilo aparte.
 */

export function canCompress(): boolean {
  return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

export function bytesToB64(bytes: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return btoa(s);
}

export function b64ToBytes(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const src = new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(bytes);
      c.close();
    },
  });
  const out = new Response(src.pipeThrough(stream as unknown as ReadableWritablePair<Uint8Array, Uint8Array>));
  return new Uint8Array(await out.arrayBuffer());
}

export async function gzipText(text: string): Promise<string> {
  return bytesToB64(await pipe(new TextEncoder().encode(text), new CompressionStream('gzip')));
}

export async function gunzipText(b64: string): Promise<string> {
  return new TextDecoder().decode(await pipe(b64ToBytes(b64), new DecompressionStream('gzip')));
}


export function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0') + ':' + text.length.toString(36);
}
