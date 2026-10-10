import { useState } from 'react';
import { useGame, useUI, store } from '../../store';
import { InfoButton, CardHead, Pill, NumInput, Act, Learn, LineChart, Seg, Money } from '../../components/common';
import { bondQuote, buyBond, sellBond, bondYields, bondDescription, duration, GOV_SPREAD } from '../../../engine/invest/bonds';
import type { JurisdictionId } from '../../../content/jurisdictions';
import { fmtMoney, fmtPct } from '../../../engine/format';
import { formatDate } from '../../../engine/time/calendar';
import type { BondIssue } from '../../../engine/invest/types';

function statusPill(b: BondIssue) {
  if (b.status === 'impago') return <Pill tone="loss">Impago</Pill>;
  if (b.status === 'vencido') return <Pill tone="neutral">Vencido</Pill>;
  return <Pill tone={/^A/.test(b.rating) ? 'gain' : /^B{3}/.test(b.rating) ? 'info' : 'warn'}>{b.rating}</Pill>;
}

function BondDetail({ b, onClose }: { b: BondIssue; onClose: () => void }) {
  const s = useGame();
  useUI();
  const [qty, setQty] = useState(1);
  const y = bondYields(s, b);
  const h = s.bonds.holdings[b.id];
  const buyQ = bondQuote(s, b, Math.max(1, qty), 'compra');
  const sellQ = bondQuote(s, b, Math.max(1, Math.min(qty, h?.qty ?? 1)), 'venta');
  const dur = b.status === 'vigente' ? duration(s, b) : 0;
  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <div className="card-head">
        <h2 style={{ flex: 1 }}>{b.name}</h2>
        {statusPill(b)}
        <button className="btn sm ghost" onClick={onClose}>Cerrar</button>
      </div>
      <p className="small">{bondDescription(s, b)}</p>
      <LineChart series={[{ name: 'Precio', values: b.history.slice(-120).map((x) => x.p), color: 'var(--accent)' }]} height={110} />
      <div className="kv">
        <dt>Precio por bono (nominal {fmtMoney(b.face, { decimals: false })})</dt><dd>{fmtMoney(b.price)}</dd>
        <dt>Rendimiento al vencimiento <InfoButton term="rendimiento_vencimiento" /></dt><dd>{fmtPct(y.ytm, 2)}</dd>
        <dt>Rendimiento corriente <InfoButton term="cupon" /></dt><dd>{fmtPct(y.current, 2)}</dd>
        <dt>Duración <InfoButton term="duracion" /></dt><dd>{dur.toFixed(2)} años</dd>
        {b.status === 'impago'
          ? <><dt>Situación</dt><dd className="loss">En impago · liquidación el {formatDate(b.maturityDay)} · recupero {fmtPct(b.recovery ?? 0.4, 0)} del nominal</dd></>
          : <><dt>Próximo cupón</dt><dd>{y.nextCoupon !== null ? `${formatDate(y.nextCoupon)} · ${fmtMoney(Math.round((b.face * b.coupon) / 2))} por bono` : '—'}</dd></>}
        <dt>Calificación <InfoButton term="calificacion" /></dt><dd>{b.status === 'impago' ? 'D' : b.rating}</dd>
      </div>
      <p className="tiny muted">
        Si las tasas suben 1 punto, el precio caería aproximadamente {fmtPct(dur / 100, 1)}.{' '}
        {b.issuerKind === 'empresa' ? 'Si la empresa quiebra, se recupera alrededor del 40 % del nominal.' : GOV_SPREAD[b.issuer as JurisdictionId] > 0.02 ? 'Este gobierno podría entrar en impago en una recesión profunda: se recuperaría alrededor del 55 % del nominal.' : 'El riesgo de impago de este gobierno es prácticamente nulo.'}
        {b.issuerKind === 'empresa' ? ' Un bono corporativo paga más porque la empresa puede quebrar.' : ''}
      </p>
      {h && <p className="small">Tenés <strong>{h.qty}</strong> bonos · costo {fmtMoney(h.cost)} · valor {fmtMoney(Math.round(h.qty * b.price))} (<Money c={Math.round(h.qty * b.price) - h.cost} colored sign />)</p>}
      {b.status === 'vigente' && (
        <>
          <div className="field">
            <label htmlFor="bond-qty">Cantidad de bonos</label>
            <NumInput id="bond-qty" live value={qty} onChange={setQty} min={1} />
            <span className="tiny muted">Compra ≈ {fmtMoney(buyQ.total)} (comisión {fmtMoney(buyQ.fee)}) · Venta ≈ {fmtMoney(sellQ.total)} neto</span>
          </div>
          <div className="btn-row">
            <Act label="Comprar bonos" help="accion_comprar_bono" className="btn primary" onClick={() => store.run((x) => buyBond(x, b.id, qty))} />
            <Act label="Vender" help="accion_vender_bono" className="btn" disabled={!h} onClick={() => store.run((x) => sellBond(x, b.id, Math.min(qty, h?.qty ?? 0)))} />
          </div>
        </>
      )}
    </div>
  );
}

export function BondsScreen() {
  const s = useGame();
  useUI();
  const [sel, setSel] = useState<string | null>(null);
  const [kind, setKind] = useState<'todos' | 'gobierno' | 'empresa'>('todos');
  const list = s.bonds.issues.filter((b) => (kind === 'todos' || b.issuerKind === kind) && (b.status !== 'vencido' || s.bonds.holdings[b.id]));
  const b = sel ? s.bonds.issues.find((x) => x.id === sel) : null;
  return (
    <>
      <div className="card">
        <CardHead title="Bonos y renta fija" term="bono" />
        <Learn term="bono" />
        <p className="small">Un bono es un préstamo que le hacés a un gobierno o a una empresa: te paga un cupón fijo cada seis meses y te devuelve el nominal al vencimiento. Su precio sube cuando bajan las tasas y cae cuando suben.</p>
        <div className="kv">
          <dt>Tasa de política <InfoButton term="interes" /></dt><dd>{fmtPct(s.macro.policyRate, 2)}</dd>
          <dt>Cupones cobrados (histórico)</dt><dd>{fmtMoney(s.bonds.couponsReceived)}</dd>
        </div>
      </div>
      {b && <BondDetail key={b.id} b={b} onClose={() => setSel(null)} />}
      <Seg items={[{ id: 'todos', label: 'Todos' }, { id: 'gobierno', label: 'Soberanos' }, { id: 'empresa', label: 'Corporativos' }]} value={kind} onChange={setKind} />
      <div className="card" style={{ paddingBlock: 4 }}>
        <div className="rows">
          {list.map((x) => {
            const y = bondYields(s, x);
            return (
              <button key={x.id} className="row clickable" style={{ border: 0, borderBottom: '1px solid var(--line)', background: 'none', textAlign: 'left', width: '100%' }} onClick={() => { setSel(x.id); window.scrollTo({ top: 0 }); }}>
                <div className="grow">
                  <div className="title small">{x.name}</div>
                  <div className="meta">Cupón {fmtPct(x.coupon, 3)} · vence {formatDate(x.maturityDay)} ({y.years.toFixed(1)} a){s.bonds.holdings[x.id] ? ` · tenés ${s.bonds.holdings[x.id].qty}` : ''}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="amt small">{fmtPct(x.yield, 2)}</div>
                  {statusPill(x)}
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
