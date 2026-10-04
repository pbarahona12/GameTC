import { useState } from 'react';
import { useGame, useUI, useDerived, store } from '../../store';
import type { GameState } from '../../../engine/state';
import { navStore } from '../../nav';
import { InfoButton, CardHead, Pill, Seg, NumInput, AmountInput, Act, LineChart, Legend, Money } from '../../components/common';
import { CandleChart, IndicatorPanel, Overlay } from '../../components/charts';
import { stockById, analystView, quoteMarket, placeStockOrder, placeBracket, cancelOrder, orderSummary, isTradingDay, fairValue } from '../../../engine/invest/stocks';
import { sma, ema, rsi, macd, bollinger, correlation, annualVol, maxDrawdown } from '../../../engine/invest/indicators';
import { SECTOR_NAMES } from '../../../content/stocks';
import { fmtMoney, fmtPct, fmtNumber } from '../../../engine/format';
import { formatDate } from '../../../engine/time/calendar';
import type { OrderType, OrderSide } from '../../../engine/invest/types';
import { portfolioRisk } from './Portfolio';
import { Icon } from '../../icons';

const TYPES: Array<{ id: OrderType; label: string; term: string }> = [
  { id: 'mercado', label: 'Mercado', term: 'orden_mercado' },
  { id: 'limite', label: 'Límite', term: 'orden_limite' },
  { id: 'stop', label: 'Stop loss', term: 'stop_loss' },
  { id: 'stop_limite', label: 'Stop-límite', term: 'stop_limite' },
  { id: 'take_profit', label: 'Toma de ganancias', term: 'take_profit' },
  { id: 'trailing', label: 'Stop dinámico', term: 'trailing_stop' },
];

