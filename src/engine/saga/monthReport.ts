import type { GameState, LogItem } from '../state';
import type { Cents } from '../money';
import { startOfMonth, formatMonthLong, formatDate, isLastDayOfMonth } from '../time/calendar';
import { fmtMoney, fmtPct } from '../format';
import { incomeStatement, balanceSheet } from '../reports/statements';
import { agenda, type AgendaItem } from './agenda';
import { playerPosition, cityName, listedFortune } from './ranking';
import { rivalById } from '../world/rivals';
import { isOpen } from '../business/common';

/**
 * EL MES COMO TURNO (fase 1 · E5 y F2 de la auditoría).
 *
 * Al cerrar cada mes, un informe breve que cuenta una historia en lugar de una
 * tabla: un titular con lo más importante que pasó, tres datos, cómo te movés en
 * la lista de fortunas, qué hizo tu némesis, cómo te fue frente a lo que
 * proyectaste y, como mucho, dos decisiones para el mes que empieza.
 *
 * Es una vista pura: se calcula desde la partida el último día del mes (no se
 * guarda nada). La interfaz detiene el tiempo ahí por defecto (Ajustes).
 */
export interface MonthFact {
  label: string;
  value: string;
  tone: 'gain' | 'loss' | 'neutral';
}

export interface MonthReport {
  day: number;
  month: string;
  headline: string;
  /** Una línea que amplía el titular (opcional). */
  deck: string | null;
  facts: MonthFact[];
  rank: string | null;
  nemesis: string | null;
  vsPlan: string | null;
  decisions: AgendaItem[];
}

const money = (c: Cents) => fmtMoney(c, { decimals: false });
const signed = (c: Cents) => `${c >= 0 ? '+' : '−'}${money(Math.abs(c))}`;

/** Eventos del registro de este mes, sin los de rutina (cobros y pagos repetidos). */
function monthLog(s: GameState, from: number): LogItem[] {
  return s.log.filter((l) => l.day >= from && l.day <= s.day && l.kind !== 'income' && l.kind !== 'expense');
}

/** Lo más importante del mes, en orden: hitos de la crónica, peligros, logros, lo demás. */
function pickHeadline(s: GameState, from: number, change: Cents, income: Cents, result: Cents): { headline: string; deck: string | null } {
  const chron = (s.saga?.chronicle ?? []).filter((c) => c.day >= from && c.day <= s.day && c.kind !== 'anio' && c.kind !== 'inicio');
  const order: Record<string, number> = { desafio: 0, etapa: 1, ranking: 2, rival: 3, crisis: 4, empresa: 5, vida: 6, logro: 7, meta: 8, dilema: 9 };
  chron.sort((a, b) => (order[a.kind] ?? 99) - (order[b.kind] ?? 99) || b.day - a.day);
  if (chron[0]) return { headline: chron[0].title, deck: chron[0].text };
  const log = monthLog(s, from);
  const danger = log.filter((l) => l.kind === 'danger').pop();
  if (danger) return { headline: danger.text.split(/(?<=[.!?])\s/)[0], deck: null };
  const success = log.filter((l) => l.kind === 'success' && !l.text.startsWith('Recompensa')).pop();
  if (success) return { headline: success.text.split(/(?<=[.!?])\s/)[0], deck: null };
  // Sin un hecho destacado, el titular cuenta el mes en una frase (no repite los datos).
  if (income <= 0 && result < 0) return { headline: `Un mes sin ingresos: tus ahorros pagaron ${money(-result)} de gastos.`, deck: s.career.job ? null : 'Conseguir un ingreso es lo primero: cada mes así achica tu colchón.' };
  if (result > 0 && change > result) return { headline: `Te sobraron ${money(result)} y tus inversiones sumaron otros ${money(change - result)}.`, deck: null };
  if (result > 0) return { headline: `Cobraste ${money(income)} y te sobraron ${money(result)}.`, deck: null };
  if (result < 0) return { headline: `Gastaste ${money(-result)} más de lo que entró.`, deck: 'Revisá tus gastos fijos o buscá un ingreso mayor.' };
  return { headline: 'Un mes tranquilo: entró lo mismo que salió.', deck: null };
}

