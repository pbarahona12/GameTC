import type { KV } from './save';
import { MemoryKV, KEYS } from './save';

/**
 * Almacenamiento según la plataforma.
 *
 * Android/iOS (Capacitor): la partida se guarda en DOS almacenes nativos
 * independientes del navegador:
 *   1. @capacitor/preferences (SharedPreferences en Android).
 *   2. Archivos JSON en el directorio privado de la app (@capacitor/filesystem).
 * Si uno falla o está vacío, se lee del otro.
 *
 * Navegador: localStorage (protegido con try/catch) + exportación a archivo.
 * Sin almacenamiento disponible: memoria (se avisa al jugador que exporte).
 */
class LocalStorageKV implements KV {
  async get(k: string) {
    return localStorage.getItem(k);
  }
  async set(k: string, v: string) {
    localStorage.setItem(k, v);
  }
  async remove(k: string) {
    localStorage.removeItem(k);
  }
}

type Prefs = {
  get(o: { key: string }): Promise<{ value: string | null }>;
  set(o: { key: string; value: string }): Promise<void>;
  remove(o: { key: string }): Promise<void>;
};

class PreferencesKV implements KV {
  constructor(private prefs: Prefs) {}
  async get(key: string) {
    return (await this.prefs.get({ key })).value;
  }
  async set(key: string, value: string) {
    await this.prefs.set({ key, value });
  }
  async remove(key: string) {
    await this.prefs.remove({ key });
  }
}

class FilesystemKV implements KV {
  constructor(private fs: typeof import('@capacitor/filesystem')) {}
  private path(key: string) {
    return `saves/${key}.json`;
  }
  async get(key: string) {
    try {
      const r = await this.fs.Filesystem.readFile({ path: this.path(key), directory: this.fs.Directory.Data, encoding: this.fs.Encoding.UTF8 });
      return typeof r.data === 'string' ? r.data : null;
    } catch {
      return null;
    }
  }
  async set(key: string, value: string) {
    await this.fs.Filesystem.writeFile({ path: this.path(key), data: value, directory: this.fs.Directory.Data, encoding: this.fs.Encoding.UTF8, recursive: true });
  }
  async remove(key: string) {
    try {
      await this.fs.Filesystem.deleteFile({ path: this.path(key), directory: this.fs.Directory.Data });
    } catch {
      /* no existía */
    }
  }
}

/** Escribe en ambos almacenes; lee del primero que tenga datos. */
export class MirroredKV implements KV {
  constructor(private a: KV, private b: KV) {}
  async get(key: string) {
    let v: string | null;
    try {
      v = await this.a.get(key);
    } catch {
      v = null;
    }
    if (v) return v;
    try {
      return await this.b.get(key);
    } catch {
      return null;
    }
  }
  async set(key: string, value: string) {
    let ok = 0;
    for (const kv of [this.a, this.b]) {
      try {
        await kv.set(key, value);
        ok++;
      } catch {
        /* se intenta el otro */
      }
    }
    if (!ok) throw new Error('No se pudo escribir en ningún almacenamiento.');
  }
  async remove(key: string) {
    for (const kv of [this.a, this.b]) {
      try {
        await kv.remove(key);
      } catch {
        /* ignorar */
      }
    }
  }
}

/**
 * Almacenamiento nativo (Android) desde la versión 1.1: TODAS las partidas y
 * copias van a archivos privados de la app; en las preferencias del sistema
 * (SharedPreferences, que Android carga enteras en memoria al abrir la app) se
 * guarda solo una segunda copia de la partida PRINCIPAL. Así el arranque no se
 * vuelve lento en partidas largas y sigue habiendo dos copias independientes.
 * Lee de archivos primero y, si falta, de las preferencias (compatible con
 * instalaciones anteriores que guardaban todo en preferencias).
 */
