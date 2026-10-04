# Estado del proyecto — versión 1.4

## Versión 1.4: la historia del magnate (rama `v1.4-experiencia`)

Primera implementación de la auditoría de diseño. Todo vive en `src/engine/saga/` (estado `state.saga`) y usa su propio generador de azar: con la misma semilla, la economía (bolsa, empleos, eventos) es idéntica a la de 1.3.

| Sistema | Archivos | Qué hace |
|---|---|---|
| Listas de fortunas | `saga/ranking.ts`, `content/cities.ts` | 100 fortunas por ciudad (4 ciudades, una por jurisdicción) + ranking global. Siguen a la bolsa por sector, los índices inmobiliarios y las tasas de la partida. Los dueños de los grupos rivales están en la lista (su fortuna incluye el grupo). Puesto estimado fuera del top 100. Hitos, noticias (tema «Fortunas»), retadores y defensa del trono. |
| Rivales con memoria | `world/rivals.ts`, `world/types.ts` | Rencor 0–100 (sube si les ganás compras, los superás o competís en sus sectores); multiplica sus ataques hasta ×2. Treguas pactadas en un dilema; romperlas cuesta. |
| Metas de vida | `saga/goals.ts` | 23 metas en 6 categorías (vida, carrera, riqueza, negocios, competencia, valores), hasta 3 activas. |
| Decisiones con plazo | `saga/dilemmas.ts` | 15 plantillas con efectos por el libro mayor, empleados, carrera, rivales e inmuebles; opción por defecto si vencen; desenlaces diferidos. Pausan el tiempo (categoría «decisiones»). |
| Agenda | `saga/agenda.ts` | Vista de todo lo pendiente ordenado por vencimiento. |
| Crónica y festejos | `saga/chronicle.ts` | Línea de tiempo con resumen anual; festejos pendientes (grandes y chicos). |
| Primer mes | `saga/firstMonth.ts` | Guía de 6 pasos que se cumplen por el estado real. |
| Desafíos con semilla | `saga/challenges.ts` | 5 escenarios fijos con código de resultado verificable. |
| Explicar este número | `reports/explain.ts` | Por qué cambió el patrimonio, desde el estado de resultados. |
| Etapas a precios de hoy | `progression/progression.ts` | Umbrales × índice de precios (redondeados); la etapa 12 pide top 10 global. |

Partidas guardadas: versión 6. La migración 5 → 6 crea la historia a precios de hoy sin tocar la economía.

### Verificación 1.4 (resultados reales)

- `npm test`: 327 pruebas (27 nuevas en `tests/saga.test.ts` y `tests/saga_ui.test.tsx`), todas pasan. Typecheck, lint y build sin errores.
- Recorrido de punta a punta (Playwright) actualizado: festejo del primer sueldo y lugar en la lista; pasa.
- Auditoría de caos con 24 semillas × 20 años: invariantes contables intactos.
- Bots de balance (15 años, `docs/BALANCE.md` regenerado): ningún estilo tarda más de 60 días en salir de la supervivencia; con las etapas a precios de hoy, la etapa 7 ya no llega en 15 años (antes llegaba solo el emprendedor, por inflación).
- Costo: ~8 % más de tiempo de simulación y ~90 KB más por partida en 10 años.

### Pendiente para continuar (por prioridad)

1. Probar con 10–12 personas reales (la prueba cerrada de Play) y ajustar la frecuencia de decisiones y festejos.
2. Más plantillas de decisiones (30–40) y desenlaces que involucren a los rivales por nombre.
3. Edad, jubilación y heredero (legado); salida a bolsa y compras de rivales.
4. Crónica exportable como imagen; eras económicas.
5. Escritorio: dos columnas reales en Inicio e informes.

# Versión 1.3

## Versión 1.3: robustez (rama `v1.3-robustez`)

Ocho fases sobre la 1.2, en orden de prioridad (integridad del juego → datos → seguridad → Android → UX → rendimiento → funciones):

