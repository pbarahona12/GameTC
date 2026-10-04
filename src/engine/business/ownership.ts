import type { GameState } from '../state';
import type { Company, ProductState, ReorderRule } from './types';
import { SECTOR_BY_ID, BizSectorId, LegalForm, LEGAL_FORM_BY_ID, SectorDef, roleDef } from '../../content/sectors';
import { emptyCoLedger, coPost } from './companyLedger';
import { px, coLog, coEquity, distributableProfit, isOpen, sectorOf, monthlyPayroll, monthlyFixed } from './common';
import { generateCandidates, hire } from './staff';
import { inventoryValue, supplierAccessible } from './inventory';
import { valuation } from './reports';
import { post } from '../ledger/ledger';
import { canPayFromChecking } from '../finance/payments';
import { Cents, clamp, roundCents } from '../money';
import { ActionResult, FAIL, OK } from '../result';
import { fmtMoney, fmtPct } from '../format';
import { addLog } from '../log';
import { chance, randRange } from '../rng';
import { practice } from '../skills/skills';
import { refreshCreditScore, recordLate } from '../finance/credit';
import type { JurisdictionId } from '../../content/jurisdictions';
import { jurisdictionById } from '../../content/jurisdictions';
import { parentOf, childrenOf, groupMembers, isHolding, canJoinGroup, settleIcLoansOnExit } from './groups';
import { hiredPro } from '../pros/lookup';
import { residence } from '../tax/taxEngine';

export const SETUP_DAYS = 7;
export const ACQUISITION_FEE = 0.03;
export const SALE_FEE = 0.03;

// ------------------------------------------------------------ Creación

export interface SetupCosts {
  legal: Cents;
  license: Cents;
  deposit: Cents;
  equipment: Cents;
  hiring: Cents;
  total: Cents;
  firstMonthFixed: Cents;
  firstMonthPayroll: Cents;
  recommended: Cents;
}

export function setupCosts(state: GameState, sector: BizSectorId, form: LegalForm): SetupCosts {
  const sec = SECTOR_BY_ID[sector];
  const legal = px(state, LEGAL_FORM_BY_ID[form].setupCost);
  const license = px(state, sec.license);
  // Holding (1.2): sin subsidiarias solo necesita un domicilio legal (80 USD/mes).
  const rentBase = sector === 'holding' ? 80 : sec.rent;
  const utilBase = sector === 'holding' ? 20 : sec.utilities;
  const deposit = px(state, rentBase * sec.depositMonths);
  const equipment = sec.starterEquipment.reduce((s, id) => s + px(state, sec.equipment.find((e) => e.id === id)!.cost), 0);
  let payroll = 0;
  let hiring = 0;
  for (const [role, n] of Object.entries(sec.starterStaff)) {
    payroll += px(state, roleDef(sec, role).baseWage) * n;
    hiring += roundCents(px(state, roleDef(sec, role).baseWage) * 0.25) * n;
  }
  const firstMonthPayroll = roundCents(payroll * 1.12);
  const firstMonthFixed = px(state, rentBase + utilBase + LEGAL_FORM_BY_ID[form].monthlyAdmin);
  return { legal, license, deposit, equipment, hiring, total: legal + license + deposit + equipment + hiring, firstMonthFixed, firstMonthPayroll, recommended: px(state, sec.recommendedCapital) };
}

export function sectorRequirement(state: GameState, sector: SectorDef): { met: boolean; label: string } | null {
  if (!sector.requirements) return null;
  const met = state.skills.accounting.level >= 10 || state.education.certificates.includes('Contable básico');
  return { met, label: sector.requirements.label };
}

function defaultRules(state: GameState, sec: SectorDef): ReorderRule[] {
  return sec.items.map((it) => {
    const sups = sec.suppliers.filter((s) => s.itemId === it.id && supplierAccessible(state, s)).sort((a, b) => a.unitCost - b.unitCost);
    const s = sups[0] ?? sec.suppliers.find((x) => x.itemId === it.id)!;
    // Uso diario estimado con ~8 % de cuota de mercado.
    let use = 0;
    for (const p of sec.products) for (const r of p.recipe) if (r.item === it.id) use += p.marketDaily * 0.08 * r.qty;
    const qty = Math.max(s.minOrder, Math.ceil(use * Math.min(10, it.shelfLifeDays ?? 10)));
    return { item: it.id, enabled: true, supplierId: s.id, reorderPoint: Math.ceil(use * (s.leadDays + 2)), orderQty: qty };
  });
}

/** Construye una empresa nueva sin tocar las finanzas personales. */
export function buildCompany(state: GameState, sector: BizSectorId, name: string, form: LegalForm, color: string, npc = false, jurisdiction: JurisdictionId = state.tax.jurisdiction): Company {
  const sec = SECTOR_BY_ID[sector];
  const products: ProductState[] = sec.products.map((p) => ({ id: p.id, price: px(state, p.refPrice), active: true, plan: sec.model === 'manufacturing' ? Math.max(1, Math.round(p.marketDaily * 0.05)) : 0, finished: [] }));
  return {
    id: state.meta.nextId++, name: name.trim() || sec.name, color, sector, legalForm: form, foundedDay: state.day, acquiredDay: null, status: 'active',
    ownership: 1 - LEGAL_FORM_BY_ID[form].partnerShare, carrying: 0, goodwill: 0, ledger: emptyCoLedger(), products, inventory: [], orders: [], payables: [],
    receivables: [], arrears: [], rules: defaultRules(state, sec), blockedSuppliers: [], employees: [], candidates: [], assets: [], maintenance: 'basic', campaigns: [],
    awareness: 10, reputation: 40, quality: 50, materialQuality: 60, rdBonus: 0, subscribers: 0,
    delegation: { autoReorder: false, autoPricing: false, autoStaffing: false, targetMarkup: 1.5 },
    dividendPolicy: { frequency: 'none', payout: 0.5, reserveDays: 60 }, stats: [], history: [], loans: [], lossCarry: [], insolventSince: null,
    research: null, capitalRaised: 0, lastWeeklyDay: state.day, openDay: state.day + SETUP_DAYS, npc, investedByOwner: 0, receivedByOwner: 0, saleOffer: null, taxFilings: [],
    jurisdiction, parentId: null, group: null, suspendedUntil: null, irregular: { inflatedBooks: 0, underreport: 0 }, managementFee: 0, embezzlement: null,
  };
}

