import type { GameState } from '../state';
import type { Company } from '../business/types';
import type { RivalGroup } from '../world/types';
import { Cents, clamp, roundCents, usd } from '../money';
import { ActionResult, FAIL, OK } from '../result';
import { addLog } from '../log';
import { fmtMoney, fmtPct } from '../format';
import { post } from '../ledger/ledger';
import { coPost, CO_ACCOUNT_IDS, CO_CHART, CoAccountId } from '../business/companyLedger';
import { valuation, coIncomeStatement } from '../business/reports';
import { creditSpread } from '../economy/economy';
import { addMonths, dateOf, dayOf, formatDate } from '../time/calendar';
import { buildCompany, revalue } from '../business/ownership';
import { coEquity, isOpen, distributableProfit } from '../business/common';
import { LEGAL_FORM_BY_ID } from '../../content/sectors';
import { canPayFromChecking } from '../finance/payments';
import { publish } from '../world/news';
import { chronicle, celebrate } from './chronicle';
import { rivalGroupValue, rememberRival } from './ranking';
import { endWar } from './rivalry';

/**
 * SALIDA A BOLSA Y ADQUISICIONES (1.4): el techo estratégico de las empresas.
 *
 * - Salida a bolsa: una corporación rentable vende entre 10 % y 30 % de acciones
 *   NUEVAS al público (el dinero entra a la caja de la empresa, como una emisión).
 *   El precio depende del ciclo: en un auge pagan más; en una recesión, menos.
 *   Cotizar da reputación y acceso a capital, y trae exigencias: la prensa sigue
 *   tus resultados trimestrales y un rival puede intentar comprar acciones.
 * - Comprar un grupo rival: pagás su valor (caja + lo que compró) más una prima
 *   de control del 30 %. Recibís una holding con esa caja; el grupo deja de
 *   competir y sus locales se integran (salen de tus mercados como rivales).
 */
export const IPO_MIN_USD = 5_000_000;
export const IPO_FEE = 0.06;
export const CONTROL_PREMIUM = 0.3;

const PHASE_PREMIUM: Record<string, number> = { auge: 1.25, expansion: 1.12, recuperacion: 1.04, desaceleracion: 0.94, recesion: 0.8 };

export function ipoPremium(state: GameState): number {
  return PHASE_PREMIUM[state.macro.phase] ?? 1;
}

/** Motivo por el que una empresa no puede salir a bolsa (null = puede). */
export function ipoBlocker(state: GameState, co: Company): string | null {
  if (co.listed) return 'Ya cotiza en la bolsa.';
  if (!isOpen(co) || co.status === 'insolvent') return 'La empresa tiene que estar operando y sana.';
  if (!LEGAL_FORM_BY_ID[co.legalForm].canRaiseEquity) return 'Solo una corporación (S.A.) puede cotizar en bolsa.';
  if (co.parentId) return 'Por ahora solo cotizan empresas que tenés directamente (no subsidiarias).';
  if (co.history.length < 24) return `Hacen falta 24 meses de historia (tiene ${co.history.length}).`;
  const last12 = co.history.slice(-12).reduce((a, h) => a + h.netIncome, 0);
  if (last12 <= 0) return 'Tiene que haber ganado dinero en los últimos 12 meses.';
  const v = valuation(state, co).value;
  if (v < usd(IPO_MIN_USD * state.macro.priceIndex)) return `Su valoración (${fmtMoney(v, { decimals: false })}) tiene que superar ${fmtMoney(usd(IPO_MIN_USD * state.macro.priceIndex), { decimals: false })}.`;
  if (co.ownership * 0.9 < 0.51) return 'Para conservar el control (51 %) después de ofrecer al menos el 10 %, necesitás tener hoy más del 57 %.';
  return null;
}

function tickerFor(state: GameState, name: string): string {
  const base = name.normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 4).padEnd(4, 'X');
  const taken = new Set([...state.stocks.stocks.map((s) => s.id), ...state.companies.map((c) => c.listed?.ticker ?? '')]);
  let t = base;
  for (let i = 1; taken.has(t); i++) t = `${base.slice(0, 3)}${i}`;
  return t;
}

