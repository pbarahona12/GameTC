import type { GameState } from '../state';
import type { JurisdictionId } from '../../content/jurisdictions';
import type { FortuneSource, Magnate, RankingState } from './types';
import { CITIES, CITY_BY_ID, FIRST_NAMES, LAST_NAMES, BIOS, SOURCE_INFO } from '../../content/cities';
import { chance, nextRandom, randInt, randNormal, randRange, RngHolder, seedFromString } from '../rng';
import { clamp, Cents, roundCents, usd } from '../money';
import { balanceSheet } from '../reports/statements';
import { publish } from '../world/news';
import { addLog } from '../log';
import { fmtMoney } from '../format';
import { chronicle, celebrate } from './chronicle';
import { dateOf } from '../time/calendar';
import type { RivalGroup } from '../world/types';
import type { StockSector } from '../invest/types';
import { ZONES } from '../../content/realestate';

/**
 * CLASIFICACIONES DE FORTUNAS (1.4).
 *
 * Cada ciudad tiene sus 100 personas más ricas, con nombre, edad, origen de su
 * fortuna y una historia. Sus patrimonios NO se inventan cada mes: siguen al
 * mercado de la partida (la bolsa real del juego por sector, los índices de
 * cada zona inmobiliaria, las tasas), más su propia suerte y sus gastos. Así,
 * en una crisis caen todos, y en un auge tecnológico suben los tecnológicos.
 *
 * Los cuatro grupos rivales tienen cara: su dueño está en la lista y su
 * fortuna incluye el capital y lo que compró el grupo. Superarlos, pelear el
 * primer puesto y defenderlo genera noticias, logros, metas y reacciones.
 *
 * Tu ciudad es la de tu residencia fiscal. El ranking global junta las cuatro.
 * Todo usa el azar propio de la historia (saga.rng): no altera la economía.
 */

export const CITY_SIZE = 100;
/** Puestos que se festejan y se anuncian la primera vez. */
const CITY_MILESTONES = [100, 50, 25, 10, 3, 1];
const GLOBAL_MILESTONES = [100, 10, 1];
/** Patrimonio que se gasta o se dona por mes (estilo de vida, filantropía). */
const MONTHLY_BURN = 0.0012;

/** Dueños de los grupos rivales: su lugar en la lista al empezar. */
export const RIVAL_HEADS: Record<string, { name: string; city: JurisdictionId; rank: number; source: FortuneSource; bio: string }> = {
  duarte: { name: 'Familia Duarte', city: 'valdoria', rank: 7, source: 'industria', bio: 'Industriales tradicionales con muchos inmuebles. Controlan la Familia Duarte (grupo).' },
  altamira: { name: 'Ramiro Altamira', city: 'valdoria', rank: 15, source: 'comercio', bio: 'Fundador del Grupo Altamira: cafeterías y comercios de cercanía. Compra rápido y pelea con precios bajos.' },
  nexo: { name: 'Elena Ibarra', city: 'norvalia', rank: 5, source: 'tecnologia', bio: 'Presidenta y principal accionista de la Corporación Nexo. Paciente y muy bien informada.' },
  ferran: { name: 'Familia Ferrán', city: 'isla_coral', rank: 11, source: 'finanzas', bio: 'Dueños de Inversiones Ferrán, el fondo familiar que busca gangas.' },
};

export function srng(state: GameState): RngHolder {
  const s = state.saga as { rng?: number };
  if (typeof s.rng !== 'number') s.rng = seedFromString(`${state.seed}|saga`);
  return s as RngHolder;
}

export function emptyRanking(): RankingState {
  return { magnates: [], lastPrices: {}, lastZones: {}, player: { city: null, global: null, bestCity: null, bestGlobal: null }, reignMonths: 0, bestReign: 0, history: [], milestones: [], overtaken: [] };
}

function pickSource(g: RngHolder, weights: Partial<Record<FortuneSource, number>>): FortuneSource {
  const entries = Object.entries(weights) as Array<[FortuneSource, number]>;
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let x = nextRandom(g) * total;
  for (const [k, w] of entries) {
    x -= w;
    if (x <= 0) return k;
  }
  return entries[entries.length - 1][0];
}