/** Gastos de instalación con la caja de la empresa: trámites, licencia, depósito, equipos y personal inicial. */
export function installCompany(state: GameState, co: Company): void {
  const sec = sectorOf(co);
  const c = setupCosts(state, co.sector, co.legalForm);
  coPost(co.ledger, { day: state.day, memo: 'Constitución legal y licencias', cf: 'operating', tag: 'admin', lines: [{ account: 'admin', debit: c.legal + c.license }, { account: 'cash', credit: c.legal + c.license }] });
  coPost(co.ledger, { day: state.day, memo: 'Depósito en garantía del local', cf: 'investing', tag: 'deposit', lines: [{ account: 'deposits_paid', debit: c.deposit }, { account: 'cash', credit: c.deposit }] });
  for (const id of sec.starterEquipment) {
    const def = sec.equipment.find((e) => e.id === id)!;
    const cost = px(state, def.cost);
    coPost(co.ledger, { day: state.day, memo: `Compra de ${def.name}`, cf: 'investing', tag: 'capex', lines: [{ account: 'fixed_assets', debit: cost }, { account: 'cash', credit: cost }] });
    co.assets.push({ id: state.meta.nextId++, equipId: id, cost, bookValue: cost, boughtDay: state.day, condition: 100, brokenUntil: state.day - 1 });
  }
  // Personal inicial: se contrata al salario base del puesto (el costo de selección es exactamente el presupuestado).
  for (const [role, n] of Object.entries(sec.starterStaff)) {
    for (let i = 0; i < n; i++) {
      const cands = generateCandidates(state, co, role);
      const best = cands.sort((a, b) => b.skill - a.skill)[0];
      best.wage = px(state, roleDef(sec, role).baseWage);
      best.skill = Math.min(best.skill, 60);
      hire(state, co, best.id, true);
    }
  }
  co.candidates = [];
}

export interface FoundOptions {
  sector: BizSectorId;
  name: string;
  legalForm: LegalForm;
  capital: Cents;
  color?: string;
  /** Jurisdicción de registro (por defecto, tu residencia fiscal). */
  jurisdiction?: JurisdictionId;
  /** Fundarla como subsidiaria de una holding tuya (el capital sale de la holding). */
  parentId?: number | null;
}

export function foundCompany(state: GameState, o: FoundOptions): ActionResult {
  const sec = SECTOR_BY_ID[o.sector];
  if (!sec) return FAIL('Sector inexistente.');
  const lf = LEGAL_FORM_BY_ID[o.legalForm];
  if (!lf) return FAIL('Forma legal inexistente.');
  const req = sectorRequirement(state, sec);
  if (req && !req.met) return FAIL(`Requisito: ${req.label}.`);
  if (!o.name.trim()) return FAIL('Poné un nombre comercial.');
  if (state.companies.some((c) => isOpen(c) && c.name.toLowerCase() === o.name.trim().toLowerCase())) return FAIL('Ya tenés una empresa con ese nombre.');
  const costs = setupCosts(state, o.sector, o.legalForm);
  const partnerCapital = lf.partnerShare > 0 ? roundCents((o.capital * lf.partnerShare) / (1 - lf.partnerShare)) : 0;
  const total = o.capital + partnerCapital;
  if (total < costs.total) return FAIL(`El capital total (${fmtMoney(total)}) no cubre la instalación (${fmtMoney(costs.total)}).`);
  if (state.legal?.prison) return FAIL('Desde prisión no podés fundar empresas.');
  const parent = o.parentId ? state.companies.find((c) => c.id === o.parentId && isOpen(c)) ?? null : null;
  if (o.parentId) {
    if (!parent || !isHolding(parent)) return FAIL('La matriz debe ser una holding tuya en operación.');
    if (!lf.limitedLiability) return FAIL('Una subsidiaria debe ser SRL o corporación.');
    if (parent.ledger.balances.cash < o.capital) return FAIL(`${parent.name} no tiene ${fmtMoney(o.capital)} de caja.`);
  } else if (!canPayFromChecking(state, o.capital)) return FAIL(`Necesitás ${fmtMoney(o.capital)} en tu cuenta corriente (o en ahorro con barrido activo).`);
  const co = buildCompany(state, o.sector, o.name, o.legalForm, o.color ?? '#d2a94f', false, o.jurisdiction ?? state.tax.jurisdiction);
  if (parent) {
    coPost(parent.ledger, { day: state.day, memo: `Aporte de capital a ${co.name}`, cf: 'investing', tag: 'subsidiary:capital', lines: [{ account: 'subsidiaries', debit: o.capital }, { account: 'cash', credit: o.capital }] });
    co.parentId = parent.id;
  } else post(state.ledger, { day: state.day, memo: `Aporte de capital a ${co.name}`, cf: 'investing', tag: 'business:capital', lines: [{ account: 'business_equity', debit: o.capital }, { account: 'checking', credit: o.capital }] });
  coPost(co.ledger, { day: state.day, memo: 'Aporte de capital inicial', cf: 'financing', tag: 'capital', lines: [{ account: 'cash', debit: total }, { account: 'capital', credit: total }] });
  co.carrying = o.capital;
  co.investedByOwner = o.capital;
  state.companies.push(co);
  installCompany(state, co);
  revalueChain(state, co);
  practice(state, 'found', 'management', 400);
  addLog(state, 'success', sec.icon, `Fundaste ${co.name} (${sec.name}, ${lf.name}). Abre al público en ${SETUP_DAYS} días.${partnerCapital ? ` Tu socio aportó ${fmtMoney(partnerCapital)} y tiene el ${fmtPct(lf.partnerShare, 0)}.` : ''}`, o.capital);
  state.log[state.log.length - 1].company = co.id;
  return OK(`${co.name} creada. Instalación: ${fmtMoney(costs.total)}. Caja restante de la empresa: ${fmtMoney(co.ledger.balances.cash)}.`);
}

// ------------------------------------------------------------ Método de participación

/**
 * Método de participación: tu inversión en cada empresa vale tu porcentaje de
 * su patrimonio contable más la plusvalía pagada. Cuando la empresa gana o
 * pierde, el patrimonio de su DUEÑO cambia en la misma proporción. El dueño es
 * el jugador (cuenta personal "Participaciones en empresas") o una holding
 * (cuenta "Inversiones en subsidiarias" de la matriz).
 * Con responsabilidad limitada no baja de cero; con responsabilidad ilimitada
 * el patrimonio negativo se refleja como pérdida recién al liquidar.
 */
export function targetCarrying(co: Company): Cents {
  if (co.status === 'bankrupt' || co.status === 'closed' || co.status === 'sold') return 0;
  return Math.max(0, roundCents(coEquity(co) * co.ownership) + co.goodwill);
}

