import { activeMandates, withdrawMandate, mandateValue } from '../invest/managed';
import type { GameState } from '../state';
import type { IllegalAct, IllegalKind, LegalCase, Fine } from './types';
import { Cents, clamp, roundCents, usd } from '../money';
import { chance, randInt, randRange } from '../rng';
import { addMonths, dateOf, dayOf, formatDate } from '../time/calendar';
import { ActionResult, FAIL, OK } from '../result';
import { fmtMoney, fmtPct } from '../format';
import { addLog } from '../log';
import { post } from '../ledger/ledger';
import { canPayFromChecking, payExpense } from '../finance/payments';
import { jurisdictionById, JurisdictionId } from '../../content/jurisdictions';
import { difficultyOf } from '../economy/difficulty';
import { coPay, isOpen, sectorOf } from '../business/common';
import { coPost } from '../business/companyLedger';
import type { Company } from '../business/types';
import { hireOf, hiredPro } from '../pros/lookup';
import { bookSell, holdingsOf, markPrice, revalueInvestments } from '../invest/portfolio';
import { recordLate, refreshCreditScore } from '../finance/credit';
import { endEmploymentForPrison } from '../career/career';
import { practice } from '../skills/skills';
import { revalue } from '../business/ownership';

/**
 * SISTEMA LEGAL Y ACTIVIDADES ILEGALES (FICTICIAS).
 *
 * Todo es una simulación abstracta dentro del universo del juego: no describe
 * métodos reales. Cada decisión ilegal puede dar un beneficio económico, pero
 * deja PRUEBAS, aumenta la SOSPECHA de las autoridades y crea TESTIGOS. Nada
 * está garantizado: ni el beneficio ni la impunidad ni la absolución.
 *
 * Ciclo de un caso:
 *  1. Detección (mensual, probabilística): sospecha, controles de la jurisdicción,
 *     testigos (empleados descontentos denuncian), auditorías fiscales y externas.
 *  2. Investigación (2–5 meses): la acusación reúne pruebas. Si no alcanzan, se archiva.
 *  3. Casos fiscales administrativos (evasión menor): impuesto + intereses + multa. Sin prisión.
 *  4. Casos penales: imputación → oferta de acuerdo → juicio → sentencia (multa,
 *     restitución, decomiso, antecedentes, reputación, suspensión de la empresa y
 *     posible prisión ficticia). Se puede apelar.
 *  5. Un abogado revisa el expediente, prepara la defensa y negocia acuerdos, pero
 *     la probabilidad de condena nunca baja del 5 % si hay pruebas (ni sube del 95 %).
 */

export const KIND_INFO: Record<IllegalKind, { name: string; icon: string; base: number }> = {
  soborno: { name: 'Soborno', icon: '💼', base: 0.012 },
  evasion: { name: 'Evasión fiscal', icon: '🧾', base: 0.008 },
  evasion_empresa: { name: 'Evasión empresarial', icon: '🏢', base: 0.01 },
  fraude: { name: 'Fraude', icon: '📑', base: 0.014 },
  clandestino: { name: 'Negocio clandestino', icon: '🕶️', base: 0.02 },
  lavado: { name: 'Lavado de dinero', icon: '🧺', base: 0.016 },
};

function enabled(state: GameState): string | null {
  if (!state.options.illegalEnabled) return 'Las actividades ilegales ficticias están desactivadas en Ajustes.';
  if (state.legal.prison) return 'Estás cumpliendo una condena.';
  return null;
}

function note(state: GameState, text: string): void {
  state.legal.log.push({ day: state.day, text });
  if (state.legal.log.length > 80) state.legal.log.shift();
}

function addAct(state: GameState, a: Omit<IllegalAct, 'id' | 'day' | 'status' | 'statuteDay'> & { statuteYears?: number }): IllegalAct {
  const act: IllegalAct = { ...a, id: state.meta.nextId++, day: state.day, status: 'oculto', statuteDay: state.day + Math.round(365 * (a.statuteYears ?? 6)) };
  delete (act as { statuteYears?: number }).statuteYears;
  state.legal.acts.push(act);
  const j = jurisdictionById(a.jurisdiction);
  state.legal.heat = clamp(state.legal.heat + a.severity * 3 * j.enforcement, 0, 100);
  practice(state, 'illegal', 'risk', 10);
  return act;
}

/** Pago con efectivo no declarado (si alcanza) o desde la cuenta corriente (deja más rastro). */
function payIllicit(state: GameState, amount: Cents, memo: string): { ok: boolean; traced: boolean } {
  if (state.ledger.balances.undeclared_cash >= amount) {
    post(state.ledger, { day: state.day, memo, cf: 'internal', tag: 'illicit', lines: [{ account: 'illicit_costs', debit: amount }, { account: 'undeclared_cash', credit: amount }] });
    return { ok: true, traced: false };
  }
  if (!canPayFromChecking(state, amount)) return { ok: false, traced: false };
  post(state.ledger, { day: state.day, memo, cf: 'operating', tag: 'illicit', lines: [{ account: 'illicit_costs', debit: amount }, { account: 'checking', credit: amount }] });
  return { ok: true, traced: true };
}

// ------------------------------------------------------------ Actividades

export type BribeTarget = 'permisos' | 'contrato';

/** Soborno ficticio a un funcionario. El funcionario puede negarse y denunciarte. */
export function bribe(state: GameState, target: BribeTarget, companyId: number): ActionResult {
  const why = enabled(state);
  if (why) return FAIL(why);
  const co = state.companies.find((c) => c.id === companyId && isOpen(c));
  if (!co) return FAIL('Empresa inexistente.');
  const j = jurisdictionById(co.jurisdiction);
  if (target === 'permisos' && co.openDay <= state.day) return FAIL('La empresa ya tiene sus permisos: no hay trámite que acelerar.');
  if (target === 'contrato' && !['consultora', 'muebles', 'saas'].includes(co.sector)) return FAIL('Solo empresas que venden a organismos (consultoras, fábricas, software) pueden aspirar a contratos públicos.');
  if (target === 'contrato' && state.legal.contracts.some((c) => c.companyId === co.id && c.monthsLeft > 0)) return FAIL('Esa empresa ya tiene un contrato público vigente.');
  const cost = usd((target === 'permisos' ? 1500 : 4500) * state.macro.priceIndex);
  const pay = payIllicit(state, cost, `Pago no documentado (${target === 'permisos' ? 'agilizar permisos' : 'contrato público'})`);
  if (!pay.ok) return FAIL(`Se necesitan ${fmtMoney(cost)} (efectivo no declarado o cuenta corriente).`);
  const acceptP = clamp(0.72 - j.enforcement * 0.1 + state.skills.social.level * 0.002, 0.3, 0.9);
  const severity = target === 'permisos' ? 2 : 3;
  const act = addAct(state, {
    kind: 'soborno', label: `${co.name}: soborno para ${target === 'permisos' ? 'agilizar permisos' : 'ganar un contrato público'}`, benefit: 0, amount: cost,
    evidence: pay.traced ? 55 : 30, severity, witnesses: 1, jurisdiction: co.jurisdiction, companyId: co.id,
  });
  if (!chance(state, acceptP)) {
    act.evidence = 90;
    openCase(state, [act], 'penal', 'El funcionario rechazó el soborno y lo denunció.');
    return FAIL('El funcionario rechazó el pago y presentó una denuncia. Se abrió una investigación penal.');
  }
  if (target === 'permisos') {
    const saved = co.openDay - state.day - 1;
    co.openDay = state.day + 1;
    act.benefit = roundCents((co.history[co.history.length - 1]?.revenue ?? usd(3000 * state.macro.priceIndex)) / 30 * saved);
    note(state, `Soborno aceptado: ${co.name} abre mañana.`);
    return OK(`El trámite se "agilizó": ${co.name} abre mañana. El pago quedó registrado en tu contabilidad real como pago no documentado.`);
  }
  const avg = co.history.slice(-3).reduce((s, h) => s + h.revenue, 0) / Math.max(1, Math.min(3, co.history.length));
  const monthly = Math.max(usd(3500 * state.macro.priceIndex), roundCents(avg * 0.25));
  state.legal.contracts.push({ id: state.meta.nextId++, companyId: co.id, monthly, monthsLeft: 6, actId: act.id });
  act.benefit = monthly * 6;
  return OK(`${co.name} ganó un contrato público: ${fmtMoney(monthly)} de ventas extra por mes durante 6 meses.`);
}

