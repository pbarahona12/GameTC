import type { GameState } from '../state';
import type { Company, IcLoan, GroupPolicy } from './types';
import { Cents, clamp, roundCents } from '../money';
import { coPost, CO_ACCOUNT_IDS, CO_CHART, CoAccountId, coPeriodTotals } from './companyLedger';
import { coEquity, isOpen, monthlyFixed, monthlyPayroll } from './common';
import { ActionResult, FAIL, OK } from '../result';
import { fmtMoney, fmtPct } from '../format';
import { addMonths, startOfMonth, last90Start } from '../time/calendar';
import { LEGAL_FORM_BY_ID } from '../../content/sectors';
import { coIncomeStatement, coMetrics } from './reports';

/**
 * GRUPOS EMPRESARIALES (Fase 4).
 *
 * Una sociedad holding es dueña de subsidiarias. Reglas contables:
 * - La matriz registra cada subsidiaria en "Inversiones en subsidiarias" por el
 *   método de participación (patrimonio × % + plusvalía), contra "Resultado de
 *   subsidiarias" (exento de impuesto de sociedades).
 * - Tu balance personal solo incluye la holding: así nada se cuenta dos veces.
 * - Dividendos de una subsidiaria a su matriz: exentos (participación).
 * - Préstamos y honorarios intragrupo: se registran en cuentas "intragrupo" y se
 *   ELIMINAN en el consolidado.
 */
export const DEFAULT_GROUP_POLICY: GroupPolicy = { upstreamPayout: 0, cashPooling: false, centralDelegation: false };

export function parentOf(state: GameState, co: Company): Company | null {
  return co.parentId ? state.companies.find((c) => c.id === co.parentId) ?? null : null;
}

export function childrenOf(state: GameState, co: Company): Company[] {
  return state.companies.filter((c) => c.parentId === co.id && isOpen(c));
}

/** Todas las empresas del grupo (la matriz y sus descendientes). */
export function groupMembers(state: GameState, root: Company): Company[] {
  const out: Company[] = [root];
  for (let i = 0; i < out.length; i++) for (const c of childrenOf(state, out[i])) if (!out.includes(c)) out.push(c);
  return out;
}

export function rootOf(state: GameState, co: Company): Company {
  let r = co;
  for (let i = 0; i < 10; i++) {
    const p = parentOf(state, r);
    if (!p) break;
    r = p;
  }
  return r;
}

export function isHolding(co: Company): boolean {
  return co.sector === 'holding';
}

/** Profundidad (0 = de propiedad directa del jugador). Sirve para revaluar de abajo hacia arriba. */
export function depthOf(state: GameState, co: Company): number {
  let d = 0;
  let c = co;
  while (c.parentId && d < 10) {
    const p = parentOf(state, c);
    if (!p) break;
    c = p;
    d++;
  }
  return d;
}

// ------------------------------------------------------------ Préstamos intragrupo

export function icLoansOf(state: GameState, co: Company): { lent: IcLoan[]; borrowed: IcLoan[] } {
  const active = state.icLoans.filter((l) => l.status === 'activo');
  return { lent: active.filter((l) => l.lenderId === co.id), borrowed: active.filter((l) => l.borrowerId === co.id) };
}

export function sameGroup(state: GameState, a: Company, b: Company): boolean {
  return rootOf(state, a).id === rootOf(state, b).id;
}

export function grantIcLoan(state: GameState, lenderId: number, borrowerId: number, amount: Cents, rate: number, months: number): ActionResult {
  const lender = state.companies.find((c) => c.id === lenderId && isOpen(c));
  const borrower = state.companies.find((c) => c.id === borrowerId && isOpen(c));
  if (!lender || !borrower || lender === borrower) return FAIL('Elegí dos empresas distintas en operación.');
  if (!sameGroup(state, lender, borrower)) return FAIL('Los préstamos intragrupo solo se permiten entre empresas del mismo grupo (misma holding).');
  if (!(amount > 0)) return FAIL('Monto inválido.');
  if (lender.ledger.balances.cash < amount) return FAIL(`${lender.name} no tiene esa caja disponible.`);
  if (!(rate >= 0 && rate <= 0.3)) return FAIL('La tasa debe estar entre 0 % y 30 % anual.');
  const loan: IcLoan = { id: state.meta.nextId++, lenderId, borrowerId, principal: amount, balance: amount, rate, startDay: state.day, dueDay: addMonths(state.day, clamp(months, 1, 120)), status: 'activo' };
  postIc(state, lender, borrower, amount, 'principal', `Préstamo intragrupo de ${lender.name} a ${borrower.name}`);
  state.icLoans.push(loan);
  return OK(`${lender.name} prestó ${fmtMoney(amount)} a ${borrower.name} al ${fmtPct(rate, 1)} anual.`);
}

