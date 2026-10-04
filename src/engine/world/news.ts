import type { GameState } from '../state';
import type { NewsItem, NewsKind, NewsTopic } from './types';
import type { SkillId } from '../../content/skills';
import { chance, nextRandom, randNormal, randRange, RngHolder, seedFromString } from '../rng';
import { practice } from '../skills/skills';
import { ActionResult, FAIL, OK } from '../result';
import { fmtPct } from '../format';
import { takeNewsBoost } from '../rewards';

/**
 * NOTICIAS Y RUMORES.
 *
 * Calibración (la regla que hace que analizar valga la pena): cada noticia tiene
 * una confiabilidad real r = probabilidad de que sea cierta. Por cada hecho real
 * que podría anticiparse (un evento económico programado, un rival que planea una
 * compra) se genera también un candidato FALSO. El verdadero se publica con
 * probabilidad r y el falso con probabilidad 1 − r. Así, entre las noticias
 * publicadas con confiabilidad r, exactamente una fracción r resulta cierta.
 *
 * El jugador no ve r: ve la confiabilidad típica de la fuente y, si analiza la
 * noticia, una estimación cuyo error baja con su habilidad (±30 % con nivel 1,
 * ±3 % con nivel 100) y, a veces, una pista que respalda o contradice el rumor
 * (acierta más con más habilidad, nunca siempre).
 */

export const SOURCES = [
  { min: 0, name: 'Rumores del mercado', typical: 0.5 },
  { min: 0.6, name: 'Informe de analistas', typical: 0.7 },
  { min: 0.8, name: 'Diario Económico de Valdoria', typical: 0.85 },
];

export const TOPIC_SKILL: Record<NewsTopic, SkillId> = {
  economia: 'finEdu', bolsa: 'prediction', empresas: 'management', inmuebles: 'realEstate', proveedores: 'management', empleo: 'management', fortunas: 'prediction',
};

export const TOPIC_NAMES: Record<NewsTopic, string> = {
  economia: 'Economía', bolsa: 'Bolsa', empresas: 'Empresas', inmuebles: 'Inmuebles', proveedores: 'Proveedores', empleo: 'Empleo', fortunas: 'Fortunas',
};

const MAX_NEWS = 80;

/** Generador propio del mundo: no altera el azar del resto de la economía. */
export function wrng(state: GameState): RngHolder {
  const w = state.world as { rng?: number };
  if (typeof w.rng !== 'number') w.rng = seedFromString(`${state.seed}|mundo`);
  return w as RngHolder;
}

export function sourceFor(r: number): { name: string; typical: number } {
  let s = SOURCES[0];
  for (const x of SOURCES) if (r >= x.min) s = x;
  return s;
}

/** Confiabilidad al azar para un candidato de noticia. */
export function drawReliability(state: GameState): number {
  return Math.round(randRange(wrng(state), 0.3, 0.95) * 100) / 100;
}

export interface NewsDraft {
  kind: NewsKind;
  topic: NewsTopic;
  icon: string;
  title: string;
  body: string;
  reliability: number;
  truth: boolean;
  resolveDay: number | null;
  ref?: NewsItem['ref'];
  source?: string;
  sourceTypical?: number;
}

export function publish(state: GameState, d: NewsDraft): NewsItem | null {
  if (state.meta.projection) return null;
  const src = d.source ? { name: d.source, typical: d.sourceTypical ?? 0.95 } : sourceFor(d.reliability);
  const n: NewsItem = {
    id: state.meta.nextId++, day: state.day, kind: d.kind, topic: d.topic, icon: d.icon, title: d.title, body: d.body,
    source: src.name, sourceTypical: src.typical, reliability: d.reliability, truth: d.truth, resolveDay: d.resolveDay,
    status: d.kind === 'hecho' ? 'hecho' : 'abierta', ref: d.ref,
  };
  state.world.news.push(n);
  if (state.world.news.length > MAX_NEWS) state.world.news.splice(0, state.world.news.length - MAX_NEWS);
  return n;
}

/**
 * Publica un candidato verdadero (con probabilidad r) o falso (con probabilidad 1 − r).
 * Devuelve la noticia si se publicó.
 */