/** Estrategia de declaración personal del año en curso (0 = honesta). */
export function setUnderreport(state: GameState, fraction: number): ActionResult {
  if (fraction > 0) {
    const why = enabled(state);
    if (why) return FAIL(why);
  }
  if (![0, 0.25, 0.5, 0.75].includes(fraction)) return FAIL('Opción inválida.');
  state.tax.underreport = fraction;
  return OK(fraction === 0 ? 'Tu próxima declaración será honesta.' : `Tu próxima declaración ocultará el ${fmtPct(fraction, 0)} de tus ingresos no salariales. Es evasión fiscal: si te auditan, pagarás el impuesto, intereses y multas, y podría haber un proceso penal.`);
}

export function setCompanyIrregular(state: GameState, companyId: number, patch: Partial<Company['irregular']>): ActionResult {
  const co = state.companies.find((c) => c.id === companyId);
  if (!co) return FAIL('Empresa inexistente.');
  if (Object.values(patch).some((v) => (v ?? 0) > 0)) {
    const why = enabled(state);
    if (why) return FAIL(why);
  }
  co.irregular = { ...co.irregular, ...patch };
  return OK(co.irregular.inflatedBooks || co.irregular.underreport ? 'Configuración irregular guardada. Los libros reales del juego no cambian: lo que cambia es lo que se declara y se muestra a terceros.' : `${co.name} vuelve a declarar y mostrar cifras reales.`);
}

/** Retiro de caja de una empresa sin declararlo (evita la retención sobre dividendos). */
export function skimCash(state: GameState, companyId: number, amount: Cents): ActionResult {
  const why = enabled(state);
  if (why) return FAIL(why);
  const co = state.companies.find((c) => c.id === companyId && isOpen(c));
  if (!co || co.parentId) return FAIL('Solo de empresas tuyas de propiedad directa.');
  if (!(amount > 0) || co.ledger.balances.cash < amount) return FAIL('La empresa no tiene esa caja.');
  const mine = roundCents(amount * co.ownership);
  coPost(co.ledger, { day: state.day, memo: 'Retiro de caja sin documentar', cf: 'financing', tag: 'dividend:skim', lines: [{ account: 'distributions', debit: amount }, { account: 'cash', credit: amount }] });
  post(state.ledger, { day: state.day, memo: `Retiro no declarado de ${co.name}`, cf: 'internal', tag: 'illicit:skim', lines: [{ account: 'undeclared_cash', debit: mine }, { account: 'business_equity', credit: mine }] });
  co.carrying -= mine;
  revalue(state, co);
  const tax = roundCents(mine * jurisdictionById(co.jurisdiction).dividendRate);
  addAct(state, { kind: 'evasion_empresa', label: `${co.name}: retiro de caja no declarado`, benefit: tax, amount: mine, evidence: 45, severity: mine > usd(50000) ? 3 : 2, witnesses: Math.min(3, co.employees.length), jurisdiction: co.jurisdiction, companyId: co.id });
  return OK(`Retiraste ${fmtMoney(mine)} en efectivo no declarado (evitaste ${fmtMoney(tax)} de retención).`);
}

export const VENTURES: Record<string, { name: string; days: number; expected: number; risk: number; severity: number; description: string }> = {
  contrabando: { name: 'Contrabando de mercadería (ficticio)', days: 60, expected: 0.35, risk: 0.12, severity: 3, description: 'Mercadería que ingresa sin pagar aranceles. Rinde bien, pero los controles aduaneros pueden incautarla.' },
  apuestas: { name: 'Casa de apuestas clandestina (ficticia)', days: 90, expected: 0.5, risk: 0.18, severity: 3, description: 'Muy rentable y muy visible: los allanamientos son frecuentes.' },
  falsificados: { name: 'Venta de productos falsificados (ficticia)', days: 45, expected: 0.25, risk: 0.08, severity: 2, description: 'Menor rentabilidad y menor riesgo, pero deja muchos testigos.' },
};

/** Negocio clandestino: inviertes un monto que puede multiplicarse… o perderse en un allanamiento. */
export function startVenture(state: GameState, kind: string, amount: Cents): ActionResult {
  const why = enabled(state);
  if (why) return FAIL(why);
  const v = VENTURES[kind];
  if (!v) return FAIL('Tipo inexistente.');
  if (!(amount >= usd(500))) return FAIL('Monto mínimo: $500.');
  if (state.legal.ventures.length >= 3) return FAIL('Ya tenés tres operaciones en curso.');
  const pay = payIllicit(state, amount, `Capital en operación clandestina: ${v.name}`);
  if (!pay.ok) return FAIL(`Necesitás ${fmtMoney(amount)}.`);
  const act = addAct(state, { kind: 'clandestino', label: v.name, benefit: 0, amount, evidence: pay.traced ? 50 : 35, severity: v.severity + (amount > usd(100000) ? 1 : 0), witnesses: randInt(state, 2, 5), jurisdiction: state.tax.jurisdiction });
  state.legal.ventures.push({ id: state.meta.nextId++, invested: amount, day: state.day, resolveDay: state.day + v.days, risk: v.risk, expected: v.expected, actId: act.id });
  return OK(`Operación iniciada: se resuelve en ${v.days} días. Rendimiento esperado ${fmtPct(v.expected, 0)}, riesgo de allanamiento ${fmtPct(v.risk * difficultyOf(state).enforcement, 0)} (sin garantías).`);
}

/** Depositar efectivo no declarado en el banco: los bancos reportan depósitos grandes. */
export function depositUndeclared(state: GameState, amount: Cents): ActionResult {
  if (!(amount > 0) || state.ledger.balances.undeclared_cash < amount) return FAIL('No tenés ese efectivo no declarado.');
  post(state.ledger, { day: state.day, memo: 'Depósito de efectivo', cf: 'operating', tag: 'illicit:deposit', lines: [{ account: 'checking', debit: amount }, { account: 'undeclared_cash', credit: amount }] });
  const large = amount > usd(10000 * state.macro.priceIndex);
  addAct(state, { kind: 'lavado', label: `Depósito de ${fmtMoney(amount)} de origen no declarado`, benefit: 0, amount, evidence: large ? 60 : 35, severity: amount > usd(100000) ? 3 : 2, witnesses: 0, jurisdiction: state.tax.jurisdiction });
  if (large) state.legal.heat = clamp(state.legal.heat + 10, 0, 100);
  return OK(`Depositaste ${fmtMoney(amount)}.${large ? ' El banco reportó el depósito por su monto: la sospecha aumentó.' : ''}`);
}