/** Fortuna de la posición r (1–100) según la ley de potencias de la ciudad (USD a precios iniciales). */
export function curveWealth(city: JurisdictionId, r: number): number {
  const c = CITY_BY_ID[city];
  const a = Math.log(c.top1 / c.top100) / Math.log(CITY_SIZE);
  return c.top1 * Math.pow(r, -a);
}

function makeName(g: RngHolder, used: Set<string>, family: boolean): string {
  for (let i = 0; i < 50; i++) {
    const last = LAST_NAMES[Math.floor(nextRandom(g) * LAST_NAMES.length)];
    const name = family ? `Familia ${last}` : `${FIRST_NAMES[Math.floor(nextRandom(g) * FIRST_NAMES.length)]} ${last}${chance(g, 0.35) ? ` ${LAST_NAMES[Math.floor(nextRandom(g) * LAST_NAMES.length)]}` : ''}`;
    if (!used.has(name)) {
      used.add(name);
      return name;
    }
  }
  const n = `${FIRST_NAMES[0]} ${LAST_NAMES[0]} ${used.size}`;
  used.add(n);
  return n;
}

function newMagnate(g: RngHolder, id: number, city: JurisdictionId, wealthUsd: number, priceIndex: number, used: Set<string>, young = false): Magnate {
  const source = pickSource(g, CITY_BY_ID[city].sources);
  const family = source === 'herencia' ? chance(g, 0.5) : chance(g, 0.08);
  const bios = BIOS[source];
  return {
    id, city, source, sector: SOURCE_INFO[source].sector,
    name: makeName(g, used, family),
    age: young ? randInt(g, 26, 40) : source === 'tecnologia' ? randInt(g, 29, 58) : source === 'herencia' ? randInt(g, 34, 82) : randInt(g, 38, 80),
    wealth: usd(wealthUsd * priceIndex),
    prevCityRank: 0, bestCityRank: 999,
    bio: bios[Math.floor(nextRandom(g) * bios.length)],
  };
}

/** Grupo rival: dinero disponible + valor de lo que compró. */
export function rivalGroupValue(r: RivalGroup): Cents {
  return Math.max(0, r.capital) + Math.max(0, r.assetsValue ?? 0);
}

/** Patrimonio de un personaje (los dueños de grupos rivales suman el grupo). */
export function magnateWealth(state: GameState, m: Magnate): Cents {
  if (!m.rivalId) return m.wealth;
  const r = state.world.rivals.find((x) => x.id === m.rivalId);
  return m.wealth + (r ? rivalGroupValue(r) : 0);
}

/**
 * Crea las listas de las cuatro ciudades. En una partida vieja (migración) las
 * fortunas se ajustan a los precios de hoy, así el mundo no parece "barato".
 */
export function initRanking(state: GameState): void {
  const g = srng(state);
  const rk = state.saga.ranking;
  const pi = state.macro?.priceIndex ?? 1;
  const used = new Set<string>();
  rk.magnates = [];
  let id = 1;
  for (const c of CITIES) {
    const heads = Object.entries(RIVAL_HEADS).filter(([, h]) => h.city === c.id);
    for (let r = 1; r <= CITY_SIZE; r++) {
      const head = heads.find(([, h]) => h.rank === r);
      const w = curveWealth(c.id, r) * randRange(g, 0.93, 1.07);
      if (head) {
        const [rivalId, h] = head;
        used.add(h.name);
        const group = state.world.rivals.find((x) => x.id === rivalId);
        const groupValue = group ? rivalGroupValue(group) : 0;
        rk.magnates.push({ id: id++, name: h.name, city: c.id, age: randInt(g, 48, 74), source: h.source, sector: SOURCE_INFO[h.source].sector, wealth: Math.max(usd(1_000_000), usd(w * pi) - groupValue), prevCityRank: r, bestCityRank: r, rivalId, bio: h.bio });
        continue;
      }
      const m = newMagnate(g, id++, c.id, w, pi, used);
      m.prevCityRank = r;
      m.bestCityRank = r;
      rk.magnates.push(m);
    }
  }
  // La edad guardada es la que tenían el día 0 (así se calcula la actual en cualquier momento).
  const yearsIn = Math.floor(state.day / 365);
  if (yearsIn) for (const m of rk.magnates) m.age -= yearsIn;
  for (const r of state.world.rivals) {
    r.city = r.city ?? RIVAL_HEADS[r.id]?.city ?? 'valdoria';
    r.assetsValue = r.assetsValue ?? 0;
    r.attitude = r.attitude ?? 0;
    r.memory = r.memory ?? [];
  }
  rk.lastPrices = currentPrices(state);
  rk.lastZones = currentZones(state);
}