export function publishCandidate(state: GameState, truth: boolean, make: (r: number) => NewsDraft): NewsItem | null {
  const r = drawReliability(state);
  const show = truth ? chance(wrng(state), r) : chance(wrng(state), 1 - r);
  if (!show) return null;
  return publish(state, { ...make(r), reliability: r, truth });
}

export function resolveNews(state: GameState, n: NewsItem, happened: boolean, note?: string): void {
  if (n.status !== 'abierta') return;
  n.status = happened ? 'cumplida' : 'desmentida';
  n.resolveDay = state.day;
  if (note) n.body = `${n.body} ${note}`;
}

/** Cierra las noticias vencidas: las falsas quedan desmentidas. */
export function expireNews(state: GameState): void {
  for (const n of state.world.news) {
    if (n.status === 'abierta' && n.resolveDay !== null && n.resolveDay <= state.day) {
      resolveNews(state, n, n.truth, n.truth ? '' : 'No ocurrió.');
    }
  }
}

export function unreadNews(state: GameState): number {
  return state.world.news.filter((n) => n.id > state.world.lastRead).length;
}

export function markNewsRead(state: GameState): void {
  const last = state.world.news[state.world.news.length - 1];
  if (last) state.world.lastRead = last.id;
}

export function newsSkillLevel(state: GameState, n: NewsItem): number {
  return state.skills[TOPIC_SKILL[n.topic]].level;
}

/** Error típico de la estimación de confiabilidad según la habilidad. */
export function estimateError(skill: number): number {
  return Math.max(0.03, 0.3 * (1 - skill / 110));
}

/**
 * Azar del análisis del jugador, separado del mundo y determinista: la misma
 * noticia analizada con el mismo nivel da siempre el mismo resultado.
 */
export function analysisRng(state: GameState, n: NewsItem, skill: number): RngHolder {
  return { rng: seedFromString(`${state.seed}|analisis|${n.id}|${skill}`) };
}

/**
 * Analizar una noticia: estimás su confiabilidad (con error según tu habilidad) y
 * quizá encontrás una pista. Solo se puede repetir si tu habilidad subió 10 niveles.
 */
export function analyzeNews(state: GameState, id: number): ActionResult {
  const n = state.world.news.find((x) => x.id === id);
  if (!n) return FAIL('Noticia inexistente.');
  if (n.kind === 'hecho' || n.kind === 'oficial') return FAIL('Es un hecho confirmado: no hace falta analizarlo.');
  if (n.status !== 'abierta') return FAIL('Esta noticia ya se resolvió.');
  const skill = newsSkillLevel(state, n);
  if (n.analysis && skill < n.analysis.skill + 10) return FAIL(`Ya la analizaste. Podrás reanalizarla cuando tu habilidad llegue a ${n.analysis.skill + 10}.`);
  // Generador propio de ESTE análisis (semilla + noticia + nivel): analizar no consume el
  // azar del mundo, así que mirar una noticia no cambia lo que va a pasar después.
  const g = analysisRng(state, n, skill);
  // Recompensa por anuncio: un análisis con la mitad del error.
  const precise = takeNewsBoost(state);
  const est = Math.min(0.97, Math.max(0.03, n.reliability + randNormal(g) * estimateError(skill) * (precise ? 0.5 : 1)));
  let clue: 'respalda' | 'contradice' | null = null;
  if (nextRandom(g) < 0.25 + skill / 250) {
    const right = nextRandom(g) < Math.min(0.93, 0.6 + skill / 300);
    clue = (n.truth === right) ? 'respalda' : 'contradice';
  }
  n.analysis = { day: state.day, estimate: Math.round(est * 100) / 100, clue, skill };
  const xp = practice(state, `news:${n.topic}`, TOPIC_SKILL[n.topic], 60);
  const clueText = clue === 'respalda' ? ' Encontraste datos que la respaldan.' : clue === 'contradice' ? ' Encontraste datos que la contradicen.' : '';
  return OK(`Estimás que es cierta con ~${fmtPct(n.analysis.estimate, 0)} de probabilidad${precise ? ' (análisis preciso)' : ''}.${clueText}${xp ? ` (+${xp} XP)` : ''}`);
}