/** Lavado a través de una empresa propia: el efectivo se registra como ventas falsas (tributa y cobra una comisión). */
export function launderThroughCompany(state: GameState, companyId: number, amount: Cents): ActionResult {
  const why = enabled(state);
  if (why) return FAIL(why);
  const co = state.companies.find((c) => c.id === companyId && isOpen(c));
  if (!co || co.parentId) return FAIL('Solo a través de empresas tuyas de propiedad directa.');
  if (sectorOf(co).model === 'holding') return FAIL('Una holding no tiene ventas que usar de pantalla.');
  if (!(amount > 0) || state.ledger.balances.undeclared_cash < amount) return FAIL('No tenés ese efectivo no declarado.');
  const fee = roundCents(amount * 0.1);
  const net = amount - fee;
  const mine = roundCents(net * co.ownership);
  post(state.ledger, {
    day: state.day, memo: `Ingreso de efectivo a ${co.name}`, cf: 'internal', tag: 'illicit:launder',
    lines: [{ account: 'business_equity', debit: mine }, { account: 'illicit_costs', debit: amount - mine }, { account: 'undeclared_cash', credit: amount }],
  });
  coPost(co.ledger, { day: state.day, memo: 'Ventas en efectivo', cf: 'operating', tag: 'sales:cash', lines: [{ account: 'cash', debit: net }, { account: 'sales', credit: net }] });
  co.carrying += mine;
  revalue(state, co);
  const revenue = co.history.slice(-3).reduce((s, h) => s + h.revenue, 0) / 3;
  const visible = revenue > 0 ? net / revenue : 1;
  addAct(state, { kind: 'lavado', label: `${co.name}: ventas ficticias por ${fmtMoney(net)}`, benefit: 0, amount, evidence: clamp(35 + visible * 40, 35, 90), severity: amount > usd(200000) ? 4 : amount > usd(50000) ? 3 : 2, witnesses: Math.min(4, co.employees.filter((e) => e.role === 'contador' || e.role === 'gerente' || e.role === 'vendedor').length + 1), jurisdiction: co.jurisdiction, companyId: co.id });
  return OK(`${fmtMoney(net)} entraron a ${co.name} como ventas (comisión ${fmtMoney(fee)}). Ahora tributan como ingresos de la empresa.${visible > 0.3 ? ' Las ventas crecieron de forma llamativa: más riesgo de detección.' : ''}`);
}

/** Regularización voluntaria de una evasión aún no investigada: se paga impuesto + 20 % y no hay delito. */
export function voluntaryDisclosure(state: GameState, actId: number): ActionResult {
  const a = state.legal.acts.find((x) => x.id === actId && x.status === 'oculto');
  if (!a || (a.kind !== 'evasion' && a.kind !== 'evasion_empresa')) return FAIL('Solo se puede regularizar una evasión todavía no investigada.');
  const years = Math.max(0, (state.day - a.day) / 365);
  const due = roundCents(a.benefit * (1.2 + years * 0.06));
  const f = addFine(state, null, `Regularización voluntaria: ${a.label}`, due, 60);
  a.status = 'regularizado';
  state.legal.heat = clamp(state.legal.heat - 10, 0, 100);
  if (f.balance === 0) return OK('Regularizaste la situación: no había impuesto omitido, así que no debés nada y no hay proceso penal.');
  return OK(`Regularizaste la situación: debés ${fmtMoney(f.balance)} (impuesto + 20 % + intereses), sin proceso penal.`);
}

// ------------------------------------------------------------ Detección e investigaciones

function openCase(state: GameState, acts: IllegalAct[], kind: 'fiscal' | 'penal', origin: string): LegalCase {
  const existing = state.legal.cases.find((c) => c.stage === 'investigacion' && c.kind === kind);
  for (const a of acts) a.status = 'investigado';
  if (existing) {
    existing.acts.push(...acts.map((a) => a.id));
    existing.prosecution = clamp(existing.prosecution + acts.reduce((s, a) => s + a.evidence * 0.3, 0), 0, 100);
    addLog(state, 'danger', '🕵️', `La investigación en curso se amplió: ${acts.map((a) => a.label).join('; ')}.`, undefined, 'legal');
    return existing;
  }
  const c: LegalCase = {
    id: state.meta.nextId++, acts: acts.map((a) => a.id), kind, title: acts.map((a) => KIND_INFO[a.kind].name).filter((v, i, arr) => arr.indexOf(v) === i).join(' y '),
    origin, stage: 'investigacion', openedDay: state.day, nextStepDay: state.day + randInt(state, 60, 150),
    prosecution: clamp(acts.reduce((s, a) => s + a.evidence, 0) / acts.length * 0.5, 5, 95), defense: 0, lawyerHireId: hireOf(state, 'abogado', 'personal')?.id ?? null, reviewed: false, plea: null,
  };
  state.legal.cases.push(c);
  state.legal.heat = clamp(state.legal.heat + 10, 0, 100);
  state.player.attributes.stress = Math.min(100, state.player.attributes.stress + 12);
  addLog(state, 'danger', '🚨', `Se abrió una investigación ${kind === 'fiscal' ? 'fiscal' : 'penal'} en tu contra (${c.title}). Origen: ${origin}`, undefined, 'legal');
  note(state, `Caso ${c.id} abierto: ${origin}`);
  return c;
}

/** Paso mensual del sistema legal: sospecha, detección, contratos, operaciones, multas, inspecciones. */
export function legalMonth(state: GameState): void {
  const L = state.legal;
  const diff = difficultyOf(state);
  L.heat = clamp(L.heat * 0.96, 0, 100);
  // Estilo de vida vs. ingresos declarados (sospecha patrimonial).
  const last = state.history.slice(-13);
  if (last.length >= 13) {
    const growth = last[12].netWorth - last[0].netWorth;
    const declared = state.tax.filings.slice(-1)[0]?.grossIncome ?? 0;
    if (growth > declared * 2 + usd(80000 * state.macro.priceIndex) && L.acts.some((a) => a.status === 'oculto')) L.heat = clamp(L.heat + 4, 0, 100);
  }
  // Prescripción y detección.
  const detected: IllegalAct[] = [];
  for (const a of L.acts) {
    if (a.status !== 'oculto') continue;
    if (state.day >= a.statuteDay) {
      a.status = 'prescrito';
      continue;
    }
    const j = jurisdictionById(a.jurisdiction);
    let disgruntled = 1;
    const co = a.companyId ? state.companies.find((c) => c.id === a.companyId) : null;
    if (co && co.employees.length) {
      const low = co.employees.filter((e) => e.morale < 35).length;
      disgruntled += low * 0.4;
    }
    const p = KIND_INFO[a.kind].base * j.enforcement * diff.enforcement * (0.5 + L.heat / 100) * (1 + a.witnesses * 0.12 * disgruntled) * (0.5 + a.evidence / 100);
    if (chance(state, clamp(p, 0, 0.5))) detected.push(a);
  }
  if (detected.length) {
    const fiscal = detected.filter((a) => (a.kind === 'evasion' || a.kind === 'evasion_empresa') && a.severity <= 2);
    const penal = detected.filter((a) => !fiscal.includes(a));
    const disg = detected.some((a) => a.witnesses > 0 && a.companyId && state.companies.find((c) => c.id === a.companyId)?.employees.some((e) => e.morale < 35));
    const origin = disg ? 'Denuncia anónima de un empleado descontento.' : L.heat > 50 ? 'Investigación de oficio por sospechas acumuladas.' : 'Cruce de información de las autoridades.';
    if (fiscal.length) openCase(state, fiscal, 'fiscal', origin);
    if (penal.length) openCase(state, penal, 'penal', origin);
  }
  // Contratos públicos obtenidos con soborno.
  for (const c of L.contracts) {
    if (c.monthsLeft <= 0) continue;
    const co = state.companies.find((x) => x.id === c.companyId && isOpen(x));
    if (!co) {
      c.monthsLeft = 0;
      continue;
    }
    coPost(co.ledger, { day: state.day, memo: 'Facturación de contrato público', cf: 'operating', tag: 'sales:public', lines: [{ account: 'cash', debit: c.monthly }, { account: 'sales', credit: c.monthly }] });
    c.monthsLeft--;
  }
  L.contracts = L.contracts.filter((c) => c.monthsLeft > 0);
  processFines(state);
  inspections(state);
}