function currentPrices(state: GameState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of state.stocks?.stocks ?? []) if (s.status === 'activa') out[s.id] = s.price;
  return out;
}

function currentZones(state: GameState): Record<string, number> {
  const out: Record<string, number> = {};
  for (const z of state.realEstate?.zones ?? []) out[z.id] = z.index;
  return out;
}

export interface MarketMonth {
  market: number;
  sector: Partial<Record<StockSector, number>>;
  zone: Partial<Record<JurisdictionId, number>>;
}

/**
 * Rendimiento del mes del mercado de la partida: promedio ponderado por valor
 * de las acciones que existían el mes pasado (las que quebraron cuentan como −100 %).
 */
export function marketMonth(state: GameState): MarketMonth {
  const rk = state.saga.ranking;
  const bySector: Partial<Record<StockSector, { w: number; r: number }>> = {};
  let mw = 0;
  let mr = 0;
  for (const s of state.stocks?.stocks ?? []) {
    const before = rk.lastPrices[s.id];
    if (!before) continue;
    const now = s.status === 'activa' ? s.price : 0;
    const ret = now / before - 1;
    const w = before * s.shares;
    const acc = (bySector[s.sector] ??= { w: 0, r: 0 });
    acc.w += w;
    acc.r += w * ret;
    mw += w;
    mr += w * ret;
  }
  const sector: MarketMonth['sector'] = {};
  for (const [k, v] of Object.entries(bySector)) if (v && v.w > 0) sector[k as StockSector] = v.r / v.w;
  const zone: MarketMonth['zone'] = {};
  const zoneAcc: Partial<Record<JurisdictionId, { n: number; r: number }>> = {};
  for (const z of state.realEstate?.zones ?? []) {
    const before = rk.lastZones[z.id];
    const def = ZONE_JURISDICTION[z.id];
    if (!before || !def) continue;
    const a = (zoneAcc[def] ??= { n: 0, r: 0 });
    a.n++;
    a.r += z.index / before - 1;
  }
  for (const [k, v] of Object.entries(zoneAcc)) if (v && v.n) zone[k as JurisdictionId] = v.r / v.n;
  return { market: mw > 0 ? mr / mw : 0, sector, zone };
}

const ZONE_JURISDICTION: Record<string, JurisdictionId> = Object.fromEntries(ZONES.map((z) => [z.id, z.jurisdiction]));

/** Crecimiento mensual de una fortuna según su origen y el mercado. */
function monthlyGrowth(state: GameState, g: RngHolder, m: Magnate, mm: MarketMonth): number {
  const sec = (s?: StockSector) => (s && mm.sector[s] !== undefined ? mm.sector[s]! : mm.market);
  const n = randNormal(g);
  const zone = mm.zone[m.city] ?? mm.zone.valdoria ?? 0;
  let r: number;
  switch (m.source) {
    case 'tecnologia': r = sec('tecnologia') * 1.3 + 0.002 + n * 0.035; break;
    case 'finanzas': r = mm.market * 1.05 + 0.001 + n * 0.02; break;
    case 'inmuebles': r = zone * 1.6 + 0.003 + n * 0.015; break;
    case 'industria': r = sec('industria') * 0.9 + 0.0015 + n * 0.022; break;
    case 'comercio': r = sec('consumo') * 0.9 + 0.0015 + n * 0.022; break;
    case 'energia': r = sec('energia') + 0.001 + n * 0.028; break;
    case 'salud': r = sec('salud') + 0.002 + n * 0.022; break;
    default: r = mm.market * 0.5 + (state.macro.policyRate / 12) * 0.5 + n * 0.01;
  }
  r -= MONTHLY_BURN;
  if (m.offensive && m.offensive > 0) r += 0.012;
  return r;
}

