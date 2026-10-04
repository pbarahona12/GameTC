# Balance por estilo de juego (bots)

Generado con `URT_BOTS=1 npx vitest run tests/balance.test.ts` · 15 años de juego · 3 semillas por combinación.

Días de juego (mediana) hasta alcanzar cada etapa. "—" = no la alcanzó en el período.

| Estilo | Origen | E2 | E3 | E4 | E5 | E6 | E7 | Patrimonio final (mediana) | Quiebras | Atrasos |
|---|---|---|---|---|---|---|---|---|---|---|
| ejecutivo | egresado | 30 | 850 | 850 | 1825 | 3225 | — | $449,007 | 0 | 3 |
| ejecutivo | tecnico | 30 | 58 | 423 | 1215 | 2799 | — | $871,214 | 0 | 0 |
| ejecutivo | autodidacta | 30 | 89 | 637 | 1246 | 2737 | — | $914,014 | 0 | 0 |
| ejecutivo | herencia | 30 | 58 | 58 | 1794 | 3255 | — | $705,257 | 0 | 16 |
| inversionista | egresado | 58 | 576 | 850 | 1460 | 2587 | — | $829,127 | 0 | 0 |
| inversionista | tecnico | 30 | 364 | 454 | 1580 | 3041 | — | $492,062 | 0 | 9 |
| inversionista | autodidacta | 30 | 58 | 484 | 850 | 1945 | — | $685,331 | 0 | 0 |
| inversionista | herencia | 30 | 58 | 58 | 1154 | 2768 | — | $589,708 | 0 | 0 |
| inmobiliario | egresado | 58 | 698 | 850 | 1672 | 3102 | — | $451,252 | 0 | 1 |
| inmobiliario | tecnico | 30 | 58 | 454 | 1095 | 2281 | — | $698,149 | 0 | 0 |
| inmobiliario | autodidacta | 30 | 58 | 607 | 1185 | 2403 | — | $738,354 | 0 | 1 |
| inmobiliario | herencia | 30 | 58 | 58 | 1703 | 3803 | — | $400,119 | 0 | 0 |
| emprendedor | egresado | 58 | 789 | 2190 | 2372 | 3072 | — | $1,084,001 | 0 | 1 |
| emprendedor | tecnico | 30 | 58 | 820 | 1095 | 1764 | — | $1,253,477 | 0 | 0 |
| emprendedor | autodidacta | 30 | 89 | 850 | 1034 | 1703 | — | $1,172,023 | 0 | 0 |
| emprendedor | herencia | 30 | 58 | 1491 | 1915 | 2676 | — | $919,024 | 0 | 0 |

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
