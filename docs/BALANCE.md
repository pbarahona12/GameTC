# Balance por estilo de juego (bots)

Generado con `URT_BOTS=1 npx vitest run tests/balance.test.ts` · 15 años de juego · 3 semillas por combinación.

Días de juego (mediana) hasta alcanzar cada etapa. "—" = no la alcanzó en el período.

| Estilo | Origen | E2 | E3 | E4 | E5 | E6 | E7 | Patrimonio final (mediana) | Quiebras | Años con pérdida | Atrasos |
|---|---|---|---|---|---|---|---|---|---|---|---|
| ejecutivo | egresado | 30 | 850 | 850 | 1764 | 3164 | — | $737,196 | 0 | 0 | 3 |
| ejecutivo | tecnico | 30 | 58 | 423 | 1307 | 2646 | — | $798,498 | 0 | 0 | 0 |
| ejecutivo | autodidacta | 30 | 89 | 637 | 1064 | 2037 | — | $509,781 | 0 | 0 | 0 |
| ejecutivo | herencia | 30 | 58 | 58 | 2129 | 3345 | — | $327,848 | 0 | 0 | 20 |
| inversionista | egresado | 58 | 576 | 820 | 1794 | 2676 | — | $638,981 | 0 | 0 | 0 |
| inversionista | tecnico | 30 | 364 | 454 | 1154 | 2556 | — | $1,132,762 | 0 | 0 | 9 |
| inversionista | autodidacta | 30 | 58 | 484 | 850 | 1945 | — | $1,124,931 | 0 | 0 | 0 |
| inversionista | herencia | 30 | 58 | 58 | 1154 | 3072 | — | $760,925 | 0 | 0 | 0 |
| inmobiliario | egresado | 58 | 698 | 850 | 1672 | 3194 | — | $586,903 | 0 | 0 | 1 |
| inmobiliario | tecnico | 30 | 58 | 423 | 1034 | 2495 | — | $589,657 | 0 | 0 | 0 |
| inmobiliario | autodidacta | 30 | 58 | 607 | 1064 | 2281 | — | $691,747 | 0 | 0 | 0 |
| inmobiliario | herencia | 30 | 58 | 58 | 2860 | 3956 | — | $435,709 | 0 | 0 | 0 |
| emprendedor | egresado | 58 | 820 | 2464 | 2829 | 3590 | — | $951,248 | 1 | 0 | 0 |
| emprendedor | tecnico | 30 | 58 | 850 | 1034 | 1611 | — | $1,321,838 | 0 | 0 | 0 |
| emprendedor | autodidacta | 30 | 89 | 850 | 911 | 1672 | — | $1,223,307 | 0 | 0 | 0 |
| emprendedor | herencia | 30 | 58 | 850 | 1733 | 2921 | — | $988,546 | 1 | 0 | 0 |

## Dominancia entre estilos

| Estilo | Patrimonio mediano | Frente a la mediana de los demás |
|---|---|---|
| ejecutivo | $576,456 | ×0.65 |
| inversionista | $890,964 | ×1.51 |
| inmobiliario | $589,657 | ×0.66 |
| emprendedor | $1,201,592 | ×2.04 |

Por qué inversionista supera 1.5 veces a los demás (×1.51): pone todo el excedente en el fondo índice desde el primer mes; en 15 años el interés compuesto pesa más que el sueldo extra que buscan los otros estilos.

Por qué emprendedor supera 1.5 veces a los demás (×2.04): es el camino con más riesgo (las quiebras de la tabla son suyas) y el bot delega en un gerente desde el principio. Con una sola empresa no paga un equipo directivo (hace falta desde la quinta) ni suele llegar a una posición dominante: esos costos aparecen al crecer.

«Años con pérdida» cuenta empresas con 12 meses seguidos en rojo al cierre de diciembre.

## Origen herencia: qué le pasa

| Origen | Patrimonio final (mediana, 4 estilos) | Estilos donde supera al egresado | Sueldo medio 3 primeros años | Cursos a la vez (promedio) | Atrasos |
|---|---|---|---|---|---|
| egresado | $639,504 | — | $1,365 | 1.12 | 4 |
| tecnico | $915,482 | 4 de 4 | $1,742 | 1.31 | 9 |
| autodidacta | $955,045 | 3 de 4 | $2,118 | 1.22 | 0 |
| herencia | $662,524 | 2 de 4 | $1,385 | 1.32 | 20 |

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
