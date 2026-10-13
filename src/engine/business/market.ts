import { SECTORS, SECTOR_BY_ID, BizSectorId, SectorDef } from '../../content/sectors';
import { consumerDemand } from '../economy/economy';
import type { GameState } from '../state';
import type { CompetitorState, MarketState, Company } from './types';
import { clamp } from '../money';
import { randRange, chance, randInt } from '../rng';
import { addLog } from '../log';
import { dateOf } from '../time/calendar';
import { citiesOf, addressableWeight, CITY_MARKET } from './locations';

/**
 * Mercado por sector: demanda total + competidores controlados por IA.
 *
 * Cuota de mercado (modelo de elección):
 *   atractivo = e^(−elasticidad·(precio/ref − 1)) · (0,4 + calidad/100)
 *              · (0,5 + reputación/100) · (0,08 + 0,92·conocimiento/100) · (1 + bono comercial)
 *   cuota_i = atractivo_i / (Σ atractivos + opción de no comprar)
 * La "opción de no comprar" (30 % del atractivo medio de los rivales) hace que
 * subir precios en todo el mercado reduzca el total vendido.
 */
export function attractiveness(priceRatio: number, quality: number, reputation: number, awareness: number, elasticity: number, bonus = 0): number {
  return Math.exp(-elasticity * (priceRatio - 1)) * (0.4 + quality / 100) * (0.5 + reputation / 100) * (0.08 + (0.92 * awareness) / 100) * (1 + bonus);
}

const COMPETITOR_NAMES: Record<BizSectorId, string[]> = {
  cafeteria: ['Café del Puerto', 'La Taza Feliz', 'Grano de Oro', 'Brunch & Co.'],
  minimarket: ['MiniSuper Plaza', 'Abarrotes Doña Rosa', 'Express 24'],
  muebles: ['Carpintería Hermanos Luna', 'MueblesYa', 'Ebanistería Real'],
  saas: ['Flujo360', 'Planify', 'Kubo Cloud'],
  consultora: ['Asesores Unidos', 'Cuentas Claras', 'Fiscalistas Asociados'],
  holding: [],
};

export function initMarkets(_state: GameState): Record<string, MarketState> {
  const out: Record<string, MarketState> = {};
  let id = 1;
  for (const s of SECTORS) {
    out[s.id] = {
      sector: s.id,
      index: 1,
      competitors: s.competitors.map((c) => ({ id: id++, name: c.name, priceMult: c.priceMult, quality: c.quality, reputation: c.reputation, awareness: c.awareness, active: true, enteredDay: 0 })),
    };
  }
  return out;
}

/** Atractivo agregado de rivales y opción de no comprar para un producto. */
export function rivalsAttraction(market: MarketState, elasticity: number): { rivals: number; outside: number; each: Array<{ c: CompetitorState; a: number }> } {
  const each = market.competitors.filter((c) => c.active).map((c) => ({ c, a: attractiveness(c.priceMult, c.quality, c.reputation, c.awareness, elasticity) }));
  const rivals = each.reduce((s, x) => s + x.a, 0);
  const neutral = each.length ? each.reduce((s, x) => s + attractiveness(1, x.c.quality, x.c.reputation, x.c.awareness, elasticity), 0) / each.length : 1;
  return { rivals, outside: 0.3 * neutral, each };
}

/** Factor macroeconómico y estacional de la demanda para un sector y día. */
export function demandFactor(state: GameState, sector: SectorDef, day: number): number {
  const g = dateOf(day);
  const macro = clamp(1 - sector.rateSensitivity * (state.macro.policyRate - 0.05), 0.5, 1.3);
  const market = state.markets[sector.id]?.index ?? 1;
  return sector.weekday[g.weekday] * sector.monthly[g.m - 1] * macro * market * consumerDemand(state, sector.id);
}

/** Cuota de las empresas del jugador en el sector (últimos 30 días, por ingresos). */
export function playerShare(state: GameState, sector: BizSectorId): number {
  const cos = state.companies.filter((c) => c.sector === sector && (c.status === 'active' || c.status === 'insolvent'));
  if (!cos.length) return 0;
  let sold = 0;
  let demand = 0;
  for (const co of cos) {
    for (const d of co.stats.slice(-30)) {
      for (const k of Object.keys(d.sold)) sold += d.sold[k];
    }
  }
  const sec = SECTOR_BY_ID[sector];
  // 1.6: el mercado al que llegás suma las ciudades donde alguna de tus empresas tiene locales.
  const cities = new Set(cos.flatMap((c) => citiesOf(c, state.day)));
  const weight = [...cities].reduce((s, c) => s + CITY_MARKET[c], 0);
  for (const p of sec.products) demand += p.marketDaily * 30 * weight;
  return demand > 0 ? sold / demand : 0;
}

