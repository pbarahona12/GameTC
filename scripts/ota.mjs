// Actualizaciones por internet (OTA).
//
//   node scripts/ota.mjs sign --out <carpeta>     (lo usa el CI en main)
//     Compila la página única, la copia como urt-<build>.html y escribe manifest.json
//     FIRMADO (ECDSA P-256) con la clave privada del secreto URT_OTA_SIGNING_KEY
//     (PEM PKCS#8). Después verifica la firma con la clave pública embebida en la app.
//     Sin la clave privada falla: nunca se publica algo sin firmar.
//
//   node scripts/ota.mjs verify <carpeta>
//     Verifica una carpeta publicada: firma, versión, tamaño y huella del archivo.
//
//   node scripts/ota.mjs legacy
//     Escribe el puente para las versiones 1.2 y anteriores (ota/ en main, sin firma:
//     esas versiones no saben verificar). Con otaMinNativeCode mayor que su APK, solo
//     les avisa que instalen la APK nueva; nunca se les instala una página por internet.
//
// La clave privada NUNCA se guarda en el repositorio (ver docs/PUBLICAR.md).
import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync, existsSync } from 'node:fs';
import { createHash, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { execSync } from 'node:child_process';
import { join } from 'node:path';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const changelog = JSON.parse(readFileSync('src/content/changelog.json', 'utf8'));
const KEYS = JSON.parse(readFileSync('src/persistence/ota-keys.json', 'utf8')).keys;
const [a, b, c] = pkg.version.split(/[.-]/).map((x) => parseInt(x, 10) || 0);
const build = a * 10000 + b * 100 + c;
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

function fail(msg) {
  console.error(`ota: ${msg}`);
  process.exit(1);
}

function compile() {
  // La actualización por internet es para la APK de GitHub: tiene que seguir siendo
  // la variante `github` (si no, la versión nueva perdería las actualizaciones).
  if (!process.argv.includes('--no-build')) execSync('npm run build:single', { stdio: 'inherit', env: { ...process.env, VITE_DISTRIBUTION: 'github' } });
  const html = readFileSync('dist-single/index.html');
  if (!html.toString('utf8').includes('ota-channel')) fail('dist-single/index.html no es la variante github (compilar con VITE_DISTRIBUTION=github)');
  if (!html.includes('<div id="root">')) fail('dist-single/index.html no parece el juego');
  if (!html.toString('utf8').includes(`"${pkg.version}"`)) fail('la página compilada no contiene la versión de package.json');
  return html;
}

function manifestFor(file, html) {
  const entry = changelog.find((e) => e.version === pkg.version);
  if (!entry) fail(`falta la entrada ${pkg.version} en src/content/changelog.json`);
  return {
    format: 'urt-ota',
    version: pkg.version,
    build,
    minNativeCode: pkg.otaMinNativeCode ?? 0,
    file,
    sha256: sha256(html),
    size: html.length,
    date: entry.date,
    notes: entry.items,
  };
}

function keyIdFor(publicKey) {
  const spki = publicKey.export({ type: 'spki', format: 'der' }).toString('base64');
  const id = Object.keys(KEYS).find((k) => KEYS[k] === spki);
  if (!id) fail('la clave privada no corresponde a ninguna clave pública embebida en la app (src/persistence/ota-keys.json)');
  return id;
}

function verifyDir(dir) {
  const env = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
  if (env.format !== 'urt-ota-signed') fail('el manifiesto no está firmado');
  const spki = KEYS[env.keyId];
  if (!spki) fail(`clave desconocida: ${env.keyId}`);
  const pub = createPublicKey({ key: Buffer.from(spki, 'base64'), format: 'der', type: 'spki' });
  const payload = Buffer.from(env.payload, 'base64');
  const ok = verify('sha256', payload, { key: pub, dsaEncoding: 'ieee-p1363' }, Buffer.from(env.signature, 'base64'));
  if (!ok) fail('firma inválida');
  const man = JSON.parse(payload.toString('utf8'));
  const html = readFileSync(join(dir, man.file));
  if (html.length !== man.size || sha256(html) !== man.sha256) fail('el archivo no coincide con el manifiesto');
  console.log(`OTA verificada: ${man.version} (build ${man.build}) · ${man.file} · clave ${env.keyId}`);
  return man;
}

const mode = process.argv[2];
if (mode === 'sign') {
  const outIdx = process.argv.indexOf('--out');
  const out = outIdx > 0 ? process.argv[outIdx + 1] : null;
  if (!out) fail('indicá la carpeta de salida con --out');
  const pem = process.env.URT_OTA_SIGNING_KEY;
  if (!pem) fail('falta la clave privada (variable URT_OTA_SIGNING_KEY); no se publica nada sin firmar');
  const privateKey = createPrivateKey(pem);
  const keyId = keyIdFor(createPublicKey(privateKey));
  const html = compile();
  mkdirSync(out, { recursive: true });
  const file = `urt-${build}.html`;
  writeFileSync(join(out, file), html);
  const payload = Buffer.from(JSON.stringify(manifestFor(file, html)), 'utf8');
  const signature = sign('sha256', payload, { key: privateKey, dsaEncoding: 'ieee-p1363' });
  writeFileSync(join(out, 'manifest.json'), JSON.stringify({ format: 'urt-ota-signed', keyId, payload: payload.toString('base64'), signature: signature.toString('base64') }, null, 2) + '\n');
  verifyDir(out);
} else if (mode === 'verify') {
  const dir = process.argv[3];
  if (!dir || !existsSync(join(dir, 'manifest.json'))) fail('indicá una carpeta con manifest.json');
  verifyDir(dir);
} else if (mode === 'legacy') {
  if (!(pkg.otaMinNativeCode > 5)) fail('el puente para 1.2 solo tiene sentido si otaMinNativeCode exige una APK nueva (> 5)');
  const html = compile();
  mkdirSync('ota', { recursive: true });
  for (const f of readdirSync('ota')) if (/^web-\d+\.html$/.test(f)) unlinkSync(`ota/${f}`);
  const file = `web-${build}.html`;
  writeFileSync(`ota/${file}`, html);
  writeFileSync('ota/manifest.json', JSON.stringify(manifestFor(file, html), null, 2) + '\n');
  console.log(`Puente OTA para 1.2: ${pkg.version} exige la APK ${pkg.otaMinNativeCode}.`);
} else {
  fail('uso: node scripts/ota.mjs sign --out <carpeta> | verify <carpeta> | legacy');
}