/** Asientos espejo en ambos libros. `principal`: desembolso; `repay`: devolución; `interest`/`fee`: resultados intragrupo. */
function postIc(state: GameState, lender: Company, borrower: Company, amount: Cents, kind: 'principal' | 'repay' | 'interest' | 'fee', memo: string): void {
  if (amount <= 0) return;
  const tag = `intercompany:${kind}`;
  if (kind === 'principal') {
    coPost(lender.ledger, { day: state.day, memo, cf: 'investing', tag, lines: [{ account: 'ic_receivable', debit: amount }, { account: 'cash', credit: amount }] });
    coPost(borrower.ledger, { day: state.day, memo, cf: 'financing', tag, lines: [{ account: 'cash', debit: amount }, { account: 'ic_payable', credit: amount }] });
  } else if (kind === 'repay') {
    coPost(borrower.ledger, { day: state.day, memo, cf: 'financing', tag, lines: [{ account: 'ic_payable', debit: amount }, { account: 'cash', credit: amount }] });
    coPost(lender.ledger, { day: state.day, memo, cf: 'investing', tag, lines: [{ account: 'cash', debit: amount }, { account: 'ic_receivable', credit: amount }] });
  } else {
    // interés u honorario: el pagador es `borrower`, el cobrador `lender`
    coPost(borrower.ledger, { day: state.day, memo, cf: 'operating', tag, lines: [{ account: 'ic_expense', debit: amount }, { account: 'cash', credit: amount }] });
    coPost(lender.ledger, { day: state.day, memo, cf: 'operating', tag, lines: [{ account: 'cash', debit: amount }, { account: 'ic_income', credit: amount }] });
  }
}

export function repayIcLoan(state: GameState, loanId: number, amount: Cents): ActionResult {
  const l = state.icLoans.find((x) => x.id === loanId && x.status === 'activo');
  if (!l) return FAIL('Préstamo inexistente.');
  const lender = state.companies.find((c) => c.id === l.lenderId);
  const borrower = state.companies.find((c) => c.id === l.borrowerId);
  if (!lender || !borrower) return FAIL('Empresa inexistente.');
  const pay = Math.min(amount, l.balance, borrower.ledger.balances.cash);
  if (!(pay > 0)) return FAIL(`${borrower.name} no tiene caja para devolver.`);
  postIc(state, lender, borrower, pay, 'repay', `Devolución de préstamo intragrupo a ${lender.name}`);
  l.balance -= pay;
  if (l.balance <= 0) l.status = 'pagado';
  return OK(`${borrower.name} devolvió ${fmtMoney(pay)} a ${lender.name}.`);
}

/** Intereses mensuales y vencimientos de préstamos intragrupo. */
export function icLoansMonthEnd(state: GameState): void {
  for (const l of state.icLoans) {
    if (l.status !== 'activo') continue;
    const lender = state.companies.find((c) => c.id === l.lenderId && isOpen(c));
    const borrower = state.companies.find((c) => c.id === l.borrowerId && isOpen(c));
    if (!lender || !borrower) continue;
    const interest = roundCents((l.balance * l.rate) / 12);
    const pay = Math.min(interest, Math.max(0, borrower.ledger.balances.cash));
    if (pay > 0) postIc(state, lender, borrower, pay, 'interest', `Intereses de préstamo intragrupo (${lender.name} → ${borrower.name})`);
    if (state.day >= l.dueDay) {
      const r = Math.min(l.balance, Math.max(0, borrower.ledger.balances.cash - roundCents((monthlyPayroll(state, borrower) + monthlyFixed(state, borrower)) * 0.5)));
      if (r > 0) {
        postIc(state, lender, borrower, r, 'repay', `Vencimiento de préstamo intragrupo (${lender.name})`);
        l.balance -= r;
      }
      if (l.balance <= 0) l.status = 'pagado';
      else l.dueDay = addMonths(state.day, 12);
    }
  }
  state.icLoans = state.icLoans.filter((l) => l.status === 'activo' || state.day - l.startDay < 1100);
}