export function goPublic(state: GameState, coId: number, pct: number): ActionResult {
  const co = state.companies.find((c) => c.id === coId);
  if (!co) return FAIL('Empresa inexistente.');
  const why = ipoBlocker(state, co);
  if (why) return FAIL(why);
  if (!(pct >= 0.1 && pct <= 0.3)) return FAIL('Se puede ofrecer entre el 10 % y el 30 % de la empresa.');
  if (co.ownership * (1 - pct) < 0.51) return FAIL(`Ofreciendo el ${fmtPct(pct, 0)} te quedarías con menos del 51 %: perderías el control.`);
  const v = roundCents(valuation(state, co).value * ipoPremium(state));
  const money = roundCents((v * pct) / (1 - pct));
  const fee = roundCents(money * IPO_FEE);
  coPost(co.ledger, { day: state.day, memo: `Salida a bolsa (${fmtPct(pct, 0)} de acciones nuevas)`, cf: 'financing', tag: 'capital:ipo', lines: [{ account: 'cash', debit: money }, { account: 'capital', credit: money }] });
  coPost(co.ledger, { day: state.day, memo: 'Comisiones de colocación y bolsa', cf: 'financing', tag: 'capital:ipo', lines: [{ account: 'professional_fees', debit: fee }, { account: 'cash', credit: fee }] });
  co.ownership = co.ownership * (1 - pct);
  co.capitalRaised += money;
  const ticker = tickerFor(state, co.name);
  co.listed = { day: state.day, ticker, floatPct: pct, ipoValue: v + money, indexAtIpo: state.stocks.index.level || 1000, caps: [{ d: state.day, v: v + money }] };
  revalue(state, co);
  state.player.attributes.reputation = clamp(state.player.attributes.reputation + 8, 0, 100);
  const text = `${co.name} (${ticker}) salió a bolsa valuada en ${fmtMoney(v + money, { decimals: false })}. Entraron ${fmtMoney(money - fee, { decimals: false })} netos a su caja; conservás el ${fmtPct(co.ownership, 1)}.`;
  publish(state, { kind: 'hecho', topic: 'bolsa', icon: '🔔', title: `${co.name} debuta en la bolsa`, body: text, reliability: 1, truth: true, resolveDay: null, source: 'Bolsa de Valdoria', sourceTypical: 0.97 });
  chronicle(state, 'empresa', 'bell', `${co.name} sale a bolsa`, text);
  celebrate(state, 'big', 'bell', `${co.name} cotiza en bolsa`, text);
  addLog(state, 'success', '🔔', text, money - fee, 'logros');
  return OK(text);
}

/** Valor de mercado de una empresa cotizada: su valoración con el humor de la bolsa. */
export function marketCap(state: GameState, co: Company): Cents {
  if (!co.listed) return 0;
  const mood = Math.sqrt(Math.max(0.2, (state.stocks.index.level || 1000) / co.listed.indexAtIpo));
  return roundCents(Math.max(0, valuation(state, co).value) * mood);
}

/** Cierre de mes de las cotizadas: valor de mercado y, cada trimestre, los resultados en la prensa. */
export function listedMonth(state: GameState, month: number): void {
  for (const co of state.companies) {
    if (!co.listed || !isOpen(co)) continue;
    const cap = marketCap(state, co);
    co.listed.caps.push({ d: state.day, v: cap });
    if (co.listed.caps.length > 36) co.listed.caps.shift();
    if (month % 3 !== 0) continue;
    const q = co.history.slice(-3).reduce((a, h) => a + h.netIncome, 0);
    const prev = co.history.slice(-6, -3).reduce((a, h) => a + h.netIncome, 0);
    const good = q > 0 && q >= prev;
    publish(state, { kind: 'hecho', topic: 'bolsa', icon: good ? '📈' : '📉', title: `${co.listed.ticker}: ${q >= 0 ? 'ganó' : 'perdió'} ${fmtMoney(Math.abs(q), { decimals: false })} en el trimestre`, body: `${co.name} vale ${fmtMoney(cap, { decimals: false })} en la bolsa. ${good ? 'Los inversores celebran.' : q < 0 ? 'Los inversores piden explicaciones.' : 'Resultados por debajo del trimestre anterior.'}`, reliability: 1, truth: true, resolveDay: null, source: 'Bolsa de Valdoria', sourceTypical: 0.97 });
    if (q < 0) state.player.attributes.reputation = clamp(state.player.attributes.reputation - 2, 0, 100);
  }
}

