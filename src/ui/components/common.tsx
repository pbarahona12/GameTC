import { Icon, isIconName, IconName } from '../icons';
import { ReactNode, createContext, useContext, useEffect, useId, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import type { Cents } from '../../engine/money';
import { fmtMoney, fmtMoneyFit, fmtCompact, fmtAmountInput, fmtNumber, parseMoney, parseQuantity } from '../../engine/format';
import { GLOSSARY_BY_ID } from '../../content/glossary';
import { navStore } from '../nav';
import { useUI } from '../store';

/** Monto. `fit`: abrevia si el número completo pasa de 12 caracteres (filas y celdas angostas). */
export function Money({ c, compact, sign, colored, fit, className = '' }: { c: Cents; compact?: boolean; sign?: boolean; colored?: boolean; fit?: boolean; className?: string }) {
  const cls = colored ? (c > 0 ? 'gain' : c < 0 ? 'loss' : '') : '';
  const arrow = colored && c !== 0 ? (c > 0 ? '▲ ' : '▼ ') : '';
  const text = compact ? fmtCompact(c, { sign }) : fit ? fmtMoneyFit(c, { sign }) : fmtMoney(c, { sign });
  const full = fmtMoney(c, { sign });
  return <span className={`num ${cls} ${className}`} title={text !== full ? full : undefined} aria-label={text !== full ? full : undefined}>{arrow}{text}</span>;
}

/**
 * Cifra principal de una tarjeta: muestra el monto completo y achica la letra según
 * su largo para que nunca se salga de la pantalla (la tipografía es monoespaciada).
 */
export function BigAmount({ c, className = '' }: { c: Cents; className?: string }) {
  const { value, flash } = useCountUp(c);
  const final = fmtMoney(c);
  const text = fmtMoney(value);
  // El largo se fija con el valor final: la letra no "salta" mientras la cifra cuenta.
  return <div className={`big big-fit ${flash ? `flash-${flash}` : ''} ${className}`} style={{ ['--chars' as string]: final.length }} aria-label={text !== final ? final : undefined}>{text}</div>;
}

export function prefersReducedMotion(): boolean {
  if (typeof document === 'undefined') return true;
  if (document.documentElement.getAttribute('data-motion') === 'reduce') return true;
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Cifra que cuenta hasta su nuevo valor (1.4): el progreso se SIENTE. En el primer
 * dibujo muestra el valor final; respeta "Reducir animaciones".
 */
export function useCountUp(target: number, ms = 650): { value: number; flash: 'up' | 'down' | null } {
  const [value, setValue] = useState(target);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);
  const prev = useRef(target);
  useEffect(() => {
    const from = prev.current;
    prev.current = target;
    if (from === target) return;
    const big = Math.abs(target - from) >= Math.max(100, Math.abs(from) * 0.01);
    if (big) setFlash(target > from ? 'up' : 'down');
    const done = setTimeout(() => setFlash(null), 900);
    if (prefersReducedMotion() || typeof requestAnimationFrame === 'undefined') {
      setValue(target);
      return () => clearTimeout(done);
    }
    let raf = 0;
    const start = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      setValue(Math.round(from + (target - from) * e));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(done);
      setValue(target);
    };
  }, [target, ms]);
  return { value, flash };
}

/**
 * PUNTOS DE "CONCEPTO NUEVO": como mucho unos pocos por pantalla, para que no le
 * roben la atención a las acciones reales (el dorado es también el color de la
 * acción principal). Cada pantalla y cada hoja tiene su propio cupo; los primeros
 * conceptos sin ver (en orden de aparición) llevan el punto y el resto, la ayuda neutra.
 */
const MAX_DOTS = 3;
const DotApi = createContext<{ add(id: string): void; remove(id: string): void } | null>(null);
const DotOrder = createContext<string[]>([]);

export function DotBudget({ children }: { children: ReactNode }) {
  const [order, setOrder] = useState<string[]>([]);
  const api = useMemo(() => ({
    add: (id: string) => setOrder((o) => (o.includes(id) ? o : [...o, id])),
    remove: (id: string) => setOrder((o) => o.filter((x) => x !== id)),
  }), []);
  return <DotApi.Provider value={api}><DotOrder.Provider value={order}>{children}</DotOrder.Provider></DotApi.Provider>;
}

