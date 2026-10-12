/**
 * VARIANTE DE DISTRIBUCIÓN (se fija al compilar con VITE_DISTRIBUTION):
 *
 *  - `play` (por defecto): la que se sube a Google Play. Se actualiza SOLO por
 *    Google Play: no descarga ni ejecuta páginas nuevas desde servidores propios y
 *    no enlaza a APK de otras tiendas. Al compilarla, vite.config.ts reemplaza
 *    persistence/ota.ts por persistence/ota.play.ts, así ese código ni siquiera
 *    queda en el paquete (lo comprueba `npm run verify:play`).
 *  - `github`: la APK que se descarga de GitHub Releases. Mantiene las
 *    actualizaciones firmadas por internet (ota.ts) y el aviso de APK nueva.
 *
 * Que el valor por defecto sea `play` es deliberado: una compilación sin la
 * variable nunca puede llevar las actualizaciones propias a la tienda.
 */
export type Distribution = 'play' | 'github';

export const DISTRIBUTION: Distribution = import.meta.env.VITE_DISTRIBUTION === 'github' ? 'github' : 'play';

/** ¿Esta compilación se actualiza a sí misma por internet? (solo la APK de GitHub). */
export const SELF_UPDATES = DISTRIBUTION === 'github';
