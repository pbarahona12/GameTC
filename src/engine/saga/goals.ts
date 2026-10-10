import { fmtMoneyFit } from '../format';
import type { GameState } from '../state';
import type { Metrics } from '../reports/metrics';
import { usd, clamp } from '../money';
import { ActionResult, FAIL, OK } from '../result';
import { addLog } from '../log';
import { chronicle, celebrate } from './chronicle';
import { RIVAL_HEADS, magnateWealth, cityName, playerCity, CITY_SIZE } from './ranking';
import { professionalLevel } from '../progression/progression';
import type { PlayStyle } from '../../content/backgrounds';

/**
 * METAS DE VIDA (1.4): el jugador elige qué quiere lograr (hasta 3 a la vez).
 * No todas son de dinero: también hay metas de carrera, de vida, de reputación,
 * de competencia y de ética. Se cumplen por el estado real de la partida, quedan
 * en la crónica y suman reputación.
 */
export const MAX_ACTIVE_GOALS = 3;

export type GoalCategory = 'riqueza' | 'negocios' | 'vida' | 'competencia' | 'carrera' | 'valores';

export interface GoalProgress {
  /** 0–1. */
  progress: number;
  done: boolean;
  /** La meta ya no se puede cumplir en esta partida. */
  failed?: boolean;
  /** Texto corto del avance ("2 de 3 empresas"). */
  label: string;
}

export interface GoalDef {
  id: string;
  title: string;
  description: string;
  icon: string;
  category: GoalCategory;
  /** Etapa desde la que se sugiere (se puede elegir antes igual). */
  stage: number;
  /** Estilos para los que se recomienda al empezar. */
  styles?: PlayStyle[];
  check: (s: GameState, m: Metrics) => GoalProgress;
}

const pct = (x: number) => clamp(x, 0, 1);
const pi = (s: GameState) => s.macro.priceIndex;
const ownProps = (s: GameState) => s.realEstate.properties.filter((p) => p.owner.kind === 'personal' || p.owner.kind === 'company');
const profitable = (s: GameState) => s.companies.filter((c) => c.status === 'active' && c.sector !== 'holding' && c.history.length >= 3 && c.history.slice(-3).reduce((a, h) => a + h.netIncome, 0) > 0).length;
const maxSkill = (s: GameState) => Object.entries(s.skills).filter(([k]) => k !== 'luck').reduce((a, [, v]) => Math.max(a, v.level), 0);
const logPct = (v: number, target: number) => (v <= 1 || target <= 1 ? 0 : pct(Math.log(v) / Math.log(target)));

function rankGoal(t: number): GoalDef['check'] {
  return (s, m) => {
    const best = s.saga.ranking.player.bestCity;
    const done = best !== null && best <= t;
    const floor = s.saga.ranking.magnates.filter((x) => x.city === playerCity(s)).map((x) => magnateWealth(s, x)).sort((a, b) => b - a)[Math.min(t, CITY_SIZE) - 1] ?? 0;
    return { progress: done ? 1 : logPct(m.netWorth, floor), done, label: done ? `Lo lograste (mejor puesto: ${best})` : `Te faltan ${fmtShort(Math.max(0, floor - m.netWorth))} para el puesto ${t} de ${cityName(playerCity(s))}` };
  };
}

/** Montos cortos con el mismo formato que el resto del juego ($250.0K, $1.20B). */
function fmtShort(c: number): string {
  return fmtMoneyFit(c, { decimals: false, max: 9 });
}

const RIVAL_GOALS: GoalDef[] = Object.entries(RIVAL_HEADS).map(([rivalId, h]) => ({
  id: `vencer_${rivalId}`, title: `Superar a ${h.name}`, icon: 'rivals', category: 'competencia' as const, stage: 5,
  description: `Que tu patrimonio supere la fortuna de ${h.name} (incluye su grupo empresarial). Ellos lo van a notar.`,
  check: (s: GameState, m: Metrics) => {
    const done = s.saga.ranking.overtaken.includes(rivalId);
    const mag = s.saga.ranking.magnates.find((x) => x.rivalId === rivalId);
    const w = mag ? magnateWealth(s, mag) : 0;
    return { progress: done ? 1 : logPct(m.netWorth, w), done, label: done ? 'Lo superaste' : `Su fortuna: ${fmtShort(w)}` };
  },
}));

