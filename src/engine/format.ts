import type { Cents } from './money';

/**
 * Configuración regional ÚNICA de los números del juego: coma para miles y
 * punto para decimales ($150,000.00 · 12.5 %). Los campos de entrada aceptan ese
 * mismo formato (ver `parseDecimal`).
 */
export const NUMBER_LOCALE = 'en-US';

const groupers = new Map<number, Intl.NumberFormat>();
function grouper(decimals: number): Intl.NumberFormat {
  let f = groupers.get(decimals);
  if (!f) {
    f = new Intl.NumberFormat(NUMBER_LOCALE, { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: true });
    groupers.set(decimals, f);
  }
  return f;
}

/** Número con separador de miles: 1,234 · 1,234.5 (con `decimals`). */
export function fmtNumber(n: number, decimals = 0): string {
  return grouper(decimals).format(n).replace('-', '−');
}

/** Formato monetario consistente en todo el juego: $1,234.56 (negativos: −$1,234.56). */
export function fmtMoney(c: Cents, opts: { decimals?: boolean; sign?: boolean } = {}): string {
  const decimals = opts.decimals ?? true;
  c = Math.round(c);
  const neg = c < 0;
  const abs = Math.abs(c);
  const whole = Math.floor(abs / 100);
  const cents = abs % 100;
  const w = grouper(0).format(whole);
  const body = decimals ? `${w}.${cents.toString().padStart(2, '0')}` : w;
  const sign = neg ? '−' : opts.sign && c > 0 ? '+' : '';
  return `${sign}$${body}`;
}

/** Texto con el que un campo de montos muestra un valor: "150,000" o "150,000.50" (sin "$"). */
export function fmtAmountInput(c: Cents): string {
  if (!c) return '';
  const body = fmtMoney(Math.abs(c), { decimals: c % 100 !== 0 }).slice(1);
  return c < 0 ? `-${body}` : body;
}

// ------------------------------------------------------------------ lectura de números

/** Resultado en unidades enteras: `units` = valor × 10^decimales (centavos si decimales = 2). */
export type UnitsResult = { ok: true; units: number | null } | { ok: false; error: string };

/**
 * ÚNICO lector de números escritos por el jugador (montos y cantidades).
 *
 * Reglas, sin ambigüedad:
 *  - Se aceptan dígitos, "$" inicial, espacios y separadores "," y ".".
 *  - Un separador seguido de exactamente 3 dígitos separa MILES; el último
 *    separador seguido de 1 o 2 dígitos (o de nada, mientras se escribe) es el
 *    DECIMAL. Ningún monto tiene más de 2 decimales, así que no hay otra lectura:
 *      150 → 150 · 1,500 → 1500 · 150,000 → 150000 · 150.000 → 150000 ·
 *      150000 → 150000 · 1,500.50 → 1500.5 · 1.500,50 → 1500.5 · 12,5 → 12.5
 *  - Los separadores de miles deben ser todos iguales y distintos del decimal,
 *    con grupos de 3 dígitos. Si no, es un error con explicación
 *    (por ejemplo "1,500,50", "1.5.6" o "10.1234").
 *  - Vacío → `units: null` (el campo todavía no tiene valor).
 *
 * `maxDecimals`: 2 para dinero (devuelve centavos), 0 para unidades enteras.
 * Todo se calcula con enteros: no hay errores de coma flotante.
 */
export function parseUnits(text: string, maxDecimals = 2): UnitsResult {
  const raw = text.replace(/[\s\u00a0\u202f]/g, '').replace(/^\$/, '');
  if (!raw) return { ok: true, units: null };
  if (raw.startsWith('-')) return { ok: false, error: 'No se admiten números negativos.' };
  if (!/^[0-9.,]+$/.test(raw)) return { ok: false, error: 'Usá solo números, coma para los miles y punto para los decimales.' };
  const seps = [...raw].map((ch, i) => (ch === ',' || ch === '.' ? i : -1)).filter((i) => i >= 0);
  if (!seps.length) return finish(raw, '', maxDecimals);
  const last = seps[seps.length - 1];
  const tail = raw.slice(last + 1);
  if (tail.length === 3) {
    // Todos los separadores son de miles.
    const digits = groupedDigits(raw, raw[last]);
    return digits === null ? { ok: false, error: badGroups(raw) } : finish(digits, '', maxDecimals);
  }
  if (tail.length <= 2) {
    const decimalChar = raw[last];
    const intPart = raw.slice(0, last);
    if (tail.length > maxDecimals) return { ok: false, error: maxDecimals ? `Como máximo ${maxDecimals} decimales.` : 'Solo números enteros.' };
    if (intPart.includes(decimalChar)) return { ok: false, error: `El "${decimalChar}" aparece como separador de miles y como decimal. Escribí, por ejemplo, 1,500.50.` };
    const thousands = intPart.includes(',') ? ',' : intPart.includes('.') ? '.' : null;
    const digits = thousands ? groupedDigits(intPart, thousands) : intPart || '0';
    if (digits === null) return { ok: false, error: badGroups(intPart) };
    return finish(digits, tail, maxDecimals);
  }
  return { ok: false, error: `No se entiende "${text.trim()}": después de un separador van 3 dígitos (miles) o hasta 2 (decimales).` };
}

