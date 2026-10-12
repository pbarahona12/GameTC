// Comprueba qué variante de distribución quedó en una carpeta compilada.
//
//   node scripts/verifyDistribution.mjs play [carpeta=dist]
//     Falla si el paquete contiene las actualizaciones propias por internet o el
//     enlace para instalar una APK por fuera de Google Play (política de abuso de
//     dispositivo y red). Es el criterio de la fase 0 de la auditoría.
//
//   node scripts/verifyDistribution.mjs github [carpeta=dist]
//     Falla si el paquete NO las contiene (la APK de GitHub y su actualización por
//     internet tienen que seguir pudiendo actualizarse).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Rastros inequívocos de persistence/ota.ts y del enlace a Releases. */
export const OTA_MARKERS = ['raw.githubusercontent.com', 'ota-channel', 'releases/latest', 'urt-ota-signed', 'setServerBasePath', 'persistServerBasePath'];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

export function scan(dir) {
  const hits = [];
  for (const f of files(dir)) {
    if (!/\.(js|mjs|html|json|css|txt|map)$/.test(f)) continue;
    const text = readFileSync(f, 'utf8');
    for (const m of OTA_MARKERS) if (text.includes(m)) hits.push(`${relative(dir, f)}: «${m}»`);
  }
  return hits;
}

const [variant, dir = 'dist'] = process.argv.slice(2);
if (variant !== 'play' && variant !== 'github') {
  console.error('uso: node scripts/verifyDistribution.mjs play|github [carpeta]');
  process.exit(2);
}
let hits;
try {
  hits = scan(dir);
} catch (e) {
  console.error(`verify: no se pudo leer ${dir} (${e.message}). Compilá primero.`);
  process.exit(2);
}
if (variant === 'play' && hits.length) {
  console.error(`verify: la variante de Play contiene actualizaciones propias o enlaces a APK:\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
if (variant === 'github' && !hits.length) {
  console.error('verify: la variante de GitHub no contiene las actualizaciones por internet (¿se compiló sin VITE_DISTRIBUTION=github?).');
  process.exit(1);
}
console.log(variant === 'play' ? `verify: ${dir} es apta para Play (sin actualizaciones propias ni enlaces a APK).` : `verify: ${dir} incluye las actualizaciones por internet (${hits.length} rastros).`);
