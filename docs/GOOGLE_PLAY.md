# Publicar en Google Play: requisitos y respuestas

Revisado el 2026-10-02 contra la documentación de Google Play. Esto **no es asesoramiento legal**: las políticas cambian y conviene confirmarlas en Play Console al publicar.

## Estado del juego frente a los requisitos

| Requisito | Estado |
|---|---|
| Nivel de API objetivo (apps nuevas: API 36 desde el 31-08-2026) | Cumple: target/compile 36 |
| Formato AAB firmado | Cumple: el CI genera `ultimate-realistic-tycoon-play.aab` |
| Política de privacidad pública (URL) y dentro de la app | Texto listo (`src/content/legal.ts`), visible en la app (Más → Privacidad y términos). La página pública se genera con `npm run legal` cuando estén el nombre y el correo de contacto, y se publica con GitHub Pages |
| Formulario de Seguridad de los datos | Respuestas abajo |
| Cuestionario de clasificación (IARC) | Guía abajo |
| Cuentas personales nuevas: prueba cerrada con **12 testers durante 14 días seguidos** antes de producción | Pendiente (se hace en Play Console) |
| Público objetivo | 13+ (no apto para el programa de Familias) |
| Permisos | Internet; el SDK de AdMob agrega el del ID de publicidad (`AD_ID`) |
| Anuncios | Solo recompensados, opcionales, con consentimiento UMP en EEE/Reino Unido/Suiza; anuncios de prueba fuera de `main` |

## Seguridad de los datos (Data safety)

La app tiene **anuncios recompensados opcionales de Google AdMob** (solo si el jugador toca «Ver anuncio»). Respuestas, según la guía de AdMob para el formulario:

- En «Configuración de la app → Anuncios»: **Sí, contiene anuncios.**
- ¿Recopila o comparte datos? **Sí** (lo hace el SDK de Google Mobile Ads).
- Datos y fines (recopilados **y** compartidos con Google; no se venden):
  - **ID del dispositivo u otros IDs** (ID de publicidad): publicidad o marketing, análisis, prevención de fraude.
  - **Ubicación aproximada** (derivada de la IP): publicidad o marketing, análisis, prevención de fraude.
  - **Actividad en la app → interacciones con la app**: publicidad o marketing, análisis.
  - **Información y rendimiento de la app → registros de fallos y diagnósticos**: análisis, prevención de fraude.
- Datos cifrados en tránsito: **sí**. Se pueden solicitar borrados: el desarrollador no guarda datos; los del SDK los gestiona Google (enlazar su política).
- Partidas: quedan en el dispositivo, no se recopilan.
- La app no tiene cuentas (no aplica el borrado de cuenta).

Revisar la guía vigente de Google antes de enviar: <https://support.google.com/admob/answer/11994880>.

## Clasificación de contenido (IARC)

Responder con la verdad (una respuesta falsa puede hacer que retiren la app):

- Violencia, sexo, lenguaje vulgar, drogas: no.
- Referencias a actividades delictivas: **sí, ficticias y opcionales** (sobornos, evasión, lavado, contrabando, una casa de apuestas clandestina como negocio). Están desactivadas al empezar y tienen castigos.
- Apuestas simuladas (que el jugador apueste): **no**. Hay una bolsa de valores ficticia sin dinero real.
- Anuncios: **sí** (recompensados y opcionales). Compras dentro de la app: no.
- Se espera una clasificación para adolescentes (p. ej. PEGI 12–16 / ESRB Teen); la decide el cuestionario.

## Monetización: lo que hay que saber

1. **El Salvador no admite cuentas de comerciante en Google Play.** Un desarrollador con dirección en El Salvador puede publicar apps **gratuitas**, pero **no puede vender la app ni compras dentro de la app**. Para cobrar haría falta una cuenta de desarrollador a nombre de una persona o empresa con dirección, banco y datos fiscales en un país admitido (Guatemala, Honduras, Costa Rica, Panamá, México, Estados Unidos, entre otros). Unos términos y condiciones no resuelven esto.
2. **Compras dentro de la app:** para bienes digitales (quitar anuncios, desbloqueos, moneda del juego) es obligatorio Google Play Billing; no se puede cobrar por fuera.
3. **Anuncios (AdMob):** es un servicio aparte de la cuenta de comerciante; confirmar en AdMob que acepta pagos a El Salvador (transferencia). Requiere política de privacidad actualizada, consentimiento UMP, Data safety actualizado, permiso `AD_ID`, y respetar la política de anuncios de Play (nada de anuncios a pantalla completa inesperados ni que tapen controles; los recompensados, siempre opcionales).
4. **Impuestos:** los ingresos por ventas o anuncios pueden tributar en El Salvador; consultarlo con un contador.

## Ficha de la tienda

Identidad: **cada número es verdad, cada decisión deja una historia.** La ficha vende eso (contabilidad de verdad + la historia de un magnate), no "hacete rico rápido".

- **Nombre (≤ 30):** Ultimate Realistic Tycoon
- **Categoría:** Juegos → Simulación. Etiquetas sugeridas: magnate, negocios, economía, un jugador, sin conexión.
- **Descripción corta (≤ 80, tiene 79):**
  > De tu primer sueldo a un imperio. Cada número es real; cada decisión, historia.