1. **Red de seguridad del simulador:** cada día es atómico (copia previa, invariantes al cierre de mes, vuelta atrás si falla); errores visibles y recuperables (reintentar, exportar, volver); arranque con tiempos máximos; límites de error por pantalla y por hoja.
2. **Dinero:** un único intérprete de montos (1,500 / 1500 / 1,500.50; rechaza ambigüedades) con «Valor interpretado»; formularios que no arrastran datos entre entidades; validaciones de préstamos, ofertas y precios.
3. **Persistencia:** hasta 3 partidas, copias por tiempo real (10 min / 1 h / 1 día), restaurar e importar que se pueden deshacer, guardado automático sin escrituras superpuestas, «Guardado hace X».
4. **Motor:** holding con subsidiaria sin valor, equipos amortizados, gerente con calidad/costo y resumen semanal, inspección y abogado (una sola consecuencia), vivienda propia, empleo desde prisión, misiones correctas y persistentes, rumores falsos indistinguibles y azar del análisis separado del mundo, liquidez única, pausa automática por categoría.
5. **Rendimiento y ESLint:** derivados calculados una vez por cambio de partida, ESLint con react-hooks sin excepciones injustificadas, código muerto eliminado.
6. **Android 16 y CI/CD:** Capacitor 8 (minSdk 24, target 36, AGP 8.13, Gradle 8.14), borde a borde, actualizaciones firmadas ECDSA P-256 verificadas con WebCrypto, OTA con tiempos máximos y reintentos, CI de solo lectura que publica solo desde `main` sin reemplazar Releases.
7. **UX/UI:** barra superior Fecha | Play/Pausa | 1×–8× | Más; Inicio del día 1; primera partida en 4 pasos con opciones avanzadas (ilegales desactivadas por defecto); botón atrás con historial; un solo sistema de íconos; pestañas agrupadas; formato numérico único; contraste AA y zoom.
8. **Pulido:** e2e con Playwright, prueba de caos 50 × 20, recordatorio de exportar, copia automática de Android solo de partidas, mercado de inmuebles ordenable por rendimiento.

### Verificación 1.3 (resultados reales)

- `npm test`: 289 pruebas en 32 archivos, todas correctas (antes de la 1.3: 180 en 21). `npm run typecheck` y `npm run lint` sin errores ni advertencias. `npm run build` correcto (archivo principal 664.6 kB, gzip 216.7 kB).
- `npm run e2e` (Playwright, Chromium móvil): abrir → crear partida → conseguir empleo → avanzar → cerrar el primer mes → guardar → recargar → continuar. Correcto en este entorno y en GitHub Actions.
- `npm run chaos` (50 semillas × 20 años con decisiones aleatorias en todos los sistemas): correcto después de corregir tres asientos de importe cero que encontró (dos de ellos detenían la simulación diaria).
- GitHub Actions compiló la APK de actualización y el AAB/APK de publicación firmados (Android 16 / API 36).
- **No verificado:** la APK no se instaló ni se ejecutó en un teléfono o emulador. El borde a borde, el botón atrás nativo, la copia de seguridad automática de Android y el cambio de versión del WebView por una actualización por internet están probados con simulaciones y compilación, no en un dispositivo.

---

# Versión 1.2

## Novedades de la versión 1.2

