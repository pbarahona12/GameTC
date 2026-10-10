import { monthlyFixed } from '../business/common';
import type { GameState } from '../state';
import type { Insight, DataPoint } from './advisor';
import { computeMetrics } from '../reports/metrics';
import { balanceSheet } from '../reports/statements';
import { fmtMoney, fmtPct } from '../format';
import { positions, investmentsValue } from '../invest/portfolio';
import { propertyReport, marketRent } from '../realestate/realestate';
import { projectCurrentYear, compareJurisdictions, taxObligations, residence } from '../tax/taxEngine';
import { legalRiskSummary, heatLabel, openCases, convictionProbability } from '../legal/legal';
import { formatDate } from '../time/calendar';
import { PHASES, SECTOR_CYCLICALITY } from '../economy/economy';
import { isOpen } from '../business/common';
import { SECTOR_NAMES } from '../../content/stocks';
import { roundCents } from '../money';
import { activeMandates, mandateSummary } from '../invest/managed';

const H = (label: string, value: string): DataPoint => ({ label, value, kind: 'hecho' });
const E = (label: string, value: string): DataPoint => ({ label, value, kind: 'estimación' });

/**
 * Asesor avanzado: analiza inversiones, inmuebles, obligaciones
 * fiscales, riesgos legales, insolvencia personal y el ciclo económico. Todas
 * las cifras salen de la partida; las estimaciones dicen qué suponen.
 */
