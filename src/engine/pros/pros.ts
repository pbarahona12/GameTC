import { FUND_BY_ID } from '../../content/funds';
import type { GameState } from '../state';
import type { Professional, ProKind, ProHire, AuditReport } from './types';
import { Cents, clamp, roundCents, usd } from '../money';
import { chance, randInt, randNormal, randRange } from '../rng';
import { ActionResult, FAIL, OK } from '../result';
import { fmtMoney, fmtPct } from '../format';
import { addLog } from '../log';
import { payExpense, spendable } from '../finance/payments';
import { coPay, isOpen, sectorOf } from '../business/common';
import { coPost, CO_CHART } from '../business/companyLedger';
import { gAudit } from '../ledger/core';
import { investmentsValue, positions } from '../invest/portfolio';
import { formatDate, addMonths, dateOf } from '../time/calendar';
import { closeMandatesOfHire } from '../invest/managed';
import { hiredPro } from './lookup';
import { taxObligations } from '../tax/taxEngine';
import { practice } from '../skills/skills';

/**
 * PROFESIONALES CONTRATABLES (opcionales). Cada uno tiene experiencia,
 * especialización, honorario, reputación pública y una calidad REAL de servicio
 * (oculta: la reputación la estima con error). Sus efectos son mecánicas reales:
 *
 * - Contador (personal): reclama deducciones documentales (depreciación e intereses
 *   de alquileres) y prepara el informe de obligaciones. En empresas: evita errores
 *   en la declaración y detecta faltantes de caja (desfalcos).
 * - Asesor financiero: reduce el error de las estimaciones de valor de acciones y
 *   prepara proyecciones de cartera (simulación Monte Carlo con datos reales).
 * - Abogado: inspección y negociación en compras de inmuebles, desalojos más
 *   rápidos y baratos, demandas laborales y DEFENSA en procesos judiciales.
 * - Auditor: revisa los libros de una empresa, detecta irregularidades y emite
 *   un informe; una auditoría limpia mejora la valoración (+10 % al múltiplo).
 * - Gerente: administra una empresa (delegación) con su habilidad real.
 * - Gestor de inversiones: administra una cuenta con tu dinero en el mercado real
 *   (ver invest/managed.ts); cobra comisión de gestión y de éxito.
 *
 * Todos los profesionales contratados ganan experiencia cada año y se pueden
 * capacitar (paga el jugador): su calidad real sube y sus efectos mejoran.
 */
const FIRST = ['Mariana', 'Esteban', 'Rocío', 'Federico', 'Inés', 'Gonzalo', 'Valentina', 'Rodrigo', 'Florencia', 'Joaquín', 'Natalia', 'Sebastián', 'Carolina', 'Ignacio', 'Julieta', 'Emilio'];
const LAST = ['Arriaga', 'Benítez', 'Cordero', 'Duarte', 'Escobar', 'Fuentes', 'Gallardo', 'Ibarra', 'Lozano', 'Montero', 'Núñez', 'Olivares', 'Pizarro', 'Robles', 'Serrano', 'Toledo'];