/**
 * Al salir del grupo (venta, liquidación), los préstamos intragrupo se cancelan:
 * el deudor paga con la caja disponible y el resto se da de baja (pérdida del
 * prestamista, ganancia del deudor), para que ningún saldo quede huérfano.
 */
export function settleIcLoansOnExit(state: GameState, co: Company): void {
  for (const l of state.icLoans) {
    if (l.status !== 'activo' || (l.lenderId !== co.id && l.borrowerId !== co.id)) continue;
    const lender = state.companies.find((c) => c.id === l.lenderId);
    const borrower = state.companies.find((c) => c.id === l.borrowerId);
    if (!lender || !borrower) continue;
    const pay = Math.min(l.balance, Math.max(0, borrower.ledger.balances.cash));
    if (pay > 0) postIc(state, lender, borrower, pay, 'repay', `Cancelación de préstamo intragrupo por salida del grupo`);
    const rest = l.balance - pay;
    if (rest > 0) {
      coPost(lender.ledger, { day: state.day, memo: 'Préstamo intragrupo incobrable', cf: 'internal', tag: 'intercompany:writeoff', lines: [{ account: 'bad_debts', debit: rest }, { account: 'ic_receivable', credit: rest }] });
      coPost(borrower.ledger, { day: state.day, memo: 'Condonación de préstamo intragrupo', cf: 'internal', tag: 'intercompany:writeoff', lines: [{ account: 'ic_payable', debit: rest }, { account: 'other_income', credit: rest }] });
    }
    l.balance = 0;
    l.status = rest > 0 ? 'incobrable' : 'pagado';
  }
}

// ------------------------------------------------------------ Políticas de grupo (mensuales)

export function setGroupPolicy(state: GameState, holdingId: number, patch: Partial<GroupPolicy>): ActionResult {
  const h = state.companies.find((c) => c.id === holdingId);
  if (!h || !isHolding(h)) return FAIL('Solo una holding tiene políticas de grupo.');
  h.group = { ...(h.group ?? DEFAULT_GROUP_POLICY), ...patch };
  if (h.group.upstreamPayout < 0 || h.group.upstreamPayout > 1) return FAIL('El porcentaje debe estar entre 0 % y 100 %.');
  return OK('Políticas del grupo actualizadas.');
}

export function setManagementFee(state: GameState, coId: number, rate: number): ActionResult {
  const co = state.companies.find((c) => c.id === coId);
  if (!co || !co.parentId) return FAIL('Solo una subsidiaria paga honorarios de gestión a su matriz.');
  if (!(rate >= 0 && rate <= 0.1)) return FAIL('El honorario de gestión debe estar entre 0 % y 10 % de las ventas.');
  co.managementFee = rate;
  return OK(`${co.name} pagará a su matriz ${fmtPct(rate, 1)} de sus ventas cada mes.`);
}

/**
 * Administración centralizada al cierre de mes (se ejecuta antes de revaluar):
 * honorarios de gestión, dividendos hacia la matriz, centralización de caja
 * y delegación común.
 */
export function groupMonthEnd(state: GameState, distributeUp: (co: Company, amount: Cents) => void): void {
  for (const sub of state.companies) {
    if (!isOpen(sub) || !sub.parentId) continue;
    const parent = parentOf(state, sub);
    if (!parent || !isOpen(parent)) continue;
    const from = startOfMonth(state.day);
    const is = coIncomeStatement(sub, from, state.day);
    if (sub.managementFee > 0 && is.revenue > 0) {
      const fee = Math.min(roundCents(is.revenue * sub.managementFee), Math.max(0, sub.ledger.balances.cash));
      if (fee > 0) postIc(state, parent, sub, fee, 'fee', `Honorario de gestión a ${parent.name}`);
    }
    const pol = parent.group ?? DEFAULT_GROUP_POLICY;
    if (pol.centralDelegation) {
      sub.delegation = { ...sub.delegation, autoReorder: true, autoPricing: true, autoStaffing: true };
    }
    if (pol.upstreamPayout > 0 && is.netIncome > 0 && sub.ledger.balances.arrears === 0) {
      distributeUp(sub, roundCents(is.netIncome * pol.upstreamPayout));
    }
    if (pol.cashPooling) {
      const reserve = roundCents(((monthlyPayroll(state, sub) + monthlyFixed(state, sub)) / 30) * 60);
      const excess = sub.ledger.balances.cash - reserve;
      const pool = state.icLoans.find((l) => l.status === 'activo' && l.lenderId === sub.id && l.borrowerId === parent.id);
      if (excess > 0) {
        if (pool) {
          postIc(state, sub, parent, excess, 'principal', `Centralización de caja: ${sub.name} → ${parent.name}`);
          pool.balance += excess;
          pool.principal += excess;
        } else {
          state.icLoans.push({ id: state.meta.nextId++, lenderId: sub.id, borrowerId: parent.id, principal: excess, balance: excess, rate: Math.max(0, state.macro.policyRate - 0.01), startDay: state.day, dueDay: addMonths(state.day, 12), status: 'activo' });
          postIc(state, sub, parent, excess, 'principal', `Centralización de caja: ${sub.name} → ${parent.name}`);
        }
      } else if (excess < 0 && pool && pool.balance > 0) {
        const back = Math.min(pool.balance, -excess, Math.max(0, parent.ledger.balances.cash));
        if (back > 0) {
          postIc(state, sub, parent, back, 'repay', `Centralización de caja: ${parent.name} devuelve a ${sub.name}`);
          pool.balance -= back;
          if (pool.balance <= 0) pool.status = 'pagado';
        }
      }
    }
  }
}

