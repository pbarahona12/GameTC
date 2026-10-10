import type { GameState } from '../state';
import { computeMetrics, Metrics } from '../reports/metrics';
import { fmtMoney, fmtPct } from '../format';
import { statementRemaining, minRemaining, cardBalance, effectiveApr } from '../finance/creditCard';
import { savingsRate, depositRate } from '../finance/banking';
import { projectCurrentYear, taxesOutstanding, residence } from '../tax/taxEngine';
import { jurisdictionById } from '../../content/jurisdictions';
import { medicalRisk } from '../world';
import { formatDate, dayOf, dateOf } from '../time/calendar';
import { BANK_BY_ID } from '../../content/banks';
import { roundCents, usd } from '../money';
import { insuranceCost } from '../finance/budget';
import { analyzeCompany, portfolioInsights } from '../business/advisor';
import { analyzeWorld } from './advisorWorld';

/**
 * Asesor basado en reglas verificables. Cada recomendación separa:
 * - HECHOS: cifras leídas del libro mayor y del estado actual.
 * - ESTIMACIONES: proyecciones calculadas con supuestos explícitos.
 * - RECOMENDACIONES: opciones con ventajas, riesgos y qué pasa si no hacés nada.
 * El asesor nunca ejecuta acciones por su cuenta.
 */
export type Severity = 'critical' | 'warning' | 'opportunity' | 'info';
export type AdvisorCategory = 'liquidez' | 'deuda' | 'credito' | 'ahorro' | 'impuestos' | 'carrera' | 'bienestar' | 'empresa' | 'inversiones' | 'inmuebles' | 'legal' | 'economia';

export const CATEGORY_NAMES: Record<AdvisorCategory, string> = {
  liquidez: 'Liquidez', deuda: 'Deuda', credito: 'Crédito', ahorro: 'Ahorro', impuestos: 'Impuestos', carrera: 'Carrera', bienestar: 'Bienestar', empresa: 'Empresas',
  inversiones: 'Inversiones', inmuebles: 'Inmuebles', legal: 'Legal', economia: 'Economía',
};

export interface DataPoint {
  label: string;
  value: string;
  kind: 'hecho' | 'estimación';
}

export interface AdvisorOption {
  label: string;
  pros: string;
  cons: string;
  tab?: 'home' | 'career' | 'finance' | 'reports' | 'business' | 'invest' | 'more';
  /** Subsección de destino. */
  sub?: string;
}

export interface Insight {
  id: string;
  severity: Severity;
  category: AdvisorCategory;
  title: string;
  what: string;
  why: string;
  data: DataPoint[];
  consequence: string;
  timeframe?: string;
  options: AdvisorOption[];
  ifNothing: string;
  uncertainty?: string;
  term?: string;
}

const H = (label: string, value: string): DataPoint => ({ label, value, kind: 'hecho' });
const E = (label: string, value: string): DataPoint => ({ label, value, kind: 'estimación' });
const months = (x: number) => (x === Infinity ? '∞' : x < 1 ? `${Math.round(x * 30)} días` : `${x.toFixed(1)} meses`);

