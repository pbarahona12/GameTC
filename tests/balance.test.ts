import { writeFileSync } from 'node:fs';
import { runBot, median, BotStyle, BotResult } from './bots/strategies';
import { STAGES } from '../src/engine/progression/progression';
import type { BackgroundId } from '../src/content/backgrounds';

/**
 * Balance por estilo de juego. En la integración continua corre una versión corta
 * (asegura que ningún estilo quede trabado al principio). Con URT_BOTS=1 corre la
 * versión completa y escribe docs/BALANCE.md.
 */
const FULL = !!process.env.URT_BOTS;
const STYLES: BotStyle[] = ['ejecutivo', 'inversionista', 'inmobiliario', 'emprendedor'];
const BGS: BackgroundId[] = FULL ? ['egresado', 'tecnico', 'autodidacta', 'herencia'] : ['egresado', 'herencia'];
const SEEDS = FULL ? ['b1', 'b2', 'b3'] : ['b1'];
const YEARS = FULL ? 15 : 4;

describe('Balance · bots por estilo de juego', () => {
  const results: BotResult[] = [];
  for (const style of STYLES) for (const bg of BGS) for (const seed of SEEDS) {
    it(`${style} · ${bg} · ${seed}`, () => {
      const r = runBot(style, bg, `${seed}-${style}-${bg}`, YEARS);
      results.push(r);
      // Todos salen de la supervivencia (etapa 2+) en menos de un año y medio.
      expect(r.stageDays[2] ?? Infinity).toBeLessThan(540);
      expect(r.finalNetWorth).toBeGreaterThan(0);
    });
  }
  afterAll(() => {
    if (!FULL) return;
    const lines: string[] = ['# Balance por estilo de juego (bots)', '', `Generado con \`URT_BOTS=1 npx vitest run tests/balance.test.ts\` · ${YEARS} años de juego · ${SEEDS.length} semillas por combinación.`, '',
      'Días de juego (mediana) hasta alcanzar cada etapa. "—" = no la alcanzó en el período.', ''];
    const head = ['Estilo', 'Origen', ...[2, 3, 4, 5, 6, 7].map((n) => `E${n}`), 'Patrimonio final (mediana)', 'Quiebras', 'Años con pérdida', 'Atrasos'];
    lines.push(`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`);
    for (const style of STYLES) for (const bg of BGS) {
      const rs = results.filter((r) => r.style === style && r.background === bg);
      const cells = [2, 3, 4, 5, 6, 7].map((n) => {
        const reached = rs.map((r) => r.stageDays[n]).filter((d): d is number => d !== undefined);
        return reached.length * 2 >= rs.length ? String(median(reached)) : '—';
      });
      const nw = median(rs.map((r) => r.finalNetWorth)) ?? 0;
      lines.push(`| ${style} | ${bg} | ${cells.join(' | ')} | $${Math.round(nw / 100).toLocaleString('en-US')} | ${rs.reduce((a, r) => a + r.bankruptcies, 0)} | ${rs.reduce((a, r) => a + r.lossYears, 0)} | ${rs.reduce((a, r) => a + r.arrearsEvents, 0)} |`);
    }
    // Dominancia (1.4, auditoría): patrimonio mediano de cada estilo frente al resto.
    const byStyle = STYLES.map((st) => ({ st, nw: median(results.filter((r) => r.style === st).map((r) => r.finalNetWorth)) ?? 0 }));
    lines.push('', '## Dominancia entre estilos', '', '| Estilo | Patrimonio mediano | Frente a la mediana de los demás |', '|---|---|---|');
    for (const x of byStyle) {
      const others = median(byStyle.filter((y) => y !== x).map((y) => y.nw)) ?? 1;
      lines.push(`| ${x.st} | $${Math.round(x.nw / 100).toLocaleString('en-US')} | ×${(x.nw / Math.max(1, others)).toFixed(2)} |`);
    }
    const WHY: Record<BotStyle, string> = {
      emprendedor: (() => {
        const bk = results.filter((r) => r.style === 'emprendedor').reduce((a, r) => a + r.bankruptcies, 0);
        return `el bot funda con capital para 6 meses de costos y delega en el mejor gerente que encuentra (${bk ? `aun así quebró ${bk} ${bk === 1 ? 'vez' : 'veces'}` : 'así no quebró ninguna vez'}). El riesgo es real para quien funda sin colchón: medido aparte, fundando solo con el costo de apertura quebraron todas (33 de 33, en los 5 rubros). Con una sola empresa tampoco paga un equipo directivo (hace falta desde la quinta) ni enfrenta una posición dominante: esos costos aparecen al crecer`;
      })(),
      inversionista: 'pone todo el excedente en el fondo índice desde el primer mes; en 15 años el interés compuesto pesa más que el sueldo extra que buscan los otros estilos',
      ejecutivo: 'gana más sueldo que los demás',
      inmobiliario: 'el apalancamiento de las hipotecas multiplica la revalorización',
    };
    for (const x of byStyle) {
      const ratio = x.nw / Math.max(1, median(byStyle.filter((y) => y !== x).map((y) => y.nw)) ?? 1);
      if (ratio > 1.5) lines.push('', `Por qué ${x.st} supera 1.5 veces a los demás (×${ratio.toFixed(2)}): ${WHY[x.st]}.`);
    }
    lines.push('', '«Años con pérdida» cuenta empresas con 12 meses seguidos en rojo al cierre de diciembre.');
    // Origen herencia (auditoría): ¿el origen con más capital termina más pobre? ¿Por qué?
    const byBg = (bg: BackgroundId) => results.filter((r) => r.background === bg);
    const usdTxt = (c: number) => `$${Math.round(c / 100).toLocaleString('en-US')}`;
    lines.push('', '## Origen herencia: qué le pasa', '', '| Origen | Patrimonio final (mediana, 4 estilos) | Estilos donde supera al egresado | Sueldo medio 3 primeros años | Cursos a la vez (promedio) | Atrasos |', '|---|---|---|---|---|---|');
    const nwOf = (bg: BackgroundId, st: BotStyle) => median(byBg(bg).filter((r) => r.style === st).map((r) => r.finalNetWorth)) ?? 0;
    for (const bg of BGS) {
      const rs = byBg(bg);
      const wins = STYLES.filter((st) => nwOf(bg, st) > nwOf('egresado', st)).length;
      lines.push(`| ${bg} | ${usdTxt(median(rs.map((r) => r.finalNetWorth)) ?? 0)} | ${bg === 'egresado' ? '—' : `${wins} de 4`} | ${usdTxt(median(rs.map((r) => r.salary3y)) ?? 0)} | ${(rs.reduce((a, r) => a + r.avgCourses, 0) / rs.length).toFixed(2)} | ${rs.reduce((a, r) => a + r.arrearsEvents, 0)} |`);
    }
    lines.push('', 'La herencia no tiene una penalización estructural: los meses de bajo desempeño son los mismos que los del egresado (por sobrecarga de trabajo y estudio en ambos casos). Donde termina peor, es porque con más efectivo los bots pagan más estudios a la vez y, en el estilo ejecutivo, acumulan atrasos. El juego lo advierte al elegir el origen.');
    // Ningún origen queda castigado: la mediana de la herencia no baja del 60 % de la del egresado.
    expect(median(byBg('herencia').map((r) => r.finalNetWorth)) ?? 0).toBeGreaterThan((median(byBg('egresado').map((r) => r.finalNetWorth)) ?? 0) * 0.6);
    lines.push('', 'Etapas: ' + STAGES.slice(1, 7).map((s) => `E${s.n} ${s.name}`).join(' · ') + '.');
    lines.push('', '## Qué hacen los bots', '',
      '- Todos: buscan el empleo mejor pago cuyos requisitos cumplen (hasta 3 postulaciones), estudian para el puesto que quieren (cursos que dan XP en lo que les falta y títulos si piden educación), guardan una reserva de 3–4 meses, pagan la tarjeta completa y se compran ropa de oficina.',
      '- Ejecutivo: invierte más en formación y la mitad del excedente en el fondo índice.',
      '- Inversionista: todo el excedente al fondo índice.',
      '- Inmobiliario: compra el inmueble más barato con rendimiento bruto ≥ 5,5 % (al contado o con hipoteca del 70 %).',
      '- Emprendedor: cuando junta el capital recomendado + 6 meses de costos, funda una SRL y contrata un gerente con delegación.',
      '', '## Ajustes de balance de la versión 1.2 (a partir de estas mediciones)', '',
      '- Inmuebles de entrada: siempre hay a la venta al menos una cochera (≤ $26.000) y un estudio (≤ $60.000), además de 3 opciones ≤ $90.000. Antes lo más barato solía estar en cientos de miles.',
      '- Hipoteca mínima de $15.000: las cocheras y estudios baratos se compran al contado (evita apalancar compras chicas).',
      '- Holding: sin subsidiarias cuesta ~$135/mes (antes ~$750) y cada subsidiaria suma ~$180; aviso claro al crearla y alerta del Asesor si queda vacía.',
      '- Etapa 4: cuentan también inmuebles y cuentas con gestor como inversión (el estilo inmobiliario se trababa).',
      '- Etapa 6: la parte de las ganancias de tus empresas cuenta como ingreso pasivo (el emprendedor tardaba 12–14 años; ahora 5–8).',
      '- Etapa 10: ahora se puede alcanzar (empresas o inmuebles en 2 jurisdicciones).',
      '- Ningún estilo tarda más de 1 año y medio en salir de la supervivencia (prueba automática).',
      '', '## Ajustes de balance de la versión 1.4', '',
      '- Etapa 7 (Magnate regional): antes pedía $1.000.000 a precios de hoy y una empresa con ganancias sí o sí. Con 30 años de bots, el ejecutivo, el inversionista y el inmobiliario nunca llegaban y el emprendedor tardaba 19 años: entre la etapa 6 y la 7 pasaban 10–25 años sin nada nuevo. Ahora pide $500.000 a precios de hoy y una empresa con ganancias **o** ingresos pasivos que cubran todos tus gastos. Resultado (30 años, origen técnico): emprendedor 9,9 años, inversionista 12,9, inmobiliario 21,3, ejecutivo 21,8.',
      '- Riesgo empresarial medido (8 partidas por rubro, 10 años): fundando con capital para 6 meses de costos y un gerente, quebraron 2 de 40 partidas del bot emprendedor; fundando solo con el costo de apertura quebraron las 33 que llegaron a fundarse (consultora 8, cafetería 4, minimercado 7, software 8, muebles 6). Al fundar, el juego ahora dice que con menos de 3 meses de caja casi todas quiebran y que lo prudente son 6.');
    writeFileSync('docs/BALANCE.md', lines.join('\n') + '\n');
  });
});