- **Tiendas con sentido** (Más → Tiendas): 12 tiendas en 5 categorías (ropa, vehículos, tecnología, hogar, lujo) y 41 artículos. Cada uno tiene un efecto real: imagen, costos de transporte, salud, estrés, aprendizaje, red de contactos o ahorro en comida. Se paga con débito, efectivo, tarjeta (con reintegro según el nivel) o en cuotas (sin interés si la tienda y tu tarjeta lo permiten). Vehículos, tecnología, hogar y lujo son bienes que se deprecian y se pueden vender; la ropa se gasta.
- **Tu personaje:** dibujo propio en SVG que se viste con lo que tenés puesto (camisa, saco, tapado, reloj, cadena, bolso…), apariencia elegible (tono de piel, peinado y color) y vestidor. **Imagen personal** 0–100: cambia la probabilidad en entrevistas (±6 puntos según el nivel del puesto), las negociaciones de sueldo, la reputación y el **trato en las tiendas** (atención fría, normal o de cliente preferente con descuento; las colecciones exclusivas solo se muestran con buena imagen).
- **Tarjetas Clásica, Oro, Platino y Black:** requisitos de puntaje, ingresos o patrimonio e historial; costo anual; reintegro sobre todo lo que pagás con la tarjeta; cuotas sin interés; más límite; rebaja de tasa y reconocimiento en tiendas. Pedir una superior es una consulta de crédito y puede rechazarse.
- **Mercado con vida:** 4 grupos rivales compran empresas e inmuebles en venta (antes que vos), abren competidores en tus sectores, cierran exclusividades con proveedores (suben su precio para vos), ofertan por tus empresas rentables y tientan a tus mejores empleados (igualás o lo dejás ir). **Noticias calibradas**: los eventos económicos se programan con anticipación, los balances tienen pistas previas y los movimientos de rivales se rumorean; hay rumores falsos. Analizar estima la confiabilidad con un error que baja con la habilidad y a veces da una pista: ventaja real, nunca certeza.
- **Guía:** 26 misiones en 6 capítulos ("Comprá tu primera acción", "Cobrá tu primer alquiler", "Pedí una tarjeta Oro"…), con experiencia de recompensa. Secciones avanzadas (Negocios, Inmuebles, Trading Pro, Mogul, Gestor, Holding) muestran una **recomendación por etapa** la primera vez, con "Abrir igual"; en Ajustes se puede mostrar todo.
- **Balance** medido con bots por estilo de juego (`docs/BALANCE.md`): cocheras y estudios baratos siempre a la venta, hipoteca mínima de $15.000, holding sin subsidiarias ~$135/mes (antes ~$750) con aviso claro y alerta del Asesor, etapa 4 que cuenta inmuebles, etapa 6 que cuenta las ganancias de tus empresas, etapa 10 alcanzable.
- **Interfaz:** íconos de línea en toda la navegación, barra superior con tu personaje, noticias y asesor; menú "Más" agrupado; **Ajustes por secciones** con el interruptor de **actividades ilegales** bien visible (también arriba de todo en Más → Legal y al crear la partida); gráfico de velas de Trading Pro con **deslizar para ver cada día, pellizco con dos dedos para acercar y arrastre para moverse**, botones de zoom; microanimaciones; importar partida desde archivo en la pantalla inicial.
- **Identidad y publicación:** ícono y pantalla de inicio propios (Android 12+ y anteriores), **firma fija** para que cada APK se instale encima sin perder la partida, Releases de GitHub para descargar desde el teléfono, **AAB firmado para Play Store** cuando se configuran los secretos, y **actualizaciones dentro de la app** (sin reinstalar, verificadas con SHA-256 y con vuelta atrás automática). Ver `docs/PUBLICAR.md`.

### Verificación 1.2 (resultados reales en este entorno)

- `npx vitest run`: ver `docs/RESULTADOS_PRUEBAS.txt` (21 archivos). Nuevas: `v12.test.ts` (migración 4→5, tiendas y contabilidad de bienes, transporte y comida, imagen en entrevistas, trato en tiendas, niveles de tarjeta, reintegros, cuotas, calibración de noticias con 12.000 candidatos, precisión del análisis según habilidad, 5 años de rivales con invariantes, ofertas por empleados, costos de holding, inmuebles de entrada, misiones, secciones, etapa 10, manifiesto de actualización), `ota.test.ts` (flujo de actualización con plugins simulados: descarga, archivo alterado, guardado previo fallido, confirmación, vuelta atrás por error o por partida ilegible, versión fallida no reofrecida, APK nueva requerida) y `balance.test.ts` (bots por estilo). La auditoría integral con bots aleatorios ahora también compra, vende, se viste, pide tarjetas, analiza noticias y responde ofertas, con invariantes, Δ patrimonio = resultado y conciliación del flujo de caja cada mes.
- Recorrido en Chromium (390 × 844, táctil, temas claro y oscuro): pantalla inicial con importación y apariencia, Inicio, Más, Tiendas, compra con débito, tarjeta y cuotas, vestidor, noticias, competencia, tarjeta y niveles, recomendación por etapa y Trading Pro, Ajustes por secciones. Sin errores de consola.
- **No verificado aquí:** la APK no se compiló ni se ejecutó en este entorno (no hay SDK de Android); se compila en GitHub Actions. El cambio de versión del WebView de Android en una actualización por internet se probó con los plugins simulados, no en un teléfono.