export const GOALS: GoalDef[] = [
  {
    id: 'casa_propia', title: 'Tu propia casa', icon: 'home', category: 'vida', stage: 3, styles: ['inmobiliario', 'ejecutivo', 'libre'],
    description: 'Vivir en una vivienda que sea tuya (comprala y usala como residencia en Invertir → Inmuebles).',
    check: (s) => {
      const home = s.realEstate.properties.some((p) => p.owner.kind === 'personal' && p.type === 'vivienda' && p.usedBy === 'jugador');
      const owns = s.realEstate.properties.some((p) => p.owner.kind === 'personal' && p.type === 'vivienda');
      return { progress: home ? 1 : owns ? 0.7 : 0, done: home, label: home ? 'Vivís en tu casa' : owns ? 'Tenés una vivienda: usala como tu residencia' : 'Todavía alquilás' };
    },
  },
  {
    id: 'independencia', title: 'Independencia financiera', icon: 'savings', category: 'riqueza', stage: 4, styles: ['inversionista', 'inmobiliario', 'libre'],
    description: 'Que tus ingresos pasivos (intereses, alquileres, dividendos y ganancias de tus empresas) cubran todos tus gastos fijos.',
    check: (_s, m) => {
      const need = m.recurringMonthly + m.debtPayments;
      const r = need > 0 ? m.passiveMonthly / need : 0;
      return { progress: pct(r), done: need > 0 && r >= 1, label: `Tus ingresos pasivos cubren el ${Math.round(pct(r) * 100)} % de tus gastos` };
    },
  },
  {
    id: 'sin_deudas', title: 'Libre de deudas', icon: 'shield', category: 'valores', stage: 3,
    description: 'Llegar a un patrimonio de $250,000 (a precios de hoy) sin deber nada: ni préstamos, ni hipotecas, ni tarjeta.',
    check: (s, m) => {
      const target = usd(250_000 * pi(s));
      const debtFree = m.debt === 0 && m.mortgages === 0 && s.ledger.balances.credit_card === 0;
      return { progress: debtFree ? pct(m.netWorth / target) : pct(m.netWorth / target) * 0.6, done: debtFree && m.netWorth >= target, label: debtFree ? `Sin deudas · ${fmtShort(m.netWorth)} de ${fmtShort(target)}` : 'Todavía tenés deudas (préstamos, hipotecas o tarjeta)' };
    },
  },
  {
    id: 'tres_empresas', title: 'Tres empresas rentables', icon: 'business', category: 'negocios', stage: 4, styles: ['emprendedor', 'industrial'],
    description: 'Tener tres empresas que ganen dinero al mismo tiempo (resultado positivo en los últimos 3 meses).',
    check: (s) => {
      const n = profitable(s);
      return { progress: pct(n / 3), done: n >= 3, label: `${Math.min(n, 3)} de 3 empresas rentables` };
    },
  },
  {
    id: 'empleador', title: 'Dar trabajo a 50 personas', icon: 'pros', category: 'negocios', stage: 5, styles: ['emprendedor', 'industrial'],
    description: 'Sumar 50 empleados entre todas tus empresas.',
    check: (s) => {
      const n = s.companies.reduce((a, c) => a + (c.status === 'active' ? c.employees.length : 0), 0);
      return { progress: pct(n / 50), done: n >= 50, label: `${n} de 50 empleados` };
    },
  },
  {
    id: 'diez_inmuebles', title: 'Diez inmuebles alquilados', icon: 'realestate', category: 'riqueza', stage: 4, styles: ['inmobiliario'],
    description: 'Tener diez inmuebles (tuyos o de tus empresas) con inquilino al mismo tiempo.',
    check: (s) => {
      const n = ownProps(s).filter((p) => p.lease).length;
      return { progress: pct(n / 10), done: n >= 10, label: `${n} de 10 alquilados` };
    },
  },
  { id: 'top100', title: 'Entrar en la lista de fortunas', icon: 'medal', category: 'competencia', stage: 5, description: 'Ser una de las 100 personas más ricas de tu ciudad.', check: rankGoal(100) },
  { id: 'top10', title: 'Top 10 de tu ciudad', icon: 'medal', category: 'competencia', stage: 7, description: 'Estar entre las 10 fortunas más grandes de tu ciudad.', check: rankGoal(10) },
  { id: 'top1_ciudad', title: 'La persona más rica de tu ciudad', icon: 'crown', category: 'competencia', stage: 7, description: 'Encabezar la lista de fortunas de tu ciudad. Quien está segundo no se va a quedar quieto.', check: rankGoal(1) },
  {
    id: 'trono', title: 'Defender el trono un año', icon: 'crown', category: 'competencia', stage: 8,
    description: 'Ser el número 1 de tu ciudad durante 12 meses seguidos.',
    check: (s) => {
      const r = s.saga.ranking;
      return { progress: pct(Math.max(r.reignMonths, r.bestReign) / 12), done: r.bestReign >= 12, label: r.reignMonths ? `${r.reignMonths} de 12 meses en el trono` : r.bestReign ? `Récord: ${r.bestReign} meses` : 'Primero tenés que llegar al número 1' };
    },
  },
  {
    id: 'top1_mundo', title: 'La persona más rica del mundo', icon: 'crown', category: 'competencia', stage: 9,
    description: 'Superar a todas las fortunas de las cuatro ciudades.',
    check: (s, m) => {
      const best = s.saga.ranking.player.bestGlobal;
      const top = s.saga.ranking.magnates.reduce((a, x) => Math.max(a, magnateWealth(s, x)), 0);
      const done = best === 1;
      return { progress: done ? 1 : logPct(m.netWorth, top), done, label: done ? 'Lo lograste' : `El número 1 tiene ${fmtShort(top)}` };
    },
  },
  ...RIVAL_GOALS,
  {
    id: 'universidad', title: 'Título universitario', icon: 'education', category: 'carrera', stage: 1, styles: ['ejecutivo', 'libre'],
    description: 'Terminar una carrera universitaria (o un posgrado).',
    check: (s) => {
      const done = s.education.level === 'universitario' || s.education.level === 'posgrado';
      const studying = s.education.active.length > 0;
      return { progress: done ? 1 : studying ? 0.4 : 0, done, label: done ? 'Graduado' : studying ? 'Estudiando' : 'Sin empezar' };
    },
  },
  {
    id: 'cima_carrera', title: 'Llegar a la cima de tu carrera', icon: 'career', category: 'carrera', stage: 2, styles: ['ejecutivo'],
    description: 'Alcanzar el nivel profesional 20 con un empleo.',
    check: (s) => {
      const lv = professionalLevel(s).level;
      return { progress: pct(lv / 20), done: lv >= 20 && s.career.job !== null, label: `Nivel profesional ${lv} de 20` };
    },
  },
  {
    id: 'maestria', title: 'Maestría', icon: 'brain', category: 'carrera', stage: 3,
    description: 'Llevar una habilidad a nivel 50 (estudiando y practicando).',
    check: (s) => {
      const lv = maxSkill(s);
      return { progress: pct(lv / 50), done: lv >= 50, label: `Tu mejor habilidad: nivel ${lv}` };
    },
  },
  {
    id: 'reputacion', title: 'Una reputación intachable', icon: 'star', category: 'valores', stage: 4,
    description: 'Llegar a 85 de reputación sin antecedentes penales.',
    check: (s) => {
      const rep = s.player.attributes.reputation;
      const clean = s.legal.criminalRecord === 0;
      return { progress: clean ? pct(rep / 85) : 0, done: clean && rep >= 85, failed: !clean, label: clean ? `Reputación ${Math.round(rep)} de 85` : 'Tenés antecedentes: ya no se puede' };
    },
  },
  {
    id: 'fortuna_limpia', title: 'Una fortuna limpia', icon: 'shield', category: 'valores', stage: 2,
    description: 'Llegar a la etapa 7 (Magnate regional) sin cometer nunca un acto ilegal.',
    check: (s) => {
      const clean = s.legal.acts.length === 0;
      return { progress: clean ? pct((s.progression.stage - 1) / 6) : 0, done: clean && s.progression.stage >= 7, failed: !clean, label: clean ? `Etapa ${s.progression.stage} de 7, sin manchas` : 'Ya cometiste un acto ilegal' };
    },
  },
  {
    id: 'filantropo', title: 'Filántropo', icon: 'gift', category: 'valores', stage: 5,
    description: 'Donar $1,000,000 (a precios de hoy) a causas del mundo del juego. Las oportunidades llegan como decisiones.',
    check: (s) => {
      const target = usd(1_000_000 * pi(s));
      const d = s.saga.stats.donated;
      return { progress: pct(d / target), done: d >= target, label: `Donaste ${fmtShort(d)} de ${fmtShort(target)}` };
    },
  },
  {
    id: 'resistir_crisis', title: 'Resistir una recesión', icon: 'rain', category: 'riqueza', stage: 2,
    description: 'Atravesar una recesión (fase del ciclo económico) terminando con más patrimonio que cuando empezó.',
    check: (s) => {
      const n = s.saga.stats.crisesSurvived;
      return { progress: n >= 1 ? 1 : Object.keys(s.saga.stats.crisisStart).length ? 0.5 : 0, done: n >= 1, label: n ? 'La resististe' : Object.keys(s.saga.stats.crisisStart).length ? 'Hay una recesión en curso: aguantá' : 'Esperando la próxima recesión' };
    },
  },
  {
    id: 'familia', title: 'Formar una familia', icon: 'sparkles', category: 'vida', stage: 2,
    description: 'Tener pareja y al menos un hijo. La propuesta de pareja llega como una decisión entre los 26 y los 42 años; los hijos, hasta los 45.',
    check: (s) => {
      const l = s.saga.life;
      const age = l ? (s.day - l.birthDay) / 365.25 : 0;
      const done = !!l?.partner && (l?.children.length ?? 0) > 0;
      const failed = !done && ((!l?.partner && age > 42) || age > 45);
      return { progress: done ? 1 : l?.partner ? 0.5 : 0, done, failed, label: done ? 'Tu familia crece' : failed ? 'Ya no es posible en esta generación' : l?.partner ? `En pareja con ${l.partner}` : 'Todavía sin pareja' };
    },
  },
  {
    id: 'dinastia', title: 'Fundar una dinastía', icon: 'crown', category: 'vida', stage: 6,
    description: 'Que tu heredero reciba la fortuna familiar y la haga crecer: llegar a la segunda generación con más patrimonio que la primera.',
    check: (s, m) => {
      const l = s.saga.life;
      const first = l?.ancestors[0];
      const done = !!first && (l?.generation ?? 1) >= 2 && m.netWorth > first.netWorth;
      return { progress: done ? 1 : first ? 0.7 : Math.min(0.5, (s.progression.stage - 1) / 12), done, label: done ? 'La segunda generación ya superó a la primera' : first ? `Superá los ${fmtShort(first.netWorth)} de ${first.name}` : 'Primero, pasar la posta a un heredero' };
    },
  },
  {
    id: 'cotizar', title: 'Tocar la campana', icon: 'bell', category: 'negocios', stage: 7,
    description: 'Sacar una empresa tuya a la bolsa.',
    check: (s) => {
      const done = s.companies.some((c) => !!c.listed);
      const corp = s.companies.some((c) => c.legalForm === 'corporacion' && c.status === 'active');
      return { progress: done ? 1 : corp ? 0.5 : 0, done, label: done ? 'Una empresa tuya cotiza' : corp ? 'Tenés una corporación: hacela crecer' : 'Necesitás una corporación rentable' };
    },
  },
  {
    id: 'absorber', title: 'Comprar a un rival', icon: 'deal', category: 'competencia', stage: 8,
    description: 'Comprar uno de los cuatro grupos rivales. Deja de competir con vos para siempre.',
    check: (s) => {
      const done = s.world.rivals.some((r) => !!r.acquired);
      return { progress: done ? 1 : Math.min(0.9, (s.progression.stage - 1) / 8), done, label: done ? 'Ya compraste un grupo rival' : s.progression.stage >= 8 ? 'Ya podés: Más → Competencia' : 'Se habilita desde la etapa 8' };
    },
  },
  {
    id: 'millon_rapido', title: 'Tu primer millón en 10 años', icon: 'rocket', category: 'riqueza', stage: 1, styles: ['emprendedor', 'inversionista', 'libre'],
    description: 'Llegar a $1,000,000 de patrimonio (a precios de hoy) antes de cumplir 10 años de partida.',
    check: (s, m) => {
      const target = usd(1_000_000 * pi(s));
      const done = s.progression.achievements.fast_million !== undefined || (s.day < 3650 && m.netWorth >= target);
      const failed = !done && s.day >= 3650;
      return { progress: done ? 1 : logPct(Math.max(1, m.netWorth), target), done, failed, label: done ? 'Lo lograste' : failed ? 'Pasaron los 10 años' : `Quedan ${Math.max(0, Math.ceil((3650 - s.day) / 365))} años` };
    },
  },
];