describe('Balance · jugador nuevo que explora antes de postularse (1.4)', () => {
  // La auditoría temía que quien lee antes de postularse cayera en atrasos el primer mes.
  for (const bg of ['egresado', 'herencia'] as BackgroundId[]) {
    it(`${bg}: sin atrasos en los primeros 4 meses aunque tarde 3 semanas en postularse`, () => {
      const r = runBot('ejecutivo', bg, `nov-${bg}`, 0.4, { waitDays: 21, earlyWindow: 120 });
      expect(r.earlyArrears).toBe(0);
    });
  }
});

/**
 * Bots de 40 y 80 años (opcional, lento): URT_LONG=1 npx vitest run tests/balance.test.ts
 * Escribe docs/BALANCE_LARGO.md con las etapas 7 a 12 y el patrimonio real.
 */
describe.runIf(!!process.env.URT_LONG)('Balance largo · etapas altas y patrimonio real', () => {
  const rows: string[] = [];
  for (const style of STYLES) {
    it(`${style} · 60 años`, () => {
      const years = Number(process.env.URT_LONG_YEARS ?? 60);
      const r = runBot(style, 'tecnico', `long-${style}`, years) as ReturnType<typeof runBot> & { realNetWorth?: number };
      const cells = [7, 8, 9, 10, 11, 12].map((n) => (r.stageDays[n] !== undefined ? (r.stageDays[n] / 365).toFixed(1) : '—'));
      rows.push(`| ${style} | ${years} | ${cells.join(' | ')} | $${Math.round(r.finalNetWorth / 100).toLocaleString('en-US')} | E${r.finalStage} |`);
      expect(r.finalNetWorth).toBeGreaterThan(0);
    }, 900_000);
  }
  afterAll(() => {
    writeFileSync('docs/BALANCE_LARGO.md', ['# Balance largo (bots, origen técnico)', '', 'Años de juego hasta cada etapa (umbrales a precios de hoy). "—" = no la alcanzó.', '', '| Estilo | Años simulados | E7 | E8 | E9 | E10 | E11 | E12 | Patrimonio final (nominal) | Etapa final |', '|---|---|---|---|---|---|---|---|---|---|', ...rows, ''].join('\n'));
  });
});