export function analyzeWorld(state: GameState): Insight[] {
  const out: Insight[] = [];
  const m = computeMetrics(state);
  const bs = balanceSheet(state);
  const b = state.ledger.balances;
  const nw = bs.netWorth;

  // ------------------------------------------------ Insolvencia personal (obligaciones de 90 días vs recursos)
  const due90 = taxObligations(state, 90).filter((o) => o.kind !== 'empresa').reduce((s, o) => s + Math.max(0, o.amount ?? 0), 0);
  const service90 = m.debtPayments * 3;
  const inflow90 = Math.max(0, m.expectedNetPay + m.rentIncome) * 3;
  const living90 = m.recurringMonthly * 3;
  const gap = due90 + service90 + living90 - inflow90 - m.liquid;
  if (gap > 0 && (m.debtPayments > 0 || due90 > 0)) {
    out.push({
      id: 'personal-insolvency', severity: 'critical', category: 'liquidez', term: 'solvencia',
      title: '🚨 Riesgo de insolvencia personal en 90 días',
      what: `Tus obligaciones de los próximos 3 meses superan tu liquidez y tus ingresos esperados en ${fmtMoney(gap)}.`,
      why: 'Se suman cuotas (préstamos, tarjeta e hipotecas), impuestos y multas que vencen, y tus gastos de vida.',
      data: [H('Liquidez', fmtMoney(m.liquid)), E('Cuotas de deuda (3 meses)', fmtMoney(service90)), E('Impuestos y multas que vencen', fmtMoney(due90)), E('Gastos de vida (3 meses)', fmtMoney(living90)), E('Ingresos esperados (3 meses)', fmtMoney(inflow90))],
      consequence: 'Atrasos, recargos, caída del puntaje crediticio y, con hipotecas, riesgo de embargo del inmueble.',
      timeframe: 'Próximos 90 días.',
      options: [
        { label: 'Vender inversiones líquidas (fondos, acciones)', pros: 'Liquidez inmediata.', cons: 'Podés vender en un mal momento y pagar impuesto a la ganancia.', tab: 'invest' },
        { label: 'Reducir gastos de vida', pros: 'Mejora el flujo todos los meses.', cons: 'Costo de mudanza.', tab: 'finance' },
        { label: 'Pedir un plan de pagos para multas', pros: 'Evita embargos.', cons: '10 % de recargo.', tab: 'more', sub: 'legal' },
      ],
      ifNothing: 'Aparecerán atrasos en pocas semanas.',
      uncertainty: 'Supone ingresos y gastos como los actuales; no incluye ventas de activos ni ingresos extraordinarios.',
    });
  }

  // ------------------------------------------------ Endeudamiento total
  if (bs.totalAssets > 0 && m.debt / bs.totalAssets > 0.6 && m.debt > 0) {
    out.push({
      id: 'debt-assets', severity: m.debt / bs.totalAssets > 0.85 ? 'critical' : 'warning', category: 'deuda', term: 'apalancamiento',
      title: '⚖️ Tus deudas son una parte muy alta de tus activos',
      what: `Debés el ${fmtPct(m.debt / bs.totalAssets, 0)} del valor de todo lo que tenés.`,
      why: 'Hipotecas, préstamos, tarjeta, impuestos y multas pendientes frente a tus activos.',
      data: [H('Deudas totales', fmtMoney(m.debt)), H('Activos totales', fmtMoney(bs.totalAssets)), H('Hipotecas', fmtMoney(m.mortgages))],
      consequence: 'Con mucho apalancamiento, una caída del 20 % en tus activos puede dejarte con patrimonio negativo.',
      options: [
        { label: 'Amortizar la deuda más cara primero', pros: 'Reduce intereses y riesgo.', cons: 'Menos liquidez.', tab: 'finance' },
        { label: 'Vender un activo poco rentable', pros: 'Reduce deuda y riesgo.', cons: 'Costos de venta.', tab: 'invest' },
      ],
      ifNothing: 'Quedás expuesto a subas de tasas y caídas de precios.',
    });
  }

  // ------------------------------------------------ Gestor de inversiones: resultados frente al índice
  for (const md of activeMandates(state)) {
    const sm = mandateSummary(state, md);
    const years = (state.day - md.startDay) / 365;
    if (years < 1) continue;
    const gap = sm.totalReturn - sm.benchReturn;
    if (gap < -0.03 * years) {
      out.push({
        id: `mandate-under-${md.id}`, severity: 'warning', category: 'inversiones', term: 'gestor_inversiones',
        title: `${md.managerName} rinde menos que el índice`,
        what: `En ${years.toFixed(1)} años tu cuenta rindió ${fmtPct(sm.totalReturn, 1)} contra ${fmtPct(sm.benchReturn, 1)} del Fondo Índice (sin gestor).`,
        why: 'Sus comisiones y sus elecciones no están agregando valor frente a comprar todo el mercado.',
        data: [H('Rendimiento de la cuenta', fmtPct(sm.totalReturn, 1)), H('Fondo Índice en el mismo período', fmtPct(sm.benchReturn, 1)), H('Comisiones pagadas', fmtMoney(Math.round(md.mgmtFeesPaid + md.perfFeesPaid))), H('Años de experiencia del gestor', String(sm.hire?.pro.experience ?? '—'))],
        consequence: 'Si sigue así, pierde frente a la alternativa más simple y barata.',
        timeframe: 'Revisalo este año.',
        options: [
          { label: 'Capacitar al gestor', pros: 'Mejora su calidad real.', cons: 'Cuesta dinero y no garantiza mejores resultados.', tab: 'invest', sub: 'gestor' },
          { label: 'Cambiar de gestor o pasar al Fondo Índice', pros: 'Comisión mucho menor.', cons: 'Vender realiza ganancias o pérdidas (impuestos).', tab: 'invest', sub: 'funds' },
        ],
        ifNothing: 'La diferencia puede seguir acumulándose… o revertirse: un año malo no prueba que sea malo.',
        uncertainty: 'Uno o dos años es poco tiempo para juzgar a un gestor: la suerte pesa mucho en plazos cortos.',
      });
    }
  }

  // ------------------------------------------------ Concentración de la cartera
  const inv = investmentsValue(state);
  const stocks = positions(state, 'stocks');
  if (inv > 50000) {
    const top = [...stocks].sort((x, y) => y.value - x.value)[0];
    if (top && top.value / inv > 0.3) {
      const st = state.stocks.stocks.find((s) => s.id === top.id);
      out.push({
        id: 'concentration-stock', severity: 'warning', category: 'inversiones', term: 'diversificacion',
        title: `🎯 Cartera concentrada en ${top.id}`,
        what: `${st?.name ?? top.id} representa el ${fmtPct(top.value / inv, 0)} de tus inversiones financieras.`,
        why: 'Una sola empresa puede caer mucho por malos resultados, un evento del sector o una quiebra.',
        data: [H('Valor en esa acción', fmtMoney(top.value)), H('Cartera financiera total', fmtMoney(inv)), H('Resultado no realizado', `${fmtMoney(top.unrealized)} (${fmtPct(top.unrealizedPct, 1)})`), ...(st ? [H('Beta', st.beta.toFixed(2)), H('Sector', SECTOR_NAMES[st.sector])] : [])],
        consequence: `Si cae 40 %, perderías ${fmtMoney(Math.round(top.value * 0.4))} (${fmtPct((top.value * 0.4) / Math.max(1, nw), 1)} de tu patrimonio).`,
        options: [
          { label: 'Diversificar con un fondo índice', pros: 'Reparte el riesgo en todo el mercado.', cons: 'Renunciás a parte del potencial de esa acción.', tab: 'invest', sub: 'funds' },
          { label: 'Proteger con un stop loss u OCO', pros: 'Limita la pérdida máxima.', cons: 'Puede venderse en una caída pasajera.', tab: 'invest', sub: 'pro' },
        ],
        ifNothing: 'Tu resultado dependerá de una sola empresa.',
      });
    }
  }
  const bigShare = (label: string, value: number, id: string, tab: 'invest' | 'business') => {
    if (nw > 100000 && value / nw > 0.75) {
      out.push({
        id, severity: 'warning', category: 'inversiones', term: 'diversificacion',
        title: `🧺 El ${fmtPct(value / nw, 0)} de tu patrimonio está en ${label}`,
        what: `Casi toda tu riqueza depende de un solo tipo de activo.`,
        why: 'Cuando un mercado entero cae (inmuebles en una corrección, empresas en una recesión), cae casi todo tu patrimonio a la vez.',
        data: [H(`Valor en ${label}`, fmtMoney(value)), H('Patrimonio neto', fmtMoney(nw))],
        consequence: 'Mayor volatilidad de tu patrimonio y menor liquidez.',
        options: [{ label: 'Reinvertir parte de las ganancias en otras clases de activos', pros: 'Diversifica.', cons: 'Costos de transacción.', tab }],
        ifNothing: 'Tu patrimonio seguirá concentrado.',
      });
    }
  };
  bigShare('inmuebles', b.real_estate, 'concentration-re', 'invest');
  bigShare('empresas propias', b.business_equity, 'concentration-biz', 'business');

  // ------------------------------------------------ Caída de la cartera
  const cost = [...stocks, ...positions(state, 'funds'), ...positions(state, 'mogul'), ...positions(state, 'bonds')].reduce((s, p) => s + p.cost, 0);
  if (cost > 0 && inv / cost - 1 < -0.15) {
    out.push({
      id: 'portfolio-drawdown', severity: 'warning', category: 'inversiones', term: 'drawdown',
      title: `📉 Tu cartera cae ${fmtPct(1 - inv / cost, 0)} respecto de lo invertido`,
      what: `Invertiste ${fmtMoney(cost)} y hoy vale ${fmtMoney(inv)}.`,
      why: `La economía está en ${PHASES[state.macro.phase].name.toLowerCase()}; ${state.macro.events.filter((e) => e.startDay <= state.day && e.endDay >= state.day).map((e) => e.name).join(', ') || 'sin eventos especiales activos'}.`,
      data: [H('Costo', fmtMoney(cost)), H('Valor actual', fmtMoney(inv)), H('Pérdida no realizada', fmtMoney(inv - cost))],
      consequence: 'Si vendés ahora, la pérdida se realiza (y compensa ganancias para impuestos). Si esperás, puede recuperarse… o no.',
      options: [
        { label: 'Revisar el análisis de cada acción', pros: 'Distinguís caídas del mercado de problemas de la empresa.', cons: 'Tu estimación tiene error según tu habilidad.', tab: 'invest', sub: 'pro' },
        { label: 'Vender perdedoras para compensar ganancias del año', pros: 'Reduce el impuesto del año.', cons: 'Perdés la recuperación si luego suben.', tab: 'invest' },
      ],
      ifNothing: 'El resultado dependerá de la evolución del mercado.',
      uncertainty: 'Nadie puede predecir el rebote con certeza.',
    });
  }

  // ------------------------------------------------ Holdings sin subsidiarias (1.2)
  for (const h of state.companies.filter((c) => c.sector === 'holding' && (c.status === 'active' || c.status === 'insolvent'))) {
    const subs = state.companies.filter((c) => c.parentId === h.id && (c.status === 'active' || c.status === 'insolvent')).length;
    if (subs > 0 || state.day - h.foundedDay < 30) continue;
    const cost = monthlyFixed(state, h);
    out.push({
      id: `holding-empty-${h.id}`, severity: 'warning', category: 'empresa', term: 'holding',
      title: `🏛️ ${h.name} no tiene subsidiarias`,
      what: `Paga ~${fmtMoney(cost)} por mes (domicilio, servicios y administración) y no tiene ingresos propios.`,
      why: 'Una holding solo gana a través de las empresas que controla.',
      data: [H('Costo fijo mensual', fmtMoney(cost)), H('Caja de la holding', fmtMoney(h.ledger.balances.cash)), H('Subsidiarias', '0')],
      consequence: `En un año son ~${fmtMoney(cost * 12)} de pérdida.`,
      options: [
        { label: 'Transferirle una SRL o corporación tuya', pros: 'Empieza a cumplir su función (dividendos sin retención, préstamos intragrupo).', cons: 'Cada subsidiaria suma costos de gestión.', tab: 'business' },
        { label: 'Fundar o comprar una empresa a nombre de la holding', pros: 'Usa la caja que ya tiene.', cons: 'Arriesgás ese capital.', tab: 'business' },
        { label: 'Cerrar la holding', pros: 'Deja de generar costos.', cons: 'Perdés lo pagado en la constitución.', tab: 'business' },
      ],
      ifNothing: 'La caja de la holding se irá consumiendo mes a mes.',
    });
  }

  // ------------------------------------------------ Inmuebles
  for (const p of state.realEstate.properties.filter((x) => x.owner.kind === 'personal')) {
    const mort = state.realEstate.mortgages.find((x) => x.id === p.mortgageId && x.status === 'activa');
    if (p.usedBy === null && !p.lease && p.vacantSince !== null && state.day - p.vacantSince > 60 && !p.renovation && !p.development && p.type !== 'terreno') {
      const mr = marketRent(state, p);
      out.push({
        id: `vacant-${p.id}`, severity: 'warning', category: 'inmuebles', term: 'vacancia',
        title: `🏚️ ${p.name}: ${Math.round((state.day - p.vacantSince) / 30)} meses vacío`,
        what: `No genera alquiler pero sí gastos${mort ? ` y la cuota de hipoteca (${fmtMoney(mort.payment)}/mes)` : ''}.`,
        why: p.askingRent > mr * 1.05 ? `Pedís ${fmtMoney(p.askingRent)} y el mercado paga ${fmtMoney(mr)}.` : p.listedForRent ? 'La vacancia del mercado es alta o el estado del inmueble es bajo.' : 'No está publicado para alquilar.',
        data: [H('Alquiler pedido', fmtMoney(p.askingRent)), E('Alquiler de mercado', fmtMoney(mr)), H('Estado', `${Math.round(p.condition)}/100`), H('Administración', p.management)],
        consequence: `Cada mes vacío cuesta ~${fmtMoney(mr)} de ingreso perdido.`,
        options: [
          { label: 'Bajar el alquiler al valor de mercado', pros: 'Se alquila más rápido.', cons: 'Menor renta mensual.', tab: 'invest', sub: 'realestate' },
          { label: 'Contratar una inmobiliaria', pros: '+50 % de probabilidad de conseguir inquilino.', cons: '8 % del alquiler.', tab: 'invest', sub: 'realestate' },
        ],
        ifNothing: 'Seguirá generando gastos sin ingresos.',
      });
    }
    if (mort && p.appraisal > 0 && mort.balance / p.appraisal > 0.9) {
      out.push({
        id: `ltv-${p.id}`, severity: mort.balance > p.appraisal ? 'critical' : 'warning', category: 'inmuebles', term: 'ltv',
        title: `🏦 ${p.name}: la hipoteca es ${fmtPct(mort.balance / p.appraisal, 0)} de su valor`,
        what: mort.balance > p.appraisal ? 'Debés más de lo que vale el inmueble (patrimonio negativo en esa propiedad).' : 'Casi no tenés capital propio en el inmueble.',
        why: 'La tasación cayó o compraste con mucha financiación.',
        data: [H('Saldo de la hipoteca', fmtMoney(mort.balance)), H('Tasación', fmtMoney(p.appraisal)), H('Tasa', `${fmtPct(mort.apr, 2)} (${mort.rateType})`)],
        consequence: `Venderlo no alcanzaría para cancelar la deuda.${mort.recourse ? ' Con recurso, en un embargo seguirías debiendo la diferencia.' : ''}`,
        options: [{ label: 'Amortizar capital', pros: 'Baja el riesgo y los intereses.', cons: 'Usa liquidez.', tab: 'invest', sub: 'realestate' }],
        ifNothing: 'Dependés de que el precio se recupere.',
      });
    }
    if (mort && mort.rateType === 'variable' && state.macro.policyRate + mort.spread > mort.apr + 0.0075) {
      out.push({
        id: `variable-${p.id}`, severity: 'warning', category: 'inmuebles', term: 'tasa_variable',
        title: `📈 La cuota variable de ${p.name} va a subir`,
        what: `Tu tasa actual es ${fmtPct(mort.apr, 2)}; con la tasa de política de hoy sería ${fmtPct(state.macro.policyRate + mort.spread, 2)} en la próxima revisión anual.`,
        why: 'El banco central subió la tasa.',
        data: [H('Cuota actual', fmtMoney(mort.payment)), E('Tasa en la próxima revisión', fmtPct(state.macro.policyRate + mort.spread, 2))],
        consequence: 'Mayor cuota mensual.',
        options: [{ label: 'Amortizar parte antes de la revisión', pros: 'Reduce la cuota nueva.', cons: 'Usa liquidez.', tab: 'invest', sub: 'realestate' }],
        ifNothing: 'La cuota se ajustará automáticamente.',
      });
    }
    const rep = propertyReport(state, p);
    if (p.usedBy === null && p.monthly.length >= 6 && rep.monthlyCashFlow < 0) {
      out.push({
        id: `negative-cf-${p.id}`, severity: 'warning', category: 'inmuebles', term: 'cash_on_cash',
        title: `💸 ${p.name} te cuesta dinero cada mes`,
        what: `Flujo mensual estimado: ${fmtMoney(rep.monthlyCashFlow)} (alquiler − gastos − impuesto − cuota).`,
        why: rep.occupancy < 0.8 ? 'Tuvo meses vacío.' : 'La cuota y los gastos superan el alquiler.',
        data: [H('Ingreso neto anual', fmtMoney(rep.annualNoi)), H('Cuotas anuales', fmtMoney(rep.annualDebtService)), H('Ocupación (12 meses)', fmtPct(rep.occupancy, 0)), H('Rentabilidad neta', fmtPct(rep.netYield, 1))],
        consequence: 'Solo es buena inversión si la revalorización compensa el flujo negativo.',
        options: [{ label: 'Revisar alquiler, administración o vender', pros: 'Frena la pérdida de caja.', cons: 'Vender tiene costos.', tab: 'invest', sub: 'realestate' }],
        ifNothing: 'Seguirás aportando dinero todos los meses.',
      });
    }
    if (p.lease && p.lease.unpaidMonths >= 1) {
      out.push({
        id: `tenant-${p.id}`, severity: 'warning', category: 'inmuebles', term: 'desalojo',
        title: `🧾 ${p.name}: inquilino moroso`,
        what: `${p.lease.tenant} debe ${p.lease.unpaidMonths} mes(es). Con 2 meses impagos empieza un desalojo.`,
        why: `El desempleo está en ${fmtPct(state.macro.unemployment, 1)}: sube la morosidad.`,
        data: [H('Alquiler', fmtMoney(p.lease.rent)), H('Meses impagos', String(p.lease.unpaidMonths))],
        consequence: 'Meses sin cobrar y costos legales.',
        options: [{ label: 'Contratar un abogado', pros: 'Desalojo más rápido y barato.', cons: 'Honorario mensual.', tab: 'more', sub: 'pros' }],
        ifNothing: 'Si no paga el próximo mes, se inicia el desalojo automáticamente.',
      });
    }
  }

  // ------------------------------------------------ Impuestos
  const proj = projectCurrentYear(state);
  const cgt = proj.projected.capitalGainsTax ?? 0;
  if (cgt > 50000) {
    out.push({
      id: 'cgt-reserve', severity: m.liquid < cgt ? 'warning' : 'info', category: 'impuestos', term: 'ganancia_capital',
      title: `🧾 Reservá ${fmtMoney(cgt)} para ganancias de capital`,
      what: `Tus ventas de este año generan impuesto a pagar en la declaración (${residence(state).name}).`,
      why: 'Las ganancias realizadas (precio − costo) tributan al cerrar el año; no hay retención.',
      data: [H('Ganancias realizadas (corto plazo)', fmtMoney(state.tax.ytd.gainsShort ?? 0)), H('Ganancias realizadas (largo plazo)', fmtMoney(state.tax.ytd.gainsLong ?? 0)), H('Comisiones deducibles', fmtMoney(state.tax.ytd.investFees ?? 0)), E('Impuesto estimado', fmtMoney(cgt))],
      consequence: 'Si al vencimiento no tenés el dinero: multa y recargos.',
      options: [{ label: 'Separar el dinero en la cuenta de ahorro', pros: 'Evita gastarlo.', cons: 'Ninguna.', tab: 'finance' }],
      ifNothing: 'Deberás pagarlo en el próximo vencimiento.',
      uncertainty: 'Si vendés con pérdida antes de fin de año, el impuesto baja.',
    });
  }
  const cmp = compareJurisdictions(state);
  const mine = cmp.find((c) => c.id === state.tax.jurisdiction);
  const best = [...cmp].sort((x, y) => x.tax - y.tax)[0]; // tax ya incluye ganancias de capital
  if (mine && best && best.id !== mine.id && mine.tax - best.tax > 1000000) {
    out.push({
      id: 'jurisdiction-opportunity', severity: 'opportunity', category: 'impuestos', term: 'residencia_fiscal',
      title: `🌍 Con tus ingresos de este año, residir en ${best.name} te ahorraría impuestos`,
      what: `Impuesto estimado: ${fmtMoney(mine.tax)} en ${mine.name} vs ${fmtMoney(best.tax)} en ${best.name}.`,
      why: 'Cada jurisdicción grava distinto salarios, alquileres y ganancias de capital. Es planificación fiscal legal.',
      data: cmp.map((c) => E(c.name, fmtMoney(c.tax))),
      consequence: 'También cambia tu costo de vida, el trámite tiene costo y algunas exigen patrimonio mínimo.',
      options: [{ label: 'Comparar jurisdicciones', pros: 'Menos impuestos de forma legal.', cons: 'Costo de vida y trámite.', tab: 'more', sub: 'tax' }],
      ifNothing: 'Seguís tributando en tu residencia actual.',
      uncertainty: 'Supone ingresos como los del año en curso.',
    });
  }

  // ------------------------------------------------ Legal
  const lr = legalRiskSummary(state);
  for (const c of openCases(state)) {
    const p = convictionProbability(state, c);
    out.push({
      id: `case-${c.id}`, severity: 'critical', category: 'legal', term: 'defensa_legal',
      title: `⚖️ Proceso ${c.kind === 'fiscal' ? 'fiscal' : 'penal'} abierto: ${c.title}`,
      what: `Etapa: ${c.stage}. Próximo paso: ${formatDate(c.nextStepDay)}.`,
      why: c.origin,
      data: [H('Abogado', c.lawyerHireId ? 'Asignado' : 'Defensor público'), H('Preparación de la defensa', `${Math.round(c.defense)}/100`), ...(c.reviewed ? [E('Probabilidad de condena (según tu abogado)', fmtPct(p, 0))] : [])],
      consequence: 'Multas, restitución, decomiso, antecedentes y posible prisión (ficticia).',
      options: [{ label: 'Gestionar la defensa', pros: 'Un buen abogado y preparación bajan la probabilidad de condena.', cons: 'Honorarios; nunca garantiza la absolución.', tab: 'more', sub: 'legal' }],
      ifNothing: 'El caso avanzará con un defensor público.',
    });
  }
  if (lr.heat >= 35 && lr.hiddenActs > 0) {
    out.push({
      id: 'legal-heat', severity: lr.heat >= 60 ? 'critical' : 'warning', category: 'legal', term: 'sospecha',
      title: `🕵️ Sospecha de las autoridades: ${heatLabel(lr.heat).toLowerCase()}`,
      what: `Tenés ${lr.hiddenActs} acto(s) irregular(es) sin descubrir con un beneficio total de ${fmtMoney(lr.exposure)}.`,
      why: 'Actos ilegales recientes, depósitos grandes o un patrimonio que crece mucho más que tus ingresos declarados.',
      data: [H('Nivel de sospecha', `${Math.round(lr.heat)}/100`), H('Actos ocultos', String(lr.hiddenActs)), H('Antecedentes', String(lr.record))],
      consequence: 'Mayor probabilidad de investigación y auditoría cada mes.',
      options: [
        { label: 'Regularizar voluntariamente las evasiones', pros: 'Elimina el riesgo penal de esas declaraciones.', cons: 'Pagás el impuesto + 20 %.', tab: 'more', sub: 'legal' },
        { label: 'Dejar de sumar actos irregulares', pros: 'La sospecha baja ~4 % por mes.', cons: 'Renunciás a esos beneficios.', tab: 'more', sub: 'legal' },
      ],
      ifNothing: 'El riesgo se mantiene hasta que los actos prescriban.',
    });
  }
  if (lr.pendingFines > 0) {
    const f = state.legal.fines.filter((x) => x.balance > 0).sort((x, y) => x.dueDay - y.dueDay)[0];
    out.push({
      id: 'fines', severity: f.garnishing ? 'critical' : 'warning', category: 'legal', term: 'multa',
      title: `🧾 Multas pendientes: ${fmtMoney(lr.pendingFines)}`,
      what: f.garnishing ? 'Una multa venció: se están embargando tus cuentas e inversiones.' : `La próxima vence el ${formatDate(f.dueDay)}.`,
      why: f.label,
      data: [H('Total pendiente', fmtMoney(lr.pendingFines)), H('Liquidez', fmtMoney(m.liquid))],
      consequence: 'Embargos y ventas forzadas de inversiones con descuento.',
      options: [{ label: 'Pagar o pedir un plan de 12 cuotas', pros: 'Evita embargos.', cons: 'Plan con 10 % de recargo.', tab: 'more', sub: 'legal' }],
      ifNothing: 'Al vencer, empieza el embargo.',
    });
  }
  if (state.legal.prison) {
    out.push({
      id: 'prison', severity: 'info', category: 'legal', term: 'prision',
      title: `⛓️ Cumplís una condena hasta el ${formatDate(state.legal.prison.until)}`,
      what: 'No podés operar en mercados ni fundar o comprar. Tus inversiones y empresas siguen funcionando.',
      why: 'Sentencia judicial.',
      data: [H('Días restantes', String(state.legal.prison.until - state.day))],
      consequence: 'Tus gastos de vida siguen corriendo.',
      options: [{ label: 'Revisar tus finanzas para que alcancen', pros: 'Evitás atrasos durante la condena.', cons: 'Ninguna.', tab: 'finance' }],
      ifNothing: 'Con buena conducta podés salir antes.',
    });
  }

  // ------------------------------------------------ Ciclo económico
  const cyclical = state.companies.filter((c) => isOpen(c) && (SECTOR_CYCLICALITY[c.sector] ?? 1) >= 1.2);
  if ((state.macro.phase === 'recesion' || state.macro.phase === 'desaceleracion') && (cyclical.length || m.debt > m.liquid * 3)) {
    out.push({
      id: 'cycle', severity: state.macro.phase === 'recesion' ? 'warning' : 'info', category: 'economia', term: 'ciclo_economico',
      title: `${PHASES[state.macro.phase].icon} La economía está en ${PHASES[state.macro.phase].name.toLowerCase()}`,
      what: PHASES[state.macro.phase].description,
      why: `PIB ${fmtPct(state.macro.gdpGrowth, 1)}, desempleo ${fmtPct(state.macro.unemployment, 1)}, confianza ${state.macro.confidence.toFixed(2)}, tasa ${fmtPct(state.macro.policyRate, 2)}.`,
      data: [H('Empresas cíclicas tuyas', cyclical.map((c) => c.name).join(', ') || 'ninguna'), H('Deuda / liquidez', m.liquid > 0 ? `${(m.debt / m.liquid).toFixed(1)}×` : '—')],
      consequence: 'Ventas más bajas en sectores cíclicos, más morosidad, precios de activos en baja y crédito más caro.',
      options: [
        { label: 'Reforzar la caja de las empresas cíclicas', pros: 'Aguantan la caída de ventas.', cons: 'Inmoviliza capital.', tab: 'business' },
        { label: 'Mantener liquidez para oportunidades', pros: 'En recesión los activos se abaratan.', cons: 'Rinde poco mientras tanto.', tab: 'invest' },
      ],
      ifNothing: 'El impacto dependerá de cuánto dure la fase.',
      uncertainty: 'La duración de cada fase es incierta (entre un mínimo y un máximo de meses).',
    });
  }
  void roundCents;
  return out;
}