function badGroups(s: string): string {
  return `No se entiende "${s}": los miles van de a 3 dígitos con el mismo separador (por ejemplo 1,500,000).`;
}

/** Dígitos de un entero con separador de miles, o null si los grupos no son válidos. */
function groupedDigits(s: string, sep: string): string | null {
  const other = sep === ',' ? '.' : ',';
  if (s.includes(other)) return null;
  const groups = s.split(sep);
  // Un primer grupo que empieza con 0 ("0.755", "0,500") no es una cifra de miles válida.
  if (!groups[0] || groups[0].length > 3 || groups[0].startsWith('0') || groups.slice(1).some((g) => g.length !== 3)) return null;
  return groups.join('');
}

function finish(intDigits: string, decDigits: string, maxDecimals: number): UnitsResult {
  const units = Number(intDigits + decDigits.padEnd(maxDecimals, '0'));
  if (!Number.isSafeInteger(units)) return { ok: false, error: 'El número es demasiado grande.' };
  return { ok: true, units };
}

/** Monto escrito por el jugador → centavos exactos (`cents: null` si está vacío). */
export function parseMoney(text: string): { ok: true; cents: Cents | null } | { ok: false; error: string } {
  const r = parseUnits(text, 2);
  return r.ok ? { ok: true, cents: r.units } : r;
}

/** Cantidad escrita por el jugador (unidades, días, porcentajes) con hasta `decimals` decimales. */
export function parseQuantity(text: string, decimals = 0): { ok: true; value: number | null } | { ok: false; error: string } {
  const r = parseUnits(text, decimals);
  if (!r.ok) return r;
  return { ok: true, value: r.units === null ? null : r.units / 10 ** decimals };
}

/** Formato compacto para cifras grandes: $12.4K, $3.20M, $1.05B. */
export function fmtCompact(c: Cents, opts: { sign?: boolean } = {}): string {
  const v = c / 100;
  const a = Math.abs(v);
  const s = v < 0 ? '−' : opts.sign && v > 0 ? '+' : '';
  if (a >= 1e15) return `${s}$${grouper(0).format(Math.round(a / 1e12))}T`;
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(2)}M`;
  if (a >= 1e4) return `${s}$${(a / 1e3).toFixed(1)}K`;
  return fmtMoney(c, { decimals: a > 0 && a < 1000, sign: opts.sign });
}

/**
 * Monto completo si entra en `max` caracteres; si no, abreviado ($9.50B, $1.20T).
 * Para filas, celdas y barras donde un número enorme no puede empujar al resto.
 */
export function fmtMoneyFit(c: Cents, opts: { decimals?: boolean; sign?: boolean; max?: number } = {}): string {
  const full = fmtMoney(c, opts);
  return full.length <= (opts.max ?? 12) ? full : fmtCompact(c, { sign: opts.sign });
}

export function fmtPct(rate: number, digits = 1): string {
  const v = rate * 100;
  // Porcentajes enormes (una inversión que se multiplicó 100 veces) con separador de miles y sin decimales.
  if (Math.abs(v) >= 1000) return `${grouper(0).format(Math.round(v)).replace('-', '−')} %`;
  // Sin ceros de más ("4.50 %" → "4.5 %", "3.0 %" → "3 %") y con el mismo signo menos que el dinero.
  const txt = v.toFixed(digits).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return `${txt === '-0' ? '0' : txt.replace('-', '−')} %`;
}
