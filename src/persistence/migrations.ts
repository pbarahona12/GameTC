import { SAVE_VERSION, GameState, newPossessions } from '../engine/state';
import { initWorldLife } from '../engine/world/rivals';
import { TUTORIAL } from '../engine/progression/tutorial';
import { initMarkets } from '../engine/business/market';
import { newMacroV2 } from '../engine/economy/economy';
import { emptyYtd } from '../engine/tax/incomeTax';
import { initWorldV3 } from '../engine/worldInit';
import { migrateSaga } from '../engine/saga/index';

/**
 * Migraciones de partidas guardadas. Cada función transforma una partida de
 * la versión N a la N+1. Nunca se borran: una partida muy vieja pasa por todas.
 *
 * Versión 0 (prototipo interno): no tenía `credit.arrearsEvents` ni
 * `bank.rateNegotiations`. Se conserva como ejemplo y está cubierta por pruebas.
 */
/**
 * Una partida guardada por una versión anterior es JSON sin tipo estático (su forma
 * es justamente lo que estas funciones corrigen). Es la única excepción al tipado
 * estricto del proyecto; el resultado se valida después con las invariantes.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- datos heredados sin forma conocida
type AnyState = Record<string, any>;

export const MIGRATIONS: Record<number, (s: AnyState) => AnyState> = {
  0: (s) => {
    s.credit = { arrearsEvents: 0, ...s.credit };
    s.bank = { rateNegotiations: {}, ...s.bank };
    s.version = 1;
    return s;
  },
  1: (s) => {
    // v2: empresas (Fase 2). Nuevas cuentas personales, mercados y cartera vacía.
    for (const acc of ['business_equity', 'business_results', 'dividend_tax', 'capital_gains_tax', 'acquisition_costs']) {
      if (s.ledger.balances[acc] === undefined) s.ledger.balances[acc] = 0;
    }
    s.companies = s.companies ?? [];
    s.listings = s.listings ?? [];
    s.formerCompanies = s.formerCompanies ?? [];
    s.markets = s.markets && Object.keys(s.markets).length ? s.markets : initMarkets(s as GameState);
    if (s.tax?.ytd && s.tax.ytd.business === undefined) s.tax.ytd.business = 0;
    s.version = 2;
    return s;
  },
  2: (s) => {
    // v3: Fases 3–4 (inversiones, inmuebles, economía dinámica, jurisdicciones, profesionales, grupos, sistema legal).
    const personal = ['stocks', 'bonds', 'funds', 'mogul', 'real_estate', 'undeclared_cash', 'mortgages', 'fines_payable', 'dividend_income', 'bond_interest', 'rental_income',
      'realized_gains', 'unrealized_gains', 'illicit_income', 'brokerage_fees', 'property_expenses', 'property_tax', 'professional_fees', 'legal_costs', 'fines', 'illicit_costs', 'seizures'];
    for (const a of personal) if (s.ledger.balances[a] === undefined) s.ledger.balances[a] = 0;
    const companyAccounts = ['real_estate', 'subsidiaries', 'ic_receivable', 'mortgages', 'ic_payable', 'rental_income', 'gain_on_sale', 'ic_income', 'subsidiary_results', 'property_costs', 'property_tax', 'professional_fees', 'undocumented', 'ic_expense', 'fines'];
    const fixCompany = (co: AnyState) => {
      for (const a of companyAccounts) if (co.ledger.balances[a] === undefined) co.ledger.balances[a] = 0;
      co.jurisdiction = co.jurisdiction ?? 'valdoria';
      co.parentId = co.parentId ?? null;
      co.group = co.group ?? null;
      co.suspendedUntil = co.suspendedUntil ?? null;
      co.irregular = co.irregular ?? { inflatedBooks: 0, underreport: 0 };
      co.managementFee = co.managementFee ?? 0;
      co.embezzlement = co.embezzlement ?? null;
    };
    for (const co of s.companies ?? []) fixCompany(co);
    for (const l of s.listings ?? []) fixCompany(l.company);
    s.macro = { ...newMacroV2(), ...s.macro, forced: null };
    s.macro.yearInflationAcc = s.macro.yearInflationAcc ?? 0;
    s.tax.jurisdiction = s.tax.jurisdiction ?? 'valdoria';
    s.tax.pendingJurisdiction = s.tax.pendingJurisdiction ?? null;
    s.tax.capitalLossCarry = s.tax.capitalLossCarry ?? [];
    s.tax.underreport = s.tax.underreport ?? 0;
    s.tax.ytd = { ...emptyYtd(s.tax.ytd.year, 'valdoria'), ...s.tax.ytd };
    for (const f of s.tax.filings ?? []) f.jurisdiction = f.jurisdiction ?? 'valdoria';
    s.options = s.options ?? { difficulty: 'normal', illegalEnabled: true };
    s.icLoans = s.icLoans ?? [];
    s.stocks = { stocks: [], index: { level: 1000, base: 0, history: [] }, orders: [], holdings: {}, trades: [], dividendsReceived: 0 };
    s.bonds = { issues: [], holdings: {}, couponsReceived: 0 };
    s.funds = { funds: [], holdings: {}, distributionsReceived: 0 };
    s.mogul = { assets: [], holdings: {}, distributionsReceived: 0 };
    s.realEstate = { zones: [], properties: [], mortgages: [], listings: [] };
    s.pros = { market: [], hires: [], audits: [], lastRefresh: -1 };
    s.legal = { heat: 0, acts: [], cases: [], fines: [], prison: null, criminalRecord: 0, ventures: [], log: [], lastTaxAudit: 0, contracts: [], inspections: [] };
    initWorldV3(s as GameState);
    s.version = 3;
    return s;
  },
  3: (s) => {
    // v4 (1.1): habilidad Proyección de negocios, gestor de inversiones, pronósticos guardados.
    if (s.ledger.balances.managed === undefined) s.ledger.balances.managed = 0;
    s.skills.forecasting = s.skills.forecasting ?? { level: 1, xp: 0 };
    s.managed = s.managed ?? { mandates: [], holdings: {} };
    for (const co of s.companies ?? []) co.forecast = co.forecast ?? null;
    s.version = 4;
    return s;
  },
  4: (s) => {
    // v5 (1.2): tiendas y posesiones, niveles de tarjeta y cuotas, noticias y rivales.
    for (const a of ['personal_assets', 'card_installments', 'card_rewards', 'shopping', 'goods_depreciation']) if (s.ledger.balances[a] === undefined) s.ledger.balances[a] = 0;
    const c = s.bank.card;
    c.tier = c.tier ?? 'clasica';
    c.feeDay = c.feeDay ?? s.day + 365;
    c.rewardsPending = c.rewardsPending ?? 0;
    c.rewardsTotal = c.rewardsTotal ?? 0;
    c.installments = c.installments ?? [];
    c.lastTierRequest = c.lastTierRequest ?? -999;
    s.possessions = s.possessions ?? newPossessions(s.seed ?? 0);
    if (!s.world) {
      s.world = { news: [], rivals: [], intents: [], supplierShocks: [], poach: [], lastRead: 0 };
      initWorldLife(s as GameState);
    }
    s.meta.gatesOpened = s.meta.gatesOpened ?? [];
    // Las misiones que ya estaban hechas se marcan sin recompensa (evita una lluvia de avisos).
    s.tutorial.completed = s.tutorial.completed ?? [];
    for (const t of TUTORIAL) {
      try {
        if (!s.tutorial.completed.includes(t.id) && t.done(s as GameState)) s.tutorial.completed.push(t.id);
      } catch {
        /* misión que depende de datos que la partida vieja no tenía */
      }
    }
    s.version = 5;
    return s;
  },
  5: (s) => {
    // v6 (1.4): la historia del magnate (clasificaciones, metas, dilemas, crónica, desafíos).
    // La economía no se toca: las fortunas del mundo se crean a precios de hoy.
    for (const r of s.world?.rivals ?? []) {
      r.assetsValue = r.assetsValue ?? 0;
      r.attitude = r.attitude ?? 0;
      r.memory = r.memory ?? [];
      r.truce = r.truce ?? null;
    }
    if (!s.saga) migrateSaga(s as GameState);
    s.version = 6;
    return s;
  },
};