export const PRO_INFO: Record<ProKind, { name: string; icon: string; baseFee: number; feeUnit: string; specialties: string[]; what: string }> = {
  contador: { name: 'Contador', icon: '🧮', baseFee: 260, feeUnit: 'por mes', specialties: ['Impuestos personales', 'Empresas', 'Inmuebles'], what: 'Lleva registros, prepara informes y revisa tus obligaciones fiscales. Reclama deducciones que sin conocimientos contables se pierden.' },
  asesor: { name: 'Asesor financiero', icon: '📈', baseFee: 300, feeUnit: 'por mes (mínimo) o 1 % anual de tu cartera', specialties: ['Bolsa', 'Renta fija', 'Carteras diversificadas'], what: 'Analiza inversiones, compara riesgos y elabora proyecciones. Mejora la precisión de las estimaciones, pero nunca garantiza resultados.' },
  abogado: { name: 'Abogado', icon: '⚖️', baseFee: 420, feeUnit: 'por mes (anticipo) + honorarios por caso', specialties: ['Inmobiliario', 'Mercantil', 'Laboral', 'Penal'], what: 'Revisa contratos, asesora en disputas y te representa en procesos. Contratarlo no garantiza ganar un juicio.' },
  auditor: { name: 'Auditor', icon: '🔍', baseFee: 2800, feeUnit: 'por auditoría', specialties: ['Estados financieros', 'Forense', 'Cumplimiento'], what: 'Revisa los libros de una empresa, detecta irregularidades y emite un informe independiente.' },
  gestor: { name: 'Gestor de inversiones', icon: '🧑‍💼', baseFee: 0, feeUnit: 'comisiones sobre tu cuenta', specialties: ['Acciones de valor', 'Carteras balanceadas', 'Crecimiento'], what: 'Le das dinero y lo invierte por vos en acciones y fondos del mercado. Cuanto mejor capacitado y más experiencia tenga, mejor elige; nunca garantiza ganancias. Cobra una comisión anual sobre el valor y otra sobre las ganancias.' },
  gerente: { name: 'Gerente profesional', icon: '👔', baseFee: 2600, feeUnit: 'de sueldo mensual', specialties: ['Gastronomía', 'Comercio', 'Manufactura', 'Tecnología', 'Servicios'], what: 'Administra una empresa: supervisa empleados, repone inventario y fija precios con su propia habilidad.' },
};

export const SPECIALTY_SECTOR: Record<string, string> = { Gastronomía: 'cafeteria', Comercio: 'minimarket', Manufactura: 'muebles', Tecnología: 'saas', Servicios: 'consultora' };

function makePro(state: GameState, kind: ProKind): Professional {
  const info = PRO_INFO[kind];
  const experience = randInt(state, 1, 30);
  const quality = clamp(Math.round(35 + experience * 1.2 + randNormal(state) * 14), 10, 98);
  const reputation = clamp(Math.round(quality + randNormal(state) * 12 + (experience > 15 ? 5 : 0)), 5, 99);
  const fee = usd(info.baseFee * (0.6 + experience / 30 + reputation / 150) * state.macro.priceIndex);
  const pro: Professional = {
    id: state.meta.nextId++, name: `${FIRST[randInt(state, 0, FIRST.length - 1)]} ${LAST[randInt(state, 0, LAST.length - 1)]}`,
    kind, specialty: info.specialties[randInt(state, 0, info.specialties.length - 1)], experience, fee: Math.round(fee / 1000) * 1000, reputation, quality,
  };
  if (kind === 'gestor') {
    // Los más reconocidos cobran más (y no siempre son los mejores: la reputación estima la calidad con error).
    pro.mgmtFee = Math.round((0.006 + (reputation / 100) * 0.014) * 10000) / 10000;
    pro.perfFee = Math.round((0.08 + (reputation / 100) * 0.12) * 100) / 100;
  }
  return pro;
}

export function refreshProMarket(state: GameState): void {
  const kinds: ProKind[] = ['contador', 'asesor', 'abogado', 'auditor', 'gerente', 'gestor'];
  state.pros.market = [];
  for (const k of kinds) for (let i = 0; i < (k === 'gerente' ? 4 : 3); i++) state.pros.market.push(makePro(state, k));
  state.pros.lastRefresh = state.day;
}

export function initPros(state: GameState): void {
  refreshProMarket(state);
}

/** Honorario mensual efectivo (el asesor cobra el mayor entre su anticipo y 1 % anual de la cartera). */
export function monthlyFee(state: GameState, h: ProHire): Cents {
  if (h.pro.kind === 'asesor') return Math.max(h.pro.fee, roundCents((investmentsValue(state) * 0.01) / 12));
  if (h.pro.kind === 'auditor' || h.pro.kind === 'gerente' || h.pro.kind === 'gestor') return 0;
  return h.pro.fee;
}

