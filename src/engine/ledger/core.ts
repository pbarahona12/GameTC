import { Cents, isValidCents } from '../money';

/**
 * Núcleo genérico de libro mayor de partida doble.
 * Lo usan el libro personal y el libro de cada empresa, cada uno con su
 * propio plan de cuentas (`Chart`). Reglas idénticas para todos:
 *  - Σ Debe = Σ Haber, importes enteros en centavos, cuentas existentes.
 *  - Las cuentas `noNegative` nunca quedan en negativo.
 *  - Si el asiento es inválido, no se modifica nada.
 */
export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';
export type CashFlowClass = 'operating' | 'investing' | 'financing' | 'internal';

export interface AccountSpec {
  name: string;
  type: AccountType;
  cashEquivalent?: boolean;
  noNegative?: boolean;
  term?: string;
  group?: string;
}

export type Chart<A extends string> = Record<A, AccountSpec>;

export interface GLine<A extends string> {
  account: A;
  debit: Cents;
  credit: Cents;
}

export interface GEntry<A extends string> {
  id: number;
  day: number;
  memo: string;
  lines: GLine<A>[];
  cf: CashFlowClass;
  tag?: string;
}

export interface GLedger<A extends string> {
  entries: GEntry<A>[];
  balances: Record<A, Cents>;
  nextId: number;
  /**
   * Asientos antiguos resumidos (compactación, Fase 5). Cada balde agrupa un
   * mes: movimiento neto exacto por cuenta y flujo de efectivo por clase y
   * concepto. Los saldos NUNCA cambian por compactar: saldo = Σ baldes + Σ asientos.
   */
  archive?: GArchive<A>;
}

export interface GBucket<A extends string> {
  /** Clave del mes (año·12 + mes). */
  key: number;
  /** Primer y último día con asientos dentro del balde. */
  from: number;
  to: number;
  n: number;
  totals: Partial<Record<A, Cents>>;
  /** Flujo de efectivo: neto por clase → concepto, y entradas/salidas brutas. */
  cash: Partial<Record<CashFlowClass, Record<string, Cents>>>;
  cashIn: Cents;
  cashOut: Cents;
}

export interface GArchive<A extends string> {
  /** Todos los asientos con día < `before` están resumidos. */
  before: number;
  buckets: GBucket<A>[];
  entries: number;
}

export interface GPostInput<A extends string> {
  day: number;
  memo: string;
  cf: CashFlowClass;
  tag?: string;
  lines: Array<{ account: A; debit?: Cents; credit?: Cents }>;
}

export class LedgerError extends Error {}

export function emptyGLedger<A extends string>(chart: Chart<A>): GLedger<A> {
  const balances = {} as Record<A, Cents>;
  for (const id of Object.keys(chart) as A[]) balances[id] = 0;
  return { entries: [], balances, nextId: 1 };
}

export function gSigned<A extends string>(chart: Chart<A>, account: A, debit: Cents, credit: Cents): Cents {
  const t = chart[account].type;
  return t === 'asset' || t === 'expense' ? debit - credit : credit - debit;
}

export function gValidate<A extends string>(chart: Chart<A>, ledger: GLedger<A>, input: GPostInput<A>): string | null {
  if (input.lines.length < 2) return 'Un asiento necesita al menos dos líneas.';
  let dr = 0;
  let cr = 0;
  const deltas = new Map<A, Cents>();
  for (const l of input.lines) {
    if (!(l.account in chart)) return `Cuenta inexistente: ${String(l.account)}`;
    const debit = l.debit ?? 0;
    const credit = l.credit ?? 0;
    if (!isValidCents(debit) || !isValidCents(credit)) return 'Importe no entero en centavos.';
    if (debit < 0 || credit < 0) return 'Importes negativos no permitidos en una línea.';
    if (debit > 0 && credit > 0) return 'Una línea no puede tener Debe y Haber a la vez.';
    dr += debit;
    cr += credit;
    deltas.set(l.account, (deltas.get(l.account) ?? 0) + gSigned(chart, l.account, debit, credit));
  }
  if (dr !== cr) return `El asiento no cuadra (Debe ${dr} ≠ Haber ${cr}).`;
  if (dr === 0) return 'Asiento de importe cero.';
  for (const [acc, delta] of deltas) {
    const def = chart[acc];
    if (def.noNegative && ledger.balances[acc] + delta < 0) return `Saldo insuficiente en ${def.name}.`;
  }
  return null;
}

