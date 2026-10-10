import { post } from '../ledger/ledger';
import { Cents, clamp, roundCents, usd } from '../money';
import type { Filing, GameState } from '../state';
import { dayOf, dateOf, formatDate, daysInMonth } from '../time/calendar';
import { addLog } from '../log';
import { ActionResult, FAIL, OK } from '../result';
import { fmtMoney } from '../format';
import { computeAnnualTax, emptyYtd, TaxComputation, YearToDate, payroll, TaxContext, HONEST } from './incomeTax';
import { jurisdictionById, JurisdictionId, Jurisdiction, JURISDICTION_BY_ID } from '../../content/jurisdictions';
import { canPayFromChecking } from '../finance/payments';
import { hiredPro } from '../pros/lookup';
import { balanceSheet } from '../reports/statements';
import { rebuildLivingCosts } from '../finance/budget';
import { recordEvasion } from '../legal/hooks';
import { coIncomeStatement } from '../business/reports';
import { coPeriodTotals } from '../business/companyLedger';
import { LEGAL_FORM_BY_ID } from '../../content/sectors';

/** Jurisdicción de residencia fiscal actual del jugador. */
export function residence(state: GameState): Jurisdiction {
  return jurisdictionById(state.tax.jurisdiction);
}

/**
 * Fracción de deducciones "documentales" (depreciación e intereses de
 * inmuebles alquilados) que se reclaman. Sin conocimientos contables se pierden
 * algunas; un contador contratado las reclama casi todas.
 */
export function deductionCapture(state: GameState): number {
  let c = clamp(0.5 + state.skills.accounting.level * 0.008, 0.5, 1);
  const acc = hiredPro(state, 'contador', 'personal');
  if (acc) c = Math.max(c, clamp(0.82 + acc.quality * 0.002, 0, 1));
  return Math.round(c * 1000) / 1000;
}

export function lossCarryAvailable(state: GameState, j: Jurisdiction, year: number): Cents {
  return (state.tax.capitalLossCarry ?? []).filter((l) => year - l.year <= j.capitalGains.lossCarryYears).reduce((s, l) => s + l.amount, 0);
}

function taxContext(state: GameState, j: Jurisdiction, year: number, underreport: number): TaxContext {
  return { lossCarry: lossCarryAvailable(state, j, year), deductionCapture: deductionCapture(state), underreport };
}

/** Consume pérdidas arrastradas (las más antiguas primero) y registra las nuevas. */
function applyLossCarry(state: GameState, j: Jurisdiction, year: number, used: Cents, created: Cents): void {
  const list = (state.tax.capitalLossCarry ?? []).filter((l) => year - l.year <= j.capitalGains.lossCarryYears);
  let left = used;
  for (const l of list.sort((a, b) => a.year - b.year)) {
    const take = Math.min(l.amount, left);
    l.amount -= take;
    left -= take;
  }
  state.tax.capitalLossCarry = list.filter((l) => l.amount > 0);
  if (created > 0) state.tax.capitalLossCarry.push({ year, amount: created });
}