export function revalue(state: GameState, co: Company): void {
  const target = targetCarrying(co);
  const delta = target - co.carrying;
  if (delta === 0) return;
  const parent = parentOf(state, co);
  if (parent) {
    coPost(parent.ledger, {
      day: state.day, memo: `Resultado de ${co.name} (método de participación)`, cf: 'internal', tag: 'subsidiary:equity',
      lines: delta > 0 ? [{ account: 'subsidiaries', debit: delta }, { account: 'subsidiary_results', credit: delta }] : [{ account: 'subsidiary_results', debit: -delta }, { account: 'subsidiaries', credit: -delta }],
    });
  } else {
    post(state.ledger, {
      day: state.day, memo: `Resultado de ${co.name} (método de participación)`, cf: 'internal', tag: 'business:equity',
      lines: delta > 0 ? [{ account: 'business_equity', debit: delta }, { account: 'business_results', credit: delta }] : [{ account: 'business_results', debit: -delta }, { account: 'business_equity', credit: -delta }],
    });
  }
  co.carrying = target;
}

/** Revalúa una empresa y luego toda su cadena de matrices (de abajo hacia arriba). */
export function revalueChain(state: GameState, co: Company): void {
  let c: Company | null = co;
  for (let i = 0; c && i < 10; i++) {
    revalue(state, c);
    c = parentOf(state, c);
  }
}

/** Tasas de la empresa según su forma legal y su jurisdicción. */
export function companyTaxRates(co: Company): { corporate: number; dividend: number } {
  const lf = LEGAL_FORM_BY_ID[co.legalForm];
  const j = jurisdictionById(co.jurisdiction);
  return lf.passThrough ? { corporate: 0, dividend: 0 } : { corporate: j.corporateRate, dividend: j.dividendRate };
}

// ------------------------------------------------------------ Aportes y retiros

export function injectCapital(state: GameState, co: Company, amount: Cents): ActionResult {
  if (!isOpen(co)) return FAIL('La empresa no está operando.');
  if (!(amount > 0)) return FAIL('Ingresá un monto mayor a cero.');
  const parent = parentOf(state, co);
  if (parent) {
    if (parent.ledger.balances.cash < amount) return FAIL(`${parent.name} (la matriz) no tiene esa caja disponible.`);
  } else if (!canPayFromChecking(state, amount)) return FAIL('Fondos personales insuficientes en la cuenta corriente.');
  const eq = coEquity(co);
  if (co.ownership < 1 && eq > 0) co.ownership = clamp((co.ownership * eq + amount) / (eq + amount), 0, 1);
  if (parent) coPost(parent.ledger, { day: state.day, memo: `Aporte de capital a ${co.name}`, cf: 'investing', tag: 'subsidiary:capital', lines: [{ account: 'subsidiaries', debit: amount }, { account: 'cash', credit: amount }] });
  else post(state.ledger, { day: state.day, memo: `Aporte de capital a ${co.name}`, cf: 'investing', tag: 'business:capital', lines: [{ account: 'business_equity', debit: amount }, { account: 'checking', credit: amount }] });
  coPost(co.ledger, { day: state.day, memo: parent ? `Aporte de capital de ${parent.name}` : 'Aporte de capital del dueño', cf: 'financing', tag: 'capital', lines: [{ account: 'cash', debit: amount }, { account: 'capital', credit: amount }] });
  co.carrying += amount;
  co.investedByOwner += amount;
  revalueChain(state, co);
  return OK(`${parent ? parent.name : 'Aportaste'} ${parent ? 'aportó' : ''} ${fmtMoney(amount)} a ${co.name}.${co.ownership < 1 ? ` Participación: ${fmtPct(co.ownership, 1)}.` : ''}`.replace('  ', ' '));
}

export function maxDistribution(state: GameState, co: Company): { max: Cents; reserve: Cents; cashLimit: Cents; legalLimit: Cents | null } {
  // Reserva: gastos fijos de los días elegidos, más el capital de los bonos que vencen dentro de 12 meses.
  const bondsDue = co.loans.filter((l) => l.bullet && l.balance > 0 && l.termMonths - l.paymentsMade - l.missed <= 12).reduce((a, l) => a + l.balance, 0);
  const reserve = roundCents(((monthlyPayroll(state, co) + monthlyFixed(state, co)) / 30) * co.dividendPolicy.reserveDays) + bondsDue;
  const cashLimit = Math.max(0, co.ledger.balances.cash - reserve - co.ledger.balances.arrears);
  const lf = LEGAL_FORM_BY_ID[co.legalForm];
  const legalLimit = lf.limitedLiability ? Math.max(0, distributableProfit(co)) : null;
  return { max: legalLimit === null ? cashLimit : Math.min(cashLimit, legalLimit), reserve, cashLimit, legalLimit };
}

/**
 * Dividendos (SRL/corporación) o retiros del dueño (individual/sociedad).
 * Límites: caja disponible menos una reserva operativa, y en sociedades de
 * responsabilidad limitada, solo beneficios acumulados distribuibles.
 * Si el dueño es una holding, el dividendo va a su caja sin impuesto
 * (exención por participación); si es el jugador, se retiene el impuesto a los
 * dividendos de la jurisdicción de la empresa.
 */
