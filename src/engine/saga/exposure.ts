import type { GameState } from '../state';
import type { Cents } from '../money';
import { usd } from '../money';
import type { EconEffects, EconEvent } from '../economy/economy';
import { valuation } from '../business/reports';
import { CITY_MARKET, locales, presence } from '../business/locations';
import { SECTOR_BY_ID } from '../../content/sectors';
import { SECTOR_NAMES } from '../../content/stocks';
import type { StockSector } from '../invest/types';
import type { JurisdictionId } from '../../content/jurisdictions';
import { positions, investmentsValue } from '../invest/portfolio';
import { balanceSheet } from '../reports/statements';
import { announceMacroEvent } from '../world/rivals';
import { chance, randInt } from '../rng';
import { srng, cityName } from './ranking';
import { chronicle } from './chronicle';
import { fmtPct } from '../format';

/**
 * CRISIS SEGÚN TU EXPOSICIÓN (1.6, auditoría F5).
 *
 * Una recesión enfría toda la economía, pero lo que más duele es tener todo en el
 * mismo lugar. Al empezar una recesión (o, con menos probabilidad, una
 * desaceleración) se mira dónde está tu patrimonio: si la mayor parte depende de
 * un mismo sector, de una misma ciudad o de un mismo sector de la bolsa, puede
 * llegar una crisis específica de eso. Quien está diversificado solo atraviesa la
 * recesión general. La crisis es un evento económico más: se programa con
 * anticipación (las noticias pueden anticiparla) y afecta también a los rivales
 * de ese sector o ciudad.
 */

export type ExposureKind = 'sector' | 'city' | 'stock';

export interface ExposureBucket {
  kind: ExposureKind;
  key: string;
  label: string;
  value: Cents;
  share: number;
}

export interface Exposure {
  /** Activos considerados: empresas (a valor estimado), inmuebles propios, inversiones y liquidez. */
  total: Cents;
  buckets: ExposureBucket[];
  /** Mayor concentración (null si no hay nada concentrado). */
  top: ExposureBucket | null;
}

/** Desde qué patrimonio cuentan estas crisis: al principio no hay con qué diversificar. */
export const EXPOSURE_MIN_TOTAL = usd(500_000);
/** Por debajo de esta concentración no hay crisis específica (la diversificación protege). */
export const EXPOSURE_SAFE_SHARE = 0.4;
/** Una crisis específica como máximo cada dos años. */
const EXPOSURE_COOLDOWN = 720;

const activeCo = (state: GameState) => state.companies.filter((c) => !c.npc && (c.status === 'active' || c.status === 'insolvent'));

/** Dónde está tu patrimonio: por sector de tus empresas, por ciudad y por sector bursátil. */
export function exposure(state: GameState): Exposure {
  const cos = activeCo(state);
  // Valor de tus empresas: el mismo que usa la fortuna estimada (valuación × participación).
  let bizValue = 0;
  for (const co of cos) if (co.parentId === null) bizValue += Math.max(0, Math.round(valuation(state, co).value * co.ownership));
  // Se reparte entre las empresas operativas según lo que facturan (12 meses).
  const ops = cos.filter((c) => c.sector !== 'holding');
  const rev = ops.map((c) => Math.max(0, c.history.slice(-12).reduce((s, h) => s + h.revenue, 0)));
  const revTotal = rev.reduce((s, r) => s + r, 0);
  const sectors = new Map<string, number>();
  const cities = new Map<string, number>();
  ops.forEach((co, i) => {
    const v = bizValue * (revTotal > 0 ? rev[i] / revTotal : 1 / ops.length);
    sectors.set(co.sector, (sectors.get(co.sector) ?? 0) + v);
    const loc = locales(co, state.day);
    const w = Object.entries(loc).map(([c, n]) => [c, CITY_MARKET[c as JurisdictionId] * presence(n)] as const);
    const wt = w.reduce((s, [, x]) => s + x, 0) || 1;
    for (const [c, x] of w) cities.set(c, (cities.get(c) ?? 0) + (v * x) / wt);
  });
  // Inmuebles a tu nombre (los de las empresas ya están en su valor).
  let reValue = 0;
  for (const p of state.realEstate.properties) {
    if (p.owner.kind !== 'personal') continue;
    reValue += p.appraisal;
    cities.set(p.jurisdiction, (cities.get(p.jurisdiction) ?? 0) + p.appraisal);
  }
  // Acciones por sector bursátil (los fondos y bonos ya están diversificados).
  const stockSectors = new Map<string, number>();
  for (const pos of positions(state, 'stocks')) {
    const st = state.stocks.stocks.find((s) => s.id === pos.id);
    if (st) stockSectors.set(st.sector, (stockSectors.get(st.sector) ?? 0) + pos.value);
  }
  const total = Math.round(bizValue + reValue + investmentsValue(state) + Math.max(0, balanceSheet(state).liquid));
  const buckets: ExposureBucket[] = [];
  const add = (kind: ExposureKind, key: string, label: string, value: number) => {
    if (value > 0 && total > 0) buckets.push({ kind, key, label, value: Math.round(value), share: value / total });
  };
  for (const [k, v] of sectors) add('sector', k, SECTOR_BY_ID[k as keyof typeof SECTOR_BY_ID]?.name.toLowerCase() ?? k, v);
  for (const [k, v] of cities) add('city', k, cityName(k as JurisdictionId), v);
  for (const [k, v] of stockSectors) add('stock', k, `acciones de ${(SECTOR_NAMES[k as StockSector] ?? k).toLowerCase()}`, v);
  // Ante empate, primero el sector (lo más concreto), después la ciudad.
  const order: Record<ExposureKind, number> = { sector: 0, city: 1, stock: 2 };
  buckets.sort((a, b) => b.share - a.share || order[a.kind] - order[b.kind]);
  const top = buckets[0] && buckets[0].share >= EXPOSURE_SAFE_SHARE ? buckets[0] : null;
  return { total, buckets, top };
}