export const GOAL_BY_ID: Record<string, GoalDef> = Object.fromEntries(GOALS.map((g) => [g.id, g]));

export function emptyGoals(): GameState['saga']['goals'] {
  return { active: [], completed: {}, dropped: [] };
}

/** Metas sugeridas para elegir ahora: acordes a la etapa y al estilo, sin repetir las elegidas o cumplidas. */
export function suggestedGoals(s: GameState, m: Metrics): GoalDef[] {
  const g = s.saga.goals;
  const taken = new Set([...g.active.map((x) => x.id), ...Object.keys(g.completed)]);
  return GOALS.filter((d) => !taken.has(d.id) && !d.check(s, m).failed && !d.check(s, m).done)
    .sort((a, b) => score(s, b) - score(s, a));
}

function score(s: GameState, d: GoalDef): number {
  const stage = s.progression.stage;
  let v = 0;
  if (d.stage <= stage + 1) v += 3;
  if (d.stage > stage + 3) v -= 4;
  if (d.styles?.includes(s.player.style)) v += 2;
  return v;
}

export function chooseGoal(s: GameState, id: string): ActionResult {
  const def = GOAL_BY_ID[id];
  if (!def) return FAIL('Esa meta no existe.');
  const g = s.saga.goals;
  if (g.active.some((x) => x.id === id)) return FAIL('Ya la tenés elegida.');
  if (g.completed[id] !== undefined) return FAIL('Esa meta ya la cumpliste.');
  if (g.active.length >= MAX_ACTIVE_GOALS) return FAIL(`Podés tener hasta ${MAX_ACTIVE_GOALS} metas a la vez. Abandoná una para elegir otra.`);
  g.active.push({ id, since: s.day });
  g.dropped = g.dropped.filter((x) => x !== id);
  chronicle(s, 'meta', def.icon, `Nueva meta: ${def.title}`, def.description);
  return OK(`Meta elegida: ${def.title}.`);
}