export function distribute(state: GameState, co: Company, total: Cents, auto = false): ActionResult {
  if (!isOpen(co)) return FAIL('La empresa no está operando.');
  if (co.ledger.balances.arrears > 0) return FAIL('No se puede repartir mientras haya deudas vencidas.');
  const lim = maxDistribution(state, co);
  if (!(total > 0)) return FAIL('Ingresá un monto mayor a cero.');
  if (total > lim.max) {
    return FAIL(lim.legalLimit !== null && lim.legalLimit < lim.cashLimit
      ? `Solo se pueden repartir beneficios acumulados: máximo ${fmtMoney(lim.max)}.`
      : `Máximo disponible ${fmtMoney(lim.max)} (caja menos una reserva de ${fmtMoney(lim.reserve)} para ${co.dividendPolicy.reserveDays} días de gastos).`);
  }
  const lf = LEGAL_FORM_BY_ID[co.legalForm];
  coPost(co.ledger, { day: state.day, memo: lf.passThrough ? 'Retiro de los dueños' : 'Pago de dividendos', cf: 'financing', tag: 'dividend', lines: [{ account: 'distributions', debit: total }, { account: 'cash', credit: total }] });
  const mine = roundCents(total * co.ownership);
  const parent = parentOf(state, co);
  if (parent) {
    coPost(parent.ledger, { day: state.day, memo: `Dividendos de ${co.name} (exentos)`, cf: 'investing', tag: 'subsidiary:dividend', lines: [{ account: 'cash', debit: mine }, { account: 'subsidiaries', credit: mine }] });
    co.carrying -= mine;
    co.receivedByOwner += mine;
    revalueChain(state, co);
    if (!auto) coLog(state, co, 'income', '🏛️', `giró ${fmtMoney(mine)} de dividendos a ${parent.name}.`, mine);
    return OK(`${parent.name} recibió ${fmtMoney(mine)}.`);
  }
  const tax = roundCents(mine * companyTaxRates(co).dividend);
  post(state.ledger, {
    day: state.day, memo: `${lf.passThrough ? 'Retiro' : 'Dividendos'} de ${co.name}`, cf: 'operating', tag: 'business:dividend',
    lines: [{ account: 'checking', debit: mine - tax }, ...(tax > 0 ? [{ account: 'dividend_tax' as const, debit: tax }] : []), { account: 'business_equity', credit: mine }],
  });
  co.carrying -= mine;
  co.receivedByOwner += mine - tax;
  revalue(state, co);
  if (!auto) practice(state, 'dividend', 'finEdu', 60);
  if (!state.meta.projection) {
    addLog(state, 'income', '💰', `${co.name}: ${lf.passThrough ? 'retiraste' : 'cobraste dividendos por'} ${fmtMoney(mine)}${tax ? ` (retención del ${fmtPct(companyTaxRates(co).dividend, 0)}: ${fmtMoney(tax)})` : ''}.`, mine - tax);
    state.log[state.log.length - 1].company = co.id;
  }
  return OK(`Recibiste ${fmtMoney(mine - tax)} en tu cuenta corriente.`);
}

/** Política automática de dividendos al cierre de mes/trimestre/año. */
export function autoDividends(state: GameState, co: Company, month: number): void {
  const p = co.dividendPolicy;
  if (p.frequency === 'none' || p.payout <= 0) return;
  if (p.frequency === 'quarterly' && month % 3 !== 0) return;
  if (p.frequency === 'annual' && month !== 12) return;
  const months = p.frequency === 'monthly' ? 1 : p.frequency === 'quarterly' ? 3 : 12;
  const recent = co.history.slice(-months).reduce((s, h) => s + h.netIncome, 0);
  if (recent <= 0) return;
  const amount = Math.min(roundCents(recent * p.payout), maxDistribution(state, co).max);
  if (amount > 0) distribute(state, co, amount, true);
}

/** Emisión de acciones a inversionistas privados (solo corporaciones). */
export function raiseEquity(state: GameState, co: Company, pct: number): ActionResult {
  if (!LEGAL_FORM_BY_ID[co.legalForm].canRaiseEquity) return FAIL('Solo una corporación puede vender acciones a inversionistas.');
  if (!isOpen(co) || co.status === 'insolvent') return FAIL('Los inversionistas no entran en una empresa insolvente.');
  if (!(pct >= 0.05 && pct <= 0.3)) return FAIL('Se puede vender entre el 5 % y el 30 % por ronda.');
  if (co.ownership * (1 - pct) < 0.51) return FAIL('Perderías el control mayoritario (menos del 51 %).');
  const v = valuation(state, co).value;
  if (v <= 0) return FAIL('La empresa no tiene una valoración positiva para atraer inversionistas.');
  const money = roundCents((v * pct) / (1 - pct));
  coPost(co.ledger, { day: state.day, memo: `Emisión de acciones (${fmtPct(pct, 0)})`, cf: 'financing', tag: 'capital:investors', lines: [{ account: 'cash', debit: money }, { account: 'capital', credit: money }] });
  co.ownership = co.ownership * (1 - pct);
  co.capitalRaised += money;
  revalue(state, co);
  coLog(state, co, 'success', '📈', `vendió el ${fmtPct(pct, 0)} a inversionistas por ${fmtMoney(money)} (valoración previa ${fmtMoney(v)}).`, money);
  return OK(`Ingresaron ${fmtMoney(money)} a la caja. Tu participación: ${fmtPct(co.ownership, 1)}.`);
}

// ------------------------------------------------------------ Compraventa

export function requestSaleOffer(state: GameState, co: Company): ActionResult {
  if (!isOpen(co)) return FAIL('La empresa no está operando.');
  if (co.saleOffer && co.saleOffer.expires >= state.day) return FAIL('Ya tenés una oferta vigente.');
  const v = valuation(state, co);
  let price = roundCents(v.value * randRange(state, 0.85, 1.1));
  if (co.status === 'insolvent') price = roundCents(price * 0.6);
  if (price <= 0) return FAIL('Ningún comprador ofrece dinero por la empresa en su estado actual (valoración cero). Podés cerrarla de forma ordenada.');
  co.saleOffer = { price, expires: state.day + 15 };
  practice(state, 'sale_offer', 'negotiation', 80);
  return OK(`Un comprador ofrece ${fmtMoney(price)} por el 100 % (valoración estimada ${fmtMoney(v.value)}). Válida 15 días.`);
}

/** Quita de la partida lo que pertenece a una empresa que deja de ser tuya (inmuebles, hipotecas, préstamos del grupo). */
function detachCompanyAssets(state: GameState, co: Company): void {
  settleIcLoansOnExit(state, co);
  const props = state.realEstate.properties.filter((p) => p.owner.kind === 'company' && p.owner.id === co.id);
  const ids = new Set(props.map((p) => p.id));
  state.realEstate.properties = state.realEstate.properties.filter((p) => !ids.has(p.id));
  for (const m of state.realEstate.mortgages) if (ids.has(m.propertyId) && m.status === 'activa') m.status = 'pagada';
  state.pros.hires = state.pros.hires.filter((h) => h.scope !== co.id);
  for (const p of state.realEstate.properties) if (p.usedBy === co.id) p.usedBy = null;
}

/** Ganancia de capital personal al vender una participación (precio neto − lo invertido). */
function personalCompanyGain(state: GameState, co: Company, netProceeds: Cents): void {
  const j = residence(state);
  const held = state.day - (co.acquiredDay ?? co.foundedDay);
  const gain = netProceeds - co.investedByOwner;
  const y = state.tax.ytd;
  if (j.capitalGains.longAfterDays > 0 && held >= j.capitalGains.longAfterDays) y.gainsLong = (y.gainsLong ?? 0) + gain;
  else y.gainsShort = (y.gainsShort ?? 0) + gain;
}

/**
 * Venta de la empresa al comprador. Si el dueño es el jugador, la ganancia de
 * capital (precio neto − lo invertido) tributa en su declaración anual según su
 * jurisdicción. Si el dueño es una holding, el resultado queda en la holding.
 * Las subsidiarias de una holding vendida se van con ella.
 */
