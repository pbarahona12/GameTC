import type { GameState } from '../state';
import type { SagaState } from './types';
import type { Metrics } from '../reports/metrics';
import { seedFromString } from '../rng';
import { emptyRanking, initRanking, rankingMonth, rankSummary } from './ranking';
import { emptyGoals, checkGoals } from './goals';
import { emptyDilemmas, dilemmasDay, checkTruces } from './dilemmas';
import { chronicle, celebrate, yearSummary } from './chronicle';
import { checkChallenge, setupChallenge } from './challenges';
import { balanceSheet } from '../reports/statements';
import { dateOf } from '../time/calendar';
import { fmtMoney } from '../format';
import { BACKGROUND_BY_ID } from '../../content/backgrounds';
import { cityName } from './ranking';

/**
 * Orquestador de la historia del magnate (1.4). Se engancha al ciclo diario y
 * al cierre de cada mes, y a la revisión de progreso que corre después de cada
 * acción. No corre en las proyecciones del asesor.
 */
export function emptySaga(seed: number): SagaState {
  return {
    rng: seedFromString(`${seed}|saga`),
    ranking: emptyRanking(),
    goals: emptyGoals(),
    dilemmas: emptyDilemmas(),
    chronicle: [],
    celebrations: [],
    firstMonth: { done: [], dismissed: false },
    challenge: null,
    stats: { donated: 0, crisesSurvived: 0, crisisStart: {}, decisions: 0 },
  };
}

/** Partida nueva: listas de fortunas, primera página de la crónica y desafío (si hay). */
export function initSaga(state: GameState, challengeId?: string): void {
  state.saga = emptySaga(state.seed);
  initRanking(state);
  const bg = BACKGROUND_BY_ID[state.player.background];
  chronicle(state, 'inicio', 'sparkles', `Empieza la historia de ${state.player.name}`, `${bg.summary} Ciudad: ${cityName(state.tax.jurisdiction)}.`);
  if (challengeId) setupChallenge(state, challengeId);
}

/** Partida guardada antes de 1.4: se crea la historia sin tocar la economía. */
export function migrateSaga(state: GameState): void {
  state.saga = emptySaga(state.seed);
  // En una partida avanzada, los primeros dilemas no llegan de golpe.
  state.saga.dilemmas.nextDay = state.day + 20;
  state.saga.firstMonth.dismissed = state.day > 60;
  initRanking(state);
  chronicle(state, 'inicio', 'sparkles', 'Empieza tu crónica', `La crónica empieza hoy: ${state.player.name} tiene ${fmtMoney(balanceSheet(state).netWorth, { decimals: false })} de patrimonio y está en la etapa ${state.progression.stage}.`);
}

export function sagaDay(state: GameState): void {
  if (state.meta.projection || !state.saga) return;
  dilemmasDay(state);
}

export function sagaMonth(state: GameState): void {
  if (state.meta.projection || !state.saga) return;
  rankingMonth(state);
  checkTruces(state);
  trackCrises(state);
  checkChallenge(state);
  if (dateOf(state.day).m === 12) yearSummary(state, rankSummary(state));
}

/** Después de cada acción y de cada cierre de mes: metas de vida. */
export function sagaProgress(state: GameState, m: Metrics): void {
  if (state.meta.projection || !state.saga) return;
  checkGoals(state, m);
}

/** La interfaz celebra cada etapa nueva y los logros (y la crónica los recuerda). */
export function onStage(state: GameState, n: number, name: string, recommended: string[], description = ''): void {
  if (!state.saga) return;
  const text = `${description}${recommended.length ? ` Desde ahora se recomienda: ${recommended.join(', ')}.` : ''}`.trim() || 'Seguís avanzando.';
  celebrate(state, 'big', 'progress', `Etapa ${n}: ${name}`, text);
  chronicle(state, 'etapa', 'progress', `Etapa ${n}: ${name}`, text);
}

export function onAchievement(state: GameState, name: string, description: string, big: boolean): void {
  if (!state.saga) return;
  celebrate(state, big ? 'big' : 'small', 'medal', `Logro: ${name}`, description);
  chronicle(state, 'logro', 'medal', name, description);
}

/** Recesiones: si terminan y tu patrimonio es mayor que al empezar, la resististe. */
function trackCrises(state: GameState): void {
  const st = state.saga.stats;
  const inRecession = state.macro.phase === 'recesion';
  const key = 'recesion';
  if (inRecession && st.crisisStart[key] === undefined) {
    st.crisisStart[key] = balanceSheet(state).netWorth;
    chronicle(state, 'crisis', 'rain', 'Empieza una recesión', 'La economía entra en recesión: suben el desempleo y la morosidad, caen las ventas.');
    return;
  }
  if (!inRecession && st.crisisStart[key] !== undefined) {
    const start = st.crisisStart[key];
    delete st.crisisStart[key];
    const nw = balanceSheet(state).netWorth;
    if (nw > start) {
      st.crisesSurvived++;
      const text = `Terminó la recesión y tu patrimonio pasó de ${fmtMoney(start, { decimals: false })} a ${fmtMoney(nw, { decimals: false })}.`;
      celebrate(state, 'small', 'shield', 'Resististe la recesión', text);
      chronicle(state, 'crisis', 'shield', 'Resististe la recesión', text);
    } else {
      chronicle(state, 'crisis', 'cloudSun', 'Termina la recesión', `Tu patrimonio pasó de ${fmtMoney(start, { decimals: false })} a ${fmtMoney(nw, { decimals: false })}.`);
    }
  }
}