export function migrate(raw: AnyState): { state: GameState; migratedFrom: number | null } {
  let v = typeof raw.version === 'number' ? raw.version : 0;
  const from = v;
  if (v > SAVE_VERSION) throw new Error(`La partida es de una versión más nueva del juego (v${v}). Actualizá la aplicación.`);
  while (v < SAVE_VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`No existe migración desde la versión ${v}.`);
    raw = m(raw);
    v = raw.version;
  }
  return { state: raw as GameState, migratedFrom: from === SAVE_VERSION ? null : from };
}

/** Comprobación estructural mínima antes de validar la contabilidad. */
export function validateShape(s: AnyState): string[] {
  const errs: string[] = [];
  const need = ['player', 'ledger', 'bank', 'budget', 'career', 'skills', 'education', 'tax', 'macro', 'credit', 'progression', 'history', 'log', 'meta', 'tutorial'];
  if (typeof s.version === 'number' && s.version >= 3) need.push('stocks', 'bonds', 'funds', 'mogul', 'realEstate', 'pros', 'legal', 'options');
  if (typeof s.version === 'number' && s.version >= 4) need.push('managed');
  if (typeof s.version === 'number' && s.version >= 5) need.push('possessions', 'world');
  if (typeof s.version === 'number' && s.version >= 6) need.push('saga');
  for (const k of need) if (s[k] === undefined || s[k] === null) errs.push(`Falta la sección "${k}".`);
  if (!Array.isArray(s.ledger?.entries)) errs.push('Libro mayor inválido.');
  if (typeof s.day !== 'number') errs.push('Día inválido.');
  return errs;
}