/** Recomprar acciones en el mercado (para defenderte de una compra hostil). */
export function buyBackShares(state: GameState, co: Company, pct: number, premium = 1.15): ActionResult {
  if (!co.listed) return FAIL('La empresa no cotiza.');
  if (co.parentId) return FAIL('Las acciones de una subsidiaria las compra su holding, no vos.');
  const free = 1 - co.ownership;
  const take = Math.min(pct, free);
  if (take <= 0) return FAIL('Ya tenés todas las acciones.');
  const cost = roundCents(marketCap(state, co) * take * premium);
  if (!canPayFromChecking(state, cost)) return FAIL(`Recomprar el ${fmtPct(take, 0)} cuesta ${fmtMoney(cost, { decimals: false })}.`);
  post(state.ledger, { day: state.day, memo: `Compra de acciones de ${co.name}`, cf: 'investing', tag: 'business:purchase', lines: [{ account: 'business_equity', debit: cost }, { account: 'checking', credit: cost }] });
  co.goodwill += cost - roundCents(coEquity(co) * take);
  co.carrying += cost;
  co.ownership = Math.min(1, co.ownership + take);
  co.investedByOwner += cost;
  revalue(state, co);
  return OK(`Compraste el ${fmtPct(take, 0)} de ${co.name} por ${fmtMoney(cost, { decimals: false })}. Ahora tenés el ${fmtPct(co.ownership, 1)}.`);
}

// ------------------------------------------------------------------ comprar un grupo rival

export function rivalPrice(r: RivalGroup): Cents {
  return roundCents(rivalGroupValue(r) * (1 + CONTROL_PREMIUM));
}

export function rivalBlocker(state: GameState, r: RivalGroup): string | null {
  if (r.acquired) return 'Ya es tuyo.';
  if (state.progression.stage < 8) return 'Comprar un grupo entero se habilita desde la etapa 8 (Empresario nacional).';
  const price = rivalPrice(r);
  if (price <= 0) return 'El grupo no tiene valor para comprar.';
  return null;
}