export function hirePro(state: GameState, proId: number, scope: 'personal' | number): ActionResult {
  const pro = state.pros.market.find((p) => p.id === proId);
  if (!pro) return FAIL('Ese profesional ya no está disponible.');
  if (pro.kind === 'auditor') return FAIL('Los auditores se contratan por encargo: usá "Encargar auditoría" en la empresa.');
  if (pro.kind === 'gerente') {
    if (scope === 'personal') return FAIL('Elegí la empresa que va a administrar.');
    return assignManager(state, pro, scope);
  }
  if ((pro.kind === 'asesor' || pro.kind === 'gestor') && scope !== 'personal') return FAIL(`El ${PRO_INFO[pro.kind].name.toLowerCase()} trabaja con tu dinero personal.`);
  if (scope !== 'personal' && !state.companies.some((c) => c.id === scope && isOpen(c))) return FAIL('Empresa inexistente.');
  if (hiredPro(state, pro.kind, scope)) return FAIL(`Ya tenés un ${PRO_INFO[pro.kind].name.toLowerCase()} para ese ámbito. Despedilo primero si querés cambiarlo.`);
  state.pros.hires.push({ id: state.meta.nextId++, pro, scope, since: state.day });
  state.pros.market = state.pros.market.filter((p) => p.id !== proId);
  practice(state, 'hire_pro', 'management', 30);
  const where = scope === 'personal' ? 'tus finanzas personales' : state.companies.find((c) => c.id === scope)!.name;
  if (pro.kind === 'gestor') return OK(`Contrataste a ${pro.name} como gestor de inversiones. Ahora entregale dinero desde Invertir → Gestor (${feeLabel(pro)}).`);
  return OK(`Contrataste a ${pro.name} (${PRO_INFO[pro.kind].name.toLowerCase()}) para ${where}. Honorario: ${fmtMoney(pro.fee)} ${PRO_INFO[pro.kind].feeUnit}.`);
}

function assignManager(state: GameState, pro: Professional, companyId: number): ActionResult {
  const co = state.companies.find((c) => c.id === companyId && isOpen(c));
  if (!co) return FAIL('Empresa inexistente.');
  if (co.employees.some((e) => e.role === 'gerente')) return FAIL(`${co.name} ya tiene gerente. Despedilo en Personal para reemplazarlo.`);
  const fee = pro.fee;
  const specialtySector = SPECIALTY_SECTOR[pro.specialty];
  const fit = specialtySector === co.sector ? 1 : 0.85;
  const skill = clamp(Math.round(pro.quality * fit), 10, 95);
  co.employees.push({ id: state.meta.nextId++, name: pro.name, role: 'gerente', wage: fee, skill, morale: 75, hiredDay: state.day, absentUntil: state.day - 1, trainingUntil: state.day - 1 });
  const hireCost = roundCents(fee * 0.5);
  coPay(state, co, 'training', hireCost, { memo: `Búsqueda y contratación de gerente (${pro.name})`, tag: 'hiring', allowArrears: false });
  state.pros.market = state.pros.market.filter((p) => p.id !== pro.id);
  return OK(`${pro.name} es el nuevo gerente de ${co.name} (habilidad efectiva ${skill}${fit < 1 ? ', fuera de su especialidad' : ''}). Sueldo ${fmtMoney(fee)}/mes.`);
}

export function firePro(state: GameState, hireId: number): ActionResult {
  const h = state.pros.hires.find((x) => x.id === hireId);
  if (!h) return FAIL('Contratación inexistente.');
  for (const c of state.legal?.cases ?? []) if (c.lawyerHireId === hireId) c.lawyerHireId = null;
  const returned = h.pro.kind === 'gestor' ? closeMandatesOfHire(state, hireId, 'fin del contrato') : 0;
  state.pros.hires = state.pros.hires.filter((x) => x.id !== hireId);
  return OK(`Terminaste la relación con ${h.pro.name}.${returned > 0 ? ` Liquidó tu cuenta y te devolvió ${fmtMoney(returned)}.` : ''}`);
}

/** Costo de la próxima capacitación de un profesional contratado. */
export function trainingCost(state: GameState, h: ProHire): Cents {
  return usd(Math.round(700 * (1 + (h.trainings ?? 0) * 0.5) * state.macro.priceIndex));
}

export const TRAINING_COOLDOWN_DAYS = 90;

/**
 * Capacitar a un profesional contratado: paga el jugador; su calidad real sube
 * con rendimientos decrecientes (cuanto mejor es, menos mejora). Una vez cada 90 días.
 */