/**
 * IA de competidores (mensual). Reacciones explicables:
 *  - Si el jugador supera el 20 % del mercado, los rivales tienden a bajar precios.
 *  - Precios con margen muy bajo tienden a subir; calidad y conocimiento derivan.
 *  - Un rival débil (reputación < 30) puede salir del mercado; si hay pocos rivales, entra uno nuevo.
 *  - El índice de demanda del sector hace un paseo aleatorio acotado (±3 % mensual).
 */
export function monthlyMarkets(state: GameState): void {
  for (const sec of SECTORS) {
    const m = state.markets[sec.id];
    if (!m) continue;
    const oldIndex = m.index;
    m.index = clamp(m.index + randRange(state, -0.03, 0.03) + (1 - m.index) * 0.1, 0.8, 1.2);
    const share = playerShare(state, sec.id);
    for (const c of m.competitors) {
      if (!c.active) continue;
      if (share > 0.2 && chance(state, 0.5)) {
        c.priceMult = clamp(c.priceMult * 0.97, 0.7, 1.8);
        if (!state.meta.projection && state.companies.some((co) => co.sector === sec.id && co.status === 'active')) {
          addLog(state, 'warning', '🏷️', `${c.name} bajó sus precios 3 % para recuperar clientes frente a tu crecimiento en ${sec.name}.`);
        }
      } else if (c.priceMult < 0.85 && chance(state, 0.3)) c.priceMult = clamp(c.priceMult * 1.03, 0.7, 1.8);
      else c.priceMult = clamp(c.priceMult * (1 + randRange(state, -0.015, 0.02)), 0.7, 1.8);
      c.quality = clamp(c.quality + randRange(state, -1.5, 1.6), 30, 95);
      c.awareness = clamp(c.awareness + randRange(state, -2, 2) + (60 - c.awareness) * 0.05, 20, 90);
      c.reputation = clamp(c.reputation + (c.quality - c.reputation) * 0.1 + randRange(state, -1, 1), 15, 95);
      if (c.reputation < 30 && chance(state, 0.2)) {
        c.active = false;
        if (!state.meta.projection) addLog(state, 'info', '🚪', `${c.name} cerró y dejó el mercado de ${sec.name}: más demanda disponible para los demás.`);
      }
    }
    const active = m.competitors.filter((c) => c.active).length;
    if (active < 3 || (active < 5 && chance(state, 0.04))) {
      const names = COMPETITOR_NAMES[sec.id].filter((n) => !m.competitors.some((c) => c.name === n));
      if (names.length) {
        const c: CompetitorState = {
          id: state.meta.nextId++, name: names[randInt(state, 0, names.length - 1)], priceMult: randRange(state, 0.85, 1.15),
          quality: randRange(state, 50, 75), reputation: 45, awareness: 30, active: true, enteredDay: state.day,
        };
        m.competitors.push(c);
        if (!state.meta.projection) addLog(state, 'warning', '🆕', `Nuevo competidor en ${sec.name}: ${c.name}.`);
      }
    }
    if (!state.meta.projection && Math.abs(m.index - oldIndex) > 0.025 && state.companies.some((co) => co.sector === sec.id && co.status === 'active')) {
      addLog(state, 'info', m.index > oldIndex ? '📈' : '📉', `La demanda del sector ${sec.name} ${m.index > oldIndex ? 'creció' : 'cayó'} ${Math.abs(Math.round((m.index / oldIndex - 1) * 100))} % este mes (índice ${m.index.toFixed(2)}).`);
    }
  }
}

export function companyShareEstimate(co: Company): number {
  const sec = SECTOR_BY_ID[co.sector];
  let sold = 0;
  let demand = 0;
  const recent = co.stats.slice(-30);
  for (const d of recent) for (const k of Object.keys(d.sold)) sold += d.sold[k];
  const weight = addressableWeight(co, recent[recent.length - 1]?.day ?? 0);
  for (const p of sec.products) demand += p.marketDaily * recent.length * weight;
  return demand > 0 ? sold / demand : 0;
}
