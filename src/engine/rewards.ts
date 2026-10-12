import type { GameState } from './state';
import { ActionResult, FAIL, OK } from './result';
import { fmtMoney } from './format';
import { addLog } from './log';
import { COURSE_BY_ID } from '../content/courses';
import { tuition, TUITION_PERIOD_DAYS, recordEducationSpend } from './skills/education';
import { payExpense } from './finance/payments';

/**
 * RECOMPENSAS POR VER UN ANUNCIO (opcional, nunca obligatorio).
 *
 * Regla de la fase 0 (auditoría D5): un anuncio NUNCA crea dinero ni cancela
 * deudas. Las recompensas dan información o tiempo, y lo que cuesta dinero se paga
 * igual que siempre por el libro mayor. El límite es por DÍA REAL (lo pasa la
 * interfaz como "AAAA-MM-DD"), así el motor sigue siendo determinista.
 *  - news:  el próximo análisis de una noticia tiene la mitad de error.
 *  - study: adelanta hasta 3 meses un curso en curso; las matrículas de esos meses
 *           se pagan igual.
 * Durante un desafío con semilla no hay recompensas: los resultados tienen que ser
 * comparables entre jugadores.
 *
 * Hasta la 1.4.0 existían `cash` (una semana de sueldo como "otros ingresos") y
 * `debt` (cancelar la mitad de un préstamo con 3 anuncios). Se quitaron: los
 * contadores viejos que queden en partidas guardadas se ignoran.
 */
export type AdRewardKind = 'news' | 'study';

export const AD_REWARDS: Record<AdRewardKind, { perDay: number; title: string }> = {
  news: { perDay: 3, title: 'Análisis de noticias más preciso' },
  study: { perDay: 1, title: 'Adelantar 3 meses de estudio' },
};
export const STUDY_SKIP_DAYS = 90;

export interface AdRewardsState {
  date: string;
  used: Partial<Record<AdRewardKind, number>>;
  /** El próximo análisis de noticia usa la mitad del error. */
  newsBoost: boolean;
}

/** Solo las recompensas vigentes (una partida o un botón viejo pueden pedir otra). */
function isRewardKind(kind: string): kind is AdRewardKind {
  return Object.prototype.hasOwnProperty.call(AD_REWARDS, kind);
}

function ads(state: GameState): AdRewardsState {
  state.meta.ads ??= { date: '', used: {}, newsBoost: false };
  return state.meta.ads;
}

/** ¿Hay un desafío en curso? (cumplido o vencido ya no cuenta: su código quedó fijo). */
export function challengeActive(state: GameState): boolean {
  const run = state.saga?.challenge;
  return !!run && run.completedDay === null && !run.failed;
}

/** Motivo por el que no hay recompensas en esta partida (null = disponibles). */
export function adRewardsBlocked(state: GameState): string | null {
  return challengeActive(state) ? 'Durante un desafío no hay recompensas por anuncios: así los resultados se pueden comparar.' : null;
}

export function adRewardsLeft(state: GameState, kind: AdRewardKind, today: string): number {
  if (!isRewardKind(kind) || adRewardsBlocked(state)) return 0;
  const a = state.meta.ads;
  const used = a && a.date === today ? a.used[kind] ?? 0 : 0;
  return Math.max(0, AD_REWARDS[kind].perDay - used);
}

/** Cursos que se pueden adelantar (en curso y con más de un día restante). */
export function skippableCourses(state: GameState) {
  return state.education.active.filter((a) => a.endDay - state.day > 1);
}

/**
 * Aplica la recompensa de un anuncio ya visto. Se llama SOLO cuando el SDK de
 * anuncios confirma la recompensa.
 */
export function grantAdReward(state: GameState, kind: AdRewardKind, today: string, opts: { courseId?: string } = {}): ActionResult {
  if (!isRewardKind(kind)) return FAIL('Esa recompensa ya no existe.');
  const blocked = adRewardsBlocked(state);
  if (blocked) return FAIL(blocked);
  if (adRewardsLeft(state, kind, today) <= 0) return FAIL(`Ya usaste las ${AD_REWARDS[kind].perDay} recompensas de hoy. Volvé mañana.`);
  let message: string;
  if (kind === 'news') {
    if (ads(state).newsBoost) return FAIL('Ya tenés un análisis preciso pendiente: usalo primero.');
    ads(state).newsBoost = true;
    message = 'Tu próximo análisis de una noticia va a tener la mitad del error habitual.';
  } else {
    const a = skippableCourses(state).find((x) => x.courseId === opts.courseId) ?? skippableCourses(state)[0];
    if (!a) return FAIL('No tenés un curso en curso para adelantar.');
    const c = COURSE_BY_ID[a.courseId];
    const remaining = a.endDay - state.day;
    const skip = Math.min(STUDY_SKIP_DAYS, remaining - 1);
    // Matrículas de los meses adelantados (cobros que caerían en los días salteados,
    // ver processEducation): se pagan ahora.
    const before = state.day - a.startDay;
    const after = before + skip;
    const periods = c.monthlyTuition ? Math.floor(after / TUITION_PERIOD_DAYS) - Math.floor(before / TUITION_PERIOD_DAYS) : 0;
    if (periods > 0) {
      const t = tuition(state, c) * periods;
      const res = payExpense(state, 'education', t, { memo: `Matrícula adelantada: ${c.name}`, tag: 'education', method: 'checking', allowArrears: false });
      if (!res.ok) return FAIL(`Adelantar ${Math.round(skip / 30)} meses requiere pagar ${fmtMoney(t)} de matrícula.`);
      recordEducationSpend(state, t);
    }
    a.startDay -= skip;
    a.endDay -= skip;
    message = `Adelantaste ${skip} días de ${c.name}.${periods > 0 ? ` Pagaste ${periods} matrícula(s).` : ''}`;
  }
  const st = ads(state);
  if (st.date !== today) {
    st.date = today;
    st.used = {};
  }
  st.used[kind] = (st.used[kind] ?? 0) + 1;
  addLog(state, 'success', '🎁', `Recompensa por anuncio: ${message}`);
  return OK(message);
}

/** Consume el análisis preciso (lo usa analyzeNews). */
export function takeNewsBoost(state: GameState): boolean {
  if (!state.meta.ads?.newsBoost) return false;
  state.meta.ads.newsBoost = false;
  return true;
}