export class NativeKV implements KV {
  constructor(private files: KV, private prefs: KV, private mirrorKeys: string[]) {}
  async get(key: string) {
    try {
      const v = await this.files.get(key);
      if (v) return v;
    } catch {
      /* se intenta el otro */
    }
    try {
      return await this.prefs.get(key);
    } catch {
      return null;
    }
  }
  async set(key: string, value: string) {
    let ok = 0;
    let lastErr: unknown = null;
    try {
      await this.files.set(key, value);
      ok++;
    } catch (e) {
      lastErr = e;
    }
    if (this.mirrorKeys.includes(key)) {
      try {
        await this.prefs.set(key, value);
        ok++;
      } catch (e) {
        lastErr = e;
      }
    } else {
      // Limpia copias viejas que versiones anteriores dejaban en las preferencias.
      try {
        await this.prefs.remove(key);
      } catch {
        /* ignorar */
      }
    }
    if (!ok) throw lastErr instanceof Error ? lastErr : new Error('No se pudo escribir en ningún almacenamiento.');
  }
  async remove(key: string) {
    for (const kv of [this.files, this.prefs]) {
      try {
        await kv.remove(key);
      } catch {
        /* ignorar */
      }
    }
  }
}

export interface StorageInfo {
  kv: KV;
  kind: 'native' | 'local' | 'memory';
}

export async function isNative(): Promise<boolean> {
  try {
    const { Capacitor } = await import('@capacitor/core');
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export async function createStorage(): Promise<StorageInfo> {
  if (await isNative()) {
    const { Preferences } = await import('@capacitor/preferences');
    const fs = await import('@capacitor/filesystem');
    return { kv: new NativeKV(new FilesystemKV(fs), new PreferencesKV(Preferences), [KEYS.primary]), kind: 'native' };
  }
  try {
    const probe = '__urt_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return { kv: new LocalStorageKV(), kind: 'local' };
  } catch {
    return { kv: new MemoryKV(), kind: 'memory' };
  }
}

/**
 * Exporta la partida a un archivo .json.
 * Android: se escribe en la caché de la app y se abre el menú "Compartir"
 * (Guardar en Archivos, Drive, correo…). Navegador: descarga directa.
 */
export async function exportToFile(text: string, filename: string): Promise<{ ok: boolean; message: string }> {
  if (await isNative()) {
    try {
      const fs = await import('@capacitor/filesystem');
      const { Share } = await import('@capacitor/share');
      const w = await fs.Filesystem.writeFile({ path: filename, data: text, directory: fs.Directory.Cache, encoding: fs.Encoding.UTF8 });
      await Share.share({ title: 'Partida de Ultimate Realistic Tycoon', url: w.uri, dialogTitle: 'Guardar copia de la partida' });
      return { ok: true, message: 'Elegí dónde guardar el archivo.' };
    } catch (e) {
      return { ok: false, message: `No se pudo exportar: ${(e as Error).message}` };
    }
  }
  try {
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return { ok: true, message: 'Descarga iniciada. Si tu navegador la bloquea, usá "Copiar texto".' };
  } catch (e) {
    return { ok: false, message: `No se pudo descargar: ${(e as Error).message}` };
  }
}

/**
 * Comparte una imagen PNG (1.4: la crónica como imagen). En Android se guarda en la
 * caché privada (la única carpeta que expone el FileProvider) y se abre el menú
 * de compartir; en el navegador se descarga.
 */
export async function exportImage(dataUrl: string, filename: string, title: string): Promise<{ ok: boolean; message: string }> {
  const base64 = dataUrl.split(',')[1] ?? '';
  if (await isNative()) {
    try {
      const fs = await import('@capacitor/filesystem');
      const { Share } = await import('@capacitor/share');
      const w = await fs.Filesystem.writeFile({ path: filename, data: base64, directory: fs.Directory.Cache });
      await Share.share({ title, url: w.uri, dialogTitle: title });
      return { ok: true, message: 'Elegí dónde compartir la imagen.' };
    } catch (e) {
      return { ok: false, message: `No se pudo compartir: ${(e as Error).message}` };
    }
  }
  try {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    return { ok: true, message: 'Imagen descargada.' };
  } catch (e) {
    return { ok: false, message: `No se pudo descargar: ${(e as Error).message}` };
  }
}