// ------------------------------------------------------------ Consolidación

export interface ConsolidatedGroup {
  members: Company[];
  assets: Array<{ account: CoAccountId; amount: Cents }>;
  liabilities: Array<{ account: CoAccountId; amount: Cents }>;
  totalAssets: Cents;
  totalLiabilities: Cents;
  goodwill: Cents;
  minority: Cents;
  attributableEquity: Cents;
  eliminated: { investments: Cents; icBalances: Cents; icResults: Cents; subsidiaryResults: Cents };
  revenue: Cents;
  ebitda: Cents;
  netIncome: Cents;
  minorityNet: Cents;
  attributableNet: Cents;
  cash: Cents;
  debtRatio: number;
  employees: number;
  checks: string[];
}

/**
 * Estados consolidados del grupo: suma de los libros de todas las empresas,
 * ELIMINANDO lo que existe solo dentro del grupo:
 *  - la inversión de la matriz en sus subsidiarias (se reemplaza por sus activos y pasivos);
 *  - préstamos intragrupo (cuentas por cobrar y por pagar entre miembros);
 *  - intereses y honorarios intragrupo, y el "resultado de subsidiarias".
 * La parte de las subsidiarias que pertenece a otros socios es el interés minoritario.
 */
export function consolidateGroup(state: GameState, root: Company, from: number, to: number): ConsolidatedGroup {
  const members = groupMembers(state, root);
  const ids = new Set(members.map((m) => m.id));
  const sum = {} as Record<CoAccountId, Cents>;
  for (const id of CO_ACCOUNT_IDS) sum[id] = 0;
  for (const m of members) for (const id of CO_ACCOUNT_IDS) sum[id] += m.ledger.balances[id];
  // Préstamos entre miembros
  let icBal = 0;
  for (const l of state.icLoans) if (l.status === 'activo' && ids.has(l.lenderId) && ids.has(l.borrowerId)) icBal += l.balance;
  const investments = sum.subsidiaries;
  let goodwill = 0;
  let minority = 0;
  for (const m of members) {
    if (m === root) continue;
    goodwill += m.goodwill;
    minority += roundCents(Math.max(0, coEquity(m)) * (1 - m.ownership));
  }
  const bal = { ...sum };
  bal.subsidiaries = 0;
  bal.ic_receivable -= icBal;
  bal.ic_payable -= icBal;
  const assets = CO_ACCOUNT_IDS.filter((id) => CO_CHART[id].type === 'asset' && bal[id] !== 0).map((id) => ({ account: id, amount: bal[id] }));
  const liabilities = CO_ACCOUNT_IDS.filter((id) => CO_CHART[id].type === 'liability' && bal[id] !== 0).map((id) => ({ account: id, amount: bal[id] }));
  const totalAssets = assets.reduce((s, x) => s + x.amount, 0) + goodwill;
  const totalLiabilities = liabilities.reduce((s, x) => s + x.amount, 0);
  const attributableEquity = totalAssets - totalLiabilities - minority;
  // Resultados del período
  let revenue = 0;
  let ebitda = 0;
  let net = 0;
  let minorityNet = 0;
  let icResults = 0;
  let subRes = 0;
  for (const m of members) {
    const is = coIncomeStatement(m, Math.max(from, m.foundedDay), to);
    const t = coPeriodTotals(m.ledger, Math.max(from, m.foundedDay), to);
    revenue += is.revenue;
    ebitda += is.ebitda;
    const own = is.netIncome - t.subsidiary_results;
    net += own;
    subRes += t.subsidiary_results;
    icResults += t.ic_income;
    if (m !== root) minorityNet += roundCents(own * (1 - m.ownership));
  }
  // Los ingresos intragrupo de uno son gastos de otro: en la suma se cancelan (el neto ya lo refleja).
  const checks: string[] = [];
  const expected = coEquity(root);
  if (Math.abs(attributableEquity - expected) > members.length * 2) checks.push(`El patrimonio atribuible consolidado (${fmtMoney(attributableEquity)}) difiere del patrimonio de la matriz (${fmtMoney(expected)}): las revaluaciones se hacen a fin de mes.`);
  const cash = bal.cash;
  return {
    members, assets, liabilities, totalAssets, totalLiabilities, goodwill, minority, attributableEquity,
    eliminated: { investments, icBalances: icBal, icResults, subsidiaryResults: subRes },
    revenue, ebitda, netIncome: net, minorityNet, attributableNet: net - minorityNet, cash,
    debtRatio: totalAssets > 0 ? totalLiabilities / totalAssets : 0,
    employees: members.reduce((s, m) => s + m.employees.length, 0), checks,
  };
}