export function dropGoal(s: GameState, id: string): ActionResult {
  const g = s.saga.goals;
  if (!g.active.some((x) => x.id === id)) return FAIL('Esa meta no está activa.');
  g.active = g.active.filter((x) => x.id !== id);
  if (!g.dropped.includes(id)) g.dropped.push(id);
  return OK('Meta abandonada. Podés volver a elegirla cuando quieras.');
}

/** Revisa las metas activas (después de cada acción y al cierre de cada mes). */
export function checkGoals(s: GameState, m: Metrics): void {
  if (s.meta.projection || !s.saga) return;
  const g = s.saga.goals;
  for (const a of [...g.active]) {
    const def = GOAL_BY_ID[a.id];
    if (!def) {
      g.active = g.active.filter((x) => x !== a);
      continue;
    }
    const p = def.check(s, m);
    if (!p.done) continue;
    g.active = g.active.filter((x) => x !== a);
    g.completed[a.id] = s.day;
    s.player.attributes.reputation = clamp(s.player.attributes.reputation + 3, 0, 100);
    const years = Math.max(0, (s.day - a.since) / 365);
    const text = `${def.description}${years >= 1 ? ` Te llevó ${years.toFixed(1)} años.` : ''}`;
    celebrate(s, 'big', def.icon, `Meta cumplida: ${def.title}`, text);
    chronicle(s, 'meta', def.icon, `Meta cumplida: ${def.title}`, text);
    addLog(s, 'success', '🎯', `Meta de vida cumplida: ${def.title} (+3 de reputación).`, undefined, 'logros');
  }
}
