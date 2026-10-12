# Publicar y actualizar Ultimate Realistic Tycoon

Esta guía explica cómo llega una versión nueva al teléfono **sin perder la partida**, qué hace el CI y qué secretos necesita.

## 1. Resumen

Hay **dos variantes** del mismo juego (ver `src/distribution.ts`), elegidas al compilar con `VITE_DISTRIBUTION`:

- **`play`** (por defecto): la de Google Play. Se actualiza solo desde la tienda. Al compilarla, `vite.config.ts` reemplaza `src/persistence/ota.ts` por `ota.play.ts`, así que la descarga desde GitHub y el enlace a la APK **no están en el paquete**. `npm run build:play` lo comprueba (`scripts/verifyDistribution.mjs`) y el CI lo vuelve a comprobar dentro del AAB.
- **`github`**: la APK de GitHub Releases, con las actualizaciones firmadas por internet. `npm run build:github`.

| Qué | Variante | Dónde | Quién lo publica | Firma |
|---|---|---|---|---|
| AAB para Play Store (`ultimate-realistic-tycoon-play.aab`) | `play` | Artefacto del CI `play-<versión>` (se sube a mano a Play Console) | CI | Llave de subida (secretos `URT_KEYSTORE_*`) |
| APK de GitHub (`ultimate-realistic-tycoon.apk`) | `github` | Releases de GitHub `v<versión>` | CI, solo desde `main` | Llave propia de GitHub (secretos `URT_GITHUB_KEYSTORE_*`), distinta de la de Play |
| Actualización por internet (OTA) | `github` | Rama `ota-channel` | CI, solo desde `main` | ECDSA P-256 (secreto `URT_OTA_SIGNING_KEY`) |
| APK de prueba | `play` | No se publica | CI | Llave de depuración del runner |
| Puente para APK 1.2 | — | Carpeta `ota/` de `main` | A mano (`npm run ota:legacy`) | Sin firma (la 1.2 no verifica) |

`scripts/check-signing.sh` rechaza cualquier APK o AAB sin firmar, firmado con una llave de depuración o con un certificado de `android/compromised-signing-certs.txt`.

**Única fuente de la versión:** `package.json` → `version` (versionName, número de la OTA y de la Release), `nativeCode` (versionCode de Android) y `otaMinNativeCode` (APK mínima que puede recibir la OTA). `android/app/build.gradle` los lee de ahí.

## 2. Qué hace el CI (`.github/workflows/android.yml`)

En **cualquier rama y en pull requests** (permisos de solo lectura):

1. Valida el *Gradle wrapper* y que la versión tenga su entrada en `src/content/changelog.json`.
2. `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build:play` (con la comprobación de la variante), prueba e2e sobre esa compilación y `npx cap sync android`.
3. `./gradlew assembleDebug` → APK de prueba (no se distribuye).
4. Con los secretos de Play: `bundleRelease` firmado, verificación de la firma y de que el contenido web del AAB no trae actualizaciones propias → artefacto `play-<versión>`.
5. `npm run build:github` y `npx cap sync android`; con los secretos de GitHub: `assembleRelease` firmado y verificado → artefacto `github-<versión>` con `SHA256SUMS`.

Ningún paso crítico usa `continue-on-error`: si algo falla, el CI falla.

Solo en **push a `main`** (job `publicar`, único con permiso de escritura):

1. Si hay llave de GitHub, crea la Release `v<versión>` con la APK de GitHub y `SHA256SUMS`. **Si la Release ya existe no se reemplaza**: el CI avisa y hay que subir la versión en `package.json`. El AAB de Play **no** se publica en la Release.
2. Si existe `URT_OTA_SIGNING_KEY`: compila la página única de la variante `github` (`scripts/ota.mjs` falla si no lo es), firma el manifiesto, lo verifica con la clave pública embebida en la app y lo publica en la rama `ota-channel`. Si el canal ya tiene esa versión (o una mayor), no la reemplaza. **Sin la clave, no se publica nada por internet.**

Compilaciones reproducibles: `npm ci` con `package-lock.json`, Node y Java fijos, `SOURCE_DATE_EPOCH` y APK sin el bloque cifrado de dependencias.

## 3. Secretos de GitHub

**Settings → Secrets and variables → Actions → New repository secret**:

| Secreto | Contenido |
|---|---|
| `URT_KEYSTORE_BASE64` | El `.jks` de la llave de subida/publicación en base64 (`base64 -w0 urt-upload-key.jks`). |
| `URT_KEYSTORE_PASSWORD` | Contraseña del almacén. |
| `URT_KEY_ALIAS` | Alias de la clave (por ejemplo `urt-upload`). |
| `URT_KEY_PASSWORD` | Opcional: contraseña de la clave si es distinta. |
| `URT_GITHUB_KEYSTORE_BASE64` | El `.jks` de la llave **de GitHub** (otra llave, solo para la APK de Releases) en base64. |
| `URT_GITHUB_KEYSTORE_PASSWORD` | Contraseña de ese almacén. |
| `URT_GITHUB_KEY_ALIAS` | Alias de esa clave (por ejemplo `urt-github`). |
| `URT_GITHUB_KEY_PASSWORD` | Opcional: contraseña de la clave si es distinta. |
| `URT_OTA_SIGNING_KEY` | La clave privada ECDSA P-256 de las actualizaciones, en PEM (`-----BEGIN PRIVATE KEY-----…`). |

Crear la llave de GitHub (una sola vez, en tu computadora, fuera del repositorio):

```bash
keytool -genkeypair -v -keystore urt-github.jks -alias urt-github -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 urt-github.jks   # → secreto URT_GITHUB_KEYSTORE_BASE64
```

