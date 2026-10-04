import { useState } from 'react';
import { useGame, useUI, useDerived, store } from '../../store';
import type { GameState } from '../../../engine/state';
import { navStore } from '../../nav';
import { Money, InfoButton, CardHead, Pill, Seg, LineChart, NumInput, Act, Learn } from '../../components/common';
import { Sparkline } from '../../components/charts';
import { stockById, analystView, quoteMarket, placeStockOrder, studyStock, returnOver, isTradingDay } from '../../../engine/invest/stocks';
import { SECTOR_NAMES } from '../../../content/stocks';
import { fmtMoney, fmtPct, fmtNumber } from '../../../engine/format';
import { formatDate } from '../../../engine/time/calendar';
import type { Stock } from '../../../engine/invest/types';
import { Icon } from '../../icons';

export function riskLabel(st: Stock): { label: string; tone: 'gain' | 'warn' | 'loss' } {
  const r = st.beta * 0.5 + st.vol * 3 + (st.status !== 'activa' ? 5 : 0);
  if (r < 1.2) return { label: 'Riesgo bajo', tone: 'gain' };
  if (r < 1.8) return { label: 'Riesgo medio', tone: 'warn' };
  return { label: 'Riesgo alto', tone: 'loss' };
}

export function DayChange({ st }: { st: Stock }) {
  const ch = st.prevClose > 0 ? st.price / st.prevClose - 1 : 0;
  return <span className={`num small ${ch > 0 ? 'gain' : ch < 0 ? 'loss' : ''}`}>{ch > 0 ? '▲' : ch < 0 ? '▼' : ''} {fmtPct(Math.abs(ch), 2)}</span>;
}

/** Serie de precios de cierre para el gráfico: 3 meses, 1 año o todo (semanal + diario). */
function priceSeries(s: GameState, id: string, range: '3m' | '1a' | 'max'): number[] {
  const st = stockById(s, id)!;
  const daily = st.history.map((c) => c.c);
  if (range === '3m') return daily.slice(-63);
  if (range === '1a') return daily.slice(-252);
  return [...st.weekly.map((c) => c.c), ...daily];
}

function StockDetail({ st }: { st: Stock }) {
  const s = useGame();
  useUI();
  const [range, setRange] = useState<'3m' | '1a' | 'max'>('3m');
  const [qty, setQty] = useState(10);
  const view = analystView(s, st);
  const h = s.stocks.holdings[st.id];
  const buyQ = quoteMarket(s, st, 'compra', Math.max(1, qty));
  const sellQ = quoteMarket(s, st, 'venta', Math.max(1, qty));
  const series = useDerived(priceSeries, st.id, range);
  const risk = riskLabel(st);
  const ret = returnOver(st, range === '3m' ? 62 : range === '1a' ? 251 : st.history.length - 1);
  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <div className="card-head">
        <div style={{ flex: 1 }}>
          <h2>{st.name} <span className="faint small">{st.id}</span></h2>
          <div className="tiny muted">{SECTOR_NAMES[st.sector]} · <Pill tone={risk.tone}>{risk.label}</Pill> {st.status !== 'activa' && <Pill tone="loss">En quiebra</Pill>}</div>
        </div>
        <button className="btn sm ghost" onClick={() => navStore.setSub('invest', 'lite')}>Cerrar</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
        <span className="num" style={{ fontSize: 26, fontWeight: 700 }}>{fmtMoney(st.price)}</span>
        <DayChange st={st} />
        {ret !== null && <span className="tiny muted">{range === '3m' ? '3 meses' : range === '1a' ? '1 año' : 'Desde el inicio'}: <span className={ret >= 0 ? 'gain' : 'loss'}>{ret >= 0 ? '+' : ''}{fmtPct(ret, 1)}</span></span>}
      </div>
      <Seg items={[{ id: '3m', label: '3 meses' }, { id: '1a', label: '1 año' }, { id: 'max', label: 'Todo' }]} value={range} onChange={setRange} />
      <LineChart series={[{ name: st.id, values: series, color: 'var(--accent)' }]} height={130} />
      <p className="small">{st.description}</p>
      <div className="kv">
        <dt>P/E <InfoButton term="pe_ratio" /></dt><dd>{view.pe !== null ? view.pe.toFixed(1) : 'con pérdidas'}</dd>
        <dt>Rendimiento por dividendo <InfoButton term="dividend_yield" /></dt><dd>{fmtPct(view.dividendYield, 1)}</dd>
        <dt>Beneficio por acción (12 m) <InfoButton term="bpa" /></dt><dd>{fmtMoney(st.eps)}</dd>
        {st.status === 'quebrada' ? <><dt>Situación</dt><dd className="loss">En quiebra: deja de cotizar el {formatDate(st.nextEarnings)}</dd></> : <><dt>Próximos resultados</dt><dd>{formatDate(st.nextEarnings)}</dd></>}
      </div>
      <div className="card flat" style={{ padding: 12, gap: 6 }}>
        <div className="card-head"><strong style={{ flex: 1 }}>Tu análisis</strong><InfoButton term="prediccion_bursatil" /></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Pill tone={view.rating === 'compra' ? 'gain' : view.rating === 'venta' ? 'loss' : 'neutral'}>{view.rating === 'compra' ? 'Parece barata' : view.rating === 'venta' ? 'Parece cara' : 'Precio razonable'}</Pill>
          <span className="small">Valor estimado {fmtMoney(view.low)} – {fmtMoney(view.high)}</span>
        </div>
        <span className="tiny muted">Confianza {view.confidence} · error ±{Math.round(view.errorPct * 100)} %. {view.explanation}</span>
        <Act label="Analizar a fondo (+ experiencia)" help="accion_analizar" className="btn sm" onClick={() => store.run((x) => studyStock(x, st.id))} />
      </div>
      {st.news.length > 0 && (
        <details>
          <summary className="small"><strong>Noticias</strong></summary>
          <div className="rows">{st.news.slice().reverse().map((n) => <div className="row" key={n.day + n.text}><div className="grow tiny">{formatDate(n.day)} · {n.text}</div></div>)}</div>
        </details>
      )}
      {h && <p className="small">Tenés <strong>{h.qty}</strong> acciones · costo {fmtMoney(h.cost)} · valor {fmtMoney(Math.round(h.qty * st.price))} (<Money c={Math.round(h.qty * st.price) - h.cost} colored sign />)</p>}
      <div className="field">
        <label htmlFor="lite-qty">Cantidad de acciones</label>
        <NumInput id="lite-qty" live value={qty} onChange={setQty} min={1} />
        <span className="tiny muted">Compra ≈ {fmtMoney(buyQ.total)} (incluye comisión {fmtMoney(buyQ.fee)}) · Venta ≈ {fmtMoney(sellQ.total)} neto{!isTradingDay(s.day) ? ' · Mercado cerrado: se ejecuta en la próxima apertura.' : ''}</span>
      </div>
      <div className="btn-row">
        <Act label="Comprar" help="accion_comprar_accion" className="btn primary" disabled={st.status !== 'activa'} onClick={() => store.run((x) => placeStockOrder(x, { stockId: st.id, side: 'compra', type: 'mercado', qty }))} />
        <Act label="Vender" help="accion_vender_accion" className="btn" disabled={!h} onClick={() => store.run((x) => placeStockOrder(x, { stockId: st.id, side: 'venta', type: 'mercado', qty: Math.min(qty, h?.qty ?? 0) }))} />
      </div>
      <button className="btn sm ghost" onClick={() => navStore.setSub('invest', `pro:${st.id}`)}>Abrir en Trading Pro (órdenes avanzadas e indicadores)</button>
    </div>
  );
}

