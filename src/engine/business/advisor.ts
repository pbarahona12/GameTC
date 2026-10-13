import type { GameState } from '../state';
import type { Insight } from '../advisor/advisor';
import type { Company } from './types';
import { coMetrics, coIncomeStatement } from './reports';
import { daysToBankruptcy, INSOLVENCY_GRACE_DAYS } from './finance';
import { sectorOf, isOpen, workingAssets, equipDef, px } from './common';
import { itemPlan } from './inventory';
import { refPrice } from './operations';
import { LEGAL_FORM_BY_ID } from '../../content/sectors';
import { fmtMoney, fmtPct } from '../format';
import { formatDate } from '../time/calendar';
import { roundCents } from '../money';

const H = (label: string, value: string) => ({ label, value, kind: 'hecho' as const });
const E = (label: string, value: string) => ({ label, value, kind: 'estimación' as const });
const d = (x: number) => (x === Infinity ? 'sin límite' : x < 1 ? 'menos de 1 día' : `${Math.round(x)} días`);

/**
 * Asesor empresarial: reglas verificables sobre los datos reales de cada empresa.
 * Todas las proyecciones usan promedios recientes de la propia simulación y lo aclaran.
 */
export function analyzeCompany(state: GameState, co: Company): Insight[] {
  if (!isOpen(co) || state.day < co.openDay) return [];
  const out: Insight[] = [];
  const m = coMetrics(state, co);
  const sec = sectorOf(co);
  const lf = LEGAL_FORM_BY_ID[co.legalForm];
  const id = (x: string) => `co${co.id}-${x}`;
  const tab = 'business' as const;
  const young = m.daysOpen < 30;

  // 1. Insolvencia y quiebra
  const left = daysToBankruptcy(state, co);
  if (left !== null) {
    out.push({
      id: id('insolvent'), severity: 'critical', category: 'empresa', term: 'quiebra',
      title: `🚨 ${co.name}: insolvente, quiebra en ${left} días`,
      what: `Tiene ${fmtMoney(m.arrears)} de deudas vencidas sin pagar. Si no se regulariza antes del ${formatDate(state.day + left)}, se declarará la quiebra y se liquidará.`,
      why: 'La caja no alcanzó para pagar obligaciones (sueldos, proveedores, alquiler, impuestos o cuotas).',
      data: [H('Deudas vencidas', fmtMoney(m.arrears)), H('Caja', fmtMoney(m.cash)), H('Plazo de gracia', `${INSOLVENCY_GRACE_DAYS} días`), E('Consumo de caja diario (90 días)', fmtMoney(Math.max(0, m.burnPerDay)))],
      consequence: lf.limitedLiability
        ? 'Por ser de responsabilidad limitada perderías tu inversión, y además pagarías cualquier préstamo que hayas garantizado personalmente.'
        : `Por ser ${lf.name.toLowerCase()}, tendrías que pagar con tu dinero personal las deudas que la venta de activos no cubra.`,
      timeframe: `${left} días`,
      options: [
        { label: `Aportar al menos ${fmtMoney(m.arrears)} de capital`, pros: 'Paga las deudas vencidas y sale de la insolvencia de inmediato.', cons: 'Usa tu dinero personal; si el negocio sigue perdiendo, volverá a pasar.', tab },
        { label: 'Cerrar de forma ordenada ahora', pros: 'La venta voluntaria recupera más que la quiebra (inventario 50 % vs 30 %, equipos 60 % vs 40 %).', cons: 'Se pierde el negocio.', tab },
        { label: 'Reducir costos (personal, marketing) y subir precios', pros: 'Ataca la causa.', cons: 'Tarda en generar caja; puede no alcanzar a tiempo.', tab },
      ],
      ifNothing: 'Quiebra automática al terminar el plazo, con venta forzada de activos.',
    });
  }

  // 2. Pista de caja
  if (!young && m.runwayDays !== null && m.runwayDays < 90 && left === null) {
    const [lo, hi] = m.runwayRange!;
    const expected = co.receivables.filter((r) => r.dueDay <= state.day + 30).reduce((s, r) => s + r.amount, 0);
    out.push({
      id: id('runway'), severity: m.runwayDays < 30 ? 'critical' : 'warning', category: 'empresa', term: 'flujo_caja',
      title: m.runwayDays < 30 ? `⚠️ RIESGO DE QUIEBRA: ${co.name}` : `⚠️ ALERTA DE LIQUIDEZ: ${co.name}`,
      what: `Al ritmo de los últimos 90 días, la caja de ${co.name} se agotaría en aproximadamente ${d(m.runwayDays)}.`,
      why: 'Los pagos de la empresa (sueldos, alquiler, insumos, marketing) superan lo que cobra.',
      data: [
        H('Caja', fmtMoney(m.cash)),
        E('Consumo neto diario (promedio 90 días)', fmtMoney(m.burnPerDay)),
        H('Nómina mensual con cargas', fmtMoney(m.payrollMonthly)),
        H('Costos fijos mensuales', fmtMoney(m.fixedMonthly)),
        ...(expected ? [H('Cobros de clientes en los próximos 30 días', fmtMoney(expected))] : []),
        ...(m.breakEvenRevenue ? [E('Ventas de equilibrio mensuales', fmtMoney(m.breakEvenRevenue))] : []),
      ],
      consequence: 'Sin caja, los pagos quedan como deudas vencidas y la empresa entra en insolvencia (60 días hasta la quiebra).',
      timeframe: `Entre ${d(lo)} y ${d(hi)}`,
      uncertainty: 'Limitaciones: promedio de los últimos 90 días (±15–20 %). No anticipa estacionalidad, cambios de precios de la competencia, averías ni tus decisiones futuras. Los cobros pendientes pueden alargar el plazo.',
      options: [
        { label: 'Aportar capital desde tus finanzas personales', pros: 'Compra tiempo sin intereses.', cons: 'Arriesgás más dinero propio.', tab },
        { label: 'Pedir un préstamo empresarial', pros: 'Mantiene tu liquidez personal.', cons: 'Agrega cuotas e intereses; sin ganancias solo se consigue con garantía personal.', tab },
        { label: 'Recortar costos o ajustar precios', pros: 'Mejora el flujo de forma sostenida.', cons: 'Recortar personal reduce capacidad; subir precios reduce demanda.', tab },
      ],
      ifNothing: 'Insolvencia y posible quiebra.',
    });
  }

  // 3. Pérdidas recurrentes
  if (m.consecutiveLossMonths >= 2) {
    // Una frase, no la lista de cada mes (con muchos meses en rojo era ilegible).
    const losses = co.history.slice(-m.consecutiveLossMonths).map((h) => h.netIncome);
    const total = losses.reduce((a, b) => a + b, 0);
    const recent = losses.slice(-3).map((x) => fmtMoney(x, { decimals: false })).join(', ');
    const last = losses.length > 3 ? `${fmtMoney(total, { decimals: false })} en total (promedio ${fmtMoney(Math.round(total / losses.length), { decimals: false })} por mes); los últimos tres: ${recent}` : recent;
    out.push({
      id: id('losses'), severity: m.consecutiveLossMonths >= 4 ? 'critical' : 'warning', category: 'empresa', term: 'punto_equilibrio',
      title: `📉 ${co.name}: ${m.consecutiveLossMonths} meses seguidos con pérdidas`,
      what: `Resultados netos recientes: ${last}.`,
      why: m.breakEvenRevenue && m.revenue30 < m.breakEvenRevenue ? `Las ventas (${fmtMoney(m.revenue30)} en 30 días) están por debajo del punto de equilibrio estimado (${fmtMoney(m.breakEvenRevenue)}).` : 'Los costos crecieron más que el beneficio bruto.',
      data: [H('Ventas últimos 30 días', fmtMoney(m.revenue30)), H('Margen bruto', fmtPct(m.grossMargin30)), ...(m.breakEvenRevenue ? [E('Punto de equilibrio mensual', fmtMoney(m.breakEvenRevenue))] : []), H('Cuota de mercado', fmtPct(m.share))],
      consequence: 'Cada mes con pérdidas reduce el patrimonio de la empresa y tu patrimonio personal (método de participación).',
      options: [
        { label: 'Invertir en marketing para ganar cuota', pros: 'Más clientes sobre la misma estructura de costos.', cons: 'Gasto inmediato con resultado incierto.', tab },
        ...(sec.products.length ? [{ label: 'Revisar precios', pros: 'Un precio mayor mejora el margen si la demanda es poco elástica.', cons: `En este sector la elasticidad es ${sec.products[0].elasticity}: subir precios reduce ventas.`, tab }] : []),
        { label: 'Ajustar el personal a la demanda', pros: 'Baja la nómina.', cons: 'Indemnizaciones y menor capacidad.', tab },
      ],
      ifNothing: 'Las pérdidas continuarán hasta agotar la caja.',
    });
  }

  // 4. Exceso de inventario y vencimientos
  if (sec.items.length && !young) {
    for (const it of sec.items) {
      const p = itemPlan(state, co, it.id);
      if (p.usage > 0 && p.coverDays > Math.max(45, (it.shelfLifeDays ?? 999) * 0.8)) {
        out.push({
          id: id(`inv-${it.id}`), severity: it.shelfLifeDays && p.coverDays > it.shelfLifeDays ? 'warning' : 'opportunity', category: 'empresa', term: 'inventario',
          title: `📦 EXCESO DE INVENTARIO: ${p.name} en ${co.name}`,
          what: `Las existencias de ${p.name} alcanzan para ${d(p.coverDays)} al ritmo actual de consumo.`,
          why: 'Las compras superan el consumo real.',
          data: [H('Existencias', `${p.onHand.toFixed(1)} ${p.unit}`), H('Consumo diario (14 días)', `${p.usage.toFixed(1)} ${p.unit}`), H('Valor inmovilizado', fmtMoney(p.value)), E('Costo de almacenamiento mensual', fmtMoney(p.holdingCost)), ...(it.shelfLifeDays ? [H('Vida útil', `${it.shelfLifeDays} días (más con refrigeración)`)] : [])],
          consequence: it.shelfLifeDays ? 'Parte del stock puede vencer antes de venderse y convertirse en pérdida.' : 'Capital inmovilizado que podría usarse en otra cosa, más costo de almacenamiento.',
          options: [{ label: 'Reducir la cantidad de reposición', pros: 'Libera caja.', cons: 'Si bajás demasiado, riesgo de faltantes.', tab }],
          ifNothing: 'Seguís pagando almacenamiento y arriesgando mermas.',
        });
      }
      if (p.expiringSoon > 0 && p.usage > 0 && p.expiringSoon > p.usage * 2) {
        out.push({
          id: id(`exp-${it.id}`), severity: 'warning', category: 'empresa', term: 'mermas',
          title: `🗑️ ${co.name}: ${p.name} por vencer`,
          what: `${p.expiringSoon.toFixed(1)} ${p.unit} vencen en 2 días o menos y el consumo diario es ${p.usage.toFixed(1)}.`,
          why: 'Se compró más de lo que se vende antes de la fecha de vencimiento.',
          data: [H('Por vencer', `${p.expiringSoon.toFixed(1)} ${p.unit}`), H('Consumo diario', `${p.usage.toFixed(1)} ${p.unit}`)],
          consequence: 'Se descartará y se registrará como merma.',
          options: [{ label: 'Activar una promoción temporal', pros: 'Acelera la venta.', cons: 'Reduce el margen 10 %.', tab }, { label: 'Comprar refrigeración', pros: 'Alarga la vida útil 60–80 %.', cons: 'Inversión en equipo.', tab }],
          ifNothing: 'Pérdida por vencimiento.',
        });
      }
    }
  }

  if (sec.model === 'holding') return out; // una holding no tiene ventas, inventario ni producción propios
  // 5. Ventas perdidas
  if (!young && m.lostShare > 0.1) {
    const lostRev = co.stats.slice(-30).reduce((s, x) => {
      let r = 0;
      for (const k of Object.keys(x.lost)) r += (x.lost[k] ?? 0) * (co.products.find((p) => p.id === k)?.price ?? 0);
      return s + r;
    }, 0);
    out.push({
      id: id('lost'), severity: 'opportunity', category: 'empresa', term: 'capacidad',
      title: `💡 OPORTUNIDAD: ${co.name} pierde ventas`,
      what: `No pudo atender el ${Math.round(m.lostShare * 100)} % de la demanda de los últimos 30 días.`,
      why: `Cuello de botella: ${m.lostReason || 'capacidad o inventario'}.`,
      data: [E('Ventas perdidas (30 días)', fmtMoney(roundCents(lostRev))), ...(m.utilization !== null ? [H('Uso de la capacidad', fmtPct(m.utilization))] : [])],
      consequence: 'Los clientes no atendidos se van a la competencia y la reputación baja.',
      options: [
        ...(m.lostReason.includes('falta') || m.lostReason.includes('stock') ? [{ label: sec.model === 'manufacturing' ? 'Aumentar el plan de producción o reponer insumos antes' : 'Subir el punto de pedido o la cantidad de reposición', pros: 'Menos faltantes.', cons: 'Más capital inmovilizado.', tab }] : []),
        { label: 'Contratar personal o comprar equipos', pros: 'Más capacidad.', cons: 'Más costos fijos: conviene si la demanda se mantiene.', tab },
      ],
      ifNothing: 'Seguirás dejando ventas sobre la mesa.',
    });
  }

  // 6. Gastos salariales elevados
  if (!young && m.wageShare !== null && m.wageShare > sec.benchmarks.wageShare + 0.12) {
    out.push({
      id: id('wages'), severity: 'warning', category: 'empresa', term: 'nomina',
      title: `👥 ${co.name}: gastos salariales elevados`,
      what: `Los sueldos y cargas representan el ${Math.round(m.wageShare * 100)} % de las ventas (referencia del sector: ${Math.round(sec.benchmarks.wageShare * 100)} %).`,
      why: m.utilization !== null && m.utilization < 0.6 ? `La capacidad se usa solo al ${Math.round(m.utilization * 100)} %: hay más personal del necesario.` : 'Las ventas no alcanzan para sostener la nómina actual.',
      data: [H('Nómina mensual con cargas', fmtMoney(m.payrollMonthly)), H('Ventas 30 días', fmtMoney(m.revenue30)), ...(m.utilization !== null ? [H('Uso de capacidad', fmtPct(m.utilization))] : [])],
      consequence: 'Reduce el margen y la caja cada mes.',
      options: [{ label: 'Ajustar la plantilla', pros: 'Baja la nómina.', cons: 'Indemnizaciones y moral del resto.', tab }, { label: 'Aumentar ventas con marketing', pros: 'Aprovecha la capacidad ociosa.', cons: 'Gasto con resultado incierto.', tab }],
      ifNothing: 'El margen seguirá presionado.',
    });
  }

  // 7. Caída de ventas
  if (m.salesTrend !== null && m.salesTrend < -0.15) {
    out.push({
      id: id('decline'), severity: 'warning', category: 'empresa', term: 'ingresos_vs_beneficio',
      title: `📉 ${co.name}: caída de ventas`,
      what: `Las ventas de los últimos 30 días cayeron ${Math.round(-m.salesTrend * 100)} % frente a los 30 anteriores.`,
      why: 'Puede deberse a estacionalidad, a precios de la competencia, a pérdida de reputación o a faltantes.',
      data: [H('Ventas 30 días', fmtMoney(m.revenue30)), H('30 días anteriores', fmtMoney(m.revenuePrev30)), H('Reputación', `${Math.round(co.reputation)}/100`), H('Conocimiento de marca', `${Math.round(co.awareness)}/100`)],
      consequence: 'Menos margen para cubrir los costos fijos.',
      options: [{ label: 'Comparar precios con la competencia (pestaña Mercado)', pros: 'Identifica si te quedaste caro.', cons: 'Bajar precios reduce el margen.', tab }],
      ifNothing: 'Si la caída no es estacional, continuará.',
    });
  }

  // 8. Precio por debajo del costo
  for (const ps of co.products) {
    const p = sec.products.find((x) => x.id === ps.id)!;
    let unit = 0;
    for (const r of p.recipe) {
      const lots = co.inventory.filter((l) => l.item === r.item);
      const q = lots.reduce((s, l) => s + l.qty, 0);
      const v = lots.reduce((s, l) => s + l.value, 0);
      if (q > 0) unit += (v / q) * r.qty;
    }
    unit += px(state, sec.variableCost);
    if (ps.active && unit > 0 && ps.price < unit) {
      out.push({
        id: id(`price-${ps.id}`), severity: 'critical', category: 'empresa', term: 'margen_bruto',
        title: `⛔ ${co.name}: ${p.name} se vende por debajo del costo`,
        what: `Precio ${fmtMoney(ps.price)} vs. costo directo estimado ${fmtMoney(roundCents(unit))}.`,
        why: 'Cada unidad vendida pierde dinero antes de pagar sueldos y alquiler.',
        data: [H('Precio', fmtMoney(ps.price)), E('Costo directo por unidad', fmtMoney(roundCents(unit))), H('Precio de referencia del mercado', fmtMoney(refPrice(state, p)))],
        consequence: 'Cuanto más vende, más pierde.',
        options: [{ label: 'Subir el precio por encima del costo', pros: 'Margen positivo.', cons: 'Menos demanda.', tab }],
        ifNothing: 'Pérdidas crecientes.',
      });
    }
  }

  // 9. Moral baja
  if (co.employees.length > 0 && m.morale < 45) {
    out.push({
      id: id('morale'), severity: 'warning', category: 'empresa', term: 'nomina',
      title: `😞 ${co.name}: moral del equipo baja`,
      what: `La moral promedio es ${Math.round(m.morale)}/100.`,
      why: 'Salarios por debajo del mercado, sueldos impagos o sobrecarga de trabajo.',
      data: [H('Moral promedio', `${Math.round(m.morale)}/100`), H('Empleados', String(co.employees.length))],
      consequence: 'Con moral menor a 40 aumentan las renuncias y el ausentismo, y cae la productividad.',
      options: [{ label: 'Subir salarios al nivel de mercado', pros: 'Retiene al equipo.', cons: 'Más nómina.', tab }, { label: 'Contratar un analista de RR. HH.', pros: '+5 moral por mes y menos rotación.', cons: 'Un sueldo más.', tab }],
      ifNothing: 'Renuncias en los próximos meses.',
    });
  }

  // 10. Facturas por vencer sin caja
  if (m.payablesDue7 > m.cash) {
    out.push({
      id: id('payables'), severity: 'warning', category: 'empresa', term: 'cuentas_por_pagar',
      title: `🧾 ${co.name}: facturas por vencer sin caja suficiente`,
      what: `En 7 días vencen ${fmtMoney(m.payablesDue7)} de proveedores y la caja es ${fmtMoney(m.cash)}.`,
      why: 'Se compró a crédito más de lo que se cobra en ese plazo.',
      data: [H('Vencimientos 7 días', fmtMoney(m.payablesDue7)), H('Caja', fmtMoney(m.cash))],
      consequence: 'Una factura impaga genera recargo y el proveedor deja de vender a crédito.',
      options: [{ label: 'Aportar capital o tomar un préstamo corto', pros: 'Evita la mora.', cons: 'Costo financiero o más dinero propio.', tab }],
      ifNothing: 'Mora con proveedores e insolvencia.',
    });
  }

  // 11. Equipos deteriorados
  const bad = workingAssets(state, co).filter((a) => a.condition < 40);
  if (bad.length) {
    out.push({
      id: id('assets'), severity: 'warning', category: 'empresa', term: 'depreciacion',
      title: `🔧 ${co.name}: equipos en mal estado`,
      what: `${bad.map((a) => equipDef(co, a.equipId).name).join(', ')} con condición menor a 40.`,
      why: `Política de mantenimiento: ${co.maintenance === 'none' ? 'ninguno' : co.maintenance === 'basic' ? 'básico' : 'preventivo'}.`,
      data: bad.map((a) => H(equipDef(co, a.equipId).name, `${Math.round(a.condition)}/100`)),
      consequence: 'La probabilidad de averías crece: el equipo queda fuera de servicio y la reparación cuesta 8 % de su valor.',
      options: [{ label: 'Pasar a mantenimiento preventivo', pros: 'Recupera la condición.', cons: 'Mayor costo mensual.', tab }],
      ifNothing: 'Averías más frecuentes.',
    });
  }
  return out;
}

