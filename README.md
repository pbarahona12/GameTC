# Ultimate Realistic Tycoon

Simulador móvil de finanzas personales, carrera, empresas, inversiones, bienes raíces, impuestos internacionales, grupos empresariales y un sistema legal ficticio. Cada movimiento de dinero pasa por un **libro mayor de partida doble**: nada aparece ni desaparece sin un asiento contable que lo explique.

**Estado:** versión 1.4 con la **fase 0 de la auditoría** (variante para Google Play sin actualizaciones propias ni enlaces a APK, progreso sin conexión que no deja vencer decisiones, anuncios que nunca dan dinero, llave de firma de GitHub nueva y registro local de errores). La 1.3 (robustez), sobre la 1.2 (tiendas, personaje e imagen, tarjetas por niveles, noticias calibradas, rivales, misiones, actualizaciones dentro de la app) suma una **red de seguridad del simulador** (un día que falla vuelve atrás y se pausa), **hasta 3 partidas** con copias por tiempo real, **montos sin ambigüedad**, correcciones del motor, **Android 16** (Capacitor 8), **actualizaciones firmadas**, CI/CD endurecido, rediseño de la barra superior, la primera partida y la navegación, **accesibilidad** (contraste AA, zoom) y una **prueba de punta a punta**. Ver [`docs/ESTADO.md`](docs/ESTADO.md) y [`src/content/changelog.json`](src/content/changelog.json).

## Requisitos

- Node.js 20 o superior (probado con 22) y npm.
- Para Android: JDK 21 y Android SDK (Android Studio o las herramientas de línea de comandos), **o** GitHub Actions (ver abajo).

## Ejecutar en el navegador

```bash
npm install
npm run dev          # servidor de desarrollo en http://localhost:5173
```

Abrilo con las herramientas de desarrollo en modo móvil (≈ 390 × 844) para la experiencia prevista.

## Pruebas

```bash
npm test             # 289 pruebas en 32 archivos (Vitest): contabilidad, impuestos, crédito, simulación,
                     # red de seguridad, guardado/copias/ranuras, dinero, formularios, empresas, inversiones,
                     # inmuebles, legal, auditorías con bots aleatorios, OTA firmada, UX y accesibilidad
npm run typecheck    # TypeScript estricto
npm run lint         # ESLint (react-hooks); falla con cualquier error o advertencia
npm run build && npm run e2e   # recorrido completo con Playwright sobre la versión compilada
npm run chaos        # prueba de caos: 50 semillas × 20 años (semanal en el CI)
URT_BOTS=1 npx vitest run tests/balance.test.ts   # bots de balance completos → docs/BALANCE.md
```

La prueba e2e usa Chromium de Playwright (`npx playwright install chromium`); si ya hay uno instalado, `PW_CHROMIUM_PATH=/ruta/a/chrome npm run e2e`.

## Compilar

```bash
npm run build          # versión web en dist/ (la que usa Android)
npm run build:single   # un único index.html autocontenido en dist-single/ (vista previa portable)
```

## Generar la APK de Android

> La APK se compila en GitHub Actions. No se probó en un teléfono físico desde el entorno de desarrollo. Proyecto Capacitor 8 (`webDir: dist`, plugins app, filesystem, preferences, share), minSdk 24, target/compile 36, AGP 8.13, Gradle 8.14, Java 21; la versión sale solo de `package.json` (`version`, `nativeCode`). Ícono y pantalla de inicio propios (`npm run icons`). Dos variantes del mismo juego: **Play** (`npm run build:play`, sin actualizaciones propias) y **GitHub** (`npm run build:github`, con actualizaciones firmadas por internet). La llave fija que estuvo en el repositorio hasta la 1.4.0 era pública y se retiró: ya no firma nada que se distribuya. Guía completa: [`docs/PUBLICAR.md`](docs/PUBLICAR.md).

### Opción A — sin instalar nada (GitHub Actions, recomendada)

1. Cada push (cualquier rama) corre tipos, lint, pruebas, e2e y compila la APK; solo un push a `main` publica la Release (workflow **Android y publicación**).
2. Descargala desde **Releases** (`https://github.com/pbarahona12/gametc/releases/latest`, directo desde el teléfono) o desde los artefactos de la ejecución.
3. La APK de Releases se firma con la llave propia de GitHub (secretos `URT_GITHUB_KEYSTORE_*`). Las instalaciones firmadas con la llave pública anterior (hasta la 1.4.0) no la aceptan encima: exportá la partida, desinstalá, instalá la nueva e importá la partida (una sola vez).
4. Con los secretos `URT_KEYSTORE_*`, el mismo flujo genera el **AAB firmado para Play Store** como artefacto del CI (ver `docs/PUBLICAR.md`).

### Opción B — en tu computadora

1. Instalá Android Studio (incluye el SDK) y JDK 21.
2. En la carpeta del proyecto:
   ```bash
   npm install
   npm run build:play          # o build:github para la variante con actualizaciones por internet
   npx cap sync android
   cd android && ./gradlew assembleDebug        # en Windows: gradlew.bat assembleDebug
   ```
   Resultado: `android/app/build/outputs/apk/debug/app-debug.apk`, firmada con la llave de depuración de tu computadora: sirve para probar, **no para distribuir**.
3. Instalación: abrí la APK en el teléfono (habilitá "instalar apps desconocidas") o `adb install -r app-debug.apk`.

### Actualizaciones sin reinstalar

