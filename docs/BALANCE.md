# Balance por estilo de juego (bots)

Generado con `URT_BOTS=1 npx vitest run tests/balance.test.ts` · 15 años de juego · 3 semillas por combinación.

Días de juego (mediana) hasta alcanzar cada etapa. "—" = no la alcanzó en el período.

| Estilo | Origen | E2 | E3 | E4 | E5 | E6 | E7 | Patrimonio final (mediana) | Quiebras | Años con pérdida | Atrasos |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ejecutivo | egresado | 30 | 364 | 850 | 1703 | 3376 | 5233 | $885,686 | 0 | 0 | 0 |
| ejecutivo | tecnico | 30 | 150 | 484 | 1003 | 2403 | 5112 | $990,796 | 0 | 0 | 0 |
| ejecutivo | autodidacta | 30 | 58 | 729 | 942 | 2311 | 5325 | $917,162 | 0 | 0 | 0 |
| ejecutivo | herencia | 30 | 58 | 58 | 1519 | 3711 | — | $792,826 | 0 | 0 | 6 |
| inversionista | egresado | 30 | 119 | 850 | 1733 | 3194 | — | $754,005 | 0 | 0 | 0 |
| inversionista | tecnico | 30 | 58 | 364 | 1399 | 3011 | — | $997,143 | 0 | 0 | 0 |
| inversionista | autodidacta | 30 | 58 | 454 | 1246 | 1856 | 4472 | $978,906 | 0 | 0 | 0 |
| inversionista | herencia | 58 | 58 | 58 | 1550 | 2403 | 4867 | $926,944 | 0 | 0 | 0 |
| inmobiliario | egresado | 30 | 150 | 820 | 1884 | 3406 | — | $652,267 | 0 | 0 | 0 |
| inmobiliario | tecnico | 30 | 58 | 484 | 1154 | 2615 | — | $726,825 | 0 | 0 | 0 |
| inmobiliario | autodidacta | 30 | 58 | 637 | 973 | 2403 | — | $558,250 | 0 | 0 | 0 |
| inmobiliario | herencia | 30 | 58 | 119 | 1460 | 2952 | — | $816,056 | 0 | 0 | 0 |
| emprendedor | egresado | 30 | 180 | 1611 | 1764 | 2403 | 4229 | $1,148,516 | 0 | 0 | 0 |
| emprendedor | tecnico | 30 | 58 | 911 | 1126 | 1794 | 3803 | $1,708,865 | 0 | 0 | 0 |
| emprendedor | autodidacta | 30 | 58 | 850 | 1064 | 1794 | 4472 | $1,334,134 | 0 | 1 | 0 |
| emprendedor | herencia | 30 | 58 | 881 | 1185 | 1915 | 3864 | $1,623,019 | 0 | 0 | 0 |

## Dominancia entre estilos

| Estilo | Patrimonio mediano | Frente a la mediana de los demás |
|---|---|---|
| ejecutivo | $917,162 | ×0.95 |
| inversionista | $969,999 | ×1.06 |
| inmobiliario | $664,091 | ×0.68 |
| emprendedor | $1,612,664 | ×1.76 |

Por qué emprendedor supera 1.5 veces a los demás (×1.76): el bot funda con capital para 6 meses de costos y delega en el mejor gerente que encuentra (así no quebró ninguna vez). El riesgo es real para quien funda sin colchón: medido aparte, fundando solo con el costo de apertura quebraron todas (33 de 33, en los 5 rubros). Con una sola empresa tampoco paga un equipo directivo (hace falta desde la quinta) ni enfrenta una posición dominante: esos costos aparecen al crecer.

«Años con pérdida» cuenta empresas con 12 meses seguidos en rojo al cierre de diciembre.

## Origen herencia: qué le pasa

| Origen | Patrimonio final (mediana, 4 estilos) | Estilos donde supera al egresado | Sueldo medio 3 primeros años | Cursos a la vez (promedio) | Atrasos |
|---|---|---|---|---|---|
| egresado | $885,686 | — | $1,519 | 1.38 | 0 |
| tecnico | $997,143 | 4 de 4 | $1,784 | 1.47 | 0 |
| autodidacta | $978,906 | 3 de 4 | $2,068 | 1.36 | 0 |
| herencia | $926,944 | 3 de 4 | $1,614 | 1.47 | 6 |

La herencia no tiene una penalización estructural: los meses de bajo desempeño son los mismos que los del egresado (por sobrecarga de trabajo y estudio en ambos casos). Donde termina peor, es porque con más efectivo los bots pagan más estudios a la vez y, en el estilo ejecutivo, acumulan atrasos. El juego lo advierte al elegir el origen.