/** Resolución diaria: operaciones clandestinas, etapas de casos, prisión. */
export function legalDay(state: GameState): void {
  const L = state.legal;
  for (const v of [...L.ventures]) {
    if (state.day < v.resolveDay) continue;
    L.ventures = L.ventures.filter((x) => x.id !== v.id);
    const act = L.acts.find((a) => a.id === v.actId);
    if (chance(state, v.risk * difficultyOf(state).enforcement)) {
      if (act) {
        act.evidence = 85;
        openCase(state, [act], 'penal', 'Allanamiento policial durante la operación.');
      }
      addLog(state, 'danger', '🚔', `Allanamiento: se incautó todo el capital de la operación clandestina (${fmtMoney(v.invested)}).`, undefined, 'legal');
      continue;
    }
    const ret = roundCents(v.invested * (1 + v.expected + randRange(state, -0.25, 0.25)));
    post(state.ledger, { day: state.day, memo: 'Retorno de operación clandestina', cf: 'internal', tag: 'illicit:return', lines: [{ account: 'undeclared_cash', debit: ret }, { account: 'illicit_income', credit: ret }] });
    if (act) act.benefit = ret - v.invested;
    L.heat = clamp(L.heat + 3, 0, 100);
    addLog(state, 'warning', '🕶️', `La operación clandestina terminó: recibiste ${fmtMoney(ret)} en efectivo no declarado.`);
  }
  for (const c of L.cases) if (c.stage !== 'cerrado' && state.day >= c.nextStepDay) advanceCase(state, c);
  if (L.prison) {
    if (state.day >= L.prison.until) releaseFromPrison(state, false);
    else if (dateOf(state.day).d === 1) {
      state.player.attributes.stress = Math.min(100, state.player.attributes.stress + 3);
      state.player.attributes.health = Math.max(20, state.player.attributes.health - 1);
      const served = (state.day - L.prison.from) / Math.max(1, L.prison.until - L.prison.from);
      if (served >= 0.66 && chance(state, 0.25)) releaseFromPrison(state, true);
    }
  }
  if (dateOf(state.day).m === 2 && dateOf(state.day).d === 1) annualTaxAudit(state);
}

/** Auditoría fiscal anual (1 de febrero): revisa los últimos 5 años. */
function annualTaxAudit(state: GameState): void {
  const j = jurisdictionById(state.tax.jurisdiction);
  const p = j.auditRate * difficultyOf(state).enforcement * (1 + state.legal.heat / 50);
  if (!chance(state, p)) return;
  state.legal.lastTaxAudit = state.day;
  const found = state.legal.acts.filter((a) => (a.kind === 'evasion' || a.kind === 'evasion_empresa') && a.status === 'oculto' && chance(state, a.evidence / 100));
  if (found.length) {
    const fiscal = found.filter((a) => a.severity <= 2);
    const penal = found.filter((a) => a.severity > 2);
    if (fiscal.length) openCase(state, fiscal, 'fiscal', 'Auditoría fiscal anual.');
    if (penal.length) openCase(state, penal, 'penal', 'Auditoría fiscal anual: evasión grave.');
    return;
  }
  // Declaraciones honestas: sin contador y con poca contabilidad puede haber errores menores.
  const acc = hiredPro(state, 'contador', 'personal');
  const errP = acc ? 0.02 : clamp(0.3 - state.skills.accounting.level * 0.005, 0.05, 0.3);
  const lastTax = state.tax.filings.slice(-1)[0];
  if (lastTax && chance(state, errP)) {
    const fine = Math.max(usd(150), roundCents(lastTax.taxAfterCredits * 0.05));
    addFine(state, null, 'Diferencias menores detectadas en una auditoría fiscal', fine, 60);
    addLog(state, 'warning', '🧾', `Te tocó una auditoría fiscal: encontraron errores menores en tu declaración. Multa: ${fmtMoney(fine)}.${acc ? '' : ' Un contador reduce este riesgo.'}`);
  } else addLog(state, 'info', '🧾', 'Te auditaron la declaración fiscal: todo en orden.');
}

function actsOf(state: GameState, c: LegalCase): IllegalAct[] {
  return state.legal.acts.filter((a) => c.acts.includes(a.id));
}

function lawyerOf(state: GameState, c: LegalCase) {
  return c.lawyerHireId ? state.pros.hires.find((h) => h.id === c.lawyerHireId)?.pro ?? null : null;
}

function chargeLawyer(state: GameState, c: LegalCase, mult: number, memo: string): void {
  const l = lawyerOf(state, c);
  if (!l) return;
  const fee = roundCents(l.fee * mult);
  payExpense(state, 'legal_costs', fee, { memo: `${memo} (${l.name})`, tag: 'legal:fees', method: 'checking' });
}

/** Probabilidad de condena según prueba, defensa y habilidad de Derecho. Siempre entre 5 % y 95 %. */
export function convictionProbability(state: GameState, c: LegalCase): number {
  const l = lawyerOf(state, c);
  const defense = (l ? 10 + l.quality * 0.35 : 12) + c.defense * 0.5 + state.skills.law.level * 0.1;
  const x = (c.prosecution - defense) / 14;
  return clamp(1 / (1 + Math.exp(-x)), 0.05, 0.95);
}

function sentenceFor(state: GameState, c: LegalCase): { fine: Cents; restitution: Cents; prisonMonths: number } {
  const acts = actsOf(state, c);
  const benefit = acts.reduce((s, a) => s + Math.max(0, a.benefit), 0);
  const amount = acts.reduce((s, a) => s + a.amount, 0);
  const severity = acts.reduce((s, a) => Math.max(s, a.severity), 0) + Math.max(0, acts.length - 1) * 0.5;
  const restitution = acts.filter((a) => a.kind === 'evasion' || a.kind === 'evasion_empresa').reduce((s, a) => s + roundCents(a.benefit * (1 + Math.max(0, (state.day - a.day) / 365) * 0.06)), 0);
  const fine = roundCents(benefit * 1.5 + amount * 0.1 + usd(2000 * severity * state.macro.priceIndex));
  const prisonMonths = c.kind === 'penal' ? Math.round(severity * 4 * (1 + state.legal.criminalRecord * 0.3)) : 0;
  return { fine, restitution, prisonMonths };
}