export interface RankRow {
  kind: 'npc' | 'player';
  wealth: Cents;
  m?: Magnate;
}

/** Ciudad del jugador: la de su residencia fiscal. */
export function playerCity(state: GameState): JurisdictionId {
  return state.tax.jurisdiction;
}

/** Tabla ordenada de una ciudad (los 100 personajes + el jugador si `playerNW` no es null). */
export function cityTable(state: GameState, city: JurisdictionId, playerNW: Cents | null): RankRow[] {
  const rows: RankRow[] = state.saga.ranking.magnates.filter((m) => m.city === city).map((m) => ({ kind: 'npc', wealth: magnateWealth(state, m), m }));
  if (playerNW !== null && playerNW > 0 && playerCity(state) === city) rows.push({ kind: 'player', wealth: playerNW });
  return rows.sort((a, b) => b.wealth - a.wealth || (a.kind === 'player' ? -1 : 1));
}

export function globalTable(state: GameState, playerNW: Cents | null): RankRow[] {
  const rows: RankRow[] = state.saga.ranking.magnates.map((m) => ({ kind: 'npc', wealth: magnateWealth(state, m), m }));
  if (playerNW !== null && playerNW > 0) rows.push({ kind: 'player', wealth: playerNW });
  return rows.sort((a, b) => b.wealth - a.wealth || (a.kind === 'player' ? -1 : 1));
}

export interface PlayerPosition {
  city: JurisdictionId;
  /** Puesto exacto si entra en el top 100; si no, una estimación. */
  rank: number;
  exact: boolean;
  /** Fortuna del puesto 100 y de quien está justo adelante. */
  floor: Cents;
  ahead: { name: string; wealth: Cents; rivalId?: string } | null;
  behind: { name: string; wealth: Cents; rivalId?: string } | null;
  globalRank: number | null;
}

/**
 * Tu puesto. Fuera del top 100 se estima con la misma ley de potencias de la
 * ciudad (como hacen las listas reales con "el resto"): sirve para ver que
 * avanzás aunque falte mucho para entrar en la lista.
 */
export function playerPosition(state: GameState, nw: Cents): PlayerPosition {
  const city = playerCity(state);
  const table = cityTable(state, city, nw);
  const idx = table.findIndex((r) => r.kind === 'player');
  const npcs = table.filter((r) => r.kind === 'npc');
  const floor = npcs[Math.min(CITY_SIZE, npcs.length) - 1]?.wealth ?? 0;
  const g = globalTable(state, nw);
  const gi = g.findIndex((r) => r.kind === 'player');
  const globalRank = gi >= 0 && gi < CITY_SIZE ? gi + 1 : null;
  const pick = (r?: RankRow) => (r?.m ? { name: r.m.name, wealth: r.wealth, rivalId: r.m.rivalId } : null);
  if (idx >= 0 && idx < CITY_SIZE) return { city, rank: idx + 1, exact: true, floor, ahead: pick(table[idx - 1]), behind: pick(table[idx + 1]), globalRank };
  return { city, rank: estimateRank(city, nw, floor), exact: false, floor, ahead: pick(npcs[CITY_SIZE - 1]), behind: null, globalRank };
}

/** Estimación del puesto fuera de la lista (cola de Pareto con exponente 1,1). */
export function estimateRank(city: JurisdictionId, nw: Cents, floor: Cents): number {
  const adults = CITY_BY_ID[city].adults;
  if (nw <= 0 || floor <= 0) return adults;
  if (nw >= floor) return CITY_SIZE + 1;
  const r = CITY_SIZE * Math.pow(floor / nw, 1 / 1.1);
  // Por debajo de la mediana, la cola deja de ser de Pareto: se acota a la población.
  return Math.min(Math.round(adults * 0.6), Math.max(CITY_SIZE + 1, Math.round(r)));
}