/** Presenta la declaración del año que terminó. Se ejecuta el 1 de enero. */
export function fileAnnualReturn(state: GameState): Filing {
  const ytd = state.tax.ytd;
  const j = jurisdictionById(ytd.jurisdiction ?? state.tax.jurisdiction);
  const under = clamp(state.tax.underreport ?? 0, 0, 0.9);
  const ctx = taxContext(state, j, ytd.year, under);
  const comp = computeAnnualTax(j, ytd, ctx);
  if (under > 0) {
    const honest = computeAnnualTax(j, ytd, { ...ctx, underreport: 0 });
    recordEvasion(state, ytd.year, honest.balance - comp.balance, comp.hiddenIncome ?? 0, j.id);
  }
  applyLossCarry(state, j, ytd.year, comp.lossCarryUsed ?? 0, comp.lossCarryCreated ?? 0);
  const cgt = comp.capitalGainsTax ?? 0;
  const ordinary = comp.balance - cgt; // impuesto ordinario − retenciones (puede ser negativo)
  let filing: Filing;
  const lines: Array<{ account: 'income_tax' | 'capital_gains_tax' | 'taxes_payable' | 'tax_receivable'; debit?: Cents; credit?: Cents }> = [];
  if (ordinary > 0) lines.push({ account: 'income_tax', debit: ordinary });
  if (ordinary < 0) lines.push({ account: 'income_tax', credit: -ordinary });
  if (cgt > 0) lines.push({ account: 'capital_gains_tax', debit: cgt });
  const base = { jurisdiction: j.id, fileDay: state.day, penalties: 0, underreport: under };
  if (comp.balance > 0) {
    lines.push({ account: 'taxes_payable', credit: comp.balance });
    post(state.ledger, { day: state.day, memo: `Declaración ${ytd.year}: impuesto a pagar`, cf: 'internal', tag: 'tax:assessment', lines });
    filing = { ...comp, ...base, dueDay: dayOf(ytd.year + 1, j.filingDeadline.month, j.filingDeadline.day), status: 'due', outstanding: comp.balance };
    addLog(state, 'warning', '🧾', `Declaración ${ytd.year} (${j.name}) presentada: debés ${fmtMoney(comp.balance)}${cgt ? `, de los cuales ${fmtMoney(cgt)} son ganancias de capital` : ''} (vence el ${formatDate(filing.dueDay)}).`);
  } else if (comp.balance < 0) {
    lines.push({ account: 'tax_receivable', debit: -comp.balance });
    post(state.ledger, { day: state.day, memo: `Declaración ${ytd.year}: devolución de retenciones en exceso`, cf: 'internal', tag: 'tax:assessment', lines });
    filing = { ...comp, ...base, dueDay: dayOf(ytd.year + 1, j.refundDate.month, j.refundDate.day), status: 'refund_pending', outstanding: -comp.balance };
    addLog(state, 'success', '🧾', `Declaración ${ytd.year} presentada: te devolverán ${fmtMoney(-comp.balance)} el ${formatDate(filing.dueDay)}.`);
  } else {
    if (lines.length >= 2) post(state.ledger, { day: state.day, memo: `Declaración ${ytd.year}`, cf: 'internal', tag: 'tax:assessment', lines });
    filing = { ...comp, ...base, dueDay: state.day, status: 'nothing', outstanding: 0 };
    if (comp.grossIncome > 0) addLog(state, 'info', '🧾', `Declaración ${ytd.year} presentada: tus retenciones cubrieron exactamente el impuesto.`);
  }
  state.tax.filings.push(filing);
  if (state.tax.filings.length > 40) state.tax.filings.splice(0, state.tax.filings.length - 40);
  // Cambio de residencia pendiente: se aplica al comenzar el nuevo año fiscal.
  const pending = state.tax.pendingJurisdiction;
  if (pending) {
    const from = residence(state);
    state.tax.jurisdiction = pending;
    state.tax.pendingJurisdiction = null;
    rebuildLivingCosts(state, from.costOfLiving);
    addLog(state, 'info', JURISDICTION_BY_ID[pending].flag, `Desde hoy tu residencia fiscal es ${JURISDICTION_BY_ID[pending].name}. Tus gastos de vida se ajustaron al costo de vida local.`);
  }
  state.tax.ytd = emptyYtd(ytd.year + 1, state.tax.jurisdiction);
  state.tax.underreport = 0;
  return filing;
}

function payFiling(state: GameState, f: Filing): boolean {
  if (f.outstanding <= 0) return true;
  if (!canPayFromChecking(state, f.outstanding)) return false;
  post(state.ledger, {
    day: state.day,
    memo: `Pago de impuestos ${f.year}`,
    cf: 'operating',
    tag: 'tax:payment',
    lines: [
      { account: 'taxes_payable', debit: f.outstanding },
      { account: 'checking', credit: f.outstanding },
    ],
  });
  addLog(state, 'expense', '🏛️', `Pagaste los impuestos de ${f.year}.`, f.outstanding);
  f.outstanding = 0;
  f.status = 'paid';
  f.paidDay = state.day;
  return true;
}

/** Suma una multa o intereses a una declaración pendiente. */
export function addPenalty(state: GameState, f: Filing, amount: Cents, memo: string): void {
  if (amount <= 0) return;
  post(state.ledger, {
    day: state.day,
    memo,
    cf: 'internal',
    tag: 'tax:penalty',
    lines: [
      { account: 'tax_penalties', debit: amount },
      { account: 'taxes_payable', credit: amount },
    ],
  });
  f.outstanding += amount;
  f.penalties += amount;
  if (f.status !== 'due') f.status = 'due';
}

