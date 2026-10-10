import type { GameState } from '../state';
import type { RivalGroup } from '../world/types';
import type { CompetitorState } from '../business/types';
import type { BizSectorId } from '../../content/sectors';
import { SECTOR_BY_ID } from '../../content/sectors';
import { chance, nextRandom, randInt } from '../rng';
import { clamp, roundCents, usd } from '../money';
import { addLog } from '../log';
import { formatDate } from '../time/calendar';
import { isOpen } from '../business/common';
import { publish } from '../world/news';
import { difficultyOf } from '../economy/difficulty';
import { balanceSheet } from '../reports/statements';
import { chronicle, celebrate } from './chronicle';
import { srng, rememberRival, magnateWealth } from './ranking';

/**
 * RIVALIDAD (1.4): la competencia con cara.
 *  - Némesis: el grupo que más te odia (rencor ≥ 75) te declara la guerra. Ataca
 *    más seguido hasta que lo vencés (lo comprás o tu fortuna duplica la de su
 *    dueño) o hacen las paces (su rencor baja de 25).
 *  - Guerra de precios: un grupo con rencor baja los precios de sus locales en un
 *    mercado donde operás (o abre un local de batalla) durante 4–8 meses. Le
 *    cuesta caro a él también: quema capital todos los meses.
 *  - Coalición: cuando sos dominante (top 10 de tu ciudad o etapa 9+), los dos
 *    grupos con más rencor se alían contra vos durante 3 años.
 *  - Aliados: un grupo puede aliarse con vos (dilema): no te ataca mientras dure.
 * Todo usa el azar de la historia (saga.rng), no el de la economía.
 */
export interface PriceWar {
  id: number;
  rivalId: string;
  sector: BizSectorId;
  from: number;
  until: number;
  /** Locales del rival con su multiplicador de precio original. */
  cut: Array<{ id: number; mult: number }>;
  /** Local de batalla abierto para la guerra (se cierra al terminar). */
  battleId: number | null;
}

export interface RivalryState {
  nemesisId: string | null;
  nemesisSince: number;
  /** Némesis vencidos (ids). */
  beaten: string[];
  wars: PriceWar[];
  coalition: { members: string[]; from: number; until: number } | null;
  lastCoalition: number;
  /** Guerras de precios resistidas (seguías operando en ese sector al terminar). */
  warsSurvived?: number;
}

export function rivalry(state: GameState): RivalryState {
  const s = state.saga;
  s.rivalry ??= { nemesisId: null, nemesisSince: 0, beaten: [], wars: [], coalition: null, lastCoalition: -99999 };
  return s.rivalry;
}

export const isAlly = (state: GameState, r: RivalGroup) => !!r.ally && r.ally.until >= state.day;
const active = (state: GameState) => state.world.rivals.filter((r) => !r.acquired);
const last = (r: RivalGroup) => r.name.split(' ').pop() ?? r.name;
const ownsCompetitor = (r: RivalGroup, c: CompetitorState) => c.name.includes(r.name) || c.name.endsWith(` ${last(r)}`) || c.name.includes(`${last(r)} Express`);

/** Hostilidad extra por rivalidad: némesis +0.25, miembro de una coalición +0.3. Aliados: 0. */
export function rivalryBoost(state: GameState, r: RivalGroup): number {
  if (!state.saga) return 0;
  const rv = state.saga.rivalry;
  if (!rv) return 0;
  let b = 0;
  if (rv.nemesisId === r.id) b += 0.25;
  if (rv.coalition && rv.coalition.until >= state.day && rv.coalition.members.includes(r.id)) b += 0.3;
  return b;
}

export function nemesisOf(state: GameState): RivalGroup | undefined {
  const id = state.saga?.rivalry?.nemesisId;
  return id ? state.world.rivals.find((r) => r.id === id) : undefined;
}

export function warsIn(state: GameState, sector: BizSectorId): PriceWar[] {
  return rivalry(state).wars.filter((w) => w.sector === sector && w.until >= state.day);
}

function news(state: GameState, r: RivalGroup, icon: string, title: string, body: string, sector?: BizSectorId): void {
  publish(state, { kind: 'hecho', topic: 'empresas', icon, title, body, reliability: 1, truth: true, resolveDay: null, source: 'Diario Económico de Valdoria', sourceTypical: 0.85, ref: { rivalId: r.id, sector } });
}