### Descripción completa (≤ 4.000 caracteres)

```
Empezás con un sueldo, un alquiler y una tarjeta. Cada decisión que tomes queda escrita en tus libros y en tu historia.

Ultimate Realistic Tycoon es un simulador de magnate donde los números no mienten: cada peso entra y sale por un libro de partida doble, como en una empresa de verdad. Tu patrimonio, tus impuestos y los resultados de tus empresas siempre cuadran, y podés tocar cualquier número para ver de dónde salió.

DE TU PRIMER SUELDO A UN IMPERIO
• Buscá empleo, negociá el sueldo, estudiá y ascendé.
• Armá un fondo de emergencia, pagá la tarjeta a tiempo y cuidá tu puntaje de crédito.
• Invertí en una bolsa con 20 empresas ficticias, bonos, fondos e inmuebles con hipotecas.
• Fundá empresas en 5 sectores: precios, personal, proveedores, marketing, préstamos y gerentes.
• Crecé con holdings, bonos corporativos, fusiones, salida a bolsa y compra de grupos rivales.

CADA DECISIÓN DEJA UNA HISTORIA
• Más de 30 decisiones con plazo: una huelga, una auditoría fiscal, un socio con capital, un ciberataque.
• Rivales con memoria: si les ganás, te guardan rencor; algunos se vuelven tu némesis y te declaran una guerra de precios.
• Listas de fortunas de cuatro ciudades y del mundo: mirá a quién pasás y quién te pisa los talones.
• Tu crónica guarda los momentos que importan, con un resumen de cada año.
• Tu personaje envejece: pareja, hijos, jubilación, herencia y fundación. Si activás el fallecimiento, tu heredero sigue la partida.

APRENDÉ JUGANDO
• Glosario con más de 280 conceptos explicados con ejemplos.
• Un asesor que lee tus números y te dice qué conviene revisar.
• Estados de resultados, balance y flujo de caja reales, personales y de cada empresa.
• Desafíos con semilla para comparar resultados con amigos o en clase.

PENSADO PARA EL TELÉFONO
• Funciona sin conexión. Tu partida queda en tu dispositivo.
• El tiempo corre aunque cierres la app (y te cuenta qué pasó mientras no estabas).
• Tema claro y oscuro, texto grande, alto contraste y modo para daltonismo.
• Modo tranquilo para empezar sin castigos duros.

IMPORTANTE
Todo es ficticio: empresas, personas, países y mercados. No hay dinero real, no se puede apostar ni retirar nada, y nada de lo que pasa en el juego es asesoramiento financiero. Tiene anuncios recompensados opcionales: solo se muestran si tocás "Ver anuncio". Incluye, desactivadas al empezar, actividades ilegales ficticias con consecuencias.
```

### Capturas (8, en orden)

Se generan con `npm run build && npm run shots` (partida real de 7 años del bot emprendedor, sin dinero regalado) en `docs/play/`. Formato 2:1 (1081 × 2163 px), dentro de lo que acepta Play.

| # | Archivo | Texto sobre la captura |
|---|---|---|
| 1 | `1-inicio.png` | Tu imperio, de un vistazo |
| 2 | `2-decision.png` | Cada decisión deja una historia |
| 3 | `3-fortunas.png` | Subí en las listas de fortunas |
| 4 | `4-empresa.png` | Empresas con contabilidad de verdad |
| 5 | `5-inversiones.png` | Bolsa, bonos, fondos e inmuebles |
| 6 | `6-informes.png` | Cada número es verdad |
| 7 | `7-cronica.png` | Tu historia, año por año |
| 8 | `8-vida.png` | Una vida entera: edad, familia y legado |

- **Gráfico destacado (1024 × 500):** fondo oscuro con la escena del imperio de la pantalla de inicio y el lema "Cada número es verdad. Cada decisión deja una historia."
- **Ícono (512 × 512):** el mismo de la app (`scripts/make_icons.py`).

## Páginas públicas (GitHub Pages)

1. Completar `developer` y `contact` en `src/content/legal.ts`.
2. `npm run legal` → genera `docs/legal/privacidad.html` y `docs/legal/terminos.html`; commit y push a `main`.
3. En GitHub: Settings → Pages → Deploy from a branch → `main` / `/docs`.
4. URL para Play Console: `https://pbarahona12.github.io/gametc/legal/privacidad.html`.

## Fuentes

- [Ubicaciones admitidas para cuentas de comerciante](https://support.google.com/googleplay/android-developer/answer/9306917)
- [Requisitos de prueba para cuentas personales nuevas](https://support.google.com/googleplay/android-developer/answer/14151465)
- [Requisitos de nivel de API objetivo](https://support.google.com/googleplay/android-developer/answer/11926878)
- [Política de datos del usuario (política de privacidad obligatoria)](https://support.google.com/googleplay/android-developer/answer/10144311)
- [Política de pagos (Google Play Billing)](https://support.google.com/googleplay/android-developer/answer/9858738)
- [Política de actividades ilegales](https://support.google.com/googleplay/android-developer/answer/9878877)
- [Clasificaciones de contenido](https://support.google.com/googleplay/android-developer/answer/9898843)
- [Ley para la Protección de Datos Personales de El Salvador (Decreto 144, 2024)](https://www.asamblea.gob.sv/node/13376)