export function processTaxes(state: GameState): void {
  for (const f of state.tax.filings) {
    if (f.status === 'refund_pending' && state.day >= f.dueDay) {
      post(state.ledger, {
        day: state.day,
        memo: `Devolución de impuestos ${f.year}`,
        cf: 'operating',
        tag: 'tax:refund',
        lines: [
          { account: 'checking', debit: f.outstanding },
          { account: 'tax_receivable', credit: f.outstanding },
        ],
      });
      addLog(state, 'income', '🏛️', `Recibiste la devolución de impuestos de ${f.year}.`, f.outstanding);
      f.outstanding = 0;
      f.status = 'refunded';
      f.paidDay = state.day;
      continue;
    }
    if (f.status !== 'due') continue;
    const j = jurisdictionById(f.jurisdiction);
    if (state.day === f.dueDay) {
      if (!payFiling(state, f)) {
        addPenalty(state, f, roundCents(f.outstanding * j.latePenaltyRate), `Multa por pago tardío de impuestos ${f.year}`);
        state.player.attributes.stress = Math.min(100, state.player.attributes.stress + 6);
        addLog(state, 'danger', '🏛️', `No pudiste pagar los impuestos de ${f.year} a tiempo: multa del ${Math.round(j.latePenaltyRate * 100)} % y ${j.lateMonthlyInterest * 100} % mensual de interés hasta pagar.`);
      }
    } else if (state.day > f.dueDay && (state.day - f.dueDay) % 30 === 0) {
      addPenalty(state, f, roundCents(f.outstanding * j.lateMonthlyInterest), `Interés por mora fiscal ${f.year}`);
      payFiling(state, f);
    }
  }
}

export function payTaxes(state: GameState, year: number): ActionResult {
  const f = state.tax.filings.find((x) => x.year === year && x.status === 'due');
  if (!f) return FAIL('No hay impuestos pendientes de ese año.');
  if (!payFiling(state, f)) return FAIL(`Necesitás ${fmtMoney(f.outstanding)} en la cuenta corriente.`);
  return OK('Impuestos pagados.');
}

export function taxesOutstanding(state: GameState): Cents {
  return state.tax.filings.filter((f) => f.status === 'due').reduce((s, f) => s + f.outstanding, 0);
}

/**
 * Proyección del año en curso: lo acumulado + lo que falta del año si el
 * sueldo actual se mantiene. Incluye lo que llevan ganado este año tus empresas transparentes.
 * Es una ESTIMACIÓN (no incluye bonos, ventas, alquileres ni ganancias futuras).
 */
/**
 * Tu parte del resultado de este año de las empresas transparentes (individual, sociedad):
 * tributa en tu declaración, pero recién entra a `ytd.business` el 1 de enero siguiente.
 */
export function passThroughYearToDate(state: GameState): Cents {
  const from0 = dayOf(state.tax.ytd.year, 1, 1);
  let total = 0;
  for (const co of state.companies) {
    if (co.npc || (co.status !== 'active' && co.status !== 'insolvent') || !LEGAL_FORM_BY_ID[co.legalForm]?.passThrough) continue;
    const from = Math.max(from0, co.acquiredDay ?? co.foundedDay);
    if (from > state.day) continue;
    const profit = coIncomeStatement(co, from, state.day).preTax - coPeriodTotals(co.ledger, from, state.day).subsidiary_results;
    total += roundCents(profit * co.ownership);
  }
  return total;
}

export function projectCurrentYear(state: GameState): { toDate: TaxComputation; projected: TaxComputation; projectedYtd: YearToDate } {
  const biz = passThroughYearToDate(state);
  const ytd = biz ? { ...state.tax.ytd, business: (state.tax.ytd.business ?? 0) + biz } : state.tax.ytd;
  const j = jurisdictionById(ytd.jurisdiction ?? state.tax.jurisdiction);
  const ctx = taxContext(state, j, ytd.year, 0);
  const toDate = computeAnnualTax(j, ytd, ctx);
  const g = dateOf(state.day);
  // El sueldo del mes se cobra el último día: el mes en curso cuenta mientras no se haya pagado.
  const paidThisMonth = !!state.career.job && state.career.job.paidThroughDay >= dayOf(g.y, g.m, daysInMonth(g.y, g.m));
  const monthsLeft = 12 - g.m + (paidThisMonth ? 0 : 1);
  const p: YearToDate = { ...ytd };
  const job = state.career.job;
  if (job && monthsLeft > 0) {
    const pr = payroll(j, job.salary, state.bank.pensionRate);
    p.wages += job.salary * monthsLeft;
    p.pensionEmployee += pr.pensionEmployee * monthsLeft;
    p.socialSecurity += pr.socialSecurity * monthsLeft;
    p.withheld += pr.incomeTaxWithheld * monthsLeft;
  }
  return { toDate, projected: computeAnnualTax(j, p, ctx), projectedYtd: p };
}

/** Compara la carga fiscal del año en curso si se declarara en cada jurisdicción (mismos ingresos). */
export function compareJurisdictions(state: GameState): Array<{ id: JurisdictionId; name: string; tax: Cents; cgt: Cents }> {
  const { projectedYtd } = projectCurrentYear(state);
  return (Object.keys(JURISDICTION_BY_ID) as JurisdictionId[]).map((id) => {
    const j = JURISDICTION_BY_ID[id];
    const ytd = { ...projectedYtd, withheld: 0 };
    const c = computeAnnualTax(j, ytd, { ...HONEST, deductionCapture: deductionCapture(state) });
    return { id, name: j.name, tax: c.taxAfterCredits + (c.capitalGainsTax ?? 0), cgt: c.capitalGainsTax ?? 0 };
  });
}