export const cityName = (id: JurisdictionId) => CITY_BY_ID[id]?.name ?? id;

function fortuneNews(state: GameState, title: string, body: string, rivalId?: string): void {
  publish(state, { kind: 'hecho', topic: 'fortunas', icon: '👑', title, body, reliability: 1, truth: true, resolveDay: null, source: 'Revista Fortuna', sourceTypical: 0.97, ref: rivalId ? { rivalId } : undefined });
}

export function rememberRival(state: GameState, r: RivalGroup, delta: number, text?: string): void {
  r.attitude = clamp((r.attitude ?? 0) + delta, 0, 100);
  if (text) {
    r.memory = [...(r.memory ?? []), { day: state.day, text }].slice(-12);
  }
}

const RARE_UPS: Record<FortuneSource, string> = {
  tecnologia: 'sacó a bolsa su empresa tecnológica', finanzas: 'cerró la mejor jugada de su fondo en años', inmuebles: 'vendió un paquete de torres a un fondo extranjero',
  industria: 'ganó un contrato de exportación histórico', comercio: 'vendió una parte de su cadena a un grupo internacional', energia: 'consiguió una concesión energética por 30 años',
  salud: 'lanzó un medicamento que se vende en toda la región', herencia: 'cobró la venta de las tierras de la familia',
};
const RARE_DOWNS: Record<FortuneSource, string> = {
  tecnologia: 'perdió a su principal cliente y sus acciones se desplomaron', finanzas: 'sufrió pérdidas enormes por una apuesta fallida', inmuebles: 'quedó atrapado con proyectos sin vender',
  industria: 'tuvo que cerrar una de sus plantas', comercio: 'enfrenta una guerra de precios que se come sus márgenes', energia: 'recibió una multa ambiental récord',
  salud: 'retiró un producto del mercado', herencia: 'repartió la fortuna en una herencia disputada',
};

/**
 * Cierre de mes de las clasificaciones: mueve las fortunas con el mercado,
 * calcula tu puesto y anuncia lo importante. Se llama al final de cada mes.
 */
