import type { GameState } from '../state';
import type { BackgroundId, PlayStyle } from '../../content/backgrounds';
import type { JurisdictionId } from '../../content/jurisdictions';
import { usd } from '../money';
import { balanceSheet } from '../reports/statements';
import { addLog } from '../log';
import { fmtMoney } from '../format';
import { chronicle, celebrate } from './chronicle';
import { cityName } from './ranking';
import { post } from '../ledger/ledger';
import { monthlyRecurring } from '../finance/budget';

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
  /** Arranca con un préstamo caro ya gastado (USD). */
  startDebtUsd?: number;
  /** Plazo en días de juego (si se pasa, el desafío queda fallido). */
  limitDays: number;
  /** Qué se compara: días hasta cumplirlo (menos es mejor) o patrimonio al vencer el plazo (más es mejor). */
  metric: 'days' | 'netWorth';
  goal: string;
  /** Medallas: umbrales de oro, plata y bronce (días o USD según la métrica). */
  medals: [number, number, number];
  /** Para clase (1.4): qué se aprende y preguntas para conversar después. */
  learn?: { goal: string; questions: string[] };
  check: (s: GameState, nw: number) => boolean;
}

export const CHALLENGES: ChallengeDef[] = [
  {
    id: 'millon', title: 'El primer millón', icon: 'rocket', seed: 'desafio-millon-1', background: 'autodidacta', style: 'libre', limitDays: 365 * 20, metric: 'days',
    description: 'Empezás con $1,500 y un estilo de vida austero. ¿Cuánto tardás en llegar al millón?',
    goal: 'Patrimonio neto de $1,000,000', medals: [365 * 8, 365 * 12, 365 * 20], 
    learn: { goal: 'Planificar a largo plazo: ingresos, ahorro, inversión y riesgo.', questions: ['¿Qué decisión te acercó más al millón?', '¿Qué riesgo tomaste que no volverías a tomar?'] },
    check: (_s, nw) => nw >= usd(1_000_000),
  },
  {
    id: 'herencia', title: 'La herencia de la tía', icon: 'key', seed: 'desafio-herencia-1', background: 'herencia', style: 'libre', limitDays: 365 * 6, metric: 'days',
    description: '$15,000 y ninguna experiencia. La mayoría lo gasta en tres años. Vos tenés seis para llegar a Empresario emergente.',
    goal: 'Etapa 6 (Empresario emergente) en menos de 6 años', medals: [365 * 3, Math.round(365 * 4.5), 365 * 6], check: (s) => s.progression.stage >= 6,
  },
  {
    id: 'lista', title: 'Entrar en la lista', icon: 'medal', seed: 'desafio-lista-1', background: 'egresado', style: 'libre', limitDays: 365 * 30, metric: 'days',
    description: 'Desde cero, convertite en una de las 100 personas más ricas de Valdoria.',
    goal: 'Top 100 de Valdoria', medals: [365 * 15, 365 * 22, 365 * 30], check: (s) => s.saga.ranking.player.city !== null && s.tax.jurisdiction === 'valdoria',
  },
  {
    id: 'recesion', title: 'Nacer en la crisis', icon: 'rain', seed: 'desafio-recesion-1', background: 'tecnico', style: 'libre', recessionMonths: 18, limitDays: 365 * 3, metric: 'netWorth',
    description: 'Empezás en plena recesión: desempleo alto, ventas bajas y bancos cautelosos. ¿Con cuánto patrimonio llegás al tercer año?',
    goal: 'El mayor patrimonio posible a los 3 años', medals: [50_000, 20_000, 5_000], 
    learn: { goal: 'Tomar decisiones con la economía en contra: liquidez, empleo y crédito.', questions: ['¿Qué hiciste para no quedarte sin efectivo?', '¿Conseguiste crédito? ¿A qué tasa? ¿Por qué los bancos eran más cautelosos?'] },
    check: (s) => s.day >= 365 * 3,
  },
  {
    id: 'puerto', title: 'Rey de Puerto Nuevo', icon: 'crown', seed: 'desafio-puerto-1', background: 'tecnico', style: 'emprendedor', city: 'meridia', limitDays: 365 * 40, metric: 'days',
    description: 'Empezás viviendo en Puerto Nuevo (Meridia), la ciudad de las fortunas nuevas. El objetivo: ser su número 1.',
    goal: 'Número 1 de Puerto Nuevo', medals: [365 * 25, 365 * 32, 365 * 40], check: (s) => s.saga.ranking.player.city === 1 && s.tax.jurisdiction === 'meridia',
  },
  // Desafíos para aprender (sirven también en clase): objetivos de finanzas personales.
  {
    id: 'deudas', title: 'Salir de deudas', icon: 'card', seed: 'desafio-deudas-1', background: 'egresado', style: 'libre', limitDays: 365 * 3, metric: 'days', startDebtUsd: 6000,
    description: 'Empezás debiendo $6,000 a FinaRápido (36 % anual). Cancelá el préstamo y llegá a $5,000 de patrimonio.',
    goal: 'Sin préstamos y $5,000 de patrimonio', medals: [365, 365 * 2, 365 * 3], 
    learn: { goal: 'Entender cuánto cuesta una deuda cara y por qué conviene cancelarla antes de invertir.', questions: ['¿Cuánto pagaste en intereses en total? ¿Qué podrías haber comprado con eso?', '¿Te convenía más adelantar cuotas o ahorrar primero? ¿Por qué?', '¿Qué gastos recortaste para pagar antes?'] },
    check: (s, nw) => s.bank.loans.every((l) => l.status !== 'active') && nw >= usd(5000),
  },
  {
    id: 'colchon', title: 'Tu colchón', icon: 'savings', seed: 'desafio-colchon-1', background: 'egresado', style: 'libre', limitDays: 365 * 2, metric: 'days',
    description: 'Armá un fondo de emergencia de 6 meses de gastos esenciales en la cuenta de ahorro.',
    goal: '6 meses de gastos esenciales ahorrados', medals: [274, 456, 730], 
    learn: { goal: 'Armar un fondo de emergencia y entender para qué sirve antes de invertir.', questions: ['¿Cuántos meses tardaste? ¿Qué gasto fue el más difícil de bajar?', '¿Qué pasó (o qué podría haber pasado) si perdías el empleo antes de tener el colchón?', '¿Por qué el colchón va en una cuenta de ahorro y no en acciones?'] },
    check: (s) => s.ledger.balances.savings >= monthlyRecurring(s, true) * 6 && s.day > 0,
  },
  {
    id: 'compuesto', title: 'El interés compuesto', icon: 'invest', seed: 'desafio-compuesto-1', background: 'tecnico', style: 'inversionista', limitDays: 365 * 12, metric: 'days',
    description: 'Llegá a $100,000 en inversiones financieras (acciones, bonos, fondos o gestor). Empezar temprano vale más que invertir mucho.',
    goal: '$100,000 en inversiones financieras', medals: [365 * 6, 365 * 9, 365 * 12], 
    learn: { goal: 'Ver el interés compuesto en acción: invertir temprano y seguido pesa más que invertir mucho.', questions: ['¿Qué parte de tu cartera final es lo que aportaste y qué parte son rendimientos?', '¿Cómo cambió tu cartera durante una caída de la bolsa? ¿Vendiste?', '¿Qué comisiones pagaste y cuánto te costaron a largo plazo?'] },
    check: (s) => { const b = s.ledger.balances; return b.stocks + b.bonds + b.funds + b.mogul + (b.managed ?? 0) >= usd(100_000); },
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
  if (c.startDebtUsd) {
    const principal = usd(c.startDebtUsd);
    const apr = 0.36;
    const term = 24;
    const r = apr / 12;
    const payment = Math.round((principal * r) / (1 - Math.pow(1 + r, -term)));
    post(s.ledger, { day: s.day, memo: 'Deuda con la que empezás el desafío', cf: 'internal', tag: 'opening', lines: [{ account: 'opening_equity', debit: principal }, { account: 'personal_loans', credit: principal }] });
    s.bank.loans.push({ id: s.meta.nextId++, bankId: 'finarapido', principal, balance: principal, apr, termMonths: term, payment, startDay: s.day, nextDueDay: s.day + 30, paymentsMade: 0, missedConsecutive: 0, missedTotal: 0, interestPaid: 0, status: 'active' });
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

/** Medalla por eficiencia según el resultado (días: menos es mejor; patrimonio: más es mejor). */
export function medalFor(id: string, value: number): 'oro' | 'plata' | 'bronce' | null {
  const c = CHALLENGE_BY_ID[id];
  if (!c) return null;
  const [g, s, b] = c.medals;
  const better = (x: number, t: number) => (c.metric === 'days' ? x <= t : x >= t);
  return better(value, g) ? 'oro' : better(value, s) ? 'plata' : better(value, b) ? 'bronce' : null;
}

export const MEDAL_LABEL = { oro: '🥇 oro', plata: '🥈 plata', bronce: '🥉 bronce' } as const;

export function describeResult(id: string, value: number): string {
  const c = CHALLENGE_BY_ID[id];
  if (!c) return '';
  const m = medalFor(id, value);
  const medal = m ? ` · medalla de ${MEDAL_LABEL[m]}` : '';
  return c.metric === 'days' ? `${c.title}: cumplido en ${(value / 365).toFixed(1)} años (${value} días)${medal}` : `${c.title}: ${fmtMoney(usd(value), { decimals: false })} de patrimonio${medal}`;
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
    run.medal = medalFor(c.id, value);
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
