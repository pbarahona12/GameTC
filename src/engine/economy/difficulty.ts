import type { GameState } from '../state';

/**
 * Dificultad económica. Se elige al crear la partida y se puede cambiar en
 * Ajustes (afecta a partir de ese momento). No cambia las reglas contables:
 * solo la intensidad de la incertidumbre y la exigencia de bancos y autoridades.
 */
export type Difficulty = 'facil' | 'normal' | 'dificil' | 'realista';

export interface DifficultyDef {
  id: Difficulty;
  name: string;
  description: string;
  /** Multiplicador de volatilidad (bolsa, ruido macro). */
  volatility: number;
  /** Multiplicador de probabilidad de recesión al terminar una desaceleración. */
  recession: number;
  /** Multiplicador de frecuencia de eventos económicos. */
  events: number;
  /** Multiplicador de probabilidad de auditorías y detección de ilícitos. */
  enforcement: number;
  /** Puntos de puntaje adicionales que exigen los bancos. */
  credit: number;
}

export const DIFFICULTIES: DifficultyDef[] = [
  { id: 'facil', name: 'Fácil', description: 'Economía más estable, menos recesiones y bancos más flexibles. Tu primer atraso no tiene recargo ni marca en tu historial. Ideal para aprender.', volatility: 0.7, recession: 0.6, events: 0.6, enforcement: 0.7, credit: -20 },
  { id: 'normal', name: 'Normal', description: 'Equilibrio entre estabilidad y sorpresas.', volatility: 1, recession: 1, events: 1, enforcement: 1, credit: 0 },
  { id: 'dificil', name: 'Difícil', description: 'Más volatilidad, recesiones frecuentes, bancos y autoridades exigentes.', volatility: 1.25, recession: 1.4, events: 1.35, enforcement: 1.3, credit: 20 },
  { id: 'realista', name: 'Realista', description: 'Parámetros cercanos a economías reales: ciclos largos, volatilidad normal y controles estrictos.', volatility: 1.05, recession: 1.1, events: 1.1, enforcement: 1.2, credit: 10 },
];

export const DIFFICULTY_BY_ID: Record<Difficulty, DifficultyDef> = Object.fromEntries(DIFFICULTIES.map((d) => [d.id, d])) as Record<Difficulty, DifficultyDef>;

export function difficultyOf(state: GameState): DifficultyDef {
  return DIFFICULTY_BY_ID[state.options?.difficulty ?? 'normal'] ?? DIFFICULTY_BY_ID.normal;
}
