# Balance por estilo de juego (bots)

Generado con `URT_BOTS=1 npx vitest run tests/balance.test.ts` · 15 años de juego · 3 semillas por combinación.

Días de juego (mediana) hasta alcanzar cada etapa. "—" = no la alcanzó en el período.

| Estilo | Origen | E2 | E3 | E4 | E5 | E6 | E7 | Patrimonio final (mediana) | Quiebras | Años con pérdida | Atrasos |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ejecutivo | egresado | 30 | 850 | 850 | 1672 | 2799 | — | $626,365 | 0 | 0 | 3 |
| ejecutivo | tecnico | 30 | 58 | 423 | 1307 | 2646 | — | $693,176 | 0 | 0 | 0 |
| ejecutivo | autodidacta | 30 | 89 | 637 | 1064 | 2037 | 5264 | $663,229 | 0 | 0 | 0 |
| ejecutivo | herencia | 30 | 58 | 58 | 2037 | 3255 | — | $673,364 | 0 | 0 | 20 |
| inversionista | egresado | 58 | 576 | 850 | 1491 | 2952 | — | $623,839 | 0 | 0 | 0 |
| inversionista | tecnico | 30 | 364 | 454 | 1154 | 2556 | 5233 | $1,126,023 | 0 | 0 | 9 |
| inversionista | autodidacta | 30 | 58 | 484 | 850 | 1945 | 4472 | $1,118,989 | 0 | 0 | 0 |
| inversionista | herencia | 30 | 58 | 58 | 1307 | 2434 | — | $567,759 | 0 | 0 | 0 |
| inmobiliario | egresado | 58 | 698 | 942 | 1672 | 2860 | — | $565,528 | 0 | 0 | 4 |
| inmobiliario | tecnico | 30 | 58 | 423 | 1034 | 2495 | — | $601,405 | 0 | 0 | 0 |
| inmobiliario | autodidacta | 30 | 58 | 607 | 1064 | 2281 | — | $666,136 | 0 | 0 | 0 |
| inmobiliario | herencia | 30 | 58 | 58 | 3833 | 3833 | — | $364,333 | 0 | 0 | 1 |
| emprendedor | egresado | 58 | 820 | 2464 | 2829 | 3590 | 5233 | $910,826 | 0 | 0 | 0 |
| emprendedor | tecnico | 30 | 58 | 850 | 1034 | 1611 | 4198 | $1,153,638 | 0 | 0 | 0 |
| emprendedor | autodidacta | 30 | 89 | 850 | 911 | 1672 | 4017 | $1,328,625 | 0 | 0 | 0 |
| emprendedor | herencia | 30 | 58 | 850 | 1095 | 2037 | 4198 | $1,332,458 | 0 | 0 | 0 |

## Dominancia entre estilos

| Estilo | Patrimonio mediano | Frente a la mediana de los demás |
|---|---|---|
| ejecutivo | $673,364 | ×0.75 |
| inversionista | $899,429 | ×1.34 |
| inmobiliario | $601,405 | ×0.67 |
| emprendedor | $1,328,625 | ×1.97 |

Por qué emprendedor supera 1.5 veces a los demás (×1.97): el bot funda con capital para 6 meses de costos y delega en el mejor gerente que encuentra (así no quebró ninguna vez). El riesgo es real para quien funda sin colchón: medido aparte, fundando solo con el costo de apertura quebraron todas (33 de 33, en los 5 rubros). Con una sola empresa tampoco paga un equipo directivo (hace falta desde la quinta) ni enfrenta una posición dominante: esos costos aparecen al crecer.

«Años con pérdida» cuenta empresas con 12 meses seguidos en rojo al cierre de diciembre.

## Origen herencia: qué le pasa

| Origen | Patrimonio final (mediana, 4 estilos) | Estilos donde supera al egresado | Sueldo medio 3 primeros años | Cursos a la vez (promedio) | Atrasos |
|---|---|---|---|---|---|
| egresado | $626,365 | — | $1,449 | 1.16 | 7 |
| tecnico | $758,519 | 4 de 4 | $1,742 | 1.31 | 9 |
| autodidacta | $957,857 | 4 de 4 | $2,118 | 1.22 | 0 |
| herencia | $673,364 | 2 de 4 | $1,334 | 1.33 | 21 |

La herencia no tiene una penalización estructural: los meses de bajo desempeño son los mismos que los del egresado (por sobrecarga de trabajo y estudio en ambos casos). Donde termina peor, es porque con más efectivo los bots pagan más estudios a la vez y, en el estilo ejecutivo, acumulan atrasos. El juego lo advierte al elegir el origen.

Etapas: E2 Ingreso estable · E3 Primeros ahorros · E4 Primeras inversiones · E5 Patrimonio sólido · E6 Empresario emergente · E7 Magnate regional.

## Qué hacen los bots

- Todos: buscan el empleo mejor pago cuyos requisitos cumplen (hasta 3 postulaciones), estudian para el puesto que quieren (cursos que dan XP en lo que les falta y títulos si piden educación), guardan una reserva de 3–4 meses, pagan la tarjeta completa y se compran ropa de oficina.
- Ejecutivo: invierte más en formación y la mitad del excedente en el fondo índice.
- Inversionista: todo el excedente al fondo índice.
- Inmobiliario: compra el inmueble más barato con rendimiento bruto ≥ 5,5 % (al contado o con hipoteca del 70 %).
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