function useNewDot(want: boolean): boolean {
  const api = useContext(DotApi);
  const order = useContext(DotOrder);
  const id = useId();
  useEffect(() => {
    if (!api || !want) return;
    api.add(id);
    return () => api.remove(id);
  }, [api, want, id]);
  if (!api) return want;
  const i = order.indexOf(id);
  return want && i >= 0 && i < MAX_DOTS;
}

export function InfoButton({ term, label }: { term: string; label?: string }) {
  const ui = useUI();
  const seen = !!ui.state?.meta.seenTerms.includes(term);
  const dot = useNewDot(!seen && !!GLOSSARY_BY_ID[term]);
  if (!GLOSSARY_BY_ID[term]) return null;
  return (
    <button
      type="button"
      className={`info-btn ${dot ? 'new' : ''}`}
      aria-label={`Qué significa ${label ?? GLOSSARY_BY_ID[term].term}`}
      onClick={(e) => {
        e.stopPropagation();
        navStore.open({ kind: 'term', id: term });
      }}
    >
      i
    </button>
  );
}

/** Explicación breve en línea visible con el modo aprendizaje activado. */
export function Learn({ term }: { term: string }) {
  const ui = useUI();
  const g = GLOSSARY_BY_ID[term];
  if (!ui.settings.learningMode || !g) return null;
  return <p className="learn">{g.short}</p>;
}

export function Stat({ label, term, value, sub, learn }: { label: string; term?: string; value: ReactNode; sub?: ReactNode; learn?: boolean }) {
  return (
    <div className="stat">
      <div className="label">
        <span>{label}</span>
        {term && <InfoButton term={term} label={label} />}
      </div>
      <div className="value">{value}</div>
      {sub && <div className="sub">{sub}</div>}
      {learn && term && <Learn term={term} />}
    </div>
  );
}