export function gPost<A extends string>(chart: Chart<A>, ledger: GLedger<A>, input: GPostInput<A>): GEntry<A> {
  const err = gValidate(chart, ledger, input);
  if (err) throw new LedgerError(err);
  const lines: GLine<A>[] = input.lines
    .map((l) => ({ account: l.account, debit: l.debit ?? 0, credit: l.credit ?? 0 }))
    .filter((l) => l.debit !== 0 || l.credit !== 0);
  for (const l of lines) ledger.balances[l.account] += gSigned(chart, l.account, l.debit, l.credit);
  const entry: GEntry<A> = { id: ledger.nextId++, day: input.day, memo: input.memo, lines, cf: input.cf, tag: input.tag };
  ledger.entries.push(entry);
  return entry;
}

export function gRecompute<A extends string>(chart: Chart<A>, entries: GEntry<A>[]): Record<A, Cents> {
  const b = {} as Record<A, Cents>;
  for (const id of Object.keys(chart) as A[]) b[id] = 0;
  for (const e of entries) for (const l of e.lines) b[l.account] = (b[l.account] ?? 0) + gSigned(chart, l.account, l.debit, l.credit);
  return b;
}

export function gEntryDelta<A extends string>(chart: Chart<A>, e: GEntry<A>, account: A): Cents {
  let d = 0;
  for (const l of e.lines) if (l.account === account) d += gSigned(chart, account, l.debit, l.credit);
  return d;
}

/**
 * Fracción de un balde que cae dentro de [from, to] y antes de `from`.
 * Si la consulta cubre todo el balde es exacta; si lo corta, se prorratea
 * por días (aproximación documentada para consultas sobre períodos antiguos).
 */
export function gBucketShare(b: { from: number; to: number }, from: number, to: number): { inside: number; before: number } {
  const len = b.to - b.from + 1;
  const ov = (a: number, z: number) => Math.max(0, Math.min(z, b.to) - Math.max(a, b.from) + 1) / len;
  return { inside: ov(from, to), before: ov(-Infinity, from - 1) };
}

/** Saldos acumulados en los baldes (saldo de apertura de los asientos vigentes). */
export function gArchiveOpening<A extends string>(chart: Chart<A>, ledger: GLedger<A>): Record<A, Cents> {
  const o = {} as Record<A, Cents>;
  for (const id of Object.keys(chart) as A[]) o[id] = 0;
  for (const b of ledger.archive?.buckets ?? []) for (const [k, v] of Object.entries(b.totals) as Array<[A, Cents]>) o[k] = (o[k] ?? 0) + v;
  return o;
}

/**
 * Compacta los asientos con día < `before` en baldes mensuales. Conserva los
 * saldos exactos y el flujo de efectivo por concepto. Devuelve cuántos asientos resumió.
 */