export interface GroupRisk {
  company: Company;
  runwayDays: number | null;
  arrears: Cents;
  debtRatio: number;
  netIncome30: Cents;
  exposure: Cents;
}

/** Riesgos individuales (cada empresa) y consolidados (el grupo en conjunto). */
export function groupRisks(state: GameState, root: Company): { members: GroupRisk[]; consolidated: { debtRatio: number; cash: Cents; burnDays: number | null; intercompany: Cents; guaranteed: Cents; warnings: string[] } } {
  const members = groupMembers(state, root).map((co) => {
    const m = coMetrics(state, co);
    const b = co.ledger.balances;
    const assets = CO_ACCOUNT_IDS.filter((id) => CO_CHART[id].type === 'asset').reduce((s, id) => s + b[id], 0);
    const liab = CO_ACCOUNT_IDS.filter((id) => CO_CHART[id].type === 'liability').reduce((s, id) => s + b[id], 0);
    return { company: co, runwayDays: m.runwayDays, arrears: b.arrears, debtRatio: assets > 0 ? liab / assets : 0, netIncome30: m.net30, exposure: b.ic_receivable };
  });
  const c = consolidateGroup(state, root, Math.max(root.foundedDay, last90Start(state.day)), state.day);
  const burn = members.reduce((s, x) => s + (x.runwayDays !== null ? x.company.ledger.balances.cash / Math.max(1, x.runwayDays) : 0), 0);
  const guaranteed = groupMembers(state, root).reduce((s, co) => s + co.loans.filter((l) => l.guaranteed).reduce((a, l) => a + l.balance, 0), 0);
  const warnings: string[] = [];
  for (const x of members) {
    if (x.arrears > 0) warnings.push(`${x.company.name} tiene deudas vencidas: su insolvencia puede arrastrar préstamos intragrupo.`);
    if (x.runwayDays !== null && x.runwayDays < 60) warnings.push(`${x.company.name} se quedaría sin caja en unos ${Math.round(x.runwayDays)} días.`);
  }
  if (c.debtRatio > 0.7) warnings.push(`Endeudamiento consolidado alto: ${fmtPct(c.debtRatio, 0)} de los activos.`);
  if (guaranteed > 0) warnings.push(`Garantizaste personalmente ${fmtMoney(guaranteed)} de préstamos del grupo.`);
  return { members, consolidated: { debtRatio: c.debtRatio, cash: c.cash, burnDays: burn > 0 ? c.cash / burn : null, intercompany: c.eliminated.icBalances, guaranteed, warnings } };
}

/** ¿Puede esta empresa ser subsidiaria? (necesita responsabilidad limitada y no estar ya en otro grupo). */
export function canJoinGroup(co: Company): string | null {
  if (!LEGAL_FORM_BY_ID[co.legalForm].limitedLiability) return 'Solo una SRL o una corporación puede ser subsidiaria de una holding.';
  if (isHolding(co)) return 'Una holding no puede ser subsidiaria de otra en este juego.';
  if (co.parentId) return 'Ya pertenece a un grupo.';
  if (!isOpen(co)) return 'La empresa no está operando.';
  if (co.listed) return 'Una empresa que cotiza en bolsa no puede pasar a una holding.';
  return null;
}