export function Bar({ value, tone, label }: { value: number; tone?: 'gain' | 'loss' | 'warn'; label?: string }) {
  const w = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className={`bar ${tone ?? ''}`} role="progressbar" aria-label={label} aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${w}%` }} />
    </div>
  );
}

export function Pill({ tone, children }: { tone: 'gain' | 'loss' | 'warn' | 'info' | 'neutral' | 'accent'; children: ReactNode }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

/**
 * Indicador de "hay más pestañas": marca el contenedor cuando se puede desplazar
 * hacia un lado (el CSS dibuja un degradado y una flecha) y lleva la pestaña
 * activa a la vista.
 */
function useOverflowHint(dep: unknown) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const left = el.scrollLeft > 4;
      const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 4;
      setEdges((e) => (e.left === left && e.right === right ? e : { left, right }));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', update);
      ro?.disconnect();
    };
  }, []);
  useEffect(() => {
    const el = ref.current;
    const on = el?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!el || !on || typeof on.scrollIntoView !== 'function') return;
    const r = on.getBoundingClientRect();
    const c = el.getBoundingClientRect();
    if (r.left < c.left || r.right > c.right) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }, [dep]);
  return { ref, edges };
}

export function Tabs<T extends string>({ items, value, onChange, label }: { items: Array<{ id: T; label: string; icon?: IconName; badge?: number }>; value: T; onChange: (v: T) => void; label?: string }) {
  const { ref, edges } = useOverflowHint(value);
  return (
    <div className={`tabs-wrap ${edges.left ? 'more-left' : ''} ${edges.right ? 'more-right' : ''}`}>
      <div className="tabs" role="tablist" aria-label={label} ref={ref}>
        {items.map((it) => (
          <button key={it.id} role="tab" aria-selected={value === it.id} className={value === it.id ? 'on' : ''} onClick={() => onChange(it.id)}>
            {it.icon && <Icon name={it.icon} size={15} />}{it.label}{it.badge ? <span className="count-badge sm">{it.badge}</span> : null}
          </button>
        ))}
      </div>
      {edges.right && <span className="tabs-more" aria-hidden><Icon name="chevron" size={16} /></span>}
    </div>
  );
}

export interface TabGroup<T extends string> {
  id: string;
  label: string;
  icon?: IconName;
  items: Array<{ id: T; label: string; badge?: number }>;
}

/**
 * Pestañas en dos niveles: grupos arriba y, si el grupo tiene varias secciones,
 * una fila de subsecciones. Las rutas no cambian (cada subsección conserva su id).
 */
export function GroupedTabs<T extends string>({ groups, value, onChange, label }: { groups: Array<TabGroup<T>>; value: T; onChange: (v: T) => void; label?: string }) {
  const current = groups.find((g) => g.items.some((i) => i.id === value)) ?? groups[0];
  const badge = (g: TabGroup<T>) => g.items.reduce((n, i) => n + (i.badge ?? 0), 0) || undefined;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <Tabs items={groups.map((g) => ({ id: g.id, label: g.label, icon: g.icon, badge: badge(g) }))} value={current.id} label={label} onChange={(id) => {
        const g = groups.find((x) => x.id === id);
        if (g && g.id !== current.id) onChange(g.items[0].id);
      }} />
      {current.items.length > 1 && (
        <div className="subtabs" role="tablist" aria-label={current.label}>
          {current.items.map((it) => (
            <button key={it.id} type="button" role="tab" aria-selected={value === it.id} className={value === it.id ? 'on' : ''} onClick={() => onChange(it.id)}>
              {it.label}{it.badge ? <span className="count-badge sm">{it.badge}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Seg<T extends string | number>({ items, value, onChange }: { items: Array<{ id: T; label: string }>; value: T; onChange: (v: T) => void }) {
  return (
    <div className="seg">
      {items.map((it) => (
        <button key={String(it.id)} className={value === it.id ? 'on' : ''} aria-pressed={value === it.id} onClick={() => onChange(it.id)} type="button">
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** Esqueleto mientras se carga una pestaña (en lugar de un «Cargando…» suelto). */
export function ScreenSkeleton() {
  return (
    <div className="skeleton-screen" role="status" aria-label="Cargando la sección">
      <div className="sk sk-title" />
      <div className="sk sk-card" />
      <div className="sk sk-row" />
      <div className="sk sk-row" />
    </div>
  );
}

/** ¿Esta hoja es la de arriba de la pila? (las de abajo quedan montadas pero ocultas). */
const SheetTop = createContext(true);

export function SheetLayer({ top, children }: { top: boolean; children: ReactNode }) {
  return <SheetTop.Provider value={top}>{children}</SheetTop.Provider>;
}

export function Sheet({ title, children, onClose }: { title: ReactNode; children: ReactNode; onClose?: () => void }) {
  const top = useContext(SheetTop);
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });
  // Solo la hoja de arriba responde a Escape y se lleva el foco; al cerrarse, el foco
  // vuelve a donde estaba (el botón que la abrió o la hoja de abajo).
  useEffect(() => {
    if (!top) return;
    const prev = document.activeElement as HTMLElement | null;
    box.current?.focus();
    const k = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      (closeRef.current ?? (() => navStore.close()))();
    };
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('keydown', k);
      if (prev && document.contains(prev)) prev.focus();
    };
  }, [top]);
  const close = () => (onClose ?? (() => navStore.close()))();
  return (
    <div className="sheet-backdrop" hidden={!top} onClick={close}>
      <div ref={box} className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-grip" aria-hidden />
        <div className="sheet-head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-btn" onClick={close} aria-label="Cerrar"><Icon name="close" /></button>
        </div>
        <div className="sheet-body"><DotBudget>{children}</DotBudget></div>
      </div>
    </div>
  );
}

/**
 * Entrada de montos. Usa el lector único (`parseMoney`): lo que el jugador
 * escribe se guarda como borrador local y debajo se muestra el valor que el
 * juego entendió. `onChange` recibe centavos; un campo vacío o inválido
 * informa 0 (los botones que dependen del monto deben exigir un valor > 0).
 */
export function AmountInput({ id, value, onChange, max, placeholder, label }: { id: string; value: Cents; onChange: (c: Cents) => void; max?: Cents; placeholder?: string; label?: string }) {
  const [text, setText] = useState(() => fmtAmountInput(value));
  const [focused, setFocused] = useState(false);
  // Último valor que este campo informó: si el padre cambia el valor por su cuenta
  // (por ejemplo con un botón de 50 %), el texto se actualiza; si no, se respeta lo escrito.
  const emitted = useRef<Cents>(value);
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setText(fmtAmountInput(value));
    }
  }, [value]);
  const change = (t: string) => {
    setText(t);
    const r = parseMoney(t);
    const c = r.ok ? r.cents ?? 0 : 0;
    emitted.current = c;
    onChange(c);
  };
  const parsed = parseMoney(text);
  const canonical = parsed.ok && parsed.cents !== null && text === fmtAmountInput(parsed.cents);
  const hintId = `${id}-hint`;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <input
        id={id}
        className="input money"
        inputMode="decimal"
        autoComplete="off"
        aria-label={label}
        aria-invalid={!parsed.ok}
        aria-describedby={hintId}
        placeholder={placeholder ?? '0.00'}
        value={text}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          // Al salir del campo se muestra el valor ya normalizado ("150000" → "150,000").
          if (parsed.ok && parsed.cents !== null) setText(fmtAmountInput(parsed.cents));
        }}
        onChange={(e) => change(e.target.value)}
      />
      <span id={hintId} className="amount-hint" aria-live="polite">
        {!parsed.ok ? <span className="tiny loss">{parsed.error}</span>
          : parsed.cents !== null && (focused || !canonical) ? <span className="tiny muted">Valor interpretado: <strong className="num">{fmtMoney(parsed.cents)}</strong></span>
          : null}
      </span>
      {max !== undefined && max > 0 && (
        <div className="chips">
          {[0.25, 0.5, 1].map((f) => {
            // «Todo» es exacto, con centavos (pagar $123 de $123.45 deja saldo y cobra intereses).
            const amt = f === 1 ? max : Math.floor((max * f) / 100) * 100 || max;
            return (
              <button key={f} type="button" onClick={() => change(fmtAmountInput(amt))}>
                {f === 1 ? 'Todo' : `${f * 100} %`} · {fmtMoney(amt, { decimals: f === 1 && amt % 100 !== 0 })}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function Empty({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <div className="empty">
      <div className="ic" aria-hidden><Icon name={icon} size={26} /></div>
      <div>{children}</div>
    </div>
  );
}

/** Confirmación inline para operaciones importantes (sin diálogos del navegador). */
export function ConfirmButton({ label, confirmLabel, onConfirm, className = 'btn', detail, disabled, help }: { label: string; confirmLabel?: string; onConfirm: () => void; className?: string; detail?: ReactNode; disabled?: boolean; help?: string }) {
  const [armed, setArmed] = useState(false);
  if (!armed) {
    const btn = <button className={className} disabled={disabled} onClick={() => setArmed(true)}>{label}</button>;
    return help ? <span className="act">{btn}<InfoButton term={help} /></span> : btn;
  }
  return (
    <div className="card flat" style={{ padding: 12, gap: 8 }}>
      {detail && <div className="small">{detail}</div>}
      <div className="btn-row">
        <button className="btn sm ghost" onClick={() => setArmed(false)}>Cancelar</button>
        <button className="btn sm dark" onClick={() => { setArmed(false); onConfirm(); }}>{confirmLabel ?? 'Confirmar'}</button>
      </div>
    </div>
  );
}

export interface Series {
  name: string;
  values: number[];
  color: string;
  dashed?: boolean;
}

/** Escala vertical de un gráfico: incluye el cero y deja aire arriba (y abajo si hay negativos). */
function chartScale(all: number[]): { min: number; max: number; ticks: number[] } {
  let lo = Math.min(0, ...all);
  let hi = Math.max(...all, 1);
  if (hi === lo) hi = lo + 1;
  const span = hi - lo;
  if (lo < 0) lo -= span * 0.05;
  hi += span * 0.08;
  return { min: lo, max: hi, ticks: [0, 0.5, 1].map((f) => lo + (hi - lo) * f) };
}

/**
 * Gráfico de líneas SVG propio (liviano, sin dependencias). Al tocar o pasar
 * el dedo muestra una línea guía con el valor de cada serie en ese punto.
 */
/** Resumen del gráfico para lectores de pantalla: inicio, fin, mínimo y máximo de cada serie. */
function chartSummary(series: Series[], format: (v: number) => string, pointLabels?: string[]): string {
  const span = pointLabels && pointLabels.length > 1 ? ` (${pointLabels[0]} a ${pointLabels[pointLabels.length - 1]})` : '';
  return series
    .filter((s) => s.values.length)
    .map((s) => `${s.name}${span}: empieza en ${format(s.values[0])} y termina en ${format(s.values[s.values.length - 1])}; mínimo ${format(Math.min(...s.values))}, máximo ${format(Math.max(...s.values))}`)
    .join('. ');
}

export function LineChart({ series, labels, pointLabels, height = 150, format = (v: number) => fmtCompact(v) }: { series: Series[]; labels?: string[]; pointLabels?: string[]; height?: number; format?: (v: number) => string }) {
  const W = 340;
  const H = height;
  const padL = 46, padR = 8, padT = 10, padB = labels ? 20 : 8;
  const all = series.flatMap((s) => s.values);
  const [hover, setHover] = useState<number | null>(null);
  const { min, max, ticks } = chartScale(all);
  const n = Math.max(...series.map((s) => s.values.length));
  if (n < 2) return <Empty icon="reports">El gráfico aparece después del primer cierre de mes.</Empty>;
  const x = (i: number) => padL + (i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
  const pick = (e: RPointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(n - 1, Math.round(((px - padL) / (W - padL - padR)) * (n - 1)))));
  };
  const tipW = 150;
  const tipX = hover !== null ? Math.min(W - tipW - 2, Math.max(padL, x(hover) - tipW / 2)) : 0;
  const rows = hover !== null ? series.filter((s) => s.values[hover] !== undefined) : [];
  return (
    <svg className="chart touch" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={chartSummary(series, format, pointLabels)}
      onPointerMove={pick} onPointerDown={pick} onPointerLeave={() => setHover(null)}>
      {ticks.map((t, i) => (
        <g key={i}>
          <line className="grid" x1={padL} x2={W - padR} y1={y(t)} y2={y(t)} />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end">{format(t)}</text>
        </g>
      ))}
      {min < 0 && max > 0 && <line x1={padL} x2={W - padR} y1={y(0)} y2={y(0)} style={{ stroke: 'var(--muted)' }} strokeWidth={1} strokeDasharray="3 3" />}
      {series.map((s) => {
        const pts = s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ');
        const last = s.values.length - 1;
        return (
          <g key={s.name}>
            {!s.dashed && series.length === 1 && (
              <polygon points={`${x(0)},${y(Math.max(min, 0))} ${pts} ${x(last)},${y(Math.max(min, 0))}`} style={{ fill: s.color }} opacity={0.1} />
            )}
            <polyline points={pts} fill="none" style={{ stroke: s.color }} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" />
            <circle cx={x(last)} cy={y(s.values[last])} r={3.5} style={{ fill: s.color }} />
          </g>
        );
      })}
      {labels && (
        <>
          <text x={padL} y={H - 4}>{labels[0]}</text>
          <text x={W - padR} y={H - 4} textAnchor="end">{labels[labels.length - 1]}</text>
        </>
      )}
      {hover !== null && (
        <g className="tip" pointerEvents="none">
          <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} style={{ stroke: 'var(--muted)' }} strokeDasharray="2 3" />
          {rows.map((s) => <circle key={s.name} cx={x(hover)} cy={y(s.values[hover])} r={4} style={{ fill: s.color, stroke: 'var(--surface)' }} strokeWidth={1.5} />)}
          <rect x={tipX} y={padT} width={tipW} height={16 + rows.length * 13} rx={6} className="tip-box" />
          <text x={tipX + 8} y={padT + 12} className="tip-title">{pointLabels?.[hover] ?? `Punto ${hover + 1} de ${n}`}</text>
          {rows.map((s, i) => (
            <text key={s.name} x={tipX + 8} y={padT + 25 + i * 13} className="tip-row" style={{ fill: s.color }}>{s.name.slice(0, 16)}: {format(s.values[hover])}</text>
          ))}
        </g>
      )}
    </svg>
  );
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <div className="chips tiny">
      {series.map((s) => (
        <span key={s.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 14, height: 3, background: s.color, borderRadius: 2, display: 'inline-block' }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

/** Botón de acción con su explicación accesible (ⓘ). */
export function Act({ label, help, onClick, className = 'btn', disabled }: { label: ReactNode; help: string; onClick: () => void; className?: string; disabled?: boolean }) {
  return (
    <span className="act">
      <button className={className} disabled={disabled} onClick={onClick}>{label}</button>
      <InfoButton term={help} />
    </span>
  );
}

/**
 * Acción que pide confirmación SOLO cuando hay un motivo (`warning`): un precio
 * muy alejado de su referencia, algo irreversible. Si no hay motivo, es un botón
 * normal: no se agregan confirmaciones innecesarias a acciones reversibles.
 */
export function GuardedAct({ label, help, onConfirm, warning, confirmLabel = 'Confirmar igual', className = 'btn', disabled }: { label: string; help: string; onConfirm: () => void; warning?: ReactNode; confirmLabel?: string; className?: string; disabled?: boolean }) {
  if (warning) return <ConfirmButton label={label} help={help} className={className} disabled={disabled} detail={warning} confirmLabel={confirmLabel} onConfirm={onConfirm} />;
  return <Act label={label} help={help} className={className} disabled={disabled} onClick={onConfirm} />;
}

export function CardHead({ title, term, right }: { title: ReactNode; term?: string; right?: ReactNode }) {
  return (
    <div className="card-head">
      <h2>{title}</h2>
      {right}
      {term && <InfoButton term={term} />}
    </div>
  );
}

function showNum(n: number, decimals: number): string {
  return fmtNumber(n, decimals > 0 && !Number.isInteger(n) ? decimals : 0);
}

/** Decimales que admite un campo según su paso (1 → 0, 0.5 → 1, 0.01 → 2). */
function decimalsOf(step: number): number {
  if (step >= 1) return 0;
  const t = String(step);
  return t.includes('.') ? t.split('.')[1].length : 0;
}

/**
 * Entrada numérica (cantidades, días, porcentajes). Usa el mismo lector que los
 * montos y mantiene un borrador local: por defecto el valor se aplica al salir
 * del campo o con Enter, nunca en cada tecla (así una acción del motor no se
 * ejecuta con valores intermedios como "1" mientras se escribe "120").
 * `live` aplica cada valor válido al instante: solo para estado local de la
 * pantalla (vistas previas), nunca para acciones del motor.
 */
export function NumInput({ id, value, onChange, min = 0, max, step = 1, suffix, live = false, label }: { id: string; value: number; onChange: (n: number) => void; min?: number; max?: number; step?: number; suffix?: string; live?: boolean; label?: string }) {
  const decimals = decimalsOf(step);
  const show = (n: number) => showNum(n, decimals);
  const [text, setText] = useState(() => showNum(value, decimals));
  const emitted = useRef(value);
  useEffect(() => {
    if (value !== emitted.current) {
      emitted.current = value;
      setText(showNum(value, decimals));
    }
  }, [value, decimals]);
  const check = (t: string): { ok: true; value: number } | { ok: false; error: string } | null => {
    const r = parseQuantity(t, decimals);
    if (!r.ok) return r;
    if (r.value === null) return null;
    if (r.value < min) return { ok: false, error: `El mínimo es ${fmtNumber(min, decimals)}.` };
    if (max !== undefined && r.value > max) return { ok: false, error: `El máximo es ${fmtNumber(max, decimals)}.` };
    return { ok: true, value: r.value };
  };
  const result = check(text);
  const commit = () => {
    if (result && result.ok) {
      setText(show(result.value));
      if (result.value !== emitted.current) {
        emitted.current = result.value;
        onChange(result.value);
      }
    } else if (!result) setText(show(value));
  };
  const hintId = `${id}-hint`;
  return (
    <span className="num-input">
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <input
          id={id}
          className="input num"
          style={{ width: 96, minHeight: 40 }}
          inputMode={decimals ? 'decimal' : 'numeric'}
          autoComplete="off"
          aria-label={label}
          aria-invalid={!!result && !result.ok}
          aria-describedby={hintId}
          value={text}
          onChange={(e) => {
            const t = e.target.value;
            setText(t);
            if (live) {
              const r = check(t);
              if (r && r.ok && r.value !== emitted.current) {
                emitted.current = r.value;
                onChange(r.value);
              }
            }
          }}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        {suffix && <span className="tiny muted">{suffix}</span>}
      </span>
      <span id={hintId} aria-live="polite">{result && !result.ok && <span className="tiny loss">{result.error}</span>}</span>
    </span>
  );
}

/** Encabezado de sección en lenguaje simple: qué es y para qué sirve (se oculta al desactivar el modo aprendizaje). */
export function ScreenIntro({ icon, title, text, term, right }: { icon: string; title: string; text: string; term?: string; right?: ReactNode }) {
  const ui = useUI();
  return (
    <div className="screen-intro">
      <span className="si-icon" aria-hidden>{isIconName(icon) ? <Icon name={icon} size={20} /> : icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <h1>{title}</h1>
        {ui.settings.learningMode && <p className="small muted">{text}</p>}
      </div>
      {right}
      {term && <InfoButton term={term} />}
    </div>
  );
}

/** Interruptor accesible (reemplaza a las casillas de verificación en Ajustes). */
export function Switch({ checked, onChange, label, sub, term }: { checked: boolean; onChange: () => void; label: ReactNode; sub?: ReactNode; term?: string }) {
  return (
    <div className="switch-line">
      <button className={`switch-row ${checked ? 'on' : ''}`} role="switch" aria-checked={checked} onClick={onChange}>
        <span className="switch" aria-hidden><span /></span>
        <span className="sw-text"><span className="small sw-label">{label}</span>{sub && <span className="tiny muted">{sub}</span>}</span>
      </button>
      {term && <InfoButton term={term} />}
    </div>
  );
}
