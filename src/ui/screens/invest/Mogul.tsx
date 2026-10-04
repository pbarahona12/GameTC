import { Fragment, useState } from 'react';
import { useGame, useUI, store } from '../../store';
import { InfoButton, CardHead, Pill, NumInput, Act, Learn, LineChart, Money, Seg } from '../../components/common';
import { buyMogul, sellMogul, mogulQuote, mogulValuation, mogulRisk } from '../../../engine/invest/mogul';
import { fmtMoney, fmtPct, fmtNumber } from '../../../engine/format';
import { formatDate } from '../../../engine/time/calendar';
import type { MogulAsset } from '../../../engine/invest/types';
import { Icon } from '../../icons';
import { MOGUL_KIND_ICON } from '../../contentIcons';

const KIND: Record<MogulAsset['kind'], string> = { empresa: 'Empresa', inmueble: 'Edificio', regalias: 'Regalías' };

function Detail({ a, onClose }: { a: MogulAsset; onClose: () => void }) {
  const s = useGame();
  useUI();
  const [units, setUnits] = useState(1);
  const h = s.mogul.holdings[a.id];
  const val = mogulValuation(s, a);
  const risk = mogulRisk(s, a);
  const bq = mogulQuote(s, a, Math.max(0.01, units), 'compra');
  const sq = mogulQuote(s, a, Math.max(0.01, Math.min(units, h?.qty ?? units)), 'venta');
  const maxUnits = Math.max(0, a.units * 0.49 - (h?.qty ?? 0));
  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <div className="card-head">
        <div style={{ flex: 1 }}>
          <h2>{a.name}</h2>
          <div className="tiny muted">{KIND[a.kind]} · {fmtNumber(a.units)} participaciones</div>
        </div>
        <button className="btn sm ghost" onClick={onClose}>Cerrar</button>
      </div>
      <p className="small">{a.description}</p>
      <LineChart series={[{ name: 'Valor por participación', values: a.history.map((x) => x.v), color: 'var(--accent)' }]} height={110} />
      <div className="card flat" style={{ padding: 12, gap: 6 }}>
        <div className="card-head"><strong style={{ flex: 1 }}>Valoración</strong><InfoButton term="valoracion" /></div>
        <span className="small">{val.method}: <strong>{fmtMoney(val.value)}</strong> total hoy · {fmtMoney(Math.round(val.perUnit))} por participación (el precio de compra y venta se actualiza al cierre de cada mes)</span>
        <div className="kv">{val.inputs.map((i) => <Fragment key={i.label}><dt>{i.label}</dt><dd>{i.value}</dd></Fragment>)}</div>
      </div>
      <div className="card flat" style={{ padding: 12, gap: 6 }}>
        <div className="card-head"><strong style={{ flex: 1 }}>Rendimiento y riesgo</strong><InfoButton term="volatilidad" /></div>
        <div className="kv">
          <dt>Riesgo (1–5)</dt><dd>{risk.score}</dd>
          <dt>Rendimiento por repartos (12 m)</dt><dd>{fmtPct(risk.yieldAnnual, 1)}</dd>
          <dt>Volatilidad anual</dt><dd>{risk.volatility === null ? 'Poca historia' : fmtPct(risk.volatility, 0)}</dd>
          <dt>Liquidez <InfoButton term="spread" /></dt><dd>{risk.liquidity} (diferencial {fmtPct(a.spread, 0)})</dd>
        </div>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{risk.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      </div>
      {a.distributions.length > 0 && (
        <p className="tiny muted">Últimos repartos: {a.distributions.slice(-4).reverse().map((d) => `${formatDate(d.d)} ${fmtMoney(Math.round(d.perUnit))}`).join(' · ')}</p>
      )}
      {h && <p className="small">Tenés {fmtNumber(h.qty, 2)} participaciones · valor {fmtMoney(Math.round(h.qty * a.nav))} (<Money c={Math.round(h.qty * a.nav) - h.cost} colored sign />)</p>}
      {a.status === 'activo' ? (
        <>
          <div className="field">
            <label htmlFor="mog-u">Participaciones (acepta fracciones, mín. 0.01)</label>
            <NumInput id="mog-u" live value={units} onChange={setUnits} step={0.01} />
            <span className="tiny muted">Compra ≈ {fmtMoney(bq.total)} · Venta ≈ {fmtMoney(sq.total)} neto · Podés comprar hasta {fmtNumber(maxUnits, 2)} más (tope 49 %).</span>
          </div>
          <div className="btn-row">
            <Act label="Comprar" help="accion_mogul_comprar" className="btn primary" onClick={() => store.run((x) => buyMogul(x, a.id, units))} />
            <Act label="Vender" help="accion_mogul_vender" className="btn" disabled={!h} onClick={() => store.run((x) => sellMogul(x, a.id, Math.min(units, h?.qty ?? 0)))} />
          </div>
        </>
      ) : <Pill tone="loss">Liquidado</Pill>}
    </div>
  );
}

export function MogulScreen() {
  const s = useGame();
  useUI();
  const [sel, setSel] = useState<string | null>(null);
  const [kind, setKind] = useState<'todos' | MogulAsset['kind']>('todos');
  const a = sel ? s.mogul.assets.find((x) => x.id === sel) : null;
  const list = s.mogul.assets.filter((x) => (kind === 'todos' || x.kind === kind) && (x.status === 'activo' || s.mogul.holdings[x.id]));
  return (
    <>
      <div className="card">
        <CardHead title="Mogul Exchange" term="mogul_exchange" />
        <Learn term="participacion_fraccionada" />
        <p className="small">Comprá fracciones de activos reales: pequeñas empresas, edificios alquilados y derechos de regalías. Cobrás tu parte de los repartos mensuales y el valor se recalcula cada mes con los datos del activo. Es menos líquido que la bolsa: el diferencial compra/venta es mayor.</p>
        <div className="kv"><dt>Repartos cobrados (histórico)</dt><dd>{fmtMoney(s.mogul.distributionsReceived)}</dd></div>
      </div>
      {a && <Detail key={a.id} a={a} onClose={() => setSel(null)} />}
      <Seg items={[{ id: 'todos', label: 'Todos' }, { id: 'empresa', label: 'Empresas' }, { id: 'inmueble', label: 'Edificios' }, { id: 'regalias', label: 'Regalías' }]} value={kind} onChange={setKind} />
      <div className="card" style={{ paddingBlock: 4 }}>
        <div className="rows">
          {list.map((x) => {
            const prev = x.history.length > 1 ? x.history[x.history.length - 2].v : x.nav;
            const ch = prev > 0 ? x.nav / prev - 1 : 0;
            return (
              <button key={x.id} className="row clickable" style={{ border: 0, borderBottom: '1px solid var(--line)', background: 'none', textAlign: 'left', width: '100%' }} onClick={() => { setSel(x.id); window.scrollTo({ top: 0 }); }}>
                <div className="grow">
                  <div className="title small"><Icon name={MOGUL_KIND_ICON[x.kind]} size={15} /> {x.name}</div>
                  <div className="meta">{KIND[x.kind]} · riesgo {x.risk}/5{s.mogul.holdings[x.id] ? ` · tenés ${fmtNumber(s.mogul.holdings[x.id].qty, 2)}` : ''}{x.status !== 'activo' ? ' · liquidado' : ''}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="amt small">{fmtMoney(Math.round(x.nav))}</div>
                  <span className={`tiny ${ch >= 0 ? 'gain' : 'loss'}`}>{fmtPct(ch, 1)} mes</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