Solo la APK de GitHub (variante `github`): busca versiones nuevas del juego y las instala en segundos. La versión de Google Play se actualiza únicamente desde la tienda. Cada actualización llega **firmada** (ECDSA P-256): la app verifica la firma con la clave pública incluida, además del tamaño y el SHA-256, y vuelve atrás sola si la versión nueva no carga la partida. Las publica solo el CI desde `main`, con la clave privada guardada como secreto (nunca en el repositorio). Ver [`docs/PUBLICAR.md`](docs/PUBLICAR.md).

### Problemas frecuentes

- `SDK location not found`: creá `android/local.properties` con `sdk.dir=/ruta/a/Android/Sdk` (Windows: `sdk.dir=C\:\Users\VOS\AppData\Local\Android\Sdk`).
- `Unsupported class file major version`: usá JDK 21 (`java -version`).
- Cambios en el código que no aparecen en la APK: repetí `npm run build && npx cap sync android` antes de compilar.
- "La app no está instalada" al actualizar: la APK anterior tenía otra firma (1.1 o anterior). Exportá la partida, desinstalá, instalá la nueva e importala.

## Estructura

```
src/
  engine/            Motor económico puro (sin React, determinista, 100 % testeable)
    ledger/          Plan de cuentas, libro mayor de partida doble y compactación mensual
    time/            Calendario del juego
    finance/         Banca, tarjeta, préstamos, presupuesto, pagos, puntaje crediticio
    career/          Empleo, postulaciones, nómina, desempeño, evaluaciones
    tax/             Impuesto progresivo, retenciones, declaración anual
    skills/          Habilidades (XP) y formación
    reports/         Estados financieros e indicadores
    economy/         Ciclo económico, inflación, tasas, eventos y dificultad
    invest/          Bolsa, órdenes, indicadores, bonos, fondos, Mogul Exchange y cartera común
    realestate/      Zonas, inmuebles, alquileres, hipotecas, obras e informes
    pros/            Profesionales contratables, auditorías y proyecciones
    legal/           Sistema legal y actividades ilegales ficticias
    snapshot.ts      Deshacer liviano de acciones
    business/        Empresas: libro propio, mercado, inventario, personal, marketing,
                     operaciones, finanzas, propiedad, gerente, informes y asesor empresarial
    advisor/         Asesor basado en reglas, escenarios y proyección de negocios
    lifestyle/       Tiendas, posesiones, imagen personal y sus efectos (1.2)
    world/           Noticias calibradas, rivales, exclusividades y ofertas por empleados (1.2)
    progression/     Etapas, logros, misiones por capítulos y secciones recomendadas
    simulation.ts    Orquestador diario
    invariants.ts    Auditoría contable
  content/           Datos del juego: empleos, cursos, sectores, glosario, estilos de vida, bancos
  persistence/       Guardado con checksum, copias, migraciones, progreso offline,
                     almacenamiento nativo espejado, exportación a archivo y actualizaciones (ota.ts)
  ui/                Interfaz React (pantallas, hojas, componentes, tema)
tests/               Pruebas unitarias e integradas (Vitest) y bots de balance (tests/bots)
e2e/                 Recorrido de punta a punta (Playwright)
docs/                Documentación técnica, económica, balance y publicación
ota/                 Actualización por internet publicada (manifiesto + página)
scripts/             Íconos y firma/verificación de actualizaciones (ota.mjs)
android/             Proyecto nativo generado por Capacitor
```

## Dónde se guarda la partida

- **Android (APK):** en archivos privados de la app. La copia de seguridad automática de Android incluye solo las partidas (no las actualizaciones descargadas).
- **Navegador:** `localStorage`.
- **Hasta 3 partidas**, cada una con guardado automático (cada 90 s, al pausar, al salir y tras cada decisión, nunca dos a la vez) y copias por tiempo real: ≤ 10 minutos, 10–70 minutos y de 1 hora a 1 día. Restaurar guarda antes la partida actual en «Antes de restaurar»; importar abre la partida en otra ranura.
- **Actualizaciones:** la partida vive fuera de la página del juego; antes de cambiar de versión se guarda una copia «antes de actualizar».
- *Ajustes → Guardado y copias → Exportar a archivo* (en Android abre Compartir: Archivos, Drive, correo…). El juego recuerda exportar si pasó un mes sin hacerlo.

## Documentación

- [`docs/ARQUITECTURA.md`](docs/ARQUITECTURA.md) — decisiones técnicas, capas y flujo de datos.
- [`docs/REGLAS_ECONOMICAS.md`](docs/REGLAS_ECONOMICAS.md) — todas las fórmulas y reglas de negocio.
- [`docs/ESTADO.md`](docs/ESTADO.md) — funcionalidades implementadas, resultados de pruebas, limitaciones y guía para continuar.
- [`docs/DISENO_FASES_3_5.md`](docs/DISENO_FASES_3_5.md) — decisiones de diseño de las Fases 3 a 5.
- [`docs/BALANCE.md`](docs/BALANCE.md) — cuánto tarda cada estilo de juego en llegar a cada etapa (bots) y los ajustes hechos.
- [`docs/PUBLICAR.md`](docs/PUBLICAR.md) — firma, APK, AAB para Play Store y actualizaciones por internet.

## Modelo de negocio

Juego completo sin pagos y sin cuenta externa. En Android hay anuncios recompensados opcionales (Google AdMob, solo si tocás «Ver anuncio») que dan información o tiempo de estudio: nunca dinero ni perdón de deudas, y nunca durante un desafío. Funciona sin conexión.