export function trainPro(state: GameState, hireId: number): ActionResult {
  const h = state.pros.hires.find((x) => x.id === hireId);
  if (!h) return FAIL('Contratación inexistente.');
  if (h.pro.kind === 'auditor' || h.pro.kind === 'gerente') return FAIL('Este profesional no se capacita desde aquí.');
  if (h.lastTraining !== undefined && state.day - h.lastTraining < TRAINING_COOLDOWN_DAYS) return FAIL(`Ya se capacitó hace poco: podés volver a capacitarlo el ${formatDate(h.lastTraining + TRAINING_COOLDOWN_DAYS)}.`);
  if (h.pro.quality >= 98) return FAIL(`${h.pro.name} ya está en la cima de su profesión.`);
  const cost = trainingCost(state, h);
  const r = payExpense(state, 'professional_fees', cost, { memo: `Capacitación de ${h.pro.name}`, tag: 'pros:training', method: 'checking' });
  if (!r.ok) return FAIL(`La capacitación cuesta ${fmtMoney(cost)}.`);
  const gain = Math.max(1, Math.round((100 - h.pro.quality) * 0.12));
  h.pro.quality = Math.min(98, h.pro.quality + gain);
  h.trainings = (h.trainings ?? 0) + 1;
  h.lastTraining = state.day;
  practice(state, 'train_pro', 'management', 40);
  return OK(`${h.pro.name} terminó una capacitación: su calidad real subió ${gain} puntos. ${h.pro.kind === 'gestor' ? 'Estimará mejor el valor de las acciones.' : ''}`);
}

/** Honorarios mensuales (último día del mes). */
export function prosMonthEnd(state: GameState): void {
  for (const h of [...state.pros.hires]) {
    const fee = monthlyFee(state, h);
    if (fee <= 0) continue;
    if (h.scope === 'personal') {
      payExpense(state, 'professional_fees', fee, { memo: `Honorarios de ${h.pro.name} (${PRO_INFO[h.pro.kind].name.toLowerCase()})`, tag: 'pros', method: 'checking' });
    } else {
      const co = state.companies.find((c) => c.id === h.scope);
      if (!co || !isOpen(co)) {
        state.pros.hires = state.pros.hires.filter((x) => x.id !== h.id);
        continue;
      }
      coPay(state, co, 'professional_fees', fee, { memo: `Honorarios de ${h.pro.name}`, tag: 'pros', kind: 'otros' });
    }
  }
  if (state.day - state.pros.lastRefresh >= 60) refreshProMarket(state);
  // Experiencia: cada fin de año los profesionales contratados aprenden en el trabajo.
  if (dateOf(state.day).m === 12) {
    for (const h of state.pros.hires) {
      h.pro.experience += 1;
      h.pro.quality = Math.min(98, h.pro.quality + Math.max(0, Math.round((100 - h.pro.quality) * 0.03)));
    }
  }
}

// ------------------------------------------------------------ Contador: informe

export interface AccountantReport {
  preparedBy: string | null;
  obligations: ReturnType<typeof taxObligations>;
  checks: Array<{ ok: boolean; text: string }>;
}

/** Informe contable con datos reales. Sin contador solo se listan las obligaciones. */
export function accountantReport(state: GameState): AccountantReport {
  const acc = hiredPro(state, 'contador', 'personal');
  const obligations = taxObligations(state, 180);
  const checks: Array<{ ok: boolean; text: string }> = [];
  if (acc) {
    const due = obligations.filter((o) => o.amount !== null && o.amount > 0 && o.day - state.day <= 60).reduce((s, o) => s + (o.amount ?? 0), 0);
    const liquid = spendable(state);
    checks.push({ ok: liquid >= due, text: `Pagos fiscales en los próximos 60 días: ${fmtMoney(due)}. Liquidez disponible: ${fmtMoney(liquid)}.` });
    checks.push({ ok: state.ledger.balances.taxes_payable === 0, text: state.ledger.balances.taxes_payable ? `Tenés ${fmtMoney(state.ledger.balances.taxes_payable)} de impuestos personales pendientes.` : 'No hay impuestos personales vencidos.' });
    const unreal = positions(state, 'stocks').filter((p) => p.unrealized < 0).reduce((s, p) => s + p.unrealized, 0);
    const gains = (state.tax.ytd.gainsShort ?? 0) + (state.tax.ytd.gainsLong ?? 0);
    if (gains > 0 && unreal < 0) checks.push({ ok: true, text: `Planificación legal: tenés ${fmtMoney(gains)} de ganancias realizadas este año y ${fmtMoney(-unreal)} de pérdidas no realizadas en acciones. Venderlas antes del cierre compensaría la ganancia (decisión tuya: evaluá si querés mantenerlas).` });
    const rentals = state.realEstate.properties.filter((p) => p.owner.kind === 'personal' && p.usedBy === null).length;
    if (rentals) checks.push({ ok: true, text: `Se reclaman deducciones por ${rentals} inmueble(s) alquilado(s): depreciación del edificio e intereses hipotecarios (según la jurisdicción).` });
    for (const co of state.companies) if (co.ledger.balances.arrears > 0) checks.push({ ok: false, text: `${co.name} tiene deudas vencidas por ${fmtMoney(co.ledger.balances.arrears)}.` });
    if ((state.tax.underreport ?? 0) > 0) checks.push({ ok: false, text: `ADVERTENCIA de ${acc.name}: la estrategia de declaración actual oculta ingresos. Es evasión fiscal: si te auditan, pagarás el impuesto, intereses y multas, y podría haber un proceso penal. Recomienda volver a una declaración honesta.` });
  }
  return { preparedBy: acc?.name ?? null, obligations, checks };
}