export function rankingMonth(state: GameState): void {
  if (state.meta.projection || !state.saga) return;
  const rk = state.saga.ranking;
  if (!rk.magnates.length) initRanking(state);
  const g = srng(state);
  const mm = marketMonth(state);
  const pi = state.macro.priceIndex;
  const nw = balanceSheet(state).netWorth;
  const city = playerCity(state);
  const prevPlayerCity = rk.player.city;
  const cityChanged = rk.lastCity !== undefined && rk.lastCity !== city;

  // 1 · Los grupos rivales: lo que compraron se mueve con el mercado; la memoria se enfría.
  // Competir en sus sectores con varias empresas les molesta (una sola, casi nada).
  for (const r of state.world.rivals) {
    r.assetsValue = roundCents(Math.max(0, (r.assetsValue ?? 0) * (1 + mm.market * 0.8 + 0.002)));
    const rivalsIn = r.acquired ? 0 : state.companies.filter((c) => !c.npc && (c.status === 'active' || c.status === 'insolvent') && r.sectors.includes(c.sector)).length;
    r.attitude = r.acquired ? 0 : clamp((r.attitude ?? 0) - 2 + Math.min(3, rivalsIn * 1.5), 0, 100);
  }

  // 2 · Las fortunas siguen al mercado, con su propia suerte.
  const events: Array<{ m: Magnate; up: boolean }> = [];
  for (const m of rk.magnates) {
    let r = monthlyGrowth(state, g, m, mm);
    if (chance(g, 0.004)) {
      const up = chance(g, 0.5);
      r += up ? randRange(g, 0.12, 0.35) : -randRange(g, 0.15, 0.45);
      events.push({ m, up });
    }
    m.wealth = Math.max(usd(250_000 * pi), roundCents(m.wealth * (1 + clamp(r, -0.6, 0.6))));
    if (m.offensive && m.offensive > 0) m.offensive--;
  }

  // 3 · Fortunas nuevas: quien cae muy por debajo de la lista deja su lugar.
  const used = new Set(rk.magnates.map((m) => m.name));
  for (const c of CITIES) {
    const floor = usd(c.top100 * pi * 0.35);
    let replaced = 0;
    for (const m of rk.magnates) {
      const tooOld = m.age + Math.floor(state.day / 365) > 92;
      if (m.rivalId && tooOld) {
        // El grupo pasa a la generación siguiente de la familia: la fortuna sigue, cambia la cara.
        m.age = randInt(g, 42, 58) - Math.floor(state.day / 365);
        continue;
      }
      if (m.city !== c.id || m.rivalId || replaced >= 2 || (m.wealth >= floor && !tooOld)) continue;
      const fresh = newMagnate(g, m.id, c.id, c.top100 * randRange(g, 1.05, 1.9), pi, used, true);
      Object.assign(m, fresh, { prevCityRank: m.prevCityRank, lastRank: 0, bestCityRank: 999, offensive: 0, age: fresh.age - Math.floor(state.day / 365) });
      replaced++;
    }
  }

  // 4 · Puestos nuevos.
  const table = cityTable(state, city, nw);
  const pIdx = table.findIndex((x) => x.kind === 'player');
  const newCity = pIdx >= 0 && pIdx < CITY_SIZE ? pIdx + 1 : null;
  const gTable = globalTable(state, nw);
  const gIdx = gTable.findIndex((x) => x.kind === 'player');
  const newGlobal = gIdx >= 0 && gIdx < CITY_SIZE ? gIdx + 1 : null;

  // Quién te pasó y a quién pasaste (solo dentro del top 100 de tu ciudad, sin mudanza de por medio).
  if (!cityChanged && prevPlayerCity !== null && newCity !== null) {
    table.forEach((row, i) => {
      if (!row.m || row.m.prevCityRank === 0) return;
      const rankNow = i + 1;
      const wasBehind = row.m.prevCityRank > prevPlayerCity;
      const isAhead = rankNow < newCity;
      if (wasBehind && isAhead && newCity <= 25) {
        addLog(state, 'warning', '📉', `${row.m.name} te superó en la lista de ${cityName(city)}: ahora estás en el puesto ${newCity}.`);
        fortuneNews(state, `${row.m.name} supera a ${state.player.name} en ${cityName(city)}`, `Con ${fmtMoney(row.wealth, { decimals: false })}, sube al puesto ${rankNow} de la lista de ${cityName(city)}.`, row.m.rivalId);
      }
    });
  }

  // 5 · Fortunas que cambian de golpe (solo se anuncian las conocidas).
  for (const { m, up } of events) {
    const rows = cityTable(state, m.city, null);
    const pos = rows.findIndex((x) => x.m === m) + 1;
    if (!m.rivalId && pos > 30) continue;
    fortuneNews(state, `${m.name} ${up ? RARE_UPS[m.source] : RARE_DOWNS[m.source]}`, `Su fortuna ${up ? 'sube' : 'cae'} con fuerza: ahora tiene ${fmtMoney(magnateWealth(state, m), { decimals: false })} y está en el puesto ${pos} de ${cityName(m.city)}.`, m.rivalId);
  }

  // 6 · Nuevo número 1 en alguna ciudad (si no sos vos).
  for (const c of CITIES) {
    const rows = cityTable(state, c.id, c.id === city ? nw : null);
    const top = rows[0];
    const prevTop = rk.magnates.find((m) => m.city === c.id && m.prevCityRank === 1);
    if (top?.m && prevTop && top.m !== prevTop) {
      fortuneNews(state, `${top.m.name} es la nueva fortuna número 1 de ${c.name}`, `Desplaza a ${prevTop.name}. Patrimonio estimado: ${fmtMoney(top.wealth, { decimals: false })}.`, top.m.rivalId);
    }
    rows.forEach((row, i) => {
      if (!row.m) return;
      row.m.lastRank = row.m.prevCityRank;
      row.m.prevCityRank = i + 1;
      row.m.bestCityRank = Math.min(row.m.bestCityRank, i + 1);
    });
  }

  // 7 · Tus hitos: primera vez en el top 100, 50, 25, 10, 3 y 1 de tu ciudad y del mundo.
  const p = rk.player;
  if (newCity !== null) {
    for (const t of CITY_MILESTONES) {
      const key = `city:${city}:${t}`;
      if (newCity > t || rk.milestones.includes(key)) continue;
      rk.milestones.push(key);
      const big = t <= 10;
      const title = t === 1 ? `La persona más rica de ${cityName(city)}` : t === 100 ? `En la lista de ${cityName(city)}` : `Top ${t} de ${cityName(city)}`;
      const text = t === 1 ? `Con ${fmtMoney(nw, { decimals: false })} encabezás la lista de fortunas de ${cityName(city)}. Ahora todos te miran: mantener el puesto también es un desafío.` : `Entraste al top ${t} de las fortunas de ${cityName(city)} (puesto ${newCity}).`;
      celebrate(state, big ? 'big' : 'small', t === 1 ? 'crown' : 'medal', title, text);
      chronicle(state, 'ranking', t === 1 ? 'crown' : 'medal', title, text);
      fortuneNews(state, t === 1 ? `${state.player.name}, la nueva fortuna número 1 de ${cityName(city)}` : `${state.player.name} entra al top ${t} de ${cityName(city)}`, text);
      addLog(state, 'success', '👑', `${title}.`, undefined, 'logros');
      break; // un festejo por mes: el mejor hito alcanzado
    }
  }
  if (newGlobal !== null) {
    for (const t of GLOBAL_MILESTONES) {
      const key = `global:${t}`;
      if (newGlobal > t || rk.milestones.includes(key)) continue;
      rk.milestones.push(key);
      const title = t === 1 ? 'La persona más rica del mundo' : `Top ${t} del mundo`;
      const text = t === 1 ? 'Ninguna fortuna de las cuatro ciudades supera la tuya.' : `Entraste al top ${t} del ranking global (puesto ${newGlobal}).`;
      celebrate(state, 'big', 'crown', title, text);
      chronicle(state, 'ranking', 'crown', title, text);
      fortuneNews(state, `${state.player.name}: ${title.toLowerCase()}`, text);
      addLog(state, 'success', '🌎', `${title}.`, undefined, 'logros');
      break;
    }
  }

  // 8 · Superar a un grupo rival (por patrimonio): lo festejás vos… y ellos lo recuerdan.
  for (const m of rk.magnates) {
    if (!m.rivalId || rk.overtaken.includes(m.rivalId) || state.world.rivals.find((x) => x.id === m.rivalId)?.acquired) continue;
    const w = magnateWealth(state, m);
    if (nw <= w) continue;
    rk.overtaken.push(m.rivalId);
    const r = state.world.rivals.find((x) => x.id === m.rivalId);
    const text = `Tu patrimonio (${fmtMoney(nw, { decimals: false })}) ya supera la fortuna de ${m.name} (${fmtMoney(w, { decimals: false })}).`;
    celebrate(state, 'small', 'rivals', `Superaste a ${m.name}`, text);
    chronicle(state, 'rival', 'rivals', `Superaste a ${m.name}`, text);
    if (r) rememberRival(state, r, 20, 'Lo superaste en la lista de fortunas');
    fortuneNews(state, `${state.player.name} ya es más rico que ${m.name}`, `${text} En el ${r?.name ?? 'grupo'} no cayó bien.`, m.rivalId);
  }

  // 9 · El trono: meses como número 1, defensa y retadores.
  if (newCity === 1) {
    rk.reignMonths++;
    rk.bestReign = Math.max(rk.bestReign, rk.reignMonths);
    if (rk.reignMonths === 12 && !rk.milestones.includes(`reign12:${city}`)) {
      rk.milestones.push(`reign12:${city}`);
      const text = `Un año entero como la persona más rica de ${cityName(city)}.`;
      celebrate(state, 'big', 'crown', 'Corona defendida', text);
      chronicle(state, 'ranking', 'crown', 'Corona defendida', text);
    }
    challenge(state, g, table, city);
  } else {
    if (prevPlayerCity === 1 && !cityChanged && rk.reignMonths > 0) {
      const usurper = table[0]?.m;
      const text = usurper ? `${usurper.name} te quitó el primer puesto de ${cityName(city)} después de ${rk.reignMonths} mes${rk.reignMonths > 1 ? 'es' : ''}.` : `Perdiste el primer puesto de ${cityName(city)}.`;
      chronicle(state, 'ranking', 'trendDown', 'Perdiste el primer puesto', text);
      addLog(state, 'danger', '👑', text, undefined, 'logros');
      if (usurper) fortuneNews(state, `${usurper.name} recupera el trono de ${cityName(city)}`, text, usurper.rivalId);
    }
    rk.reignMonths = 0;
  }

  p.city = newCity;
  p.global = newGlobal;
  if (newCity !== null) p.bestCity = p.bestCity === null ? newCity : Math.min(p.bestCity, newCity);
  if (newGlobal !== null) p.bestGlobal = p.bestGlobal === null ? newGlobal : Math.min(p.bestGlobal, newGlobal);
  rk.history.push({ day: state.day, city: newCity, global: newGlobal });
  if (rk.history.length > 120) rk.history.splice(0, rk.history.length - 120);
  rk.lastPrices = currentPrices(state);
  rk.lastZones = currentZones(state);
  rk.lastCity = city;

  // 10 · Lista anual (31 de diciembre).
  const d = dateOf(state.day);
  if (d.m === 12) annualList(state, city, newCity, nw);
}

