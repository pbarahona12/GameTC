import type { GameState } from '../state';
import type { EconEffects, EconEvent } from '../economy/economy';
import { announceMacroEvent } from '../world/rivals';
import { nextRandom, randInt } from '../rng';
import { srng } from './ranking';
import { chronicle } from './chronicle';

/**
 * ERAS ECONÓMICAS (1.4): cada 10–15 años de juego cambia el contexto de fondo.
 * Una era es un evento económico largo con efectos moderados (los mismos tipos
 * de efecto que ya usan los eventos: demanda por sector, bolsa por sector,
 * inmuebles, costos, crédito). Así el año 50 no se parece al año 10: lo que
 * rendía deja de rendir y aparecen sectores nuevos que conviene mirar.
 * La primera llega a los 6 años de partida y se anuncia con anticipación.
 */
export interface EraDef {
  kind: string;
  name: string;
  icon: string;
  description: string;
  effects: EconEffects;
}

export const ERAS: EraDef[] = [
  { kind: 'era_digital', name: 'Era del auge digital', icon: '💻', description: 'La tecnología y el software crecen más que el resto; el comercio tradicional pierde terreno.',
    effects: { stockSectors: { tecnologia: 0.06, telecom: 0.03, consumo: -0.01 }, demand: { saas: 1.15, consultora: 1.05, minimarket: 0.97 } } },
  { kind: 'era_inmobiliaria', name: 'Era de la fiebre inmobiliaria', icon: '🏗️', description: 'Crédito fácil y mucha demanda de vivienda: los inmuebles se valorizan, los bancos ganan… y crece el riesgo de una burbuja.',
    effects: { housing: 0.03, stockSectors: { inmobiliaria: 0.04, banca: 0.02 }, spread: -0.005 } },
  { kind: 'era_energia', name: 'Era de la transición energética', icon: '🔋', description: 'Inversiones enormes en energía limpia: las energéticas crecen, la industria pesada se encarece.',
    effects: { stockSectors: { energia: 0.05, industria: -0.01 }, supplierCost: 1.03, demand: { muebles: 0.97 } } },
  { kind: 'era_consumo', name: 'Era de la clase media en expansión', icon: '🛍️', description: 'Más gente con más ingresos: crece el consumo en cafés, comercios y hogares.',
    effects: { stockSectors: { consumo: 0.03 }, demand: { cafeteria: 1.08, minimarket: 1.06, muebles: 1.08 } } },
  { kind: 'era_austeridad', name: 'Era de austeridad', icon: '🧾', description: 'Gobiernos y familias ajustan gastos: la demanda se enfría, el crédito es más caro y la bolsa crece menos.',
    effects: { demand: { all: 0.96 }, spread: 0.01, stockDrift: -0.02 } },
  { kind: 'era_salud', name: 'Era de la revolución de la salud', icon: '🧬', description: 'Avances médicos y una población que envejece impulsan a la salud y la biotecnología.',
    effects: { stockSectors: { salud: 0.05 }, demand: { consultora: 1.03 } } },
];

const FIRST_ERA_DAY = 365 * 6;

export function currentEra(state: GameState): EconEvent | undefined {
  return state.macro.events.find((e) => e.kind.startsWith('era_') && e.startDay <= state.day && e.endDay >= state.day);
}

/** Cierre de mes: si no hay era en curso ni programada y ya es momento, se anuncia la próxima. */
export function erasMonth(state: GameState): void {
  if (state.meta.projection || !state.saga || state.day < FIRST_ERA_DAY) return;
  if (state.macro.events.some((e) => e.kind.startsWith('era_') && e.endDay >= state.day)) return;
  const g = srng(state);
  const last = [...state.macro.events].reverse().find((e) => e.kind.startsWith('era_'));
  if (last && state.day < last.endDay + 30 * randInt(g, 6, 24)) return;
  const pool = ERAS.filter((e) => e.kind !== last?.kind);
  const def = pool[Math.floor(nextRandom(g) * pool.length)];
  const lead = randInt(g, 30, 90);
  const years = randInt(g, 10, 15);
  const ev: EconEvent = { id: state.meta.nextId++, kind: def.kind, name: def.name, icon: def.icon, description: def.description, startDay: state.day + lead, endDay: state.day + lead + years * 365, effects: def.effects };
  state.macro.events.push(ev);
  announceMacroEvent(state, ev);
  chronicle(state, 'crisis', 'economy', `Se viene la ${def.name.toLowerCase()}`, `${def.description} Duraría unos ${years} años.`);
}