/** Concentración del patrimonio personal en empresas propias. */
export function portfolioInsights(state: GameState): Insight[] {
  const out: Insight[] = [];
  const open = state.companies.filter(isOpen);
  if (!open.length) return out;
  const assets = Object.entries(state.ledger.balances).reduce((s, [k, v]) => (['cash_wallet', 'checking', 'savings', 'term_deposits', 'pension', 'tax_receivable', 'business_equity'].includes(k) ? s + v : s), 0);
  const share = assets > 0 ? state.ledger.balances.business_equity / assets : 0;
  if (share > 0.75 && assets > 0) {
    out.push({
      id: 'concentration', severity: 'info', category: 'empresa', term: 'diversificacion',
      title: '🧺 Patrimonio concentrado en tus empresas',
      what: `El ${Math.round(share * 100)} % de tus activos está invertido en ${open.length === 1 ? 'una sola empresa' : `${open.length} empresas`}.`,
      why: 'Aportaste la mayor parte de tu capital a los negocios.',
      data: [H('Participaciones en empresas', fmtMoney(state.ledger.balances.business_equity)), H('Activos personales totales', fmtMoney(assets))],
      consequence: 'Si el negocio va mal, tu patrimonio y tu liquidez personal caen juntos.',
      options: [{ label: 'Retirar dividendos para construir un fondo personal', pros: 'Diversifica el riesgo.', cons: 'Menos caja para crecer.', tab: 'business' }],
      ifNothing: 'Tu situación personal depende de un solo negocio.',
    });
  }
  void coIncomeStatement;
  return out;
}