export function acceptSale(state: GameState, co: Company): ActionResult {
  const o = co.saleOffer;
  if (!o || o.expires < state.day) return FAIL('No hay una oferta vigente.');
  revalue(state, co);
  const mine = roundCents(o.price * co.ownership);
  const fee = roundCents(mine * SALE_FEE);
  const parent = parentOf(state, co);
  const subs = groupMembers(state, co).filter((c) => c !== co);
  if (parent) {
    const gain = mine - fee - co.carrying;
    const lines = [
      ...(mine - fee > 0 ? [{ account: 'cash' as const, debit: mine - fee }] : []),
      ...(fee ? [{ account: 'admin' as const, debit: fee }] : []),
      ...(co.carrying ? [{ account: 'subsidiaries' as const, credit: co.carrying }] : []),
      ...(gain + fee > 0 ? [{ account: 'gain_on_sale' as const, credit: gain + fee }] : []),
      ...(gain + fee < 0 ? [{ account: 'gain_on_sale' as const, debit: -(gain + fee) }] : []),
    ];
    if (lines.length >= 2) coPost(parent.ledger, { day: state.day, memo: `Venta de ${co.name}`, cf: 'investing', tag: 'subsidiary:sale', lines });
  } else {
    const result = mine - co.carrying;
    const lines = [
      ...(mine - fee > 0 ? [{ account: 'checking' as const, debit: mine - fee }] : []),
      ...(fee ? [{ account: 'acquisition_costs' as const, debit: fee }] : []),
      ...(result < 0 ? [{ account: 'business_results' as const, debit: -result }] : []),
      ...(co.carrying ? [{ account: 'business_equity' as const, credit: co.carrying }] : []),
      ...(result > 0 ? [{ account: 'business_results' as const, credit: result }] : []),
    ];
    if (lines.length >= 2) post(state.ledger, { day: state.day, memo: `Venta de ${co.name}`, cf: 'investing', tag: 'business:sale', lines });
    personalCompanyGain(state, co, mine - fee);
  }
  co.receivedByOwner += mine - fee;
  co.carrying = 0;
  co.status = 'sold';
  for (const c of [co, ...subs]) detachCompanyAssets(state, c);
  for (const s of subs) s.status = 'sold';
  state.formerCompanies.push({ id: co.id, name: co.name, sector: co.sector, endDay: state.day, outcome: 'vendida', result: co.receivedByOwner - co.investedByOwner });
  const gone = new Set([co.id, ...subs.map((s) => s.id)]);
  state.companies = state.companies.filter((c) => !gone.has(c.id));
  if (parent) revalueChain(state, parent);
  addLog(state, 'success', '🤝', `${parent ? `${parent.name} vendió` : 'Vendiste'} ${co.name} por ${fmtMoney(mine)} (comisión ${fmtMoney(fee)}).${parent ? '' : ' La ganancia de capital se declara en tu declaración anual.'}`, mine - fee);
  return OK(`Venta concretada: ${fmtMoney(mine - fee)} netos.`);
}

/**
 * Compra de una empresa del mercado de compraventa (a título personal o a través
 * de una holding). Con oferta menor al precio pedido, se negocia una vez.
 * Riesgo de contingencias ocultas (juicios, deudas fiscales): un abogado las
 * detecta en la revisión previa y descuenta su costo del precio.
 */
export function buyListing(state: GameState, listingId: number, offer: Cents, buyerId: number | null = null): ActionResult {
  const l = state.listings.find((x) => x.id === listingId);
  if (!l) return FAIL('La empresa ya no está en venta.');
  if (!(offer > 0)) return FAIL('Ingresá una oferta.');
  if (state.legal?.prison) return FAIL('Desde prisión no podés comprar empresas.');
  const buyer = buyerId ? state.companies.find((c) => c.id === buyerId && isOpen(c)) ?? null : null;
  if (buyerId && (!buyer || !isHolding(buyer))) return FAIL('Solo una holding tuya puede comprar empresas a su nombre.');
  if (buyer) {
    const why = LEGAL_FORM_BY_ID[l.company.legalForm].limitedLiability ? null : 'Una holding solo puede comprar SRL o corporaciones.';
    if (why) return FAIL(why);
  }
  let price = l.askPrice;
  if (offer < l.askPrice) {
    if (l.negotiated) return FAIL('El vendedor ya rechazó una contraoferta. Solo acepta el precio pedido.');
    l.negotiated = true;
    const p = clamp((offer / l.askPrice - 0.75) / 0.25 + state.skills.negotiation.level * 0.004, 0, 0.95);
    practice(state, 'buy_negotiation', 'negotiation', 150);
    if (!chance(state, p)) return FAIL(`El vendedor rechazó ${fmtMoney(offer)} (probabilidad estimada ${Math.round(p * 100)} %). Mantiene ${fmtMoney(l.askPrice)}.`);
    // Aceptada: el precio acordado queda firme aunque la compra falle después.
    l.askPrice = offer;
    price = offer;
  }
  const lawyer = hiredPro(state, 'abogado', buyer ? buyer.id : 'personal') ?? hiredPro(state, 'abogado', 'personal');
  let lawyerNote = '';
  if (l.hiddenLiability && lawyer) {
    price = Math.max(1, price - l.hiddenLiability);
    lawyerNote = ` ${lawyer.name} detectó una contingencia oculta de ${fmtMoney(l.hiddenLiability)} y la descontó del precio.`;
  }
  const fee = roundCents(price * ACQUISITION_FEE);
  if (buyer) {
    if (buyer.ledger.balances.cash < price + fee) return FAIL(`${buyer.name} necesita ${fmtMoney(price + fee)} de caja (precio + ${fmtPct(ACQUISITION_FEE, 0)} de costos).`);
  } else if (!canPayFromChecking(state, price + fee)) return FAIL(`Necesitás ${fmtMoney(price + fee)} (precio + ${fmtPct(ACQUISITION_FEE, 0)} de costos legales y due diligence).`);
  const co = l.company;
  if (buyer) {
    coPost(buyer.ledger, { day: state.day, memo: `Compra de ${co.name}`, cf: 'investing', tag: 'subsidiary:purchase', lines: [{ account: 'subsidiaries', debit: price }, { account: 'admin', debit: fee }, { account: 'cash', credit: price + fee }] });
    co.parentId = buyer.id;
  } else {
    post(state.ledger, {
      day: state.day, memo: `Compra de ${co.name}`, cf: 'investing', tag: 'business:purchase',
      lines: [{ account: 'business_equity', debit: price }, { account: 'acquisition_costs', debit: fee }, { account: 'checking', credit: price + fee }],
    });
  }
  co.npc = false;
  co.ownership = 1;
  co.acquiredDay = state.day;
  co.carrying = price;
  co.goodwill = price - coEquity(co);
  co.investedByOwner = price;
  co.receivedByOwner = 0;
  co.delegation = { ...co.delegation };
  state.companies.push(co);
  state.listings = state.listings.filter((x) => x.id !== listingId);
  if (l.hiddenLiability && !lawyer) {
    coPost(co.ledger, { day: state.day, memo: 'Contingencia oculta del dueño anterior (juicio laboral y deuda fiscal)', cf: 'internal', tag: 'hidden_liability', lines: [{ account: 'penalties', debit: l.hiddenLiability }, { account: 'arrears', credit: l.hiddenLiability }] });
    co.arrears.push({ id: state.meta.nextId++, kind: 'otros', amount: l.hiddenLiability, since: state.day, label: 'Contingencia oculta' });
    lawyerNote = ` Apareció una contingencia oculta de ${fmtMoney(l.hiddenLiability)} (juicio y deuda fiscal del dueño anterior) que ahora debe pagar la empresa. Un abogado la habría detectado.`;
  }
  revalueChain(state, co);
  practice(state, 'acquire', 'management', 300);
  addLog(state, lawyerNote.includes('Apareció') ? 'warning' : 'success', SECTOR_BY_ID[co.sector].icon, `${buyer ? `${buyer.name} compró` : 'Compraste'} ${co.name} por ${fmtMoney(price)} (plusvalía ${fmtMoney(co.goodwill)}).${lawyerNote}`, price + fee);
  state.log[state.log.length - 1].company = co.id;
  return OK(`¡${co.name} es ${buyer ? `de ${buyer.name}` : 'tuya'}! Precio ${fmtMoney(price)} + ${fmtMoney(fee)} de costos.${lawyerNote}`);
}