---

# Estado de la versión 1.1

## Novedades de la versión 1.1

- **Habilidad nueva: Proyección de negocios (🔮).** Antes de fundar o comprar una empresa (y también para las tuyas) el juego simula entre 5 y 15 futuros posibles con las reglas reales y muestra: probabilidad de seguir abierta, mes en que empieza a ganar, resultado del año (escenario malo, central y bueno) y un abanico mensual de ganancia, caja y ventas. La precisión mejora con la habilidad (más futuros, menos sesgo de lectura) pero nunca es total. La proyección se guarda al fundar/comprar y se compara después con la realidad ("Tu proyección vs. la realidad"), lo que también da experiencia. Libro, curso y certificación nuevos.
- **Mis inversiones:** todas tus inversiones (acciones, bonos, fondos, Mogul, cuentas con gestor e inmuebles) en una sola lista; tocás cualquiera y comprás más o vendés ahí mismo. En Bolsa, tus acciones aparecen primero (⭐) y hay un filtro "Las mías".
- **Gestor de inversiones:** profesional contratable al que le das dinero; lo invierte en acciones y fondos del mercado del juego según tu perfil (conservador, moderado, agresivo). Su calidad y experiencia cambian de verdad sus decisiones; cobra comisión de gestión y de éxito; podés aportar, retirar, cambiar el perfil, capacitarlo o despedirlo. Su resultado se compara siempre con el Fondo Índice.
- **Capacitación de profesionales** (contador, asesor, abogado, gestor) y experiencia que crece cada año.
- **Diseño y claridad:** inicio rediseñado ("Tu mes", "Tu próximo paso", "Tu mundo"), encabezados en lenguaje simple en cada sección, pestañas con íconos, gráficos táctiles (tocá para ver el valor de cada punto, también en las velas), 5 misiones nuevas en la guía (fondo, acción, proyección, gestor, economía), avisos duplicados eliminados.
- **Realismo y balance:** la bolsa vuelve a su valor justo más despacio (ventajas más realistas para quien analiza bien); las habilidades Bolsa y Marketing ahora tienen efecto real; siempre hay inmuebles de entrada (desde ~$25.000); textos de habilidades actualizados a sus efectos reales.
- **Android:** el guardado va a archivos privados de la app (con segunda copia de la principal en preferencias), para que el arranque no se vuelva lento con partidas largas.
- **Verificación 1.1:** 143 pruebas en 18 archivos, todas pasan (13 nuevas en `tests/v11.test.ts`, y los bots de la auditoría integral ahora también usan el gestor). La APK se compila en GitHub Actions.

---

# Estado de la versión 1.0 (Fases 1 a 5)

## Verificación realizada (resultados reales en este entorno)