export function acquireRival(state: GameState, rivalId: string): ActionResult {
  const r = state.world.rivals.find((x) => x.id === rivalId);
  if (!r) return FAIL('Ese grupo no existe.');
  const why = rivalBlocker(state, r);
  if (why) return FAIL(why);
  const value = rivalGroupValue(r);
  const price = rivalPrice(r);
  if (!canPayFromChecking(state, price)) return FAIL(`Necesitás ${fmtMoney(price, { decimals: false })} disponibles (su valor ${fmtMoney(value, { decimals: false })} + ${fmtPct(CONTROL_PREMIUM, 0)} de prima de control).`);
  // La holding comprada: su caja es el valor del grupo (los negocios se integran a los tuyos).
  const h = buildCompany(state, 'holding', `${r.name} (adquirido)`, 'corporacion', '#9aa7c7');
  h.openDay = state.day;
  h.group = { upstreamPayout: 0, cashPooling: false, centralDelegation: false };
  coPost(h.ledger, { day: state.day, memo: `Patrimonio de ${r.name} al momento de la compra`, cf: 'financing', tag: 'capital:acquisition', lines: [{ account: 'cash', debit: value }, { account: 'capital', credit: value }] });
  post(state.ledger, { day: state.day, memo: `Compra de ${r.name}`, cf: 'investing', tag: 'business:purchase', lines: [{ account: 'business_equity', debit: price }, { account: 'checking', credit: price }] });
  h.ownership = 1;
  h.acquiredDay = state.day;
  h.carrying = price;
  h.goodwill = price - coEquity(h);
  h.investedByOwner = price;
  state.companies.push(h);
  // El grupo deja de existir como rival.
  const last = r.name.split(' ').pop() ?? r.name;
  let integrated = 0;
  for (const m of Object.values(state.markets)) {
    for (const c of m.competitors) {
      if (c.active && (c.name.includes(r.name) || c.name.endsWith(` ${last}`))) {
        c.active = false;
        integrated++;
      }
    }
  }
  r.capital = 0;
  r.assetsValue = 0;
  r.attitude = 0;
  r.truce = null;
  r.acquired = { day: state.day, price };
  state.world.intents = state.world.intents.filter((i) => i.rivalId !== r.id);
  // Lo que el grupo tenía en marcha contra vos también termina.
  state.world.supplierShocks = state.world.supplierShocks.filter((x) => x.rivalId !== r.id);
  for (const p of state.world.poach) if (p.rivalId === r.id && p.status === 'abierta') p.status = 'se_quedo';
  for (const c of state.companies) if (c.saleOffer?.from === r.name) c.saleOffer = null;
  for (const w of [...(state.saga.rivalry?.wars ?? [])]) if (w.rivalId === r.id) endWar(state, w, true);
  const head = state.saga.ranking.magnates.find((m) => m.rivalId === r.id);
  if (head) head.wealth += price;
  rememberRival(state, r, 0, 'Lo compraste');
  state.player.attributes.reputation = clamp(state.player.attributes.reputation + 6, 0, 100);
  const text = `Compraste ${r.name} por ${fmtMoney(price, { decimals: false })}. ${integrated ? `${integrated} local(es) suyo(s) dejan de competir con vos.` : ''} ${head ? `${head.name} cobra la venta y sigue en la lista, pero ya no es tu rival.` : ''}`.trim();
  publish(state, { kind: 'hecho', topic: 'empresas', icon: r.icon, title: `${state.player.name} compra ${r.name}`, body: text, reliability: 1, truth: true, resolveDay: null, source: 'Diario Económico de Valdoria', sourceTypical: 0.85, ref: { rivalId: r.id } });
  chronicle(state, 'rival', 'deal', `Compraste ${r.name}`, text);
  celebrate(state, 'big', 'deal', `${r.name} ahora es tuyo`, text);
  addLog(state, 'success', '🤝', text, undefined, 'logros');
  return OK(text);
}

export function activeRivals(state: GameState): RivalGroup[] {
  return state.world.rivals.filter((r) => !r.acquired);
}


// ------------------------------------------------------------------ bonos corporativos

export const BOND_FEE = 0.02;

/** Tasa a la que el mercado le prestaría a tu corporación (cotizar baja el costo). */
export function bondRate(state: GameState, co: Company): number {
  const ebitda = valuation(state, co).ebitdaAnnual;
  const debt = co.ledger.balances.loans + co.ledger.balances.mortgages;
  const leverage = ebitda > 0 ? debt / ebitda : 9;
  return state.macro.policyRate + creditSpread(state) + (co.listed ? 0.015 : 0.025) + (leverage > 3 ? 0.02 : leverage > 2 ? 0.01 : 0);
}

/** Cuánto podés emitir: hasta 3 veces el EBITDA anual menos la deuda que ya tiene. */
export function bondCapacity(state: GameState, co: Company): Cents {
  const v = valuation(state, co);
  return Math.max(0, roundCents(v.ebitdaAnnual * 3 - co.ledger.balances.loans - co.ledger.balances.mortgages));
}