function advanceCase(state: GameState, c: LegalCase): void {
  const acts = actsOf(state, c);
  if (c.stage === 'investigacion') {
    c.prosecution = clamp(c.prosecution + acts.reduce((s, a) => s + a.evidence * 0.25, 0) / Math.max(1, acts.length) + randRange(state, -8, 12), 0, 100);
    chargeLawyer(state, c, 1, 'Honorarios por seguimiento de la investigación');
    if (c.kind === 'fiscal') {
      // Resolución administrativa: impuesto + intereses + multa del 50 % (reducida con buen abogado).
      const s = sentenceFor(state, c);
      const l = lawyerOf(state, c);
      const penalty = roundCents(s.restitution * 0.5 * (l ? 1 - l.quality / 300 : 1));
      const total = s.restitution + penalty;
      if (total <= 0) {
        closeCase(state, c, { day: state.day, verdict: 'archivado', fine: 0, restitution: 0, seized: 0, prisonMonths: 0, suspended: false, text: 'La autoridad fiscal no encontró impuestos omitidos: el caso se cerró sin multa.' });
        for (const a of acts) a.status = 'juzgado';
        return;
      }
      const f = addFine(state, c.id, `Resolución fiscal: ${c.title}`, total, 60);
      closeCase(state, c, { day: state.day, verdict: 'condenado', fine: penalty, restitution: s.restitution, seized: 0, prisonMonths: 0, suspended: false, text: `La autoridad fiscal determinó impuestos omitidos de ${fmtMoney(s.restitution)} más una multa de ${fmtMoney(penalty)}. Total: ${fmtMoney(f.balance)}, vence el ${formatDate(f.dueDay)}.` });
      for (const a of acts) a.status = 'juzgado';
      state.player.attributes.reputation = Math.max(0, state.player.attributes.reputation - 4);
      return;
    }
    if (c.prosecution < 35) {
      closeCase(state, c, { day: state.day, verdict: 'archivado', fine: 0, restitution: 0, seized: 0, prisonMonths: 0, suspended: false, text: 'La fiscalía no reunió pruebas suficientes: el caso se archivó.' });
      for (const a of acts) {
        a.status = 'oculto';
        a.evidence = Math.round(a.evidence * 0.6);
      }
      return;
    }
    c.stage = 'imputacion';
    c.nextStepDay = state.day + randInt(state, 30, 60);
    const s = sentenceFor(state, c);
    c.plea = { fine: roundCents((s.fine + s.restitution) * 0.7), prisonMonths: Math.max(0, Math.round(s.prisonMonths * 0.4)), expires: c.nextStepDay };
    addLog(state, 'danger', '⚖️', `Fuiste imputado formalmente (${c.title}). La fiscalía ofrece un acuerdo: ${fmtMoney(c.plea.fine)} de multa y restitución${c.plea.prisonMonths ? ` y ${c.plea.prisonMonths} meses de prisión (probablemente en suspenso)` : ''}. Si no lo aceptás, habrá juicio el ${formatDate(c.nextStepDay)}.`, undefined, 'legal');
    return;
  }
  if (c.stage === 'imputacion') {
    c.stage = 'juicio';
    c.plea = null;
    c.nextStepDay = state.day + randInt(state, 45, 100);
    addLog(state, 'warning', '⚖️', `Comenzó el juicio (${c.title}). Sentencia estimada: ${formatDate(c.nextStepDay)}.`, undefined, 'legal');
    return;
  }
  if (c.stage === 'juicio') {
    chargeLawyer(state, c, 3, 'Honorarios de representación en juicio');
    const p = convictionProbability(state, c);
    if (chance(state, p)) {
      const s = sentenceFor(state, c);
      applySentence(state, c, s.fine, s.restitution, s.prisonMonths, 'condenado', `Condenado por ${c.title}.`);
    } else {
      closeCase(state, c, { day: state.day, verdict: 'absuelto', fine: 0, restitution: 0, seized: 0, prisonMonths: 0, suspended: false, text: `Absuelto: el tribunal consideró insuficientes las pruebas (probabilidad de condena estimada: ${fmtPct(p, 0)}).` });
      for (const a of acts) a.status = 'juzgado';
      addLog(state, 'success', '⚖️', `¡Absuelto en el juicio por ${c.title}!`, undefined, 'legal');
    }
  }
}

function applySentence(state: GameState, c: LegalCase, fine: Cents, restitution: Cents, prisonMonths: number, verdict: 'condenado' | 'acuerdo', text: string): void {
  const L = state.legal;
  // Decomiso del efectivo no declarado.
  const seized = state.ledger.balances.undeclared_cash;
  if (seized > 0) post(state.ledger, { day: state.day, memo: 'Decomiso de efectivo no declarado', cf: 'internal', tag: 'legal:seizure', lines: [{ account: 'seizures', debit: seized }, { account: 'undeclared_cash', credit: seized }] });
  const f = addFine(state, c.id, `${verdict === 'acuerdo' ? 'Acuerdo' : 'Sentencia'}: ${c.title}`, fine + restitution, 90);
  const suspended = prisonMonths > 0 && prisonMonths <= 12 && L.criminalRecord === 0;
  L.criminalRecord++;
  const acts = actsOf(state, c);
  for (const a of acts) a.status = 'juzgado';
  // Empresas involucradas: suspensión de licencia en fraudes y sobornos.
  for (const a of acts) {
    const co = a.companyId ? state.companies.find((x) => x.id === a.companyId && isOpen(x)) : null;
    if (co && (a.kind === 'fraude' || a.kind === 'soborno' || a.kind === 'lavado')) {
      co.suspendedUntil = state.day + 30 * Math.min(3, a.severity);
      co.irregular = { inflatedBooks: 0, underreport: 0 };
      co.reputation = Math.max(0, co.reputation - 20);
      addLog(state, 'danger', '⛔', `${co.name}: licencia suspendida hasta el ${formatDate(co.suspendedUntil)} por la condena.`, undefined, 'legal');
    }
  }
  state.player.attributes.reputation = Math.max(0, state.player.attributes.reputation - 10 - acts.length * 3);
  state.player.attributes.network = Math.max(0, state.player.attributes.network - 5);
  closeCase(state, c, { day: state.day, verdict, fine, restitution, seized, prisonMonths, suspended, text: `${text} Multa y restitución: ${fmtMoney(f.balance)}.${seized ? ` Decomiso: ${fmtMoney(seized)}.` : ''}${prisonMonths ? (suspended ? ` Prisión de ${prisonMonths} meses en suspenso (sin antecedentes previos).` : ` Prisión efectiva de ${prisonMonths} meses (ficticia).`) : ''}` });
  if (prisonMonths > 0 && !suspended) goToPrison(state, c, prisonMonths);
  addLog(state, 'danger', '⚖️', c.outcome!.text);
}

function closeCase(state: GameState, c: LegalCase, outcome: NonNullable<LegalCase['outcome']>): void {
  c.stage = 'cerrado';
  c.outcome = outcome;
  c.plea = null;
  note(state, `Caso ${c.id}: ${outcome.text}`);
}

// ------------------------------------------------------------ Prisión (ficticia)