export function StocksLite({ selected }: { selected: string | null }) {
  const s = useGame();
  useUI();
  const [q, setQ] = useState('');
  const [sector, setSector] = useState<string>('todos');
  const st = selected ? stockById(s, selected) : null;
  const mine = (id: string) => !!s.stocks.holdings[id];
  const list = s.stocks.stocks
    .filter((x) => (sector === 'todos' || (sector === 'mias' ? mine(x.id) : x.sector === sector)) && (!q || (x.id + x.name).toLowerCase().includes(q.toLowerCase())))
    .sort((a, b) => Number(mine(b.id)) - Number(mine(a.id)));
  return (
    <>
      <div className="card">
        <CardHead title="Bolsa de Valoria · modo Lite" term="accion_modo_trading" />
        <Learn term="accion" />
        <div className="kv">
          <dt>Índice <InfoButton term="indice_bursatil" /></dt><dd>{fmtNumber(s.stocks.index.level, 1)}</dd>
          <dt>Mercado</dt><dd>{isTradingDay(s.day) ? 'Abierto (día hábil)' : 'Cerrado (fin de semana)'}</dd>
          <dt>Comisión <InfoButton term="comision_corretaje" /></dt><dd>0.2 % (mín. {fmtMoney(Math.round(100 * s.macro.priceIndex))})</dd>
        </div>
      </div>
      {st && <StockDetail key={st.id} st={st} />}
      <input className="input" placeholder="Buscar por nombre o código" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Buscar acción" />
      <div className="chips">
        {['todos', 'mias', ...Object.keys(SECTOR_NAMES)].map((k) => (
          <button key={k} aria-pressed={sector === k} onClick={() => setSector(k)} style={sector === k ? { background: 'var(--text)', color: 'var(--bg)' } : undefined}>{k === 'todos' ? 'Todas' : k === 'mias' ? `Las mías (${Object.keys(s.stocks.holdings).length})` : SECTOR_NAMES[k as keyof typeof SECTOR_NAMES]}</button>
        ))}
      </div>
      <div className="card" style={{ paddingBlock: 4 }}>
        <div className="rows">
          {list.map((x) => (
            <button key={x.id} className="row clickable" style={{ border: 0, borderBottom: '1px solid var(--line)', background: 'none', textAlign: 'left', width: '100%' }} onClick={() => { navStore.setSub('invest', `lite:${x.id}`); window.scrollTo({ top: 0 }); }}>
              <div className="grow">
                <div className="title small">{mine(x.id) && <><Icon name="star" size={13} label="Tenés esta acción" />{' '}</>}{x.id} <span className="faint">· {x.name}</span></div>
                <div className="meta">{SECTOR_NAMES[x.sector]}{s.stocks.holdings[x.id] ? ` · tenés ${s.stocks.holdings[x.id].qty}` : ''}{x.status !== 'activa' ? ' · en quiebra' : ''}</div>
              </div>
              <Sparkline values={x.history.slice(-40).map((c) => c.c)} />
              <div style={{ textAlign: 'right', minWidth: 72 }}>
                <div className="amt small">{fmtMoney(x.price)}</div>
                <DayChange st={x} />
              </div>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