/** Probabilidad de una crisis específica al empezar la fase (0 si estás diversificado). */
export function exposureChance(e: Exposure, phase: 'recesion' | 'desaceleracion'): number {
  if (!e.top || e.total < EXPOSURE_MIN_TOTAL) return 0;
  const p = Math.min(0.9, (e.top.share - EXPOSURE_SAFE_SHARE) * 2 + 0.1);
  return phase === 'recesion' ? p : p * 0.4;
}

/** Efectos y textos de la crisis para la mayor concentración. */
export function exposureCrisis(b: ExposureBucket, months: number): Pick<EconEvent, 'kind' | 'name' | 'icon' | 'description'> & { effects: EconEffects; months: number } {
  const why = `Te golpea porque el ${fmtPct(b.share, 0)} de tu patrimonio depende de eso.`;
  if (b.kind === 'sector') {
    return { kind: `exposicion_${b.key}`, name: `Crisis del sector ${b.label}`, icon: '📉', months,
      description: `La recesión golpea de lleno al sector ${b.label}: los clientes recortan y las ventas caen cerca de un 20 % en todas las empresas del rubro. ${why}`,
      effects: { demand: { [b.key]: 0.8 } } };
  }
  if (b.kind === 'city') {
    return { kind: `exposicion_${b.key}`, name: `Crisis regional en ${b.label}`, icon: '🏙️', months,
      description: `${b.label} sufre más que el resto: cierres, desempleo local y consumo en baja. Las ventas allí caen cerca de un 20 % y los inmuebles de la ciudad se abaratan. ${why}`,
      effects: { cityDemand: { [b.key]: 0.8 }, cityHousing: { [b.key]: -0.15 } } };
  }
  return { kind: `exposicion_${b.key}`, name: `Desplome de las ${b.label}`, icon: '📉', months,
    description: `Los inversores huyen del sector: las ${b.label} caen con fuerza mientras dure la crisis. ${why}`,
    effects: { stockSectors: { [b.key]: -0.4 } } };
}

/**
 * Cierre de mes: si la economía acaba de entrar en recesión (o desaceleración)
 * y tu patrimonio está concentrado, puede programarse una crisis específica.
 */
export function exposureMonth(state: GameState): void {
  if (state.meta.projection || !state.saga) return;
  const m = state.macro;
  if (m.forced && (m.forced.until ?? Infinity) >= state.day) return; // los desafíos fijan su propia economía
  if (m.phaseMonths !== 0 || (m.phase !== 'recesion' && m.phase !== 'desaceleracion')) return;
  const stats = state.saga.stats;
  if (stats.exposureLast !== undefined && state.day - stats.exposureLast < EXPOSURE_COOLDOWN) return;
  const e = exposure(state);
  const p = exposureChance(e, m.phase);
  if (p <= 0) return;
  const g = srng(state);
  if (!chance(g, p) || !e.top) return;
  const def = exposureCrisis(e.top, randInt(g, 6, 12));
  const lead = randInt(g, 20, 45);
  const ev: EconEvent = { id: state.meta.nextId++, kind: def.kind, name: def.name, icon: def.icon, description: def.description, startDay: state.day + lead, endDay: state.day + lead + def.months * 30, effects: def.effects };
  m.events.push(ev);
  stats.exposureLast = state.day;
  announceMacroEvent(state, ev);
  chronicle(state, 'crisis', 'economy', `Se viene la ${def.name.toLowerCase()}`, `${def.description} Duraría unos ${def.months} meses.`);
}