function goToPrison(state: GameState, c: LegalCase, months: number): void {
  state.legal.prison = { from: state.day, until: addMonths(state.day, months), caseId: c.id };
  endEmploymentForPrison(state);
  for (const co of state.companies) {
    if (!isOpen(co)) continue;
    co.delegation = { ...co.delegation, autoReorder: true, autoPricing: true, autoStaffing: true };
    for (const cp of co.campaigns) cp.endDay = Math.min(cp.endDay, state.day);
  }
  for (const o of state.stocks.orders) if (o.status === 'abierta') o.status = 'cancelada';
  state.player.attributes.stress = Math.min(100, state.player.attributes.stress + 30);
  addLog(state, 'danger', '⛓️', `Ingresaste a prisión por ${months} meses (hasta el ${formatDate(state.legal.prison.until)}). Perdiste tu empleo; tus empresas quedan en manos de sus gerentes (o en piloto automático). El tiempo sigue corriendo.`, undefined, 'legal');
}

function releaseFromPrison(state: GameState, early: boolean): void {
  state.legal.prison = null;
  state.player.attributes.stress = Math.max(0, state.player.attributes.stress - 20);
  addLog(state, 'success', '🔓', early ? 'Obtuviste la libertad anticipada por buena conducta.' : 'Cumpliste tu condena y recuperaste la libertad.');
}

// ------------------------------------------------------------ Multas y embargos

/**
 * Registra una multa a pagar. Un importe de cero (por ejemplo, una evasión cuyo
 * impuesto omitido resultó nulo) no genera asiento ni deuda: queda saldada.
 */
function addFine(state: GameState, caseId: number | null, label: string, amount: Cents, days: number): Fine {
  if (amount <= 0) return { id: state.meta.nextId++, caseId, label, balance: 0, original: 0, dueDay: state.day, installment: null, garnishing: false };
  post(state.ledger, { day: state.day, memo: label, cf: 'internal', tag: 'legal:fine', lines: [{ account: 'fines', debit: amount }, { account: 'fines_payable', credit: amount }] });
  const f: Fine = { id: state.meta.nextId++, caseId, label, balance: amount, original: amount, dueDay: state.day + days, installment: null, garnishing: false };
  state.legal.fines.push(f);
  return f;
}

export function payFine(state: GameState, id: number, amount?: Cents): ActionResult {
  const f = state.legal.fines.find((x) => x.id === id && x.balance > 0);
  if (!f) return FAIL('Multa inexistente o pagada.');
  const pay = Math.min(amount ?? f.balance, f.balance);
  if (!(pay > 0)) return FAIL('Monto inválido.');
  if (!canPayFromChecking(state, pay)) return FAIL(`Necesitás ${fmtMoney(pay)} en la cuenta corriente.`);
  post(state.ledger, { day: state.day, memo: `Pago: ${f.label}`, cf: 'operating', tag: 'legal:fine_payment', lines: [{ account: 'fines_payable', debit: pay }, { account: 'checking', credit: pay }] });
  f.balance -= pay;
  return OK(f.balance ? `Pagaste ${fmtMoney(pay)}; quedan ${fmtMoney(f.balance)}.` : 'Multa pagada por completo.');
}

/** Plan de pagos: 12 cuotas (con 10 % de recargo) y sin embargo mientras se paguen. */
export function finePlan(state: GameState, id: number): ActionResult {
  const f = state.legal.fines.find((x) => x.id === id && x.balance > 0);
  if (!f) return FAIL('Multa inexistente o pagada.');
  if (f.installment) return FAIL('Ya tiene un plan de pagos.');
  const extra = roundCents(f.balance * 0.1);
  // En saldos de pocos centavos el recargo redondea a cero: no hay asiento.
  if (extra > 0) post(state.ledger, { day: state.day, memo: `Recargo por plan de pagos: ${f.label}`, cf: 'internal', tag: 'legal:fine', lines: [{ account: 'fines', debit: extra }, { account: 'fines_payable', credit: extra }] });
  f.balance += extra;
  f.installment = Math.max(1, roundCents(f.balance / 12));
  f.garnishing = false;
  f.dueDay = state.day + 30;
  return OK(`Plan aprobado: 12 cuotas de ${fmtMoney(f.installment)}.`);
}

/** Cobro mensual: cuotas del plan y embargos si la multa venció. */
function processFines(state: GameState): void {
  for (const f of state.legal.fines) {
    if (f.balance <= 0 || state.day < f.dueDay) continue;
    if (f.installment && !f.garnishing) {
      const pay = Math.min(f.installment, f.balance);
      if (canPayFromChecking(state, pay)) {
        post(state.ledger, { day: state.day, memo: `Cuota: ${f.label}`, cf: 'operating', tag: 'legal:fine_payment', lines: [{ account: 'fines_payable', debit: pay }, { account: 'checking', credit: pay }] });
        f.balance -= pay;
        f.dueDay = state.day + 30;
        continue;
      }
    }
    if (!f.garnishing) {
      f.garnishing = true;
      addLog(state, 'danger', '🔨', f.installment ? `EMBARGO: no alcanzó para la cuota de "${f.label}". Se embarga todo el saldo pendiente de tus cuentas y, si no alcanza, de tus inversiones.` : `EMBARGO: venció "${f.label}" sin pagar. Se embargarán tus cuentas y, si no alcanza, tus inversiones.`, undefined, 'legal');
      recordLate(state);
      refreshCreditScore(state);
    }
    garnish(state, f);
  }
  state.legal.fines = state.legal.fines.filter((f) => f.balance > 0 || state.day - f.dueDay < 365);
}

function garnish(state: GameState, f: Fine): void {
  const b = state.ledger.balances;
  const take = (account: 'checking' | 'savings' | 'cash_wallet', amt: Cents) => {
    const t = Math.min(amt, b[account], f.balance);
    if (t <= 0) return;
    post(state.ledger, { day: state.day, memo: `Embargo por ${f.label}`, cf: 'operating', tag: 'legal:garnish', lines: [{ account: 'fines_payable', debit: t }, { account: account, credit: t }] });
    f.balance -= t;
  };
  take('checking', f.balance);
  take('savings', f.balance);
  if (f.balance <= 0) return;
  // Venta forzada de inversiones financieras.
  revalueInvestments(state);
  for (const cls of ['funds', 'stocks', 'bonds', 'mogul'] as const) {
    const hs = holdingsOf(state, cls);
    for (const id of Object.keys(hs)) {
      if (f.balance <= 0) return;
      const h = hs[id];
      const price = markPrice(state, cls, id);
      if (price <= 0) continue;
      const qtyNeeded = Math.min(h.qty, cls === 'stocks' || cls === 'bonds' ? Math.ceil(f.balance / price) : f.balance / price);
      const gross = roundCents(qtyNeeded * price * 0.97);
      bookSell(state, cls, id, qtyNeeded, gross, 0, `Venta judicial por embargo (${f.label})`);
      take('checking', gross);
    }
  }
  // Cuentas con gestor: se ordena al gestor liquidar lo necesario.
  for (const m of activeMandates(state)) {
    if (f.balance <= 0) break;
    const before = state.ledger.balances.checking;
    withdrawMandate(state, m.id, Math.min(f.balance, Math.round(mandateValue(state, m))), 'embargo judicial');
    take('checking', Math.min(f.balance, state.ledger.balances.checking - before));
  }
  if (f.balance > 0) addLog(state, 'danger', '🔨', `El embargo no alcanzó a cubrir "${f.label}": quedan ${fmtMoney(f.balance)}. Se seguirá embargando cada mes.`, undefined, 'legal');
}

// ------------------------------------------------------------ Inspecciones (con opción de pagar, impugnar o sobornar)