/** Empieza una guerra de precios (se puede forzar en pruebas). */
export function startPriceWar(state: GameState, r: RivalGroup, sector: BizSectorId, days: number): PriceWar | null {
  const m = state.markets[sector];
  if (!m || warsIn(state, sector).length) return null;
  const war: PriceWar = { id: state.meta.nextId++, rivalId: r.id, sector, from: state.day, until: state.day + days, cut: [], battleId: null };
  for (const c of m.competitors.filter((x) => x.active && ownsCompetitor(r, x))) {
    war.cut.push({ id: c.id, mult: c.priceMult });
    c.priceMult = clamp(Math.round(c.priceMult * 0.85 * 100) / 100, 0.6, 1.8);
  }
  if (!war.cut.length) {
    const sec = SECTOR_BY_ID[sector];
    const c: CompetitorState = { id: state.meta.nextId++, name: `${sec.name.split(' ')[0]} ${last(r)} Express`, priceMult: 0.82, quality: 55, reputation: 50, awareness: 45, active: true, enteredDay: state.day };
    m.competitors.push(c);
    war.battleId = c.id;
  }
  rivalry(state).wars.push(war);
  const sec = SECTOR_BY_ID[sector].name.toLowerCase();
  const body = `${r.name} baja sus precios en ${sec} ${war.battleId ? 'con un local de batalla nuevo ' : ''}hasta el ${formatDate(war.until)}. Vende por debajo de su costo para quitarte clientes: le cuesta caro también a él.`;
  news(state, r, '⚔️', `${r.name} inicia una guerra de precios en ${sec}`, body, sector);
  addLog(state, 'danger', '⚔️', body, undefined, 'ofertas');
  chronicle(state, 'rival', 'rivals', `Guerra de precios con ${r.name}`, body);
  return war;
}

/**
 * Termina una guerra de precios. Los precios del rival se recuperan desde donde
 * están hoy (deshaciendo solo el recorte), así no se borran meses de mercado.
 * `silent`: termina por una compra o una alianza (sin festejo ni «resististe»).
 */
export function endWar(state: GameState, w: PriceWar, silent = false): void {
  const m = state.markets[w.sector];
  const r = state.world.rivals.find((x) => x.id === w.rivalId);
  if (m) {
    for (const x of w.cut) {
      const c = m.competitors.find((y) => y.id === x.id);
      if (c) c.priceMult = clamp(Math.round((c.priceMult / 0.85) * 100) / 100, 0.6, 1.8);
    }
    if (w.battleId !== null) {
      const c = m.competitors.find((y) => y.id === w.battleId);
      if (c) c.active = false;
    }
  }
  rivalry(state).wars = rivalry(state).wars.filter((x) => x !== w);
  if (!r || silent || r.acquired || isAlly(state, r)) return;
  rememberRival(state, r, -10, 'Terminó la guerra de precios');
  const sec = SECTOR_BY_ID[w.sector].name.toLowerCase();
  const stillHere = state.companies.some((c) => isOpen(c) && !c.npc && c.sector === w.sector);
  const text = stillHere ? `Resististe: ${r.name} vuelve a sus precios normales en ${sec}.` : `${r.name} termina su guerra de precios en ${sec}.`;
  news(state, r, '🏳️', `Fin de la guerra de precios en ${sec}`, text, w.sector);
  chronicle(state, 'rival', 'rivals', `Fin de la guerra de precios con ${r.name}`, text);
  if (stillHere) {
    rivalry(state).warsSurvived = (rivalry(state).warsSurvived ?? 0) + 1;
    celebrate(state, 'small', 'shield', 'Resististe la guerra de precios', text);
  }
}

function nemesisStep(state: GameState): void {
  const rv = rivalry(state);
  const n = nemesisOf(state);
  if (n) {
    const head = state.saga.ranking.magnates.find((m) => m.rivalId === n.id);
    const nw = balanceSheet(state).netWorth;
    const beaten = !!n.acquired || (head ? nw >= magnateWealth(state, head) * 2 : false);
    if (beaten) {
      rv.nemesisId = null;
      rv.beaten.push(n.id);
      const text = n.acquired ? `Compraste ${n.name}: tu némesis ya no existe como rival.` : `Tu fortuna ya duplica la de ${head?.name ?? n.name}. ${n.name} dejó de ser una amenaza.`;
      chronicle(state, 'rival', 'crown', `Venciste a tu némesis: ${n.name}`, text);
      celebrate(state, 'big', 'crown', `Venciste a ${n.name}`, text);
      rememberRival(state, n, -50, 'Lo venciste');
      return;
    }
    if ((n.attitude ?? 0) < 25) {
      rv.nemesisId = null;
      chronicle(state, 'rival', 'deal', `Paz con ${n.name}`, 'El rencor se enfrió: ya no es tu némesis.');
    }
    return;
  }
  const cand = active(state).filter((r) => !isAlly(state, r) && (r.attitude ?? 0) >= 75 && !rv.beaten.includes(r.id)).sort((a, b) => (b.attitude ?? 0) - (a.attitude ?? 0))[0];
  if (!cand) return;
  rv.nemesisId = cand.id;
  rv.nemesisSince = state.day;
  const why = cand.memory?.slice(-2).map((m) => m.text.toLowerCase()).join(' y ') || 'todo lo que pasó entre ustedes';
  const text = `${cand.name} te declaró la guerra (${why}). Va a atacarte más seguido hasta que lo venzas: comprarlo o que tu fortuna duplique la de su dueño.`;
  news(state, cand, cand.icon, `${cand.name} declara la guerra a ${state.player.name}`, text);
  chronicle(state, 'rival', 'rivals', `${cand.name} es tu némesis`, text);
  celebrate(state, 'small', 'rivals', `Tenés un némesis: ${cand.name}`, text);
}