- `npx vitest run`: **130 pruebas en 17 archivos, todas pasan** (≈ 55 s en un núcleo).

  | Archivo | Pruebas | Qué comprueba |
  |---|---|---|
  | ledger | 5 | Partida doble: cuadre, rechazo de asientos inválidos, saldos no negativos, recomputación. |
  | tax | 5 | Tramos progresivos, deducciones, crédito educativo, retenciones vs. declaración. |
  | loans | 5 | Amortización, costo total, anticipos, mora e impago. |
  | card | 4 | Corte, gracia, intereses, mínimo, recargos. |
  | simulation | 11 | 5 años con invariantes cada mes, Δ patrimonio = resultado neto, determinismo, inflación, offline. |
  | save | 6 | Guardar/cargar idéntico, checksum, recuperación de copias, rechazo de estados imposibles, migración v0. |
  | save_v2 | 4 | Guardado con empresas, migraciones hasta v3, almacenamiento espejado. |
  | audit | 10 | Auditoría de la Fase 1 con bots aleatorios (6 semillas × 4 años). |
  | business | 27 | Empresas: fundación, 5 sectores × 2 años, FIFO, proveedores, personal, marketing, préstamos, impuestos, formas legales, **quiebra con responsabilidad limitada e ilimitada**, salida de insolvencia, venta, compra, emisión, liquidación. |
  | audit_business | 4 | Bots empresariales aleatorios (4 semillas × 3 años) con invariantes cada mes. |
  | invest | 10 | Compra/venta con costo FIFO, comisiones, ganancias realizadas y no realizadas; órdenes límite, stop y OCO; dividendos con retención; estimación del analista que mejora con la habilidad pero nunca es exacta; bonos (duración, cupones, nominal); fondos; Mogul Exchange; corto/largo plazo y arrastre de pérdidas. |
  | realestate | 6 | Compra al contado (escritura, alquiler, gastos, impuesto, tasación); hipoteca (cuota, intereses, amortización, venta que cancela); **impago → ejecución con recurso**; local propio de una empresa con depreciación; vivienda propia; tasación. |
  | world | 13 | Ciclo económico de 20 años acotado; recesión que reduce demanda y aumenta despidos; residencia fiscal; impuesto de sociedades por jurisdicción; contador; holding sin doble conteo; auditoría externa; proyección del asesor; evasión y regularización; caso penal por etapas; actividades clandestinas desactivables; asesor con riesgos reales; escenarios. |
  | audit_world | 3 | **Auditoría integral**: bots aleatorios en TODOS los sistemas (bolsa, bonos, fondos, Mogul, inmuebles, hipotecas, empresas, holdings, préstamos intragrupo, profesionales, jurisdicciones, actividades ilegales, multas, casos) durante 3 años × 3 semillas; cada mes: invariantes, Δ patrimonio = resultado y conciliación del flujo de caja. |
  | indicators | 2 | SMA, EMA, RSI, MACD, Bollinger, volatilidad, beta, VaR, caída máxima. |
  | phase5 | 12 | Compactación del libro (informes mensuales idénticos antes y después, personal y empresa; patrimonio intacto); guardado comprimido idéntico al original; payload alterado rechazado; **copia principal dañada → se carga la mejor copia válida sin borrar las demás**; escritura interrumpida recuperada; almacenamiento lleno (libera copias viejas, nunca la principal); instantánea liviana para deshacer; **insolvencia personal** de punta a punta; rendimiento de 10 años. |
  | content | 3 | Integridad del glosario (285 términos) y de todas las referencias de ayuda. |

- Rendimiento medido (prueba `phase5`, Node, un núcleo): **10 años de juego con empleo, empresa, acciones, fondo e inmueble en ≈ 2,9 s** (≈ 1.280 días/s). Estado ≈ 2,15 MB; guardado comprimido ≈ 0,68 MB; libro personal: 1.515 asientos detallados + 3.541 resumidos en baldes mensuales. Instantánea para deshacer ≈ 3,7 ms frente a ≈ 30 ms de una copia completa (partida de 4 años con dos empresas).
- `npx tsc -b`: sin errores (TypeScript estricto).
- `npm run build`, `npm run build:single` y `npx cap sync android`: correctos.
- Recorrido automatizado en Chromium emulando un teléfono (390 × 844, táctil, tema oscuro) sobre la compilación de un solo archivo: crear partida; comprar acciones en Bolsa Lite, analizar, abrir Trading Pro; comprar bonos, invertir en un fondo y en Mogul Exchange; inspeccionar un inmueble e intentar comprarlo (rechazo correcto por fondos, con el detalle del efectivo necesario); crear una holding; recorrer Economía, Impuestos, Profesionales (contratar un contador), Legal, Informes y el Asesor. **Sin errores de consola.** Auditoría de botones en Invertir (7 secciones), mercado inmobiliario, Economía, Impuestos, Profesionales, Legal y creación de holding: todos los botones de acción tienen ⓘ; solo quedan sin ⓘ los de navegación ("← Más", "← Volver").
- **No verificado aquí:** la APK **no se compiló ni se ejecutó** en este entorno (no hay SDK de Android y la red no permite descargarlo). Se verificaron la configuración de Capacitor, el proyecto Android sincronizado y el flujo de GitHub Actions. No hubo pruebas en un teléfono físico.