function inspections(state: GameState): void {
  if (state.meta.projection) return;
  for (const co of state.companies) {
    if (!isOpen(co) || sectorOf(co).model === 'holding' || state.legal.inspections.some((i) => i.companyId === co.id && !i.resolved)) continue;
    const p = 0.025 * jurisdictionById(co.jurisdiction).enforcement * (co.maintenance === 'none' ? 1.6 : 1);
    if (!chance(state, p)) continue;
    const revenue = co.history[co.history.length - 1]?.revenue ?? 0;
    const fine = Math.max(usd(300 * state.macro.priceIndex), roundCents(revenue * randRange(state, 0.03, 0.1)));
    const reasons = ['falta de habilitación de un depósito', 'incumplimientos de seguridad e higiene', 'documentación laboral incompleta', 'cartelería obligatoria faltante'];
    const reason = reasons[randInt(state, 0, reasons.length - 1)];
    state.legal.inspections.push({ id: state.meta.nextId++, companyId: co.id, fine, reason, dueDay: state.day + 30, resolved: false });
    addLog(state, 'warning', '📋', `${co.name}: una inspección detectó ${reason}. Multa de ${fmtMoney(fine)}: podés pagarla o impugnarla con un abogado (vence en 30 días).`, undefined, 'legal');
  }
  for (const i of state.legal.inspections) {
    if (i.resolved || state.day < i.dueDay) continue;
    const co = state.companies.find((c) => c.id === i.companyId && isOpen(c));
    i.resolved = true;
    if (co) {
      coPay(state, co, 'fines', i.fine * 2, { memo: 'Multa de inspección vencida (duplicada)', tag: 'inspection', kind: 'otros' });
      addLog(state, 'danger', '📋', `${co.name}: la multa de inspección venció y se duplicó.`, undefined, 'legal');
    }
  }
  state.legal.inspections = state.legal.inspections.filter((i) => !i.resolved || state.day - i.dueDay < 120);
}

export function resolveInspection(state: GameState, id: number, how: 'pagar' | 'impugnar' | 'sobornar'): ActionResult {
  const i = state.legal.inspections.find((x) => x.id === id && !x.resolved);
  if (!i) return FAIL('Inspección inexistente o resuelta.');
  const co = state.companies.find((c) => c.id === i.companyId && isOpen(c));
  if (!co) return FAIL('Empresa inexistente.');
  if (how === 'pagar') {
    if (co.ledger.balances.cash < i.fine) return FAIL('La empresa no tiene caja suficiente.');
    coPay(state, co, 'fines', i.fine, { memo: `Multa de inspección (${i.reason})`, tag: 'inspection', allowArrears: false });
    i.resolved = true;
    return OK('Multa pagada.');
  }
  if (how === 'impugnar') {
    const lawyer = hiredPro(state, 'abogado', co.id) ?? hiredPro(state, 'abogado', 'personal');
    if (!lawyer) return FAIL('Para impugnar necesitás un abogado contratado.');
    const cost = roundCents(lawyer.fee * 0.5);
    coPay(state, co, 'professional_fees', cost, { memo: `Impugnación de multa (${lawyer.name})`, tag: 'legal', kind: 'otros' });
    i.resolved = true;
    if (chance(state, clamp(0.3 + lawyer.quality / 200, 0.3, 0.8))) return OK(`${lawyer.name} logró anular la multa.`);
    coPay(state, co, 'fines', i.fine, { memo: `Multa de inspección confirmada (${i.reason})`, tag: 'inspection', kind: 'otros' });
    return FAIL('La impugnación fue rechazada: se pagó la multa.');
  }
  const why = enabled(state);
  if (why) return FAIL(why);
  const cost = roundCents(i.fine * 0.4);
  const pay = payIllicit(state, cost, 'Pago no documentado a un inspector');
  if (!pay.ok) return FAIL(`Se necesitan ${fmtMoney(cost)}.`);
  const act = addAct(state, { kind: 'soborno', label: `${co.name}: soborno a un inspector`, benefit: i.fine - cost, amount: cost, evidence: pay.traced ? 50 : 30, severity: 2, witnesses: 1, jurisdiction: co.jurisdiction, companyId: co.id });
  i.resolved = true;
  if (!chance(state, clamp(0.7 - jurisdictionById(co.jurisdiction).enforcement * 0.1, 0.3, 0.85))) {
    act.evidence = 90;
    openCase(state, [act], 'penal', 'El inspector rechazó el pago y lo denunció.');
    coPay(state, co, 'fines', i.fine, { memo: 'Multa de inspección', tag: 'inspection', kind: 'otros' });
    return FAIL('El inspector rechazó el pago y lo denunció: se abrió un caso penal y además hay que pagar la multa.');
  }
  return OK('El inspector aceptó y "olvidó" la infracción.');
}

// ------------------------------------------------------------ Defensa legal

export function assignLawyer(state: GameState, caseId: number, hireId: number | null): ActionResult {
  const c = state.legal.cases.find((x) => x.id === caseId && x.stage !== 'cerrado');
  if (!c) return FAIL('Caso inexistente o cerrado.');
  if (hireId !== null && !state.pros.hires.some((h) => h.id === hireId && h.pro.kind === 'abogado')) return FAIL('Primero contratá un abogado en Profesionales.');
  c.lawyerHireId = hireId;
  return OK(hireId ? 'Abogado asignado al caso.' : 'Te representará un defensor público (gratuito, con menos recursos).');
}

/** Revisión del expediente: estima la fuerza de la acusación (con error según la calidad del abogado). */
export function reviewCase(state: GameState, caseId: number): ActionResult {
  const c = state.legal.cases.find((x) => x.id === caseId && x.stage !== 'cerrado');
  if (!c) return FAIL('Caso inexistente o cerrado.');
  if (c.kind === 'fiscal') return FAIL('En un proceso fiscal no hay juicio: la autoridad liquida el impuesto y la multa al terminar la investigación. Lo que cuenta es tener un abogado asignado (baja la multa).');
  const l = lawyerOf(state, c);
  if (!l) return FAIL('Necesitás un abogado asignado para revisar el expediente.');
  chargeLawyer(state, c, 0.5, 'Revisión del expediente');
  c.reviewed = true;
  practice(state, 'case_review', 'law', 40);
  return OK('Expediente revisado: ahora ves una estimación de las pruebas y de la probabilidad de condena.');
}

/** Estimación visible de la probabilidad de condena (con error si el abogado es mediocre). */
export function estimatedConviction(state: GameState, c: LegalCase): { estimate: number; error: number } | null {
  if (!c.reviewed) return null;
  const l = lawyerOf(state, c);
  const error = l ? clamp(0.25 - l.quality * 0.002, 0.05, 0.25) : 0.25;
  const bias = ((c.id % 7) - 3) / 3;
  return { estimate: clamp(convictionProbability(state, c) + bias * error, 0.05, 0.95), error };
}

export function prepareDefense(state: GameState, caseId: number): ActionResult {
  const c = state.legal.cases.find((x) => x.id === caseId && x.stage !== 'cerrado');
  if (!c) return FAIL('Caso inexistente o cerrado.');
  if (c.kind === 'fiscal') return FAIL('En un proceso fiscal no hay juicio que preparar: con un abogado asignado, la multa final es menor.');
  const l = lawyerOf(state, c);
  if (!l) return FAIL('Necesitás un abogado asignado.');
  const cost = l.fee;
  if (!canPayFromChecking(state, cost)) return FAIL(`Preparar la defensa cuesta ${fmtMoney(cost)}.`);
  post(state.ledger, { day: state.day, memo: `Preparación de la defensa (${l.name})`, cf: 'operating', tag: 'legal:fees', lines: [{ account: 'legal_costs', debit: cost }, { account: 'checking', credit: cost }] });
  const gain = (100 - c.defense) * (0.1 + l.quality / 500);
  c.defense = clamp(c.defense + gain, 0, 95);
  practice(state, 'defense', 'law', 30);
  return OK(`Defensa reforzada (preparación ${Math.round(c.defense)}/100). Rendimientos decrecientes: cada sesión suma menos.`);
}