// ------------------------------------------------------------ Liquidación y quiebra

/**
 * Cierre de una empresa.
 *  - Voluntario: se venden activos a valores razonables (inventario 50 %, equipos 60 %,
 *    cobranzas 95 %, inmuebles 90 % de la tasación).
 *  - Quiebra: venta forzada (30 %, 40 %, 70 %, inmuebles 70 %) y el local retiene la mitad del depósito.
 * Se pagan todas las deudas (incluidas hipotecas). Si no alcanza:
 *  - Responsabilidad limitada (SRL, corporación): los acreedores asumen la pérdida.
 *  - Responsabilidad ilimitada (individual, sociedad): los dueños pagan la diferencia
 *    con su patrimonio personal (en proporción a su participación), aunque eso genere atrasos.
 * Los préstamos con garantía personal siempre los paga el jugador.
 * Una holding que cierra ordenadamente entrega sus subsidiarias a su dueño; si quiebra,
 * los acreedores las venden al 60 % de su valoración.
 */
export function liquidate(state: GameState, co: Company, mode: 'voluntary' | 'bankruptcy'): ActionResult {
  if (!isOpen(co)) return FAIL('La empresa ya no opera.');
  const r = mode === 'voluntary' ? { inv: 0.5, fixed: 0.6, rec: 0.95, dep: 1, transit: 0.9, prop: 0.9 } : { inv: 0.3, fixed: 0.4, rec: 0.7, dep: 0.5, transit: 0.7, prop: 0.7 };
  const b = co.ledger.balances;
  // Subsidiarias primero.
  for (const sub of childrenOf(state, co)) {
    if (mode === 'voluntary') spinOff(state, sub, true);
    else forcedSaleOfSubsidiary(state, co, sub);
  }
  settleIcLoansOnExit(state, co);
  const sell = (account: 'inventory' | 'fixed_assets' | 'receivables' | 'deposits_paid' | 'in_transit', rate: number, memo: string) => {
    const book = b[account];
    if (book <= 0) return;
    const cash = roundCents(book * rate);
    coPost(co.ledger, {
      day: state.day, memo, cf: 'investing', tag: 'liquidation',
      lines: [{ account: 'cash', debit: cash }, ...(book - cash > 0 ? [{ account: 'liquidation_loss' as const, debit: book - cash }] : []), { account, credit: book }],
    });
  };
  sell('inventory', r.inv, 'Venta del inventario en liquidación');
  sell('in_transit', r.transit, 'Cancelación de pedidos pagados');
  sell('fixed_assets', r.fixed, 'Venta de equipos en liquidación');
  sell('receivables', r.rec, 'Cesión de cuentas por cobrar');
  sell('deposits_paid', r.dep, 'Devolución del depósito del local');
  // Inmuebles de la empresa: se venden; la hipoteca pasa a ser deuda exigible.
  for (const p of state.realEstate.properties.filter((x) => x.owner.kind === 'company' && x.owner.id === co.id)) {
    const cash = roundCents(p.appraisal * r.prop);
    const gain = cash - p.carrying;
    coPost(co.ledger, {
      day: state.day, memo: `Venta de ${p.name} en liquidación`, cf: 'investing', tag: 'liquidation',
      lines: [{ account: 'cash', debit: cash }, ...(gain < 0 ? [{ account: 'liquidation_loss' as const, debit: -gain }] : []), { account: 'real_estate', credit: p.carrying }, ...(gain > 0 ? [{ account: 'gain_on_sale' as const, credit: gain }] : [])],
    });
  }
  const mortgagesDebt = b.mortgages;
  if (mortgagesDebt > 0) {
    coPost(co.ledger, { day: state.day, memo: 'Hipotecas exigibles por cierre', cf: 'internal', tag: 'liquidation', lines: [{ account: 'mortgages', debit: mortgagesDebt }, { account: 'arrears', credit: mortgagesDebt }] });
    co.arrears.push({ id: state.meta.nextId++, kind: 'prestamo', amount: mortgagesDebt, since: state.day, label: 'Hipotecas' });
  }
  detachCompanyAssets(state, co);
  co.inventory = [];
  for (const p of co.products) p.finished = [];
  co.orders = [];
  co.assets = [];
  co.receivables = [];
  // Indemnizaciones del personal.
  let sev = 0;
  for (const e of co.employees) sev += roundCents(e.wage * Math.max(0.5, (state.day - e.hiredDay) / 365));
  if (sev > 0) {
    coPost(co.ledger, { day: state.day, memo: 'Indemnizaciones por cierre', cf: 'internal', tag: 'severance', lines: [{ account: 'wages', debit: sev }, { account: 'arrears', credit: sev }] });
    co.arrears.push({ id: state.meta.nextId++, kind: 'sueldos', amount: sev, since: state.day, label: 'Indemnizaciones' });
  }
  co.employees = [];
  const reclass = (account: 'payables' | 'loans' | 'taxes_payable', label: string, kind: 'proveedor' | 'prestamo' | 'impuestos') => {
    const v = b[account];
    if (v <= 0) return;
    coPost(co.ledger, { day: state.day, memo: `${label} exigible por cierre`, cf: 'internal', tag: 'liquidation', lines: [{ account, debit: v }, { account: 'arrears', credit: v }] });
    co.arrears.push({ id: state.meta.nextId++, kind, amount: v, since: state.day, label });
  };
  const guaranteed = co.loans.filter((l) => l.guaranteed && l.balance > 0).reduce((s, l) => s + l.balance, 0);
  reclass('payables', 'Deudas con proveedores', 'proveedor');
  reclass('loans', 'Préstamos bancarios', 'prestamo');
  reclass('taxes_payable', 'Impuestos', 'impuestos');
  co.payables = [];
  co.loans = [];
  for (const f of co.taxFilings) f.outstanding = 0;

  const lf = LEGAL_FORM_BY_ID[co.legalForm];
  const parent = parentOf(state, co);
  let owed = b.arrears - Math.min(b.cash, b.arrears);
  let personalPaid = 0;
  if (owed > 0) {
    const mineOwed = lf.limitedLiability ? Math.min(owed, guaranteed) : roundCents(owed * co.ownership);
    const partner = lf.limitedLiability ? 0 : owed - mineOwed;
    if (mineOwed > 0) personalPaid = payFromPersonal(state, co, mineOwed);
    if (partner > 0) coPost(co.ledger, { day: state.day, memo: 'Aporte del socio para cubrir deudas', cf: 'financing', tag: 'capital', lines: [{ account: 'cash', debit: partner }, { account: 'capital', credit: partner }] });
  }
  const payNow = Math.min(b.cash, b.arrears);
  if (payNow > 0) coPost(co.ledger, { day: state.day, memo: 'Pago a acreedores en la liquidación', cf: 'operating', tag: 'liquidation', lines: [{ account: 'arrears', debit: payNow }, { account: 'cash', credit: payNow }] });
  owed = b.arrears;
  if (owed > 0) coPost(co.ledger, { day: state.day, memo: 'Deudas no cubiertas asumidas por los acreedores', cf: 'internal', tag: 'liquidation', lines: [{ account: 'arrears', debit: owed }, { account: 'other_income', credit: owed }] });
  co.arrears = [];
  // Remanente para los dueños.
  const remaining = b.cash;
  if (remaining > 0) {
    coPost(co.ledger, { day: state.day, memo: 'Reparto del remanente de liquidación', cf: 'financing', tag: 'dividend', lines: [{ account: 'distributions', debit: remaining }, { account: 'cash', credit: remaining }] });
    const mine = roundCents(remaining * co.ownership);
    if (mine > 0) {
      if (parent) {
        coPost(parent.ledger, { day: state.day, memo: `Remanente de liquidación de ${co.name}`, cf: 'investing', tag: 'subsidiary:liquidation', lines: [{ account: 'cash', debit: mine }, { account: 'subsidiaries', credit: Math.min(mine, co.carrying) }, ...(mine > co.carrying ? [{ account: 'gain_on_sale' as const, credit: mine - co.carrying }] : [])] });
      } else {
        post(state.ledger, { day: state.day, memo: `Remanente de liquidación de ${co.name}`, cf: 'investing', tag: 'business:liquidation', lines: [{ account: 'checking', debit: mine }, { account: 'business_equity', credit: Math.min(mine, co.carrying) }, ...(mine > co.carrying ? [{ account: 'business_results' as const, credit: mine - co.carrying }] : [])] });
        personalCompanyGain(state, co, mine);
      }
      co.carrying = Math.max(0, co.carrying - mine);
      co.receivedByOwner += mine;
    }
  } else if (!parent) personalCompanyGain(state, co, 0);
  co.status = mode === 'voluntary' ? 'closed' : 'bankrupt';
  revalue(state, co);
  state.formerCompanies.push({ id: co.id, name: co.name, sector: co.sector, endDay: state.day, outcome: mode === 'voluntary' ? 'liquidada' : 'quiebra', result: co.receivedByOwner - co.investedByOwner - personalPaid });
  state.companies = state.companies.filter((c) => c.id !== co.id);
  if (parent) revalueChain(state, parent);
  if (mode === 'bankruptcy') {
    state.player.attributes.reputation = Math.max(0, state.player.attributes.reputation - (parent ? 6 : 15));
    state.player.attributes.stress = Math.min(100, state.player.attributes.stress + (parent ? 8 : 20));
    addLog(state, 'danger', '⚖️', `${co.name} fue declarada en QUIEBRA y liquidada. ${lf.limitedLiability ? `Por ser de responsabilidad limitada, ${parent ? `${parent.name} perdió` : 'perdiste'} solo la inversión` : `Por ser ${lf.name.toLowerCase()}, respondiste con tu patrimonio personal (${fmtMoney(personalPaid)})`}${guaranteed && lf.limitedLiability ? ` y pagaste ${fmtMoney(personalPaid)} de préstamos que garantizaste` : ''}.`, undefined, 'peligro');
  } else {
    addLog(state, 'info', '🔒', `Cerraste ${co.name} de forma ordenada.${personalPaid ? ` Tuviste que cubrir ${fmtMoney(personalPaid)} de deudas con tu dinero.` : ''}`);
  }
  return OK(mode === 'voluntary' ? 'Empresa liquidada.' : 'Quiebra procesada.');
}