export function analyze(state: GameState, m: Metrics = computeMetrics(state)): Insight[] {
  const out: Insight[] = [];
  const b = state.ledger.balances;
  const job = state.career.job;
  const finEdu = state.skills.finEdu.level;
  const riskSkill = state.skills.risk.level;

  // 1. Pista de aterrizaje (runway)
  if (m.runwayMonths !== null && m.runwayMonths < 6) {
    const [lo0, hi0] = m.runwayRange!;
    const widen = finEdu >= 15 ? 1 : 1.12;
    const lo = lo0 / widen;
    const hi = hi0 * widen;
    const critical = m.runwayMonths < 2;
    out.push({
      id: 'runway', severity: critical ? 'critical' : 'warning', category: 'liquidez', term: 'liquidez',
      title: critical ? '⚠️ ALERTA DE LIQUIDEZ' : '⚠️ Tu efectivo se está agotando',
      what: `Si tus ingresos y gastos actuales se mantienen, te quedarías sin efectivo en aproximadamente ${months(m.runwayMonths)}.`,
      why: job ? 'Tus salidas mensuales (gastos, deudas y estudios) superan lo que cobrás.' : 'No tenés ingresos recurrentes y seguís pagando gastos fijos.',
      data: [
        H('Liquidez disponible', fmtMoney(m.liquid)),
        E('Ingreso neto mensual esperado', fmtMoney(m.expectedNetPay + m.passiveMonthly)),
        H('Gastos recurrentes', fmtMoney(m.recurringMonthly)),
        H('Pagos de deuda', fmtMoney(m.debtPayments)),
        ...(m.tuitionMonthly ? [H('Matrículas', fmtMoney(m.tuitionMonthly))] : []),
        E('Déficit mensual', fmtMoney(-m.expectedMonthlyNet)),
      ],
      consequence: 'Al agotarse el efectivo, los pagos se cargan a la tarjeta y luego quedan como atrasos con recargos; tu estrés y tu puntaje crediticio empeoran.',
      timeframe: `Entre ${months(lo)} y ${months(hi)}`,
      uncertainty: `Rango calculado con gastos entre −5 % y +10 % de lo presupuestado${finEdu < 15 ? ' (se ajusta con Educación financiera nivel 15)' : ''}.${riskSkill >= 10 ? ` Escenario pesimista con un imprevisto de ${fmtMoney(roundCents(m.recurringMonthly))}: ${months(Math.max(0, m.liquid - m.recurringMonthly) / Math.max(1, -m.expectedMonthlyNet))}.` : ''}`,
      options: [
        ...(!job ? [{ label: 'Postularte a varios empleos a la vez', pros: 'Es la forma más directa de generar ingresos.', cons: 'Cada postulación tarda 3–10 días y puede ser rechazada.', tab: 'career' as const }] : []),
        { label: 'Bajar tu estilo de vida', pros: `Reduce gastos fijos todos los meses.`, cons: 'La mudanza cuesta medio alquiler y un estilo austero aumenta el estrés.', tab: 'finance' },
        { label: 'Pedir un préstamo', pros: 'Da tiempo inmediato.', cons: 'No resuelve el déficit: agrega cuotas e intereses. Sin ingresos solo se consiguen montos pequeños y caros.', tab: 'finance' },
      ],
      ifNothing: 'Se acumularán atrasos, recargos y reportes negativos. Con dos alquileres atrasados, serás desalojado a una vivienda más barata.',
    });
  }

  // 2. Atrasos
  if (b.arrears > 0) {
    out.push({
      id: 'arrears', severity: 'critical', category: 'deuda', term: 'mora',
      title: '⛔ Tenés pagos vencidos',
      what: `Debés ${fmtMoney(b.arrears)} en gastos que no pudiste pagar (con recargos incluidos).`,
      why: 'Algún gasto recurrente llegó cuando no había fondos en ninguna cuenta ni cupo en la tarjeta.',
      data: [H('Atrasos', fmtMoney(b.arrears)), H('Cuenta corriente', fmtMoney(b.checking)), H('Veces con atraso', String(state.credit.arrearsEvents))],
      consequence: 'Los bancos rechazan nuevos créditos mientras tengas atrasos y, si superan dos alquileres, perdés la vivienda.',
      options: [
        { label: 'Pagar los atrasos desde Finanzas → Presupuesto', pros: 'Elimina el riesgo de desalojo y reabre el acceso al crédito.', cons: 'Reduce tu liquidez de inmediato.', tab: 'finance' },
      ],
      ifNothing: 'Los atrasos se mantienen, bloquean crédito y aumentan tu estrés cada mes.',
    });
  }

  // 3. Préstamo en impago
  for (const l of state.bank.loans.filter((x) => x.status === 'default')) {
    out.push({
      id: `default-${l.id}`, severity: 'critical', category: 'deuda', term: 'prestamo',
      title: '🚨 Préstamo en impago',
      what: `El préstamo con ${BANK_BY_ID[l.bankId].name} está en impago con saldo ${fmtMoney(l.balance)}.`,
      why: 'Se acumularon 3 cuotas seguidas sin pagar.',
      data: [H('Saldo', fmtMoney(l.balance)), H('Cuotas impagas totales', String(l.missedTotal)), H('Puntaje crediticio', String(state.credit.score))],
      consequence: 'El banco embarga el 20 % de tu salario neto y tu puntaje queda muy dañado durante años.',
      options: [{ label: 'Amortizar anticipadamente', pros: 'Cada pago reduce el saldo que sigue generando intereses.', cons: 'Requiere liquidez.', tab: 'finance' }],
      ifNothing: 'El interés y los recargos siguen capitalizándose.',
    });
  }

  // 4. Tarjeta: resumen por vencer
  const card = state.bank.card;
  if (card.dueDay >= 0) {
    const remaining = statementRemaining(state);
    const minLeft = minRemaining(state);
    const daysLeft = card.dueDay - state.day;
    if (remaining > 0 && daysLeft <= 7) {
      const interestIfMin = roundCents((remaining - minLeft) * effectiveApr(state) / 12);
      out.push({
        id: 'card-due', severity: b.checking < minLeft ? 'critical' : 'warning', category: 'credito', term: 'tarjeta_credito',
        title: '💳 Vence tu tarjeta',
        what: `El resumen vence el ${formatDate(card.dueDay)} (en ${daysLeft} días). Faltan ${fmtMoney(remaining)} para pagarlo completo; el mínimo pendiente es ${fmtMoney(minLeft)}.`,
        why: 'Cada mes el banco emite un resumen con fecha de pago.',
        data: [H('Saldo del resumen', fmtMoney(card.statementBalance)), H('Pagado', fmtMoney(card.paidSinceStatement)), H('Cuenta corriente', fmtMoney(b.checking)), E('Intereses si pagás solo el mínimo', fmtMoney(interestIfMin) + '/mes aprox.')],
        consequence: 'Pagar menos del total genera intereses; pagar menos del mínimo agrega un recargo y un reporte negativo.',
        timeframe: `${daysLeft} días`,
        options: [
          { label: 'Pagar el total', pros: 'Cero intereses y mejor puntaje.', cons: 'Usa más liquidez hoy.', tab: 'finance' },
          { label: 'Pagar el mínimo', pros: 'Protege tu liquidez.', cons: `El resto genera intereses al ${fmtPct(effectiveApr(state))} anual.`, tab: 'finance' },
          { label: 'Activar débito automático', pros: 'Nunca te olvidás.', cons: 'Necesitás fondos en la cuenta corriente al vencimiento.', tab: 'finance' },
        ],
        ifNothing: card.autopay !== 'none' ? 'El débito automático intentará pagar al vencimiento.' : 'Se cobrará un recargo por mora y bajará tu puntaje.',
      });
    }
  }

  // 5. Deuda de tarjeta con intereses
  const cardBal = cardBalance(state);
  if (card.revolving && cardBal > 0) {
    out.push({
      id: 'card-revolving', severity: 'warning', category: 'deuda', term: 'interes',
      title: '📉 Estás pagando intereses de tarjeta',
      what: `Tu tarjeta tiene ${fmtMoney(cardBal)} de saldo y perdiste el período de gracia.`,
      why: 'El último resumen no se pagó completo: los intereses corren sobre el saldo promedio diario.',
      data: [H('Saldo', fmtMoney(cardBal)), H('Tasa anual', fmtPct(effectiveApr(state))), E('Costo anual si el saldo se mantiene', fmtMoney(roundCents(cardBal * effectiveApr(state))))],
      consequence: 'Es una de las deudas más caras: cada mes pagás intereses sobre intereses.',
      options: [
        { label: 'Pagar la tarjeta completa', pros: 'Recuperás el período de gracia en el siguiente ciclo.', cons: 'Reduce liquidez.', tab: 'finance' },
        { label: 'Refinanciar con un préstamo más barato', pros: `Un préstamo bancario suele costar mucho menos que ${fmtPct(effectiveApr(state))}.`, cons: 'Agrega una cuota fija y una consulta de crédito.', tab: 'finance' },
      ],
      ifNothing: 'El saldo seguirá generando intereses mes a mes.',
    });
  }

  // 6. Utilización
  if (m.cardUtilization > 0.3) {
    out.push({
      id: 'utilization', severity: 'warning', category: 'credito', term: 'utilizacion_credito',
      title: '📊 Utilización de tarjeta alta',
      what: `Estás usando el ${Math.round(m.cardUtilization * 100)} % de tu límite.`,
      why: 'Los puntajes crediticios penalizan usar más del 30 % del límite disponible.',
      data: [H('Saldo', fmtMoney(cardBal)), H('Límite', fmtMoney(card.limit)), H('Puntaje actual', String(state.credit.score))],
      consequence: 'Un puntaje más bajo encarece los préstamos (prima de riesgo más alta) o los bloquea.',
      options: [{ label: 'Pagar parte del saldo antes del corte (día 25)', pros: 'El resumen reporta un saldo menor.', cons: 'Usa liquidez.', tab: 'finance' }],
      ifNothing: 'Tu puntaje seguirá penalizado mientras la utilización sea alta.',
    });
  }

  // 7. Ratio deuda/ingreso
  if (m.dti !== null && m.dti > 0.36) {
    out.push({
      id: 'dti', severity: m.dti > 0.5 ? 'critical' : 'warning', category: 'deuda', term: 'ratio_deuda_ingreso',
      title: '📉 ADVERTENCIA DE DEUDA',
      what: `Tus obligaciones de deuda mensuales representan el ${Math.round(m.dti * 100)} % de tu ingreso bruto.`,
      why: 'La suma de cuotas y pagos mínimos es alta respecto a tu salario.',
      data: [H('Pagos de deuda', fmtMoney(m.debtPayments)), H('Ingreso bruto', fmtMoney(m.monthlyGross))],
      consequence: 'Los bancos rechazan nuevas solicitudes por encima del 36–50 % y el margen ante imprevistos es mínimo.',
      options: [
        { label: 'Amortizar la deuda más cara primero', pros: 'Método avalancha: minimiza el interés total.', cons: 'Tarda más en eliminar una deuda completa.', tab: 'finance' },
        { label: 'Buscar un empleo mejor pagado', pros: 'Mejora el ratio por el denominador.', cons: 'Requiere requisitos y tiempo.', tab: 'career' },
      ],
      ifNothing: 'Cualquier imprevisto puede empujarte a atrasos.',
    });
  }

  // 8. Fondo de emergencia
  if (job && m.emergencyMonths < 1 && m.expectedMonthlyNet > 0) {
    out.push({
      id: 'emergency', severity: 'opportunity', category: 'ahorro', term: 'fondo_emergencia',
      title: '💡 Construí tu fondo de emergencia',
      what: `Tu ahorro cubre ${months(m.emergencyMonths)} de gastos esenciales. Lo recomendable es 3 a 6 meses.`,
      why: 'Tenés superávit mensual pero poco dinero apartado.',
      data: [H('Ahorro + depósitos', fmtMoney(b.savings + b.term_deposits)), H('Gastos esenciales/mes', fmtMoney(m.essentialMonthly)), E('Superávit mensual estimado', fmtMoney(m.expectedMonthlyNet))],
      consequence: 'Sin colchón, un imprevisto médico o perder el empleo te obliga a endeudarte.',
      timeframe: m.expectedMonthlyNet > 0 ? `Con tu superávit, 3 meses de colchón te llevarían ~${months(Math.max(0, m.essentialMonthly * 3 - b.savings - b.term_deposits) / m.expectedMonthlyNet)}` : undefined,
      options: [{ label: 'Transferir una parte del sueldo al ahorro cada mes', pros: `Genera ${fmtPct(savingsRate(state), 2)} anual y queda disponible.`, cons: 'Menos dinero para gastos discrecionales.', tab: 'finance' }],
      ifNothing: 'Seguirás expuesto a que un imprevisto se convierta en deuda cara.',
    });
  }

  // 9. Efectivo ocioso en cuenta corriente
  const idle = b.checking - Math.max(m.recurringMonthly * 1.5, 50000);
  if (idle > 50000 && savingsRate(state) > 0.005) {
    out.push({
      id: 'idle-cash', severity: 'opportunity', category: 'ahorro', term: 'costo_oportunidad',
      title: '💡 OPORTUNIDAD: dinero ocioso',
      what: `Tenés ${fmtMoney(idle)} en la cuenta corriente por encima de lo que necesitás para mes y medio de gastos.`,
      why: 'La cuenta corriente no paga intereses.',
      data: [H('Cuenta corriente', fmtMoney(b.checking)), H('Tasa de la cuenta de ahorro', fmtPct(savingsRate(state), 2)), E('Intereses que dejás de ganar al año', fmtMoney(roundCents(idle * savingsRate(state))))],
      consequence: 'Es un costo de oportunidad: además la inflación reduce su poder de compra.',
      options: [
        { label: 'Mover el excedente a la cuenta de ahorro', pros: 'Genera intereses y sigue disponible (con barrido automático).', cons: 'Ninguno relevante.', tab: 'finance' },
        { label: 'Abrir un depósito a plazo', pros: `Hasta ${fmtPct(depositRate(state, 24), 2)} anual.`, cons: 'Cancelarlo antes implica perder intereses y pagar comisión.', tab: 'finance' },
      ],
      ifNothing: `Perdés aproximadamente ${fmtMoney(roundCents(idle * savingsRate(state) / 12))} por mes en intereses.`,
    });
  }

  // 10. Ahorro grande sin invertir
  if (m.emergencyMonths > 6 && b.savings > 300000) {
    const excess = b.savings - m.essentialMonthly * 6;
    const gain = roundCents(excess * (depositRate(state, 12) - savingsRate(state)));
    if (excess > 50000 && gain > 0) {
      out.push({
        id: 'savings-excess', severity: 'opportunity', category: 'ahorro', term: 'deposito_plazo',
        title: '💡 Tu ahorro supera tu fondo de emergencia',
        what: `Tenés ${fmtMoney(excess)} por encima de 6 meses de gastos esenciales en la cuenta de ahorro.`,
        why: 'Ese excedente no necesita estar disponible al instante.',
        data: [H('Tasa ahorro', fmtPct(savingsRate(state), 2)), H('Tasa depósito 12 meses', fmtPct(depositRate(state, 12), 2)), E('Ganancia extra en un año', fmtMoney(gain))],
        consequence: 'Estás renunciando a rendimiento adicional sin ganar seguridad.',
        options: [{ label: 'Depósito a plazo a 12 meses', pros: 'Tasa fija más alta.', cons: 'Menos liquidez.', tab: 'finance' }],
        ifNothing: 'Tu dinero sigue seguro, pero rinde menos.',
      });
    }
  }

  // 11. Impuestos
  const owed = taxesOutstanding(state);
  if (owed > 0) {
    const f = state.tax.filings.find((x) => x.status === 'due')!;
    out.push({
      id: 'tax-due', severity: state.day > f.dueDay ? 'critical' : b.checking + b.savings < owed ? 'warning' : 'info', category: 'impuestos', term: 'declaracion_fiscal',
      title: state.day > f.dueDay ? '🏛️ Impuestos vencidos' : '🏛️ Impuestos por pagar',
      what: `Debés ${fmtMoney(owed)} de la declaración ${f.year}. Vence el ${formatDate(f.dueDay)}.`,
      why: 'Tus retenciones del año no alcanzaron para cubrir el impuesto total (por ejemplo, por intereses sin retención o bonos).',
      data: [H('Impuesto calculado', fmtMoney(f.taxAfterCredits)), H('Retenido', fmtMoney(f.withheld)), H('Multas acumuladas', fmtMoney(f.penalties))],
      consequence: (() => { const jj = jurisdictionById(f.jurisdiction ?? state.tax.jurisdiction); return `Pagar tarde suma una multa del ${fmtPct(jj.latePenaltyRate, 0)} y ${fmtPct(jj.lateMonthlyInterest, 2)} mensual.`; })(),
      options: [{ label: 'Pagar desde Informes → Impuestos', pros: 'Evita multas.', cons: 'Reduce liquidez.', tab: 'reports' }],
      ifNothing: 'Se intentará cobrar automáticamente al vencimiento; si no hay fondos, se aplican multas.',
    });
  } else if (job) {
    const { projected } = projectCurrentYear(state);
    if (projected.balance > 20000) {
      out.push({
        id: 'tax-projection', severity: 'info', category: 'impuestos', term: 'retencion',
        title: '🧾 Podrías deber impuestos en la próxima declaración',
        what: `Si el año sigue así, la declaración de enero daría un saldo a pagar de unos ${fmtMoney(projected.balance)}.`,
        why: 'Hay ingresos sin retención (intereses, pagos extraordinarios) o tu retención mensual quedó corta.',
        data: [E('Impuesto anual proyectado', fmtMoney(projected.taxAfterCredits)), E('Retenciones proyectadas', fmtMoney(projected.withheld))],
        consequence: (() => { const d = residence(state).filingDeadline; return `Tendrás que pagar esa diferencia antes del ${formatDate(dayOf(dateOf(state.day).y + 1, d.month, d.day))}.`; })(),
        options: [
          { label: 'Aumentar el aporte a jubilación', pros: 'Es deducible y reduce la base imponible.', cons: 'Ese dinero queda inmovilizado.', tab: 'finance' },
          { label: 'Reservar el monto en ahorro', pros: 'Evitás sorpresas.', cons: 'Ninguno relevante.', tab: 'finance' },
        ],
        ifNothing: 'Llegará el cobro en abril; si no tenés fondos habrá multa.',
        uncertainty: 'Estimación que asume salario constante y no incluye bonos futuros.',
      });
    }
  }

  // 12. Bienestar
  const a = state.player.attributes;
  if (a.stress >= 75) {
    out.push({
      id: 'stress', severity: 'warning', category: 'bienestar', term: 'estres',
      title: '🥵 Estrés muy alto',
      what: `Tu estrés está en ${a.stress}/100.`,
      why: 'Horas de trabajo y estudio, estilo de vida austero, deudas y atrasos suman estrés cada mes.',
      data: [H('Estrés', `${a.stress}/100`), H('Salud', `${Math.round(a.health)}/100`), ...(job ? [H('Desempeño laboral', `${job.performance}/100`)] : [])],
      consequence: 'Sobre 60, el estrés reduce tu desempeño; sobre 70, deteriora tu salud y aumenta la probabilidad de imprevistos médicos.',
      options: [
        { label: 'Reducir horas de estudio', pros: 'Baja la carga semanal.', cons: 'Tu formación avanza más lento.', tab: 'career' },
        { label: 'Mejorar el estilo de vida', pros: 'Alivia el estrés mensualmente.', cons: 'Más gastos fijos.', tab: 'finance' },
      ],
      ifNothing: 'Tu desempeño puede caer hasta poner en riesgo tu empleo.',
    });
  }
  const med = medicalRisk(state);
  if (!med.insured && (a.health < 50 || m.liquid < 150000)) {
    out.push({
      id: 'insurance', severity: 'warning', category: 'bienestar', term: 'seguro',
      title: '🩺 Sin seguro médico',
      what: `No tenés seguro médico: un problema de salud se paga completo (${fmtMoney(usd(300 * state.macro.priceIndex), { decimals: false })} a ${fmtMoney(usd(2500 * state.macro.priceIndex), { decimals: false })}).`,
      why: job ? 'Tu empleo no incluye seguro.' : 'No tenés empleo con cobertura.',
      data: [E('Probabilidad mensual de imprevisto', fmtPct(med.probability, 1)), H('Salud', `${Math.round(a.health)}/100`), H('Liquidez', fmtMoney(m.liquid))],
      consequence: 'Un imprevisto puede consumir gran parte de tu liquidez.',
      options: [{ label: 'Contratar seguro privado', pros: `Reduce el costo de un imprevisto a un copago de ${fmtMoney(usd(40 * state.macro.priceIndex), { decimals: false })}–${fmtMoney(usd(150 * state.macro.priceIndex), { decimals: false })}.`, cons: `Cuesta ${fmtMoney(insuranceCost(state))} al mes.`, tab: 'finance' }],
      ifNothing: 'Asumís el riesgo completo.',
    });
  }

  // 13. Carrera
  if (job && job.performance < 40) {
    out.push({
      id: 'performance', severity: job.performance < 30 ? 'critical' : 'warning', category: 'carrera', term: 'desempeno',
      title: '📉 Desempeño laboral bajo',
      what: `Tu desempeño es ${job.performance}/100.`,
      why: 'Depende de tus habilidades clave frente a lo que exige el puesto, tu experiencia, estrés y salud.',
      data: [H('Desempeño', `${job.performance}/100`), H('Estrés', `${a.stress}/100`), H('Meses consecutivos bajo 30', String(job.lowPerfMonths))],
      consequence: 'Tres meses seguidos bajo 30 terminan en despido. Además no habrá aumento ni bono.',
      options: [{ label: 'Formarte en las habilidades clave del puesto', pros: 'Sube el desempeño de forma sostenida.', cons: 'Cuesta dinero y horas.', tab: 'career' }],
      ifNothing: 'Riesgo de despido.',
    });
  }
  if (m.expectedNetPay > 0 && m.recurringMonthly > m.expectedNetPay * 0.7) {
    out.push({
      id: 'lifestyle', severity: 'warning', category: 'liquidez', term: 'presupuesto',
      title: '🏠 Tu estilo de vida consume casi todo tu sueldo',
      what: `Tus gastos recurrentes son el ${Math.round((m.recurringMonthly / m.expectedNetPay) * 100)} % de tu sueldo neto.`,
      why: 'Una regla práctica es no superar el 50–70 % en gastos fijos para poder ahorrar.',
      data: [H('Gastos recurrentes', fmtMoney(m.recurringMonthly)), E('Sueldo neto', fmtMoney(m.expectedNetPay))],
      consequence: 'Casi no queda margen para ahorrar, invertir o absorber imprevistos.',
      options: [{ label: 'Bajar un nivel de estilo de vida', pros: 'Libera flujo de caja todos los meses.', cons: 'Costo de mudanza y algo más de estrés.', tab: 'finance' }],
      ifNothing: 'Tu patrimonio crecerá muy lento.',
    });
  }
  out.push(...analyzeWorld(state));
  for (const co of state.companies) out.push(...analyzeCompany(state, co));
  out.push(...portfolioInsights(state));
  const order: Record<Severity, number> = { critical: 0, warning: 1, opportunity: 2, info: 3 };
  return out.sort((x, y) => order[x.severity] - order[y.severity]);
}