/** Cuando sos el número 1, el segundo puede lanzar una ofensiva (y si es un rival, se nota en tus negocios). */
function challenge(state: GameState, g: RngHolder, table: RankRow[], city: JurisdictionId): void {
  const second = table[1];
  const me = table[0];
  if (!second?.m || me.kind !== 'player') return;
  if (second.m.offensive && second.m.offensive > 0) return;
  const gap = me.wealth > 0 ? (me.wealth - second.wealth) / me.wealth : 1;
  if (gap > 0.3 || !chance(g, 0.3)) return;
  second.m.offensive = randInt(g, 4, 8);
  const r = second.m.rivalId ? state.world.rivals.find((x) => x.id === second.m!.rivalId) : undefined;
  const text = `${second.m.name} quiere el primer puesto de ${cityName(city)}: prepara compras y apuestas agresivas para los próximos meses.`;
  addLog(state, 'warning', '⚔️', text, undefined, 'ofertas');
  fortuneNews(state, `${second.m.name} va por el trono de ${cityName(city)}`, text, second.m.rivalId);
  if (r) rememberRival(state, r, 25, 'Lanzó una ofensiva para quitarte el primer puesto');
}

function annualList(state: GameState, city: JurisdictionId, rank: number | null, nw: Cents): void {
  const y = dateOf(state.day).y;
  const top = cityTable(state, city, nw).slice(0, 3).map((r, i) => `${i + 1}. ${r.kind === 'player' ? state.player.name : r.m!.name}`).join(' · ');
  const me = rank !== null ? `${state.player.name} cierra el año en el puesto ${rank}.` : `${state.player.name} todavía no entra en la lista (el puesto 100 tiene ${fmtMoney(cityTable(state, city, null)[CITY_SIZE - 1]?.wealth ?? 0, { decimals: false })}).`;
  fortuneNews(state, `La lista de fortunas ${y} de ${cityName(city)}`, `${top}. ${me}`);
}

/** Texto del puesto para el resumen anual de la crónica. */
export function rankSummary(state: GameState): string | null {
  const p = state.saga?.ranking.player;
  if (!p) return null;
  if (p.city !== null) return `puesto ${p.city} en ${cityName(playerCity(state))}${p.global !== null ? ` y ${p.global} en el mundo` : ''}`;
  return null;
}

/** Rival con más rencor hacia vos entre los que operan en un sector (o en general). */
export function hostility(state: GameState, sector?: string): number {
  const pool = state.world.rivals.filter((r) => !r.acquired && (!sector || r.sectors.includes(sector as never)));
  return pool.reduce((a, r) => Math.max(a, r.attitude ?? 0), 0);
}