Etapas: E2 Ingreso estable · E3 Primeros ahorros · E4 Primeras inversiones · E5 Patrimonio sólido · E6 Empresario emergente · E7 Magnate regional.

## Qué hacen los bots

- Todos: buscan el empleo mejor pago cuyos requisitos cumplen (hasta 3 postulaciones), estudian para el puesto que quieren (cursos que dan XP en lo que les falta y títulos si piden educación), guardan una reserva de 3–4 meses, pagan la tarjeta completa y se compran ropa de oficina.
- Ejecutivo: invierte más en formación y la mitad del excedente en el fondo índice.
- Inversionista: todo el excedente al fondo índice.
- Inmobiliario: compra el inmueble más barato con rendimiento bruto ≥ 5,5 % (al contado o con hipoteca del 70 %). Desde 1.6 también desarrolla: con dos alquileres y un terreno con margen ≥ 15 % a la vista, ahorra; compra el terreno (hipoteca del 40 %), arranca el proyecto con el máximo de unidades y pide el préstamo de obra (60 % de terreno + obra).
- Emprendedor: cuando junta el capital recomendado + 6 meses de costos, funda una SRL y contrata un gerente con delegación.

## Ajustes de balance de la versión 1.2 (a partir de estas mediciones)

- Inmuebles de entrada: siempre hay a la venta al menos una cochera (≤ $26.000) y un estudio (≤ $60.000), además de 3 opciones ≤ $90.000. Antes lo más barato solía estar en cientos de miles.
- Hipoteca mínima de $15.000: las cocheras y estudios baratos se compran al contado (evita apalancar compras chicas).
- Holding: sin subsidiarias cuesta ~$135/mes (antes ~$750) y cada subsidiaria suma ~$180; aviso claro al crearla y alerta del Asesor si queda vacía.
- Etapa 4: cuentan también inmuebles y cuentas con gestor como inversión (el estilo inmobiliario se trababa).
- Etapa 6: la parte de las ganancias de tus empresas cuenta como ingreso pasivo (el emprendedor tardaba 12–14 años; ahora 5–8).
- Etapa 10: ahora se puede alcanzar (empresas o inmuebles en 2 jurisdicciones).
- Ningún estilo tarda más de 1 año y medio en salir de la supervivencia (prueba automática).

## Ajustes de balance de la versión 1.4

- Etapa 7 (Magnate regional): antes pedía $1.000.000 a precios de hoy y una empresa con ganancias sí o sí. Con 30 años de bots, el ejecutivo, el inversionista y el inmobiliario nunca llegaban y el emprendedor tardaba 19 años: entre la etapa 6 y la 7 pasaban 10–25 años sin nada nuevo. Ahora pide $500.000 a precios de hoy y una empresa con ganancias **o** ingresos pasivos que cubran todos tus gastos. Resultado (30 años, origen técnico): emprendedor 9,9 años, inversionista 12,9, inmobiliario 21,3, ejecutivo 21,8.
- Riesgo empresarial medido (8 partidas por rubro, 10 años): fundando con capital para 6 meses de costos y un gerente, quebraron 2 de 40 partidas del bot emprendedor; fundando solo con el costo de apertura quebraron las 33 que llegaron a fundarse (consultora 8, cafetería 4, minimercado 7, software 8, muebles 6). Al fundar, el juego ahora dice que con menos de 3 meses de caja casi todas quiebran y que lo prudente son 6.

## Ajustes de balance de la versión 1.6 (auditoría E10)

- Carreras: ingeniería, industria y administración terminaban en el nivel 3 (≈ $3.600): ahora tienen gerencia (nivel 4) y dirección (nivel 5). Las 10 carreras llegan a un puesto de dirección en una empresa que cotiza, que paga cada año acciones de la empleadora (35–70 % del sueldo anual según desempeño, netas de impuestos).
- Inmuebles: proyectos por etapas (permisos, estructura, terminaciones) con sobrecostos posibles, obra parada sin fondos, aceleración y préstamo de obra; al terminar, el edificio se divide en unidades.
- Antes de estos cambios (misma medición): ejecutivo ×0,66, inversionista ×1,52, inmobiliario ×0,66, emprendedor ×2,32. El inmobiliario sigue por debajo de ×0,75: su patrimonio está en alquileres apalancados y pocas veces junta el capital para desarrollar; el emprendedor sigue por encima de ×1,4.