function rankLine(s: GameState, nw: Cents): string | null {
  const hist = s.saga?.ranking?.history ?? [];
  const pos = playerPosition(s, listedFortune(s, nw));
  const city = cityName(pos.city);
  const prev = [...hist].reverse().find((h) => h.day < startOfMonth(s.day));
  if (pos.exact) {
    const before = prev?.city ?? null;
    const ahead = pos.ahead ? ` Adelante tuyo: ${pos.ahead.name} (${money(pos.ahead.wealth)}).` : ' Sos el número 1.';
    if (before === null) return `Entraste en la lista de ${city}: puesto ${pos.rank}.${ahead}`;
    if (pos.rank < before) return `Subiste del puesto ${before} al ${pos.rank} en ${city}.${ahead}`;
    if (pos.rank > before) return `Bajaste del puesto ${before} al ${pos.rank} en ${city}${pos.ahead ? `: te pasó ${pos.ahead.name}` : ''}.`;
    return `Seguís en el puesto ${pos.rank} de ${city}.${ahead}`;
  }
  if (pos.floor > 0 && nw > 0) return `Para entrar en la lista de ${city} te faltan ${money(pos.floor - nw)} (el puesto 100 tiene ${money(pos.floor)}).`;
  return null;
}

function nemesisLine(s: GameState, from: number): string | null {
  const id = s.saga?.rivalry?.nemesisId;
  if (!id) return null;
  const r = rivalById(s, id);
  if (!r) return null;
  const did = (s.saga?.chronicle ?? []).filter((c) => c.day >= from && c.kind === 'rival' && c.text.includes(r.name)).pop()
    ?? s.world.news.filter((n) => n.day >= from && n.ref?.rivalId === id).pop();
  if (did) return `${r.name}: ${did.title.replace(/\.$/, '')}.`;
  const war = (s.saga?.rivalry?.wars ?? []).find((w) => w.rivalId === id && w.until >= s.day);
  if (war) return `${r.name} sigue con la guerra de precios hasta el ${formatDate(war.until)}.`;
  return `${r.name}, tu némesis, no movió fichas este mes.`;
}

/** Proyección contra realidad: la de tus empresas si la hiciste; si no, contra el mes anterior. */
function planLine(s: GameState, from: number, result: Cents): string | null {
  for (const co of s.companies.filter((c) => isOpen(c) && c.forecast)) {
    const f = co.forecast!;
    const months = co.history.filter((h) => h.day > f.day);
    const i = months.length - 1;
    if (i < 0 || i >= f.revenue.length || months[i].day < from) continue;
    const real = months[i].revenue;
    const est = f.revenue[i][1];
    if (est <= 0) continue;
    const d = real / est - 1;
    return `${co.name} vendió ${money(real)}; proyectaste ${money(est)} (${d >= 0 ? '+' : ''}${fmtPct(d, 0)}).`;
  }
  const prev = [...s.history].reverse().find((h) => h.day < from);
  if (!prev) return null;
  const prevResult = prev.income - prev.expenses;
  const diff = result - prevResult;
  if (Math.abs(diff) < 100) return 'Te quedó lo mismo que el mes anterior.';
  return `Te quedaron ${money(Math.abs(diff))} ${diff > 0 ? 'más' : 'menos'} que el mes anterior.`;
}

/** Informe del mes que cierra hoy (null si hoy no es fin de mes). */
export function monthReport(s: GameState): MonthReport | null {
  if (!isLastDayOfMonth(s.day)) return null;
  const from = startOfMonth(s.day);
  const is = incomeStatement(s, from, s.day);
  const nw = balanceSheet(s).netWorth;
  const prev = [...s.history].reverse().find((h) => h.day < from);
  const change = prev ? nw - prev.netWorth : is.netResult;
  const result = is.grossIncome - is.totalExpensesBeforeTax - is.totalTaxes;
  const { headline, deck } = pickHeadline(s, from, change, is.grossIncome, result);
  const facts: MonthFact[] = [
    { label: 'Patrimonio', value: signed(change), tone: change > 0 ? 'gain' : change < 0 ? 'loss' : 'neutral' },
    { label: result >= 0 ? 'Te sobró' : 'Te faltó', value: money(Math.abs(result)), tone: result > 0 ? 'gain' : result < 0 ? 'loss' : 'neutral' },
    { label: 'Ingresos del mes', value: money(is.grossIncome), tone: 'neutral' },
  ];
  const decisions = agenda(s).filter((i) => i.due !== null && i.due >= s.day).slice(0, 2);
  return {
    day: s.day,
    month: formatMonthLong(s.day),
    headline,
    deck: deck && deck !== headline ? deck : null,
    facts,
    rank: rankLine(s, nw),
    nemesis: nemesisLine(s, from),
    vsPlan: planLine(s, from, result),
    decisions,
  };
}