export function negotiatePlea(state: GameState, caseId: number): ActionResult {
  const c = state.legal.cases.find((x) => x.id === caseId && x.stage === 'imputacion');
  if (!c || !c.plea) return FAIL('Solo se negocia un acuerdo durante la imputación.');
  const l = lawyerOf(state, c);
  if (!l) return FAIL('Necesitás un abogado para negociar.');
  if ((c.negotiations ?? 0) >= 2) return FAIL('La fiscalía no acepta más contraofertas.');
  c.negotiations = (c.negotiations ?? 0) + 1;
  chargeLawyer(state, c, 0.5, 'Negociación con la fiscalía');
  if (chance(state, clamp(0.35 + l.quality / 200, 0.35, 0.85))) {
    c.plea.fine = roundCents(c.plea.fine * (1 - l.quality / 400));
    c.plea.prisonMonths = Math.max(0, Math.floor(c.plea.prisonMonths * (1 - l.quality / 250)));
    return OK(`La fiscalía mejoró la oferta: ${fmtMoney(c.plea.fine)}${c.plea.prisonMonths ? ` y ${c.plea.prisonMonths} meses` : ' sin prisión'}.`);
  }
  return FAIL('La fiscalía mantuvo su oferta.');
}

export function acceptPlea(state: GameState, caseId: number): ActionResult {
  const c = state.legal.cases.find((x) => x.id === caseId && x.stage === 'imputacion');
  if (!c || !c.plea) return FAIL('No hay oferta de acuerdo vigente.');
  const p = c.plea;
  applySentence(state, c, p.fine, 0, p.prisonMonths, 'acuerdo', `Acuerdo con la fiscalía por ${c.title}.`);
  return OK('Acuerdo firmado: el caso se cerró con condena reducida.');
}

export function goToTrial(state: GameState, caseId: number): ActionResult {
  const c = state.legal.cases.find((x) => x.id === caseId && x.stage === 'imputacion');
  if (!c) return FAIL('El caso no está en etapa de imputación.');
  c.nextStepDay = state.day;
  advanceCase(state, c);
  return OK('Rechazaste el acuerdo: el caso irá a juicio.');
}

export function appeal(state: GameState, caseId: number): ActionResult {
  const c = state.legal.cases.find((x) => x.id === caseId && x.stage === 'cerrado' && x.outcome?.verdict === 'condenado');
  if (!c || !c.outcome) return FAIL('Solo se apela una condena.');
  if (state.day - c.outcome.day > 30) return FAIL('El plazo para apelar (30 días) venció.');
  if (c.appealed) return FAIL('Ya apelaste esta sentencia.');
  const l = lawyerOf(state, c) ?? hiredPro(state, 'abogado', 'personal');
  if (!l) return FAIL('Necesitás un abogado personal para apelar (contratalo en Profesionales).');
  const cost = l.fee * 2;
  if (!canPayFromChecking(state, cost)) return FAIL(`La apelación cuesta ${fmtMoney(cost)}.`);
  // Recién ahora se usa la apelación: sin abogado o sin dinero, todavía podés intentarla.
  c.appealed = true;
  post(state.ledger, { day: state.day, memo: `Apelación (${l.name})`, cf: 'operating', tag: 'legal:fees', lines: [{ account: 'legal_costs', debit: cost }, { account: 'checking', credit: cost }] });
  if (!chance(state, clamp(0.15 + l.quality / 400, 0.15, 0.4))) return FAIL('La cámara de apelaciones confirmó la sentencia.');
  // Reducción a la mitad de la multa pendiente y de la prisión.
  const f = state.legal.fines.find((x) => x.caseId === c.id && x.balance > 0);
  if (f) {
    const cut = roundCents(f.balance / 2);
    post(state.ledger, { day: state.day, memo: 'Reducción de multa por apelación', cf: 'internal', tag: 'legal:appeal', lines: [{ account: 'fines_payable', debit: cut }, { account: 'fines', credit: cut }] });
    f.balance -= cut;
  }
  if (state.legal.prison && state.legal.prison.caseId === c.id) {
    const left = state.legal.prison.until - state.day;
    state.legal.prison.until = state.day + Math.round(left / 2);
  }
  return OK('¡La apelación prosperó! La multa pendiente y la prisión restante se redujeron a la mitad.');
}

/** Intentar sobornar al investigador (muy riesgoso). */
export function bribeInvestigator(state: GameState, caseId: number): ActionResult {
  const why = enabled(state);
  if (why) return FAIL(why);
  const c = state.legal.cases.find((x) => x.id === caseId && x.stage === 'investigacion');
  if (!c) return FAIL('Solo durante la investigación.');
  const cost = usd(15000 * state.macro.priceIndex);
  const pay = payIllicit(state, cost, 'Pago no documentado a un investigador');
  if (!pay.ok) return FAIL(`Se necesitan ${fmtMoney(cost)}.`);
  const act = addAct(state, { kind: 'soborno', label: 'Soborno a un investigador', benefit: 0, amount: cost, evidence: 70, severity: 4, witnesses: 1, jurisdiction: state.tax.jurisdiction });
  if (chance(state, clamp(0.3 - jurisdictionById(state.tax.jurisdiction).enforcement * 0.1, 0.05, 0.3))) {
    closeCase(state, c, { day: state.day, verdict: 'archivado', fine: 0, restitution: 0, seized: 0, prisonMonths: 0, suspended: false, text: 'La investigación se archivó "por falta de pruebas".' });
    for (const a of actsOf(state, c)) a.status = 'oculto';
    return OK('El investigador aceptó: el caso se archivó. El soborno queda como un nuevo delito que puede descubrirse.');
  }
  act.status = 'investigado';
  c.acts.push(act.id);
  c.prosecution = clamp(c.prosecution + 25, 0, 100);
  return FAIL('El investigador rechazó el soborno y lo sumó al expediente: la acusación se fortaleció mucho.');
}

// ------------------------------------------------------------ Consultas

export function openCases(state: GameState): LegalCase[] {
  return state.legal.cases.filter((c) => c.stage !== 'cerrado');
}

export function legalRiskSummary(state: GameState) {
  const hidden = state.legal.acts.filter((a) => a.status === 'oculto');
  const pending = state.legal.fines.reduce((s, f) => s + f.balance, 0);
  return { heat: state.legal.heat, hiddenActs: hidden.length, exposure: hidden.reduce((s, a) => s + a.benefit, 0), openCases: openCases(state).length, pendingFines: pending, record: state.legal.criminalRecord, prison: state.legal.prison };
}

export function heatLabel(h: number): string {
  return h < 15 ? 'Baja' : h < 35 ? 'Moderada' : h < 60 ? 'Alta' : 'Muy alta';
}

export function jurisdictionName(id: JurisdictionId): string {
  return jurisdictionById(id).name;
}

export const _test = { advanceCase, openCase, addFine, garnish, dayOf };