function Ticket({ id }: { id: string }) {
  const s = useGame();
  useUI();
  const st = stockById(s, id)!;
  const [side, setSide] = useState<OrderSide>('compra');
  const [type, setType] = useState<OrderType>('limite');
  const [qty, setQty] = useState(10);
  const [limit, setLimit] = useState(Math.round(st.price * 0.98));
  const [stop, setStop] = useState(Math.round(st.price * 0.93));
  const [trail, setTrail] = useState(8);
  const [days, setDays] = useState(30);
  const [tp, setTp] = useState(Math.round(st.price * 1.1));
  const h = s.stocks.holdings[id];
  const q = quoteMarket(s, st, side, Math.max(1, qty));
  const needLimit = type === 'limite' || type === 'stop_limite' || type === 'take_profit';
  const needStop = type === 'stop' || type === 'stop_limite';
  return (
    <div className="card">
      <CardHead title="Nueva orden" term="accion_orden" />
      <Seg items={[{ id: 'compra', label: 'Comprar' }, { id: 'venta', label: 'Vender' }]} value={side} onChange={(v) => { setSide(v); if (v === 'compra' && (type === 'take_profit' || type === 'trailing')) setType('limite'); }} />
      <div className="field">
        <label htmlFor="pro-type">Tipo de orden <InfoButton term={TYPES.find((t) => t.id === type)!.term} /></label>
        <select id="pro-type" className="input" value={type} onChange={(e) => setType(e.target.value as OrderType)}>
          {TYPES.filter((t) => side === 'venta' || (t.id !== 'take_profit' && t.id !== 'trailing')).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
      </div>
      <div className="inline-form">
        <label className="tiny muted" htmlFor="pro-qty">Cantidad</label>
        <NumInput id="pro-qty" live value={qty} onChange={setQty} min={1} />
        {h && side === 'venta' && <button className="btn sm ghost" onClick={() => setQty(h.qty)}>Todas ({h.qty})</button>}
      </div>
      {needStop && <div className="field"><label htmlFor="pro-stop">Precio de activación (stop)</label><AmountInput id="pro-stop" value={stop} onChange={setStop} /></div>}
      {needLimit && <div className="field"><label htmlFor="pro-limit">{type === 'take_profit' ? 'Precio objetivo' : 'Precio límite'}</label><AmountInput id="pro-limit" value={limit} onChange={setLimit} /></div>}
      {type === 'trailing' && <div className="inline-form"><label className="tiny muted" htmlFor="pro-trail">% bajo el máximo</label><NumInput id="pro-trail" live value={trail} onChange={setTrail} min={1} suffix="%" /></div>}
      {type !== 'mercado' && <div className="inline-form"><label className="tiny muted" htmlFor="pro-days">Vigencia</label><NumInput id="pro-days" live value={days} onChange={setDays} min={1} max={90} suffix="días (máx. 90)" /></div>}
      <p className="tiny muted">{type === 'mercado' ? `Ejecución inmediata ≈ ${fmtMoney(q.price)} por acción (diferencial ${fmtPct(q.spread, 2)}, impacto ${fmtPct(q.impact, 2)}). Total ≈ ${fmtMoney(q.total)}.` : 'Se revisa cada día hábil contra el mínimo y el máximo del día.'}{!isTradingDay(s.day) ? ' Hoy la bolsa está cerrada.' : ''}</p>
      <Act label="Enviar orden" help="accion_orden" className="btn primary" onClick={() => store.run((x) => placeStockOrder(x, { stockId: id, side, type, qty, limit: needLimit ? limit : undefined, stop: needStop ? stop : undefined, trailPct: type === 'trailing' ? trail / 100 : undefined, days }))} />
      {h && (
        <div className="card flat" style={{ padding: 12, gap: 8 }}>
          <div className="card-head"><strong style={{ flex: 1 }}>Proteger posición (OCO)</strong><InfoButton term="oco" /></div>
          <div className="field"><label htmlFor="oco-stop">Stop loss</label><AmountInput id="oco-stop" value={stop} onChange={setStop} /></div>
          <div className="field"><label htmlFor="oco-tp">Toma de ganancias</label><AmountInput id="oco-tp" value={tp} onChange={setTp} /></div>
          <Act label={`Proteger ${h.qty} acciones`} help="accion_proteccion_oco" className="btn sm" onClick={() => store.run((x) => placeBracket(x, id, h.qty, stop, tp, days))} />
        </div>
      )}
    </div>
  );
}

function Compare({ a }: { a: string }) {
  const s = useGame();
  const [b, setB] = useState(s.stocks.stocks.find((x) => x.id !== a)?.id ?? a);
  const A = stockById(s, a)!;
  const B = stockById(s, b);
  if (!B) return null;
  const n = Math.min(A.history.length, B.history.length, 126);
  const na = A.history.slice(-n).map((c) => (c.c / A.history[A.history.length - n].c) * 100);
  const nb = B.history.slice(-n).map((c) => (c.c / B.history[B.history.length - n].c) * 100);
  const corr = correlation(A.history.slice(-n).map((c) => c.c), B.history.slice(-n).map((c) => c.c));
  const row = (label: string, fa: string, fb: string) => <tr><td>{label}</td><td className="r">{fa}</td><td className="r">{fb}</td></tr>;
  const va = analystView(s, A);
  const vb = analystView(s, B);
  return (
    <div className="card">
      <CardHead title="Comparar acciones" term="beta" />
      <select className="input" value={b} onChange={(e) => setB(e.target.value)} aria-label="Acción a comparar">
        {s.stocks.stocks.filter((x) => x.id !== a).map((x) => <option key={x.id} value={x.id}>{x.id} · {x.name}</option>)}
      </select>
      <LineChart series={[{ name: a, values: na, color: 'var(--accent)' }, { name: b, values: nb, color: 'var(--info)' }]} height={140} format={(v) => v.toFixed(0)} />
      <Legend series={[{ name: `${a} (base 100)`, values: [], color: 'var(--accent)' }, { name: `${b} (base 100)`, values: [], color: 'var(--info)' }]} />
      <div className="hscroll">
        <table className="table">
          <thead><tr><th /><th className="r">{a}</th><th className="r">{b}</th></tr></thead>
          <tbody>
            {row('Sector', SECTOR_NAMES[A.sector], SECTOR_NAMES[B.sector])}
            {row('Precio', fmtMoney(A.price), fmtMoney(B.price))}
            {row('P/E', va.pe?.toFixed(1) ?? '—', vb.pe?.toFixed(1) ?? '—')}
            {row('Dividendo anual', fmtPct(va.dividendYield, 1), fmtPct(vb.dividendYield, 1))}
            {row('Beta', A.beta.toFixed(2), B.beta.toFixed(2))}
            {row('Volatilidad (6 m)', fmtPct(annualVol(A.history.slice(-n).map((c) => c.c)), 0), fmtPct(annualVol(B.history.slice(-n).map((c) => c.c)), 0))}
            {row('Caída máx. (6 m)', fmtPct(maxDrawdown(A.history.slice(-n).map((c) => c.c)), 0), fmtPct(maxDrawdown(B.history.slice(-n).map((c) => c.c)), 0))}
            {row('Tu estimación de valor', fmtMoney(va.fairEstimate), fmtMoney(vb.fairEstimate))}
          </tbody>
        </table>
      </div>
      <p className="tiny muted">Correlación de retornos: {corr !== null ? corr.toFixed(2) : '—'} (cerca de 1 = se mueven juntas; combinar acciones poco correlacionadas diversifica).</p>
    </div>
  );
}

/** Velas visibles e indicadores (calculados sobre todo el historial y recortados a la ventana). */
function chartData(s: GameState, id: string, range: number, endOff: number, sma20: boolean, sma50: boolean, ema20: boolean, boll: boolean) {
  const all = stockById(s, id)!.history;
  const closes = all.map((c) => c.c);
  const cut = <T,>(arr: T[]) => arr.slice(Math.max(0, arr.length - endOff - range), arr.length - endOff);
  const overlays: Overlay[] = [];
  if (sma20) overlays.push({ name: 'SMA 20', values: cut(sma(closes, 20)), color: 'var(--accent)' });
  if (sma50) overlays.push({ name: 'SMA 50', values: cut(sma(closes, 50)), color: 'var(--info)' });
  if (ema20) overlays.push({ name: 'EMA 20', values: cut(ema(closes, 20)), color: '#9a7fd1', dashed: true });
  if (boll) {
    const bb = bollinger(closes);
    overlays.push({ name: 'Bollinger sup.', values: cut(bb.upper), color: 'var(--faint)', dashed: true }, { name: 'Bollinger inf.', values: cut(bb.lower), color: 'var(--faint)', dashed: true });
  }
  const m = macd(closes);
  return { candles: cut(all), overlays, rsi: cut(rsi(closes)), macd: { macd: cut(m.macd), signal: cut(m.signal), hist: cut(m.hist) } };
}

export function TradingPro({ selected }: { selected: string | null }) {
  const s = useGame();
  const id = selected && stockById(s, selected) ? selected : s.stocks.stocks[0].id;
  const st = stockById(s, id)!;
  const total = st.history.length;
  // Ventana visible sobre todo el historial: cantidad de velas y distancia al último día.
  const [win, setWin] = useState<{ count: number; end: number }>({ count: 60, end: 0 });
  const minCount = 15;
  const clampWin = (count: number, end: number) => {
    const c = Math.max(Math.min(minCount, total), Math.min(total, count));
    return { count: c, end: Math.max(0, Math.min(total - c, end)) };
  };
  const zoom = (factor: number, anchor = 0.5) => setWin((w) => {
    const start = total - w.end - w.count;
    const anchorIdx = start + anchor * w.count;
    const count = Math.max(minCount, Math.min(total, w.count * factor));
    const newStart = anchorIdx - anchor * count;
    return clampWin(count, total - newStart - count);
  });
  const pan = (d: number) => setWin((w) => clampWin(w.count, w.end - d));
  const range = Math.round(win.count);
  const endOff = Math.round(win.end);
  const [ov, setOv] = useState<Record<string, boolean>>({ sma20: true, sma50: false, ema20: false, boll: false });
  const [panel, setPanel] = useState<'rsi' | 'macd'>('rsi');
  const data = useDerived(chartData, id, range, endOff, ov.sma20, ov.sma50, ov.ema20, ov.boll);
  const orders = s.stocks.orders.filter((o) => o.status === 'abierta');
  const closed = s.stocks.orders.filter((o) => o.status !== 'abierta').slice(-10).reverse();
  const risk = portfolioRisk(s);
  const view = analystView(s, st);
  const h = s.stocks.holdings[id];
  const markers = [
    ...(h ? [{ price: Math.round(h.cost / h.qty), label: 'costo', color: 'var(--info)' }] : []),
    ...orders.filter((o) => o.stockId === id).flatMap((o) => [o.limit ? { price: o.limit, label: o.type === 'take_profit' ? 'objetivo' : 'límite', color: 'var(--gain)' } : null, o.stop ? { price: o.stop, label: 'stop', color: 'var(--loss)' } : null].filter((x): x is { price: number; label: string; color: string } => x !== null)),
  ];
  void fairValue;
  return (
    <>
      <div className="card">
        <div className="card-head">
          <select className="input" style={{ flex: 1 }} value={id} onChange={(e) => navStore.setSub('invest', `pro:${e.target.value}`)} aria-label="Elegir acción">
            {s.stocks.stocks.map((x) => <option key={x.id} value={x.id}>{x.id} · {x.name} · {fmtMoney(x.price)}</option>)}
          </select>
          <InfoButton term="accion_modo_trading" />
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>{fmtMoney(st.price)}</span>
          <span className="tiny muted">Ap {fmtMoney(st.open)} · Máx {fmtMoney(st.high)} · Mín {fmtMoney(st.low)} · Vol {fmtNumber(st.volume)}</span>
        </div>
        <Seg items={[{ id: 60, label: '3 m' }, { id: 120, label: '6 m' }, { id: 260, label: '1 a' }, { id: 0, label: 'Todo' }]} value={[60, 120, 260].includes(range) && endOff === 0 ? range : range >= total && endOff === 0 ? 0 : -1} onChange={(v) => setWin(clampWin(v === 0 ? total : v, 0))} />
        <CandleChart candles={data.candles} overlays={data.overlays} markers={markers} onZoom={zoom} onPan={pan} />
        <div className="chart-tools" role="group" aria-label="Zoom y desplazamiento del gráfico">
          <button className="icon-btn sm" aria-label="Alejar" onClick={() => zoom(1.4)} disabled={range >= total}><Icon name="zoomOut" size={16} /></button>
          <button className="icon-btn sm" aria-label="Acercar" onClick={() => zoom(0.7)} disabled={range <= minCount}><Icon name="zoomIn" size={16} /></button>
          <button className="icon-btn sm" aria-label="Ver días anteriores" onClick={() => pan(-Math.max(5, range / 4))} disabled={endOff >= total - range}>‹</button>
          <button className="icon-btn sm" aria-label="Ver días posteriores" onClick={() => pan(Math.max(5, range / 4))} disabled={endOff === 0}>›</button>
          <button className="btn sm ghost" onClick={() => setWin(clampWin(win.count, 0))} disabled={endOff === 0}>Hoy</button>
          <span className="tiny muted" style={{ flex: 1, textAlign: 'right' }}>{range} días{endOff ? ` · hasta hace ${endOff}` : ''}</span>
        </div>
        <p className="tiny muted">Tocá y deslizá sobre el gráfico para ver el precio de cada día. Con dos dedos: pellizcá para acercar o alejar y arrastrá para moverte en el tiempo.</p>
        <div className="chips">
          {[['sma20', 'SMA 20', 'media_movil'], ['sma50', 'SMA 50', 'media_movil'], ['ema20', 'EMA 20', 'media_movil'], ['boll', 'Bollinger', 'bollinger']].map(([k, label]) => (
            <button key={k} aria-pressed={ov[k]} onClick={() => setOv({ ...ov, [k]: !ov[k] })} style={ov[k] ? { background: 'var(--text)', color: 'var(--bg)' } : undefined}>{label}</button>
          ))}
          <InfoButton term="media_movil" /><InfoButton term="bollinger" />
        </div>
        <Seg items={[{ id: 'rsi', label: 'RSI 14' }, { id: 'macd', label: 'MACD 12/26/9' }]} value={panel} onChange={setPanel} />
        {panel === 'rsi' ? (
          <IndicatorPanel label="RSI" lines={[{ name: 'RSI', values: data.rsi, color: 'var(--accent)' }]} bands={[30, 70]} />
        ) : (
          <IndicatorPanel label="MACD" lines={[{ name: 'MACD', values: data.macd.macd, color: 'var(--accent)' }, { name: 'Señal', values: data.macd.signal, color: 'var(--info)', dashed: true }]} hist={data.macd.hist} />
        )}
        <span className="tiny">Indicadores <InfoButton term="rsi" /> <InfoButton term="macd" /> · Estimación de valor {fmtMoney(view.low)}–{fmtMoney(view.high)} (±{Math.round(view.errorPct * 100)} %) <InfoButton term="prediccion_bursatil" /></span>
      </div>
      <Ticket key={id} id={id} />
      <div className="card">
        <CardHead title={`Órdenes abiertas (${orders.length})`} term="accion_cancelar_orden" />
        {orders.length === 0 && <p className="small muted">No hay órdenes abiertas.</p>}
        <div className="rows">
          {orders.map((o) => (
            <div className="row" key={o.id}>
              <div className="grow">
                <div className="small">{orderSummary(o)} {o.oco && <Pill tone="info">OCO</Pill>}</div>
                <div className="tiny faint">Vence {formatDate(o.expiresDay)}{o.note ? ` · ${o.note}` : ''}</div>
              </div>
              <button className="btn sm ghost" onClick={() => store.run((x) => cancelOrder(x, o.id))}>Cancelar</button>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <CardHead title="Historial de órdenes" term="orden_limite" />
        <div className="hscroll">
          <table className="table">
            <thead><tr><th>Orden</th><th>Estado</th><th className="r">Precio</th></tr></thead>
            <tbody>
              {closed.map((o) => <tr key={o.id}><td className="tiny">{orderSummary(o)}{o.status === 'rechazada' && o.note && <div className="loss">{o.note}</div>}</td><td><Pill tone={o.status === 'ejecutada' ? 'gain' : o.status === 'rechazada' ? 'loss' : 'neutral'}>{o.status}</Pill></td><td className="r">{o.filledPrice ? fmtMoney(o.filledPrice) : '—'}</td></tr>)}
            </tbody>
          </table>
        </div>
        {closed.length === 0 && <p className="small muted">Todavía no hay órdenes cerradas.</p>}
      </div>
      <div className="card">
        <CardHead title="Análisis de riesgo de tu cartera de acciones" term="var" />
        {risk ? (
          <div className="kv">
            <dt>Valor</dt><dd><Money c={risk.total} /></dd>
            <dt>Volatilidad anual <InfoButton term="volatilidad" /></dt><dd>{fmtPct(risk.vol, 1)}</dd>
            <dt>Beta <InfoButton term="beta" /></dt><dd>{risk.beta?.toFixed(2) ?? '—'}</dd>
            <dt>VaR 95 % (1 mes) <InfoButton term="var" /></dt><dd>{fmtMoney(Math.round(risk.var21))}</dd>
            <dt>Caída máxima <InfoButton term="drawdown" /></dt><dd>{fmtPct(risk.drawdown, 1)}</dd>
            <dt>Concentración <InfoButton term="diversificacion" /></dt><dd>{risk.hhi.toFixed(2)}</dd>
          </div>
        ) : <p className="small muted">Comprá acciones para ver el análisis de riesgo (se calcula con al menos 20 días de precios).</p>}
      </div>
      <Compare a={id} />
    </>
  );
}