// ------------------------------------------------------------ Asesor financiero: proyección

export interface PortfolioProjection {
  months: number;
  p10: Cents;
  p50: Cents;
  p90: Cents;
  probLoss: number;
  expectedReturn: number;
  volatility: number;
  note: string;
}

/**
 * Proyección Monte Carlo de la cartera financiera a N meses usando la
 * volatilidad histórica REAL de cada tenencia (últimos 120 días). Un asesor de
 * mayor calidad usa más escenarios y mejores supuestos, pero la proyección
 * siempre es un rango de posibilidades, no una promesa.
 */
export function projectPortfolio(state: GameState, months = 12): PortfolioProjection | null {
  const adv = hiredPro(state, 'asesor', 'personal');
  const total = investmentsValue(state);
  if (total <= 0) return null;
  // Retorno y volatilidad por tenencia (acciones con historia; el resto con supuestos por clase).
  let mu = 0;
  let varSum = 0;
  for (const p of positions(state, 'stocks')) {
    const s = state.stocks.stocks.find((x) => x.id === p.id);
    const h = s?.history.slice(-120) ?? [];
    if (h.length < 20) continue;
    const r = h.slice(1).map((c, i) => Math.log(c.c / h[i].c));
    const m = r.reduce((a, b) => a + b, 0) / r.length;
    const v = r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length;
    const w = p.value / total;
    mu += w * (0.07 + (m * 252 - 0.07) * 0.2);
    varSum += (w * Math.sqrt(v * 252)) ** 2 + w * w * 0.02;
  }
  // Cuentas con gestor: según la mezcla de su perfil (acciones ~16 % de volatilidad, bonos ~6 %).
  for (const p of positions(state, 'managed')) {
    const md = state.managed.mandates.find((x) => x.id === p.id);
    const stocksW = md?.profile === 'agresivo' ? 0.9 : md?.profile === 'conservador' ? 0.25 : 0.6;
    const w = p.value / total;
    mu += w * (0.03 + stocksW * 0.045);
    varSum += (w * (0.03 + stocksW * 0.15)) ** 2;
  }
  // Cada fondo con su propio riesgo: un monetario casi no se mueve; uno sectorial, mucho.
  const FUND_RISK: Record<string, [number, number]> = { monetario: [0.03, 0.005], bonos: [0.045, 0.06], dividendos: [0.06, 0.12], inmobiliario: [0.06, 0.12], indice: [0.07, 0.16], sector: [0.08, 0.22] };
  for (const p of positions(state, 'funds')) {
    const w = p.value / total;
    const [m, v] = FUND_RISK[FUND_BY_ID[String(p.id)]?.kind ?? 'indice'] ?? [0.06, 0.14];
    mu += w * m;
    varSum += (w * v) ** 2;
  }
  const byClass: Array<['bonds' | 'mogul', number, number]> = [['bonds', 0.045, 0.06], ['mogul', 0.07, 0.18]];
  for (const [cls, m, v] of byClass) for (const p of positions(state, cls)) {
    const w = p.value / total;
    mu += w * m;
    varSum += (w * v) ** 2;
  }
  const vol = Math.sqrt(varSum) * 1.2;
  const n = adv ? 400 + Math.round(adv.quality * 8) : 200;
  const t = months / 12;
  const outs: number[] = [];
  const rng = { rng: (state.seed ^ state.day) | 0 };
  for (let i = 0; i < n; i++) outs.push(total * Math.exp((mu - vol * vol / 2) * t + vol * Math.sqrt(t) * randNormal(rng)));
  outs.sort((a, b) => a - b);
  const q = (x: number) => roundCents(outs[Math.min(outs.length - 1, Math.floor(x * outs.length))]);
  return {
    months, p10: q(0.1), p50: q(0.5), p90: q(0.9), probLoss: outs.filter((x) => x < total).length / outs.length, expectedReturn: mu, volatility: vol,
    note: `${adv ? `Preparada por ${adv.name} con ${n} escenarios.` : `Proyección básica (${n} escenarios); un asesor financiero usa más escenarios y mejores supuestos.`} Supone que la volatilidad futura se parece a la de los últimos meses; crisis, eventos o cambios de tasas pueden producir resultados fuera del rango.`,
  };
}