function warStep(state: GameState): void {
  const g = srng(state);
  const rv = rivalry(state);
  for (const w of [...rv.wars]) {
    const r = state.world.rivals.find((x) => x.id === w.rivalId);
    if (w.until < state.day || !r || r.acquired || isAlly(state, r)) {
      endWar(state, w);
      continue;
    }
    // Vender por debajo del costo le cuesta al rival.
    r.capital = Math.max(0, r.capital - roundCents(usd(40_000 * state.macro.priceIndex)));
  }
  const intensity = difficultyOf(state).events;
  const mine = state.companies.filter((c) => isOpen(c) && !c.npc && c.sector !== 'holding');
  for (const r of active(state)) {
    if (isAlly(state, r) || (r.attitude ?? 0) < 55 || rv.wars.some((w) => w.rivalId === r.id)) continue;
    const targets = mine.filter((c) => r.sectors.includes(c.sector) && !(r.truce && r.truce.until >= state.day && r.truce.sector === c.sector) && !warsIn(state, c.sector).length);
    if (!targets.length) continue;
    const p = 0.04 * intensity * (rv.nemesisId === r.id ? 2 : 1) * (1 + rivalryBoost(state, r));
    if (!chance(g, p)) continue;
    const co = targets[Math.floor(nextRandom(g) * targets.length)];
    startPriceWar(state, r, co.sector, randInt(g, 120, 240));
    openWarDilemma(state, r, co.id);
  }
}

/** Se registra desde dilemmas.ts (evita una dependencia circular). */
let openWarDilemma: (state: GameState, r: RivalGroup, companyId: number) => void = () => {};
export function registerWarDilemma(fn: typeof openWarDilemma): void {
  openWarDilemma = fn;
}

function coalitionStep(state: GameState): void {
  const rv = rivalry(state);
  if (rv.coalition) {
    if (rv.coalition.until < state.day || rv.coalition.members.some((id) => state.world.rivals.find((r) => r.id === id)?.acquired)) {
      const names = rv.coalition.members.map((id) => state.world.rivals.find((r) => r.id === id)?.name ?? id).join(' y ');
      rv.coalition = null;
      chronicle(state, 'rival', 'deal', 'Se disuelve la coalición en tu contra', `${names} vuelven a competir cada uno por su lado.`);
    }
    return;
  }
  const dominant = state.progression.stage >= 9 || (state.saga.ranking.player.city !== null && state.saga.ranking.player.city <= 10);
  if (!dominant || state.day - rv.lastCoalition < 3650) return;
  const pool = active(state).filter((r) => !isAlly(state, r)).sort((a, b) => (b.attitude ?? 0) - (a.attitude ?? 0));
  if (pool.length < 2) return;
  if (!chance(srng(state), 0.03 * difficultyOf(state).events)) return;
  const [a, b] = pool;
  rv.coalition = { members: [a.id, b.id], from: state.day, until: state.day + 1095 };
  rv.lastCoalition = state.day;
  rememberRival(state, a, 20, 'Se alió contra vos');
  rememberRival(state, b, 20, 'Se alió contra vos');
  const text = `${a.name} y ${b.name} firmaron una alianza para frenarte: durante tres años coordinan compras, precios y ofertas por tu gente. Es el precio de ser de los más grandes.`;
  news(state, a, '🤝', `${a.name} y ${b.name} se alían contra ${state.player.name}`, text);
  addLog(state, 'warning', '🤝', text, undefined, 'ofertas');
  chronicle(state, 'rival', 'rivals', 'Una coalición en tu contra', text);
  celebrate(state, 'small', 'rivals', 'Se alían contra vos', text);
}

function alliesStep(state: GameState): void {
  for (const r of state.world.rivals) {
    if (r.ally && r.ally.until < state.day) {
      r.ally = null;
      chronicle(state, 'rival', 'deal', `Termina la alianza con ${r.name}`, 'Vuelven a ser competidores.');
    }
  }
}

/** Cierre de mes. */
export function rivalryMonth(state: GameState): void {
  if (state.meta.projection || !state.saga || !state.world) return;
  alliesStep(state);
  nemesisStep(state);
  warStep(state);
  coalitionStep(state);
}