export function gCompact<A extends string>(
  chart: Chart<A>, ledger: GLedger<A>, before: number, monthKey: (day: number) => number,
  cashOf: (e: GEntry<A>) => { delta: Cents; label: string },
): number {
  const idx = ledger.entries.findIndex((e) => e.day >= before);
  const cut = idx < 0 ? ledger.entries.length : idx;
  if (cut === 0) return 0;
  const old = ledger.entries.slice(0, cut);
  // Copia al escribir: el archivo anterior y sus baldes NUNCA se modifican. Así las
  // instantáneas de cada día (snapshot.ts) lo comparten en lugar de copiarlo.
  const prev = ledger.archive;
  const arch: GArchive<A> = prev ? { ...prev, buckets: prev.buckets.slice() } : { before: 0, buckets: [], entries: 0 };
  const mine = new Set<GBucket<A>>();
  const own = (b: GBucket<A>): GBucket<A> => {
    if (mine.has(b)) return b;
    const c: GBucket<A> = { ...b, totals: { ...b.totals }, cash: Object.fromEntries(Object.entries(b.cash).map(([k, v]) => [k, { ...v }])) };
    arch.buckets[arch.buckets.indexOf(b)] = c;
    mine.add(c);
    return c;
  };
  for (const e of old) {
    const key = monthKey(e.day);
    let b = arch.buckets[arch.buckets.length - 1];
    if (!b || b.key !== key) {
      b = arch.buckets.find((x) => x.key === key) as GBucket<A>;
      if (!b) {
        b = { key, from: e.day, to: e.day, n: 0, totals: {}, cash: {}, cashIn: 0, cashOut: 0 };
        arch.buckets.push(b);
        mine.add(b);
      }
    }
    b = own(b);
    b.from = Math.min(b.from, e.day);
    b.to = Math.max(b.to, e.day);
    b.n++;
    for (const l of e.lines) b.totals[l.account] = (b.totals[l.account] ?? 0) + gSigned(chart, l.account, l.debit, l.credit);
    const c = cashOf(e);
    if (c.delta !== 0) {
      const g = (b.cash[e.cf] ??= {});
      g[c.label] = (g[c.label] ?? 0) + c.delta;
      if (c.delta > 0) b.cashIn += c.delta;
      else b.cashOut -= c.delta;
    }
  }
  arch.buckets.sort((a, z) => a.key - z.key);
  arch.before = Math.max(arch.before, before);
  arch.entries += old.length;
  ledger.archive = arch;
  ledger.entries = ledger.entries.slice(cut);
  return old.length;
}

/** Movimiento neto por cuenta entre dos días (inclusive), incluyendo los baldes compactados. */
export function gPeriodTotals<A extends string>(chart: Chart<A>, ledger: GLedger<A>, from: number, to: number): Record<A, Cents> {
  const t = {} as Record<A, Cents>;
  for (const id of Object.keys(chart) as A[]) t[id] = 0;
  if (ledger.archive && from < ledger.archive.before) {
    for (const b of ledger.archive.buckets) {
      const { inside } = gBucketShare(b, from, to);
      if (inside <= 0) continue;
      for (const [k, v] of Object.entries(b.totals) as Array<[A, Cents]>) t[k] += inside >= 1 ? v : Math.round(v * inside);
    }
  }
  for (const e of ledger.entries) {
    if (e.day < from) continue;
    if (e.day > to) break;
    for (const l of e.lines) t[l.account] += gSigned(chart, l.account, l.debit, l.credit);
  }
  return t;
}

/** Errores de integridad de un libro: asientos descuadrados, saldos que no coinciden, negativos. */
export function gAudit<A extends string>(chart: Chart<A>, ledger: GLedger<A>, label: string): string[] {
  const errors: string[] = [];
  for (const e of ledger.entries) {
    let dr = 0;
    let cr = 0;
    for (const l of e.lines) {
      if (!Number.isSafeInteger(l.debit) || !Number.isSafeInteger(l.credit)) errors.push(`${label} asiento ${e.id}: importe no entero.`);
      dr += l.debit;
      cr += l.credit;
    }
    if (dr !== cr) errors.push(`${label} asiento ${e.id} descuadrado.`);
    if (errors.length > 20) return errors;
  }
  const r = gRecompute(chart, ledger.entries);
  const open = gArchiveOpening(chart, ledger);
  for (const id of Object.keys(chart) as A[]) r[id] += open[id];
  for (const id of Object.keys(chart) as A[]) {
    if (r[id] !== ledger.balances[id]) errors.push(`${label}: saldo de ${chart[id].name} no coincide con el libro.`);
    if (chart[id].noNegative && ledger.balances[id] < 0) errors.push(`${label}: ${chart[id].name} en negativo.`);
  }
  let assets = 0;
  let rhs = 0;
  for (const id of Object.keys(chart) as A[]) {
    const t = chart[id].type;
    const b = ledger.balances[id];
    if (t === 'asset') assets += b;
    else if (t === 'expense') rhs -= b;
    else rhs += b;
  }
  if (assets !== rhs) errors.push(`${label}: ecuación contable rota (activo ${assets} ≠ ${rhs}).`);
  return errors;
}
