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
import { life, lifeMonth } from './life';
import { erasMonth } from './eras';
import { dealsMonth } from './integration';
import { listedMonth } from './corporate';
import { rivalryMonth } from './rivalry';
import { GOAL_BY_ID } from './goals';
import { execMonth } from './executive';

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
  life(state);
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
  life(state);
  initRanking(state);
  chronicle(state, 'inicio', 'sparkles', 'Empieza tu crónica', `La crónica empieza hoy: ${state.player.name} tiene ${fmtMoney(balanceSheet(state).netWorth, { decimals: false })} de patrimonio y está en la etapa ${state.progression.stage}.`);
}

export function sagaDay(state: GameState): void {
  if (state.meta.projection || !state.saga) return;
  if (dateOf(state.day).d === 1) {
    dealsMonth(state);
    execMonth(state);
  }
  dilemmasDay(state);
}

export function sagaMonth(state: GameState): void {
  if (state.meta.projection || !state.saga) return;
  rankingMonth(state);
  lifeMonth(state);
  erasMonth(state);
  listedMonth(state, dateOf(state.day).m);
  checkTruces(state);
  rivalryMonth(state);
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
export function onStage(state: GameState, n: number, name: string, recommended: string[], description = '', next: string | null = null): void {
  if (!state.saga) return;
  // Cierre de capítulo: lo que queda abierto para la próxima vez (metas, decisiones y la etapa siguiente).
  const open: string[] = state.saga.goals.active.map((g) => GOAL_BY_ID[g.id]?.title ?? '').filter(Boolean).slice(0, 2).map((x) => `tu meta «${x}»`);
  const pending = state.saga.dilemmas.open.length;
  if (pending) open.push(`${pending} decisión${pending > 1 ? 'es' : ''} pendiente${pending > 1 ? 's' : ''}`);
  if (next && open.length < 3) open.push(next);
  if (!state.saga.goals.active.length && open.length < 3) open.push('elegir tus metas de vida');
  const text = `${description}${recommended.length ? ` Desde ahora se recomienda: ${recommended.join(', ')}.` : ''}${open.length ? ` Para la próxima: ${open.slice(0, 3).join('; ')}.` : ''}`.trim() || 'Seguís avanzando.';
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