/** El jugador cubre deudas de su empresa con su dinero personal (y si no alcanza, queda con atrasos). */
function payFromPersonal(state: GameState, co: Company, amount: Cents): Cents {
  if (state.ledger.balances.checking < amount && state.ledger.balances.savings > 0) {
    const move = Math.min(state.ledger.balances.savings, amount - state.ledger.balances.checking);
    post(state.ledger, { day: state.day, memo: 'Transferencia para cubrir deudas de empresa', cf: 'internal', tag: 'sweep', lines: [{ account: 'checking', debit: move }, { account: 'savings', credit: move }] });
  }
  const fromChecking = Math.min(state.ledger.balances.checking, amount);
  const fromCash = Math.min(state.ledger.balances.cash_wallet, amount - fromChecking);
  const unpaid = amount - fromChecking - fromCash;
  post(state.ledger, {
    day: state.day, memo: `Deudas de ${co.name} a cargo del dueño`, cf: 'investing', tag: 'business:guarantee',
    lines: [
      { account: 'business_results', debit: amount },
      ...(fromChecking ? [{ account: 'checking' as const, credit: fromChecking }] : []),
      ...(fromCash ? [{ account: 'cash_wallet' as const, credit: fromCash }] : []),
      ...(unpaid ? [{ account: 'arrears' as const, credit: unpaid }] : []),
    ],
  });
  if (unpaid > 0) {
    state.credit.defaults++;
    recordLate(state);
    state.credit.arrearsEvents++;
  }
  refreshCreditScore(state);
  coPost(co.ledger, { day: state.day, memo: 'Aporte del dueño para pagar deudas (responsabilidad ilimitada o garantía)', cf: 'financing', tag: 'capital', lines: [{ account: 'cash', debit: amount }, { account: 'capital', credit: amount }] });
  return amount;
}