/**
 * Mudanza de residencia fiscal (planificación fiscal LEGAL). Se paga el trámite
 * hoy y la nueva residencia rige desde el 1 de enero siguiente.
 */
export function requestResidence(state: GameState, id: JurisdictionId): ActionResult {
  const j = JURISDICTION_BY_ID[id];
  if (!j) return FAIL('Jurisdicción inexistente.');
  if (id === state.tax.jurisdiction && !state.tax.pendingJurisdiction) return FAIL('Ya residís allí.');
  // Cancelar una mudanza pendiente: no cuesta nada (el trámite ya pagado no se devuelve).
  if (id === state.tax.jurisdiction && state.tax.pendingJurisdiction) {
    state.tax.pendingJurisdiction = null;
    return OK('Cancelaste el cambio de residencia. El trámite que ya pagaste no se devuelve.');
  }
  if (state.legal?.prison) return FAIL('No podés mudarte mientras cumplís una condena.');
  if (state.legal?.cases.some((c) => c.stage !== 'cerrado')) return FAIL('Con un proceso judicial abierto no se autoriza el cambio de residencia.');
  const nw = balanceSheet(state).netWorth;
  if (nw < usd(j.minNetWorth * state.macro.priceIndex)) return FAIL(`${j.name} exige un patrimonio neto mínimo de ${fmtMoney(usd(j.minNetWorth * state.macro.priceIndex))} para otorgar la residencia.`);
  const cost = usd(j.moveCost * state.macro.priceIndex);
  if (!canPayFromChecking(state, cost)) return FAIL(`El trámite y la mudanza cuestan ${fmtMoney(cost)}.`);
  post(state.ledger, { day: state.day, memo: `Trámite de residencia en ${j.name}`, cf: 'operating', tag: 'moving', lines: [{ account: 'other_expense', debit: cost }, { account: 'checking', credit: cost }] });
  state.tax.pendingJurisdiction = id;
  const y = dateOf(state.day).y + 1;
  return OK(`Residencia en ${j.name} aprobada: rige desde el 1 de enero de ${y}.`);
}

/** Próximas obligaciones fiscales (personales y de empresas) en los próximos `days` días. */
export function taxObligations(state: GameState, days = 365): Array<{ day: number; label: string; amount: Cents | null; kind: 'personal' | 'empresa' | 'inmueble' | 'multa' }> {
  const out: Array<{ day: number; label: string; amount: Cents | null; kind: 'personal' | 'empresa' | 'inmueble' | 'multa' }> = [];
  for (const f of state.tax.filings) if (f.status === 'due') out.push({ day: Math.max(state.day, f.dueDay), label: `Impuesto personal ${f.year}`, amount: f.outstanding, kind: 'personal' });
  const g = dateOf(state.day);
  const j = residence(state);
  const next = dayOf(g.y + 1, 1, 1);
  if (next - state.day <= days) {
    const p = projectCurrentYear(state).projected;
    const due = dayOf(g.y + 1, j.filingDeadline.month, j.filingDeadline.day);
    if (p.balance > 0) out.push({ day: due, label: `Declaración ${g.y}: saldo a pagar (estimado; se presenta el 1 de enero)`, amount: p.balance, kind: 'personal' });
    else if (p.balance < 0) out.push({ day: due, label: `Declaración ${g.y}: te devolverían ${fmtMoney(-p.balance, { decimals: false })} (estimado)`, amount: null, kind: 'personal' });
    else out.push({ day: next, label: `Declaración ${g.y}: sin saldo estimado (se presenta el 1 de enero)`, amount: 0, kind: 'personal' });
  }
  for (const co of state.companies) for (const f of co.taxFilings) if (f.outstanding > 0) out.push({ day: f.dueDay, label: `${co.name}: impuesto empresarial ${f.year}`, amount: f.outstanding, kind: 'empresa' });
  for (const p of state.realEstate?.properties ?? []) {
    if (p.nextTaxDay && p.nextTaxDay - state.day <= days) out.push({ day: p.nextTaxDay, label: `Impuesto inmobiliario: ${p.name}`, amount: p.nextTaxAmount ?? null, kind: 'inmueble' });
  }
  for (const f of state.legal?.fines ?? []) if (f.balance > 0) out.push({ day: f.dueDay, label: `Multa: ${f.label}`, amount: f.balance, kind: 'multa' });
  return out.filter((o) => o.day - state.day <= days).sort((a, b) => a.day - b.day);
}