export function bondBlocker(state: GameState, co: Company): string | null {
  if (!isOpen(co) || co.status === 'insolvent' || co.ledger.balances.arrears > 0) return 'La empresa tiene que estar operando y sin deudas vencidas.';
  if (!LEGAL_FORM_BY_ID[co.legalForm].canRaiseEquity) return 'Solo una corporación (S.A.) puede emitir bonos.';
  if (co.history.length < 24) return `Hacen falta 24 meses de historia (tiene ${co.history.length}).`;
  if (co.history.slice(-12).reduce((a, h) => a + h.netIncome, 0) <= 0) return 'Tiene que haber ganado dinero en los últimos 12 meses.';
  if (bondCapacity(state, co) < usd(500_000 * state.macro.priceIndex)) return `Con su EBITDA y su deuda actual, el mercado no le prestaría lo mínimo (${fmtMoney(usd(500_000 * state.macro.priceIndex), { decimals: false })}).`;
  return null;
}

export function issueBonds(state: GameState, coId: number, amount: Cents, years: number): ActionResult {
  const co = state.companies.find((c) => c.id === coId);
  if (!co) return FAIL('Empresa inexistente.');
  const why = bondBlocker(state, co);
  if (why) return FAIL(why);
  if (![3, 5, 10].includes(years)) return FAIL('Plazos posibles: 3, 5 o 10 años.');
  const min = usd(500_000 * state.macro.priceIndex);
  if (!(amount >= min) || amount > bondCapacity(state, co)) return FAIL(`Se puede emitir entre ${fmtMoney(min, { decimals: false })} y ${fmtMoney(bondCapacity(state, co), { decimals: false })}.`);
  const rate = bondRate(state, co) + (years === 10 ? 0.01 : years === 5 ? 0.004 : 0);
  const fee = roundCents(amount * BOND_FEE);
  coPost(co.ledger, { day: state.day, memo: `Emisión de bonos a ${years} años`, cf: 'financing', tag: 'coloan:disburse', lines: [{ account: 'cash', debit: amount - fee }, { account: 'professional_fees', debit: fee }, { account: 'loans', credit: amount }] });
  co.loans.push({ id: state.meta.nextId++, bankId: 'bonos', principal: amount, balance: amount, apr: rate, termMonths: years * 12, payment: roundCents((amount * rate) / 12), nextDueDay: addMonths(state.day, 1), paymentsMade: 0, missed: 0, guaranteed: false, bullet: true });
  const text = `${co.name} emitió ${fmtMoney(amount, { decimals: false })} en bonos a ${years} años al ${fmtPct(rate, 2)}: paga solo intereses cada mes y devuelve el capital al vencer.`;
  publish(state, { kind: 'hecho', topic: 'bolsa', icon: '📜', title: `${co.name} coloca bonos por ${fmtMoney(amount, { decimals: false })}`, body: text, reliability: 1, truth: true, resolveDay: null, source: 'Bolsa de Valdoria', sourceTypical: 0.97 });
  chronicle(state, 'empresa', 'bonds', `${co.name} emite bonos`, text);
  return OK(text);
}

// ------------------------------------------------------------------ fusión de dos empresas propias

export function mergeBlocker(state: GameState, a: Company, b: Company): string | null {
  if (a.id === b.id) return 'Elegí dos empresas distintas.';
  if (!isOpen(a) || !isOpen(b) || a.status !== 'active' || b.status !== 'active') return 'Las dos empresas tienen que estar operando y sanas.';
  if (a.sector === 'holding' || b.sector === 'holding') return 'Las holdings no se fusionan (podés pasar empresas de una a otra).';
  if (a.sector !== b.sector) return 'Solo se fusionan empresas del mismo rubro.';
  const stopped = [a, b].find((c) => (c.suspendedUntil ?? -1) > state.day);
  if (stopped) return `${stopped.name} no está operando hasta el ${formatDate(stopped.suspendedUntil!)} (suspensión, huelga o ataque informático): no se puede fusionar hasta entonces.`;
  if (a.jurisdiction !== b.jurisdiction) return 'Tienen que estar registradas en la misma jurisdicción.';
  if (a.parentId || b.parentId) return 'Por ahora solo se fusionan empresas que tenés directamente.';
  if (a.ownership < 0.9999 || b.ownership < 0.9999) return 'Tienen que ser 100 % tuyas (sin socios ni accionistas).';
  if (a.listed || b.listed) return 'Una empresa que cotiza no se puede fusionar así.';
  if (b.ledger.balances.taxes_payable > 0) return `${b.name} tiene impuestos pendientes: pagalos primero.`;
  if (state.icLoans.some((l) => l.status === 'activo' && (l.lenderId === b.id || l.borrowerId === b.id))) return `${b.name} tiene préstamos intragrupo activos.`;
  return null;
}