// ------------------------------------------------------------ Grupos: altas y bajas

export interface HoldingOptions {
  name: string;
  legalForm: 'srl' | 'corporacion';
  capital: Cents;
  jurisdiction?: JurisdictionId;
}

/** Funda una sociedad holding con capital propio. */
export function foundHolding(state: GameState, o: HoldingOptions): ActionResult {
  const r = foundCompany(state, { sector: 'holding', name: o.name, legalForm: o.legalForm, capital: o.capital, color: '#9aa7c7', jurisdiction: o.jurisdiction });
  if (!r.ok) return r;
  const h = state.companies[state.companies.length - 1];
  h.group = { upstreamPayout: 0, cashPooling: false, centralDelegation: false };
  h.openDay = state.day;
  return OK(`Holding ${h.name} creada. Ya podés transferirle empresas (SRL o corporaciones) o comprar empresas a su nombre.`);
}

/**
 * Aporta una empresa tuya a una holding (aporte en especie): la holding la
 * registra al mismo valor contable. Tu patrimonio personal no cambia: antes la
 * tenías directamente y ahora a través de la holding.
 */
export function transferToGroup(state: GameState, coId: number, holdingId: number): ActionResult {
  const co = state.companies.find((c) => c.id === coId);
  const h = state.companies.find((c) => c.id === holdingId);
  if (!co || !h) return FAIL('Empresa inexistente.');
  if (!isHolding(h) || !isOpen(h)) return FAIL('El destino debe ser una holding en operación.');
  const why = canJoinGroup(co);
  if (why) return FAIL(why);
  revalue(state, co);
  revalue(state, h);
  const value = co.carrying;
  coPost(h.ledger, { day: state.day, memo: `Aporte en especie de ${co.name}`, cf: 'internal', tag: 'subsidiary:contribution', lines: [{ account: 'subsidiaries', debit: Math.max(1, value) }, { account: 'capital', credit: Math.max(1, value) }] });
  if (value === 0) coPost(h.ledger, { day: state.day, memo: 'Ajuste de aporte simbólico', cf: 'internal', tag: 'subsidiary:contribution', lines: [{ account: 'subsidiary_results', debit: 1 }, { account: 'subsidiaries', credit: 1 }] });
  // En el balance personal: la participación pasa de la empresa a la holding (misma cuenta, mismo total).
  h.carrying += value;
  h.investedByOwner += value;
  co.parentId = h.id;
  revalueChain(state, co);
  return OK(`${co.name} ahora es subsidiaria de ${h.name}. Tu patrimonio no cambió: la tenés a través de la holding.`);
}

/**
 * Saca una subsidiaria del grupo entregándola a su dueño (dividendo en especie).
 * Con `silent` se usa en el cierre ordenado de la holding.
 */
export function spinOff(state: GameState, sub: Company, silent = false): ActionResult {
  const parent = parentOf(state, sub);
  if (!parent) return FAIL('La empresa no pertenece a un grupo.');
  revalue(state, sub);
  settleIcLoansOnExit(state, sub);
  revalue(state, sub);
  const value = sub.carrying;
  if (value > 0) coPost(parent.ledger, { day: state.day, memo: `Entrega de ${sub.name} a su dueño (dividendo en especie)`, cf: 'internal', tag: 'subsidiary:spinoff', lines: [{ account: 'distributions', debit: value }, { account: 'subsidiaries', credit: value }] });
  const grand = parentOf(state, parent);
  sub.parentId = grand ? grand.id : null;
  if (grand) coPost(grand.ledger, { day: state.day, memo: `Recepción de ${sub.name}`, cf: 'internal', tag: 'subsidiary:spinoff', lines: [{ account: 'subsidiaries', debit: Math.max(1, value) }, { account: 'subsidiary_results', credit: Math.max(1, value) }] });
  parent.carrying -= value;
  // El valor pasa del patrimonio de la holding a la participación directa: el total personal no cambia.
  revalueChain(state, parent);
  if (!silent) coLog(state, sub, 'info', '🔀', `salió del grupo ${parent.name} y ahora es de propiedad directa.`);
  return OK(`${sub.name} salió del grupo.`);
}

function forcedSaleOfSubsidiary(state: GameState, parent: Company, sub: Company): void {
  const v = valuation(state, sub).value;
  const price = roundCents(v * 0.6 * sub.ownership);
  revalue(state, sub);
  const gain = price - sub.carrying;
  const lines = [...(price ? [{ account: 'cash' as const, debit: price }] : []), ...(sub.carrying ? [{ account: 'subsidiaries' as const, credit: sub.carrying }] : []), ...(gain > 0 ? [{ account: 'gain_on_sale' as const, credit: gain }] : []), ...(gain < 0 ? [{ account: 'liquidation_loss' as const, debit: -gain }] : [])];
  // Una subsidiaria sin valor (precio 0 y valor contable 0) se entrega sin asiento: no hay nada que registrar.
  if (lines.length >= 2) {
    coPost(parent.ledger, { day: state.day, memo: `Venta forzada de ${sub.name} por la quiebra de la matriz`, cf: 'investing', tag: 'subsidiary:sale', lines });
  }
  sub.carrying = 0;
  sub.status = 'sold';
  for (const c of groupMembers(state, sub)) detachCompanyAssets(state, c);
  const gone = new Set(groupMembers(state, sub).map((c) => c.id));
  state.companies = state.companies.filter((c) => !gone.has(c.id));
  addLog(state, 'warning', '⚖️', price > 0 ? `${sub.name} fue vendida por ${fmtMoney(price)} para pagar a los acreedores de ${parent.name}.` : `${sub.name} no tenía valor y se entregó a los acreedores de ${parent.name} sin pago.`, undefined, 'peligro');
}

export { inventoryValue };