// ------------------------------------------------------------ Auditor

export function commissionAudit(state: GameState, companyId: number, auditorId: number): ActionResult {
  const co = state.companies.find((c) => c.id === companyId && isOpen(c));
  if (!co) return FAIL('Empresa inexistente.');
  const aud = state.pros.market.find((p) => p.id === auditorId && p.kind === 'auditor');
  if (!aud) return FAIL('Ese auditor ya no está disponible.');
  const fee = aud.fee;
  if (co.ledger.balances.cash < fee) return FAIL(`La auditoría cuesta ${fmtMoney(fee)} y la empresa no tiene esa caja.`);
  coPay(state, co, 'professional_fees', fee, { memo: `Auditoría externa (${aud.name})`, tag: 'audit', allowArrears: false });
  const findings: string[] = [];
  // 1. Integridad de los libros (siempre se verifica de verdad).
  const errs = gAudit(CO_CHART, co.ledger, co.name);
  if (errs.length) findings.push(...errs.slice(0, 3));
  else findings.push('Los libros cuadran: cada asiento balancea y los saldos coinciden con el detalle.');
  // 2. Desfalco de empleados.
  const detect = clamp(0.4 + aud.quality / 150, 0.4, 0.97);
  if (co.embezzlement && chance(state, detect)) {
    const total = co.embezzlement.total;
    const rec = roundCents(total * 0.5);
    findings.push(`Se detectó un desfalco de un empleado por ${fmtMoney(total)} desde ${formatDate(co.embezzlement.since)}. Se recuperaron ${fmtMoney(rec)} y el empleado fue despedido.`);
    if (rec > 0) coPost(co.ledger, { day: state.day, memo: 'Recupero de desfalco', cf: 'operating', tag: 'embezzlement:recovery', lines: [{ account: 'cash', debit: rec }, { account: 'other_income', credit: rec }] });
    co.embezzlement = null;
    const idx = co.employees.findIndex((e) => e.role !== 'gerente');
    if (idx >= 0) co.employees.splice(idx, 1);
  }
  // 3. Irregularidades del dueño (ficticias): el auditor está obligado a informarlas.
  let dirty = false;
  if ((co.irregular.inflatedBooks > 0 || co.irregular.underreport > 0) && chance(state, detect)) {
    dirty = true;
    findings.push('SALVEDAD: se detectaron ingresos no declarados o cifras infladas en los registros. El auditor emitió una opinión con salvedades y está obligado a comunicarlo a las autoridades.');
    state.legal.heat = clamp(state.legal.heat + 25, 0, 100);
    for (const a of state.legal.acts) if (a.companyId === co.id && a.status === 'oculto') a.evidence = clamp(a.evidence + 30, 0, 100);
  }
  const clean = !dirty && errs.length === 0;
  const report: AuditReport = { id: state.meta.nextId++, companyId: co.id, day: state.day, auditorName: aud.name, quality: aud.quality, findings, clean, validUntil: addMonths(state.day, 12) };
  state.pros.audits.push(report);
  if (state.pros.audits.length > 40) state.pros.audits.shift();
  state.pros.market = state.pros.market.filter((p) => p.id !== auditorId);
  practice(state, 'audit', 'accounting', 60);
  addLog(state, clean ? 'success' : 'warning', '🔍', `${co.name}: auditoría de ${aud.name} ${clean ? 'sin salvedades (mejora la confianza de bancos y compradores durante 12 meses)' : 'con hallazgos'}.`);
  return OK(clean ? 'Auditoría limpia.' : 'La auditoría encontró problemas: revisá el informe.');
}