## Errores encontrados y corregidos durante las Fases 3–5

1. Empresas en venta y de Mogul que nacían insolventes: los marcadores de ausencia/capacitación/averías empezaban en 0 y, con días virtuales negativos, anulaban la productividad. Ahora se construyen en su día de inicio y los marcadores empiezan en `día − 1`.
2. El gerente NPC contrataba mal (contaba fines de semana en la utilización) y no ajustaba producción ni marketing: corregido.
3. Asiento vacío al vender una empresa sin plusvalía: se filtran líneas en cero.
4. Depósito de efectivo no declarado clasificado como "interno" aunque movía caja: rompía la conciliación del flujo; ahora es operativo.
5. El asesor y el gerente fallaban con holdings (sin productos ni mercado): protegidos.
6. Honorarios legales podían dejar la cuenta en negativo: ahora usan la cadena de pagos con atrasos.
7. Las inspecciones registraban un motivo y mostraban otro al azar: unificado.
8. El guardado superaba el cupo de `localStorage` en partidas largas (error no controlado): compactación, compresión y manejo del cupo.
9. El escenario de baja de tasas podía llevar la tasa a negativo: acotado en 0.

## Implementado y funcionando

**Fases 1 y 2** (ver versiones anteriores): libro mayor de partida doble, banca, tarjeta, préstamos, puntaje, presupuesto, 29 empleos, impuestos, 14 habilidades, 33 formaciones, progresión, asesor; empresas completas en 5 sectores con contabilidad propia.

**Fase 3 — Inversiones y bienes raíces**
- Bolsa con 20 empresas ficticias en 10 sectores: precios diarios por oferta y demanda (mercado, sector, valor justo, momento, ruido), resultados trimestrales, dividendos, splits, quiebras e IPO, noticias.
- **Bolsa Lite** (compra/venta simple, gráficos de 3 meses/1 año/todo, fundamentos, análisis) y **Trading Pro** (velas con volumen, SMA/EMA/Bollinger, RSI/MACD, 7 tipos de órdenes incluida OCO, órdenes abiertas e historial, análisis de riesgo de la cartera, comparador con correlación). Ambas sobre el mismo mercado y la misma contabilidad.
- Cartera: composición, ganancias realizadas y no realizadas, dividendos, riesgo (volatilidad, beta, VaR, caída máxima, concentración), proyección a 12 meses, últimas operaciones.
- Bonos soberanos y corporativos con calificación, rendimiento, duración, cupones, vencimiento e impago.
- 6 fondos de inversión con explicación de funcionamiento y riesgos.
- **Mogul Exchange**: participaciones fraccionadas en empresas simuladas, edificios y regalías, con valoración detallada, repartos, rendimiento y riesgo.
- Bienes raíces: 7 zonas, viviendas, locales, oficinas y terrenos; compra personal o por empresa; contraoferta; inspección; hipotecas de 3 bancos (fija/variable, LTV, cuota/ingresos); alquiler, inquilinos, morosidad, desalojo, vacancia, administración propia o inmobiliaria; mantenimiento, reparaciones, impuesto; renovaciones y construcción; uso propio; venta publicada o rápida; ejecución hipotecaria con o sin recurso; informe de rentabilidad por inmueble.

**Fase 4 — Mundo, impuestos, profesionales, grupos, legal y asesor avanzado**
- Economía dinámica con 5 fases, PIB, desempleo, inflación, tasa por regla de Taylor, confianza, costos de proveedores y 12 eventos, con efectos sobre empresas, empleo, crédito, bolsa, bonos, fondos e inmuebles. Pantalla Economía y chip en Inicio.
- 4 jurisdicciones con reglas propias; residencia fiscal; comparación de carga; obligaciones de los próximos 12 meses; informe del contador.
- Profesionales contratables (contador, asesor, abogado, auditor, gerente) con experiencia, especialidad, costo, reputación y calidad oculta.
- Holdings y subsidiarias en cadena, préstamos intragrupo, honorarios de gestión, dividendos hacia la matriz, centralización de caja, delegación común, estados consolidados con eliminaciones, riesgos individuales y consolidados, transferencia al grupo y salida del grupo.
- Sistema legal ficticio y opcional: soborno, evasión (personal y empresarial), cifras infladas, retiro no declarado, negocios clandestinos, depósitos y lavado; sospecha, detección, auditoría anual, investigación, imputación con acuerdo, juicio, sentencia, apelación, multas con plan de pagos o embargo, decomiso, suspensión de licencias, antecedentes, prisión con libertad anticipada, inspecciones, regularización voluntaria. Abogados que revisan, preparan, negocian y apelan sin garantizar la absolución.
- Asesor IA avanzado con alertas de insolvencia personal, quiebra, deuda, concentración, caída de cartera, riesgos inmobiliarios, impuestos, legal y ciclo; escenarios nuevos (recesión, tasas, caída de bolsa, compra de inmueble, vender cartera).