export function mergeCost(state: GameState, b: Company): Cents {
  const revenue = b.history.slice(-12).reduce((x, h) => x + h.revenue, 0);
  return Math.max(usd(5000 * state.macro.priceIndex), roundCents(revenue * 0.03));
}

/**
 * Fusiona `b` dentro de `a`: todos sus activos, deudas, personal, equipos,
 * inventario e inmuebles pasan a `a`, y `b` deja de existir. El resultado del año
 * de `b` pasa a `a` (tributa ahí); sus pérdidas fiscales de años anteriores se
 * pierden. Se ahorra el alquiler y la administración de una empresa; cuesta una
 * integración (3 % de las ventas anuales de `b`, mínimo $5,000).
 */
export function mergeCompanies(state: GameState, absorberId: number, targetId: number): ActionResult {
  const a = state.companies.find((c) => c.id === absorberId);
  const b = state.companies.find((c) => c.id === targetId);
  if (!a || !b) return FAIL('Empresa inexistente.');
  const why = mergeBlocker(state, a, b);
  if (why) return FAIL(why);
  const cost = mergeCost(state, b);
  if (a.ledger.balances.cash + b.ledger.balances.cash < cost) return FAIL(`La integración cuesta ${fmtMoney(cost, { decimals: false })} y entre las dos no tienen esa caja.`);
  const y0 = dayOf(dateOf(state.day).y, 1, 1);
  const is = coIncomeStatement(b, Math.max(y0, b.acquiredDay ?? b.foundedDay), state.day);
  const ytd = is.preTax;
  // 1 · Balance de b → a.
  const bl = b.ledger.balances;
  const tLines: Array<{ account: CoAccountId; debit?: Cents; credit?: Cents }> = [];
  const aLines: Array<{ account: CoAccountId; debit?: Cents; credit?: Cents }> = [];
  let net = 0;
  for (const acc of CO_ACCOUNT_IDS) {
    const t = CO_CHART[acc].type;
    const v = bl[acc];
    if (!v || (t !== 'asset' && t !== 'liability')) continue;
    if (t === 'asset') {
      tLines.push(v > 0 ? { account: acc, credit: v } : { account: acc, debit: -v });
      aLines.push(v > 0 ? { account: acc, debit: v } : { account: acc, credit: -v });
      net += v;
    } else {
      tLines.push(v > 0 ? { account: acc, debit: v } : { account: acc, credit: -v });
      aLines.push(v > 0 ? { account: acc, credit: v } : { account: acc, debit: -v });
      net -= v;
    }
  }
  tLines.push(net >= 0 ? { account: 'distributions', debit: net } : { account: 'capital', credit: -net });
  // El patrimonio de b se reparte en: capital aportado, ganancias de años anteriores (siguen siendo
  // distribuibles) y el resultado de este año (tributa en a; sin contar lo que b ya repartió).
  const dpB = distributableProfit(b);
  const ytdPart = ytd > 0 ? Math.min(ytd, Math.max(0, dpB)) : ytd;
  const priorPart = dpB - ytdPart;
  const capPart = net - dpB;
  const signed = (account: CoAccountId, v: Cents) => (v >= 0 ? { account, credit: v } : { account, debit: -v });
  if (capPart) aLines.push(signed('capital', capPart));
  if (priorPart) aLines.push(signed('distributions', priorPart));
  if (ytdPart) aLines.push(signed('other_income', ytdPart));
  coPost(b.ledger, { day: state.day, memo: `Fusión con ${a.name}: traspaso de activos y deudas`, cf: 'internal', tag: 'merge', lines: tLines });
  coPost(a.ledger, { day: state.day, memo: `Fusión: se incorpora ${b.name}${ytd ? ' (incluye su resultado del año)' : ''}`, cf: 'internal', tag: 'merge', lines: aLines });
  // 2 · Subregistros.
  a.inventory.push(...b.inventory);
  for (const p of b.products) {
    const ap = a.products.find((x) => x.id === p.id);
    if (ap) ap.finished.push(...p.finished);
  }
  a.orders.push(...b.orders);
  a.payables.push(...b.payables);
  a.receivables.push(...b.receivables);
  a.arrears.push(...b.arrears);
  a.employees.push(...b.employees);
  a.assets.push(...b.assets);
  a.loans.push(...b.loans);
  a.subscribers += b.subscribers;
  a.embezzlement ??= b.embezzlement;
  const wa = Math.max(1, a.history.slice(-3).reduce((x, h) => x + h.revenue, 0));
  const wb = Math.max(1, b.history.slice(-3).reduce((x, h) => x + h.revenue, 0));
  a.reputation = clamp(Math.round((a.reputation * wa + b.reputation * wb) / (wa + wb)), 0, 100);
  a.quality = clamp(Math.round((a.quality * wa + b.quality * wb) / (wa + wb)), 5, 100);
  a.awareness = clamp(Math.max(a.awareness, b.awareness) + 5, 0, 100);
  for (const p of state.realEstate.properties) if (p.owner.kind === 'company' && p.owner.id === b.id) p.owner = { ...p.owner, id: a.id };
  for (const m of state.realEstate.mortgages) if (m.owner.kind === 'company' && m.owner.id === b.id) m.owner = { ...m.owner, id: a.id };
  for (const p of state.realEstate.properties) if (p.usedBy === b.id) p.usedBy = state.realEstate.properties.some((x) => x.usedBy === a.id) ? null : a.id;
  for (const h of state.pros.hires) if (h.scope === b.id) h.scope = a.id;
  for (const act of state.legal.acts) if (act.companyId === b.id) act.companyId = a.id;
  if (state.saga.deals) state.saga.deals = state.saga.deals.filter((d) => d.buyerId !== b.id && d.supplierId !== b.id);
  // 3 · Tu participación: el valor contable de b se suma al de a.
  a.carrying += b.carrying;
  a.goodwill += b.goodwill;
  a.investedByOwner += b.investedByOwner;
  a.receivedByOwner += b.receivedByOwner;
  b.carrying = 0;
  b.status = 'closed';
  state.formerCompanies.push({ id: b.id, name: b.name, sector: b.sector, endDay: state.day, outcome: 'fusionada', result: 0 });
  state.companies = state.companies.filter((c) => c.id !== b.id);
  // 4 · Costo de integración (abogados, sistemas, carteles).
  const fromA = Math.min(cost, a.ledger.balances.cash);
  coPost(a.ledger, { day: state.day, memo: `Costos de integración de ${b.name}`, cf: 'operating', tag: 'merge', lines: [{ account: 'professional_fees', debit: fromA }, { account: 'cash', credit: fromA }] });
  revalue(state, a);
  const text = `${b.name} se fusionó con ${a.name}: un solo equipo (${a.employees.length} personas), una sola administración y un solo alquiler. Integración: ${fmtMoney(fromA, { decimals: false })}.${b.lossCarry.length ? ' Las pérdidas fiscales de años anteriores de la empresa absorbida se pierden.' : ''}`;
  chronicle(state, 'empresa', 'network', `Fusión: ${a.name} absorbe a ${b.name}`, text);
  addLog(state, 'success', '🔗', text);
  return OK(text);
}