/**
 * Riesgo de desfalco (mensual): en empresas con más de 4 empleados sin contador
 * ni auditoría reciente, un empleado puede empezar a sustraer caja. Un contador
 * lo detecta con una probabilidad según su calidad.
 */
export function embezzlementMonth(state: GameState): void {
  if (state.meta.projection) return;
  for (const co of state.companies) {
    if (!isOpen(co) || sectorOf(co).model === 'holding') continue;
    const acc = hiredPro(state, 'contador', co.id);
    const audited = state.pros.audits.some((a) => a.companyId === co.id && a.validUntil >= state.day);
    if (!co.embezzlement && co.employees.length > 4 && !audited) {
      const p = (acc ? 0.002 : 0.012) * (1 + Math.max(0, 60 - (co.employees.reduce((s, e) => s + e.morale, 0) / co.employees.length)) / 40);
      if (chance(state, p)) {
        const revenue = co.history[co.history.length - 1]?.revenue ?? 0;
        co.embezzlement = { monthly: Math.max(usd(100), roundCents(revenue * randRange(state, 0.01, 0.03))), since: state.day, total: 0 };
      }
    }
    if (co.embezzlement) {
      const take = Math.min(co.embezzlement.monthly, Math.max(0, co.ledger.balances.cash));
      if (take > 0) {
        coPost(co.ledger, { day: state.day, memo: 'Faltante de caja sin explicar', cf: 'operating', tag: 'embezzlement', lines: [{ account: 'admin', debit: take }, { account: 'cash', credit: take }] });
        co.embezzlement.total += take;
      }
      if (acc && chance(state, 0.15 + acc.quality / 200)) {
        const total = co.embezzlement.total;
        co.embezzlement = null;
        addLog(state, 'warning', '🕵️', `${co.name}: tu contador ${acc.name} detectó un desfalco de ${fmtMoney(total)} y el empleado fue despedido.`, undefined, 'peligro');
        const idx = co.employees.findIndex((e) => e.role !== 'gerente');
        if (idx >= 0) co.employees.splice(idx, 1);
      }
    }
  }
}

/** ¿El contador de la empresa evita errores en la declaración? Sin él, hay probabilidad de error y multa. */
export function companyFilingErrorRisk(state: GameState, companyId: number): number {
  if (hiredPro(state, 'contador', companyId)) return 0;
  return clamp(0.12 - state.skills.accounting.level * 0.002, 0.01, 0.12);
}

export function prosSummary(state: GameState) {
  return state.pros.hires.map((h) => ({ hire: h, monthly: monthlyFee(state, h), where: h.scope === 'personal' ? 'Personal' : state.companies.find((c) => c.id === h.scope)?.name ?? '—' }));
}

export function proMarketByKind(state: GameState, kind: ProKind) {
  return state.pros.market.filter((p) => p.kind === kind);
}

export function nextRefresh(state: GameState): number {
  return state.pros.lastRefresh + 60;
}

export function describeQuality(p: Professional): string {
  return p.reputation >= 80 ? 'Muy reconocido' : p.reputation >= 60 ? 'Buena reputación' : p.reputation >= 40 ? 'Reputación media' : 'Poco conocido';
}

export function feeLabel(p: Professional): string {
  if (p.kind === 'gestor') return `${fmtPct(p.mgmtFee ?? 0.015, 1)} anual de gestión + ${fmtPct(p.perfFee ?? 0.15, 0)} de las ganancias`;
  return `${fmtMoney(p.fee)} ${PRO_INFO[p.kind].feeUnit}`;
}