**Fase 5 — Optimización, personalización y guardado**
- Compactación del libro mayor en baldes mensuales (saldos e informes exactos), límites de historiales, instantánea liviana para deshacer, división de código.
- Guardado comprimido con checksum, carga de la copia válida más reciente, manejo de almacenamiento lleno, copias que nunca se destruyen entre sí, exportación/importación (texto plano o comprimido), migraciones hasta v3, validación completa al cargar.
- Ajustes: tema, tamaño de texto, densidad, alto contraste, paleta para daltonismo, reducir animaciones, velocidad base, qué eventos pausan el tiempo, confirmaciones, categorías de alertas del asesor, progreso sin conexión, dificultad económica y actividades ilegales (también al crear la partida).
- Compatibilidad con WebView antiguos: copia profunda sin `structuredClone`, guardado sin compresión si no hay `CompressionStream`.

## Limitaciones conocidas

- (1.2) Las APK instaladas a mano y la versión de Play Store tienen firmas distintas: no se instalan una encima de la otra (hay que exportar e importar la partida).
- (1.2) Al pasar de la 1.1 a la 1.2 hay que reinstalar una única vez (la 1.1 tenía una firma de depuración al azar): exportar la partida antes e importarla después.
- (1.2) Las actualizaciones por internet necesitan conexión y dependen de `raw.githubusercontent.com`.

- APK no compilada ni probada en dispositivo desde este entorno (ver README → "Generar la APK").
- Los informes de períodos antiguos que cortan un mes ya compactado se prorratean por días (los meses completos son exactos). El detalle de asientos de más de ~1–2 años se ve resumido por mes.
- La competencia IA es reactiva pero simple; no compite por empleados ni proveedores.
- La bolsa es un modelo estadístico por empresa (no hay libro de órdenes de otros participantes); el impacto de mercado y el diferencial lo aproximan.
- Mogul Exchange ofrece un conjunto acotado de activos (6 al iniciar, reemplazados al liquidarse); los bonos corporativos solo existen para empresas cotizadas.
- Las actividades ilegales son deliberadamente abstractas (decisiones y riesgos, sin métodos reales).
- La accesibilidad de los gráficos SVG para lectores de pantalla se limita a descripciones generales (`aria-label`).
- Personalización cosmética (logotipos, oficinas, vehículos, lujo) no incluida: se priorizaron sistemas funcionales.
- El tamaño de texto usa `zoom` de CSS (bien soportado en Chrome/WebView; en navegadores sin soporte se ignora).

## Guía para continuar el desarrollo

1. `npm install && npm test && npm run dev`.
2. Leé `docs/ARQUITECTURA.md` → "Cómo agregar un sistema nuevo".
3. Regla de oro: **ningún sistema cambia saldos fuera de `post()` / `coPost()`**; toda compra o venta de valores pasa por `invest/portfolio.ts`; cada subregistro agrega su conciliación en `invariants.ts`.
4. Todo cambio del formato de partida sube `SAVE_VERSION` y agrega una migración con su prueba.
5. Cada regla nueva se documenta en `docs/REGLAS_ECONOMICAS.md`, en el glosario (con `how`) y, si genera riesgos, en el asesor.
6. Los efectos macro se leen siempre desde los lectores de `economy/economy.ts` para mantener la coherencia entre sistemas.
