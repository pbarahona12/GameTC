import type { GameState } from '../state';
import type { BackgroundId, PlayStyle } from '../../content/backgrounds';
import type { JurisdictionId } from '../../content/jurisdictions';
import { usd } from '../money';
import { balanceSheet } from '../reports/statements';
import { addLog } from '../log';
import { fmtMoney } from '../format';
import { chronicle, celebrate } from './chronicle';
import { cityName } from './ranking';

/**
 * DESAFÍOS CON SEMILLA (1.4): escenarios fijos y reproducibles. Todos los que
 * juegan un desafío empiezan en el MISMO mundo (misma semilla: misma bolsa,
 * mismos empleos, mismas crisis), así que los resultados se pueden comparar de
 * verdad. Al cumplirlo, el juego da un código de resultado para compartir.
 * No hace falta servidor ni cuenta.
 */
export interface ChallengeDef {
  id: string;
  title: string;
  description: string;
  icon: string;
  seed: string;
  background: BackgroundId;
  style: PlayStyle;
  /** Ciudad donde empezás (residencia fiscal). */
  city?: JurisdictionId;
  /** Arranca con una recesión forzada de N meses. */
  recessionMonths?: number;
  /** Plazo en días de juego (si se pasa, el desafío queda fallido). */
  limitDays: number;
  /** Qué se compara: días hasta cumplirlo (menos es mejor) o patrimonio al vencer el plazo (más es mejor). */
  metric: 'days' | 'netWorth';
  goal: string;
  check: (s: GameState, nw: number) => boolean;
}

export const CHALLENGES: ChallengeDef[] = [
  {
    id: 'millon', title: 'El primer millón', icon: 'rocket', seed: 'desafio-millon-1', background: 'autodidacta', style: 'libre', limitDays: 365 * 20, metric: 'days',
    description: 'Empezás con $1,500 y un estilo de vida austero. ¿Cuánto tardás en llegar al millón?',
    goal: 'Patrimonio neto de $1,000,000', check: (_s, nw) => nw >= usd(1_000_000),
  },
  {
    id: 'herencia', title: 'La herencia de la tía', icon: 'key', seed: 'desafio-herencia-1', background: 'herencia', style: 'libre', limitDays: 365 * 6, metric: 'days',
    description: '$15,000 y ninguna experiencia. La mayoría lo gasta en tres años. Vos tenés seis para llegar a Empresario emergente.',
    goal: 'Etapa 6 (Empresario emergente) en menos de 6 años', check: (s) => s.progression.stage >= 6,
  },
  {
    id: 'lista', title: 'Entrar en la lista', icon: 'medal', seed: 'desafio-lista-1', background: 'egresado', style: 'libre', limitDays: 365 * 30, metric: 'days',
    description: 'Desde cero, convertite en una de las 100 personas más ricas de Valdoria.',
    goal: 'Top 100 de Valdoria', check: (s) => s.saga.ranking.player.city !== null && s.tax.jurisdiction === 'valdoria',
  },
  {
    id: 'recesion', title: 'Nacer en la crisis', icon: 'rain', seed: 'desafio-recesion-1', background: 'tecnico', style: 'libre', recessionMonths: 18, limitDays: 365 * 3, metric: 'netWorth',
    description: 'Empezás en plena recesión: desempleo alto, ventas bajas y bancos cautelosos. ¿Con cuánto patrimonio llegás al tercer año?',
    goal: 'El mayor patrimonio posible a los 3 años', check: (s) => s.day >= 365 * 3,
  },
  {
    id: 'puerto', title: 'Rey de Puerto Nuevo', icon: 'crown', seed: 'desafio-puerto-1', background: 'tecnico', style: 'emprendedor', city: 'meridia', limitDays: 365 * 40, metric: 'days',
    description: 'Empezás viviendo en Puerto Nuevo (Meridia), la ciudad de las fortunas nuevas. El objetivo: ser su número 1.',
    goal: 'Número 1 de Puerto Nuevo', check: (s) => s.saga.ranking.player.city === 1 && s.tax.jurisdiction === 'meridia',
  },
];

export const CHALLENGE_BY_ID: Record<string, ChallengeDef> = Object.fromEntries(CHALLENGES.map((c) => [c.id, c]));

/** Prepara una partida nueva para un desafío (se llama desde newGame). */
export function setupChallenge(s: GameState, id: string): void {
  const c = CHALLENGE_BY_ID[id];
  if (!c) return;
  s.saga.challenge = { id, completedDay: null, failed: false };
  if (c.city) s.tax.jurisdiction = c.city;
  if (c.recessionMonths) {
    s.macro.phase = 'recesion';
    s.macro.phaseMonths = 0;
    s.macro.forced = { phase: 'recesion', until: c.recessionMonths * 30 };
  }
  chronicle(s, 'desafio', c.icon, `Desafío: ${c.title}`, `${c.description} Objetivo: ${c.goal}.`);
}

function fnv(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(6, '0').slice(-6);
}

/**
 * Código de resultado: desafío, valor y una verificación. Quien lo recibe puede
 * comprobar que no está mal copiado (no es una firma criptográfica: el juego es local).
 */
export function resultCode(id: string, value: number): string {
  const core = `${id.toUpperCase()}-${value}`;
  return `${core}-${fnv(`urt|${core}`)}`;
}

export function verifyCode(code: string): { id: string; value: number } | null {
  const m = /^([A-Z]+)-(\d+)-([0-9A-Z]{6})$/.exec(code.trim().toUpperCase());
  if (!m) return null;
  const id = m[1].toLowerCase();
  const value = Number(m[2]);
  return resultCode(id, value) === code.trim().toUpperCase() && CHALLENGE_BY_ID[id] ? { id, value } : null;
}

export function describeResult(id: string, value: number): string {
  const c = CHALLENGE_BY_ID[id];
  if (!c) return '';
  return c.metric === 'days' ? `${c.title}: cumplido en ${(value / 365).toFixed(1)} años (${value} días)` : `${c.title}: ${fmtMoney(usd(value), { decimals: false })} de patrimonio`;
}

/** Revisa el desafío al cierre de cada mes. */
export function checkChallenge(s: GameState): void {
  const run = s.saga?.challenge;
  if (!run || run.completedDay !== null || run.failed) return;
  const c = CHALLENGE_BY_ID[run.id];
  if (!c) return;
  const nw = balanceSheet(s).netWorth;
  if (c.check(s, nw)) {
    run.completedDay = s.day;
    run.finalNetWorth = nw;
    const value = c.metric === 'days' ? s.day : Math.max(0, Math.round(nw / 100));
    run.code = resultCode(c.id, value);
    const text = `${describeResult(c.id, value)}. Código para comparar: ${run.code}.`;
    celebrate(s, 'big', c.icon, `Desafío cumplido: ${c.title}`, text);
    chronicle(s, 'desafio', c.icon, `Desafío cumplido: ${c.title}`, text);
    addLog(s, 'success', '🏁', `Desafío cumplido: ${c.title}. Tu código: ${run.code}.`, undefined, 'logros');
    return;
  }
  if (s.day > c.limitDays) {
    run.failed = true;
    run.finalNetWorth = nw;
    const where = c.city ? ` (${cityName(c.city)})` : '';
    chronicle(s, 'desafio', 'clock', `Se terminó el plazo del desafío${where}`, `${c.title}: no se cumplió el objetivo (${c.goal}). La partida sigue normalmente.`);
    addLog(s, 'warning', '🏁', `Se terminó el plazo del desafío «${c.title}». La partida sigue normalmente.`);
  }
}