Las claves privadas **nunca** van al repositorio (`.gitignore` excluye `*.jks`, `*.pem`, `URT_KEYSTORE_BASE64.txt`, `LEEME_*`, `release-key/`, `ota-key/`). Guardalas también fuera de GitHub (gestor de contraseñas): si perdés la de OTA, hay que publicar una APK con una clave pública nueva.

### Crear o rotar la clave de las actualizaciones por internet

```bash
openssl ecparam -name prime256v1 -genkey -noout | openssl pkcs8 -topk8 -nocrypt -out urt-ota-signing-key.pem
openssl pkey -in urt-ota-signing-key.pem -pubout -outform DER | base64 -w0   # clave pública (SPKI)
```

1. Agregá la clave pública en `src/persistence/ota-keys.json` con un id nuevo (sin borrar la anterior).
2. Publicá esa versión (llega firmada con la clave vieja, que la app actual conoce).
3. Recién entonces cambiá el secreto `URT_OTA_SIGNING_KEY` por la clave nueva. Más adelante podés quitar la pública vieja.

## 4. Actualizaciones por internet (sin reinstalar)

La app lee `https://raw.githubusercontent.com/pbarahona12/gametc/ota-channel/manifest.json`. Es un **sobre firmado** (`format: urt-ota-signed`): el manifiesto va en base64 y la firma ECDSA P-256 (SHA-256) cubre ese texto exacto. El manifiesto incluye tamaño y huella SHA-256 del archivo, así que la firma protege también la página. La app verifica la firma con WebCrypto y la clave pública embebida; si no es válida, no ofrece nada.

Si hay una versión mayor y compatible con la APK (`minNativeCode`), al aceptar:

1. descarga la página (con tiempo máximo, detección de descargas detenidas y reintentos) y comprueba tamaño y huella;
2. la guarda en los archivos privados de la app;
3. guarda la partida y una copia "antes de actualizar";
4. abre la versión nueva **sin hacerla permanente**;
5. cuando la versión nueva carga la partida, lo anota de inmediato y, tras unos segundos sin errores, se confirma.

Si la versión nueva falla antes de confirmarse, vuelve sola a la anterior y no se ofrece de nuevo automáticamente. Si la app se cierra justo durante la confirmación (la versión ya había funcionado), al reabrirla **se retoma** la versión nueva en lugar de marcarla como fallida; tras 3 arranques sin confirmarse, se revierte.

Para publicar una actualización por internet: subí `version` en `package.json`, agregá sus novedades en `src/content/changelog.json` y hacé push a `main`. Si cambió algo nativo (Capacitor, plugins, permisos, ícono, nombre), subí también `nativeCode` y `otaMinNativeCode`: la APK de GitHub mostrará "necesita instalar la APK nueva" con el enlace a Releases (y los pasos para exportar e importar la partida). La versión de Play nunca muestra ese enlace: se actualiza desde la tienda.

### Puente para la 1.2

La 1.2 lee `ota/manifest.json` de `main` y no verifica firmas. La 1.3 usa Capacitor 8, que necesita la APK nueva, así que el puente (`npm run ota:legacy`) solo le avisa a la 1.2 que instale la APK de la Release; nunca le instala una página por internet. Se regenera una sola vez, al publicar la 1.3.

## 5. Firma de las APK y partidas existentes

Android solo instala una APK encima de otra si ambas tienen **la misma firma**; desinstalar borra la partida guardada en el teléfono.

- **Hasta la 1.4.0**, la APK de GitHub se firmaba con una llave fija incluida en el repositorio (`android/app/urt-debug.keystore`, contraseña `android`). Al ser pública, cualquiera podía firmar una APK con el mismo paquete que se instalara encima de la de un jugador y leyera su partida (auditoría D8).
- **Desde la fase 0** esa llave se retiró del repositorio y su certificado (SHA-256 `9355ac77…aec6`) figura en `android/compromised-signing-certs.txt`: el CI rechaza todo lo que esté firmado con ella. La APK de GitHub usa una llave nueva y propia (`URT_GITHUB_KEYSTORE_*`), distinta de la de Play. La llave vieja sigue en el historial de git: **no la reutilices nunca**.
- **Jugadores con la APK vieja:** siguen recibiendo las actualizaciones por internet (la página del juego, firmada con ECDSA) mientras no cambie nada nativo. La primera vez que haga falta una APK nueva, la app les indica: exportar la partida (Ajustes → Guardado y copias), desinstalar, instalar la APK nueva e importar la partida. Conviene avisarlo también en la descripción de la Release y marcar las Releases viejas como obsoletas.
- La versión de Play Store (firmada por Google con Play App Signing) y la APK de GitHub tienen firmas distintas: no se instalan una encima de la otra. Para pasar de una a otra, exportá la partida e importala.

## 6. Play Store

1. Configurá los secretos `URT_KEYSTORE_*` (sección 3).
2. En el próximo push, el artefacto `play-<versión>` de la ejecución del CI contiene `ultimate-realistic-tycoon-play.aab` firmado (variante `play`, sin actualizaciones propias). No se publica en la Release.
3. En Play Console activá **Play App Signing** y subí ese AAB. Requisitos actuales que cumple el proyecto: `targetSdkVersion 36`, `minSdkVersion 24`, AGP 8.13.0, Gradle 8.14.3, Java 21, solo el permiso `INTERNET`.

> La versión de Play Store (firmada por Google) y las APK instaladas a mano tienen firmas distintas: no se instalan una encima de la otra. Para pasar de una a otra, exportá la partida e importala.
