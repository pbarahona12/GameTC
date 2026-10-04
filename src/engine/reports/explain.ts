import type { GameState } from '../state';
import type { Cents } from '../money';
import { incomeStatement, balanceSheet } from './statements';
import { startOfMonth, dateOf, dayOf } from '../time/calendar';
import { fmtMoney } from '../format';

/**
 * EXPLICAR ESTE NÚMERO (1.4): por qué cambió tu patrimonio, en lenguaje simple y
 * desglosado desde el libro mayor. Solo un juego con contabilidad real puede
 * hacerlo sin inventar: cada línea es la suma de asientos verdaderos.
 *
 * Patrimonio al final = patrimonio al principio + ingresos − gastos − impuestos
 * (+ aportes o ajustes de capital, si los hubo). La diferencia que no explica el
 * estado de resultados se muestra aparte, nunca se esconde.
 */
export type ExplainPeriod = 'mes' | 'mes_pasado' | 'anio';

export interface ExplainItem {
  key: string;
  label: string;
  amount: Cents;
  kind: 'ingreso' | 'revalorizacion' | 'gasto' | 'impuesto' | 'otro';
  detail?: string;
}

export interface Explanation {
  from: number;
  to: number;
  start: Cents;
  end: Cents;
  change: Cents;
  items: ExplainItem[];
  /** Frase que resume el período. */
  summary: string;
}

const SALARY = new Set(['salary_income', 'bonus_income', 'benefits_income']);
const GROUP_LABEL: Record<string, string> = { living: 'Gastos de vida', financial: 'Intereses y comisiones', education: 'Educación', property: 'Mantenimiento de inmuebles', legal: 'Costos legales y multas', other: 'Otros gastos' };

function snapshotBefore(state: GameState, day: number) {
  return [...state.history].reverse().find((h) => h.day < day);
}

export function periodRange(state: GameState, p: ExplainPeriod): { from: number; to: number } {
  if (p === 'mes') return { from: startOfMonth(state.day), to: state.day };
  if (p === 'mes_pasado') {
    const thisStart = startOfMonth(state.day);
    const to = Math.max(0, thisStart - 1);
    return { from: startOfMonth(to), to };
  }
  const y = dateOf(state.day).y;
  return { from: Math.max(0, dayOf(y, 1, 1)), to: state.day };
}

export function explainNetWorth(state: GameState, p: ExplainPeriod): Explanation {
  const { from, to } = periodRange(state, p);
  const is = incomeStatement(state, from, to);
  const endSnap = to === state.day ? null : [...state.history].reverse().find((h) => h.day <= to);
  const end = endSnap ? endSnap.netWorth : balanceSheet(state).netWorth;
  const startSnap = snapshotBefore(state, from);
  const start = startSnap ? startSnap.netWorth : end - is.netResult;
  const items: ExplainItem[] = [];
  const salary = is.income.filter((l) => SALARY.has(l.account)).reduce((a, l) => a + l.amount, 0);
  if (salary) items.push({ key: 'salary', label: 'Sueldo y bonos', amount: salary, kind: 'ingreso' });
  for (const l of is.income) {
    if (SALARY.has(l.account) || l.account === 'unrealized_gains') continue;
    items.push({ key: l.account, label: l.name, amount: l.amount, kind: 'ingreso' });
  }
  if (is.unrealized) items.push({ key: 'unrealized', label: 'Revalorización de inversiones e inmuebles', amount: is.unrealized, kind: 'revalorizacion', detail: 'Subieron (o bajaron) de precio, pero no es dinero cobrado: cambia si vendés.' });
  const groups: Array<[string, typeof is.living]> = [['living', is.living], ['financial', is.financial], ['education', is.education], ['property', is.property], ['legal', is.legal], ['other', is.other]];
  for (const [g, ls] of groups) {
    const total = ls.reduce((a, l) => a + l.amount, 0);
    if (!total) continue;
    const top = [...ls].sort((a, b) => b.amount - a.amount).slice(0, 3).map((l) => `${l.name} ${fmtMoney(l.amount, { decimals: false })}`).join(' · ');
    items.push({ key: g, label: GROUP_LABEL[g], amount: -total, kind: 'gasto', detail: top });
  }
  if (is.totalTaxes) items.push({ key: 'taxes', label: 'Impuestos', amount: -is.totalTaxes, kind: 'impuesto', detail: is.taxes.map((l) => `${l.name} ${fmtMoney(l.amount, { decimals: false })}`).join(' · ') });
  const explained = items.reduce((a, x) => a + x.amount, 0);
  const rest = end - start - explained;
  if (Math.abs(rest) >= 100) items.push({ key: 'rest', label: 'Aportes y ajustes de capital', amount: rest, kind: 'otro', detail: 'Movimientos que no son ingresos ni gastos (por ejemplo, el saldo de apertura o correcciones del período anterior).' });
  items.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return { from, to, start, end, change: end - start, items, summary: summarize(end - start, items) };
}

function summarize(change: Cents, items: ExplainItem[]): string {
  const up = items.filter((x) => x.amount > 0);
  const down = items.filter((x) => x.amount < 0);
  const word = (x?: ExplainItem) => (x ? x.label.toLowerCase() : '');
  if (change === 0 && !items.length) return 'No hubo movimientos en este período.';
  const head = change >= 0 ? `Tu patrimonio subió ${fmtMoney(change, { decimals: false })}` : `Tu patrimonio bajó ${fmtMoney(-change, { decimals: false })}`;
  const parts: string[] = [];
  if (up[0]) parts.push(`lo que más sumó fue ${word(up[0])} (${fmtMoney(up[0].amount, { decimals: false })})`);
  if (down[0]) parts.push(`lo que más restó, ${word(down[0])} (${fmtMoney(-down[0].amount, { decimals: false })})`);
  return `${head}${parts.length ? `: ${parts.join('; ')}` : ''}.`;
}
