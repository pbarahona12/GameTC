import { useEffect } from 'react';
import { useGame, useUI, store } from '../../store';
import { navStore } from '../../nav';
import { answerPoach, rivalById } from '../../../engine/world/rivals';
import { SECTOR_BY_ID } from '../../../content/sectors';
import { formatDate } from '../../../engine/time/calendar';
import { fmtMoney, fmtPct } from '../../../engine/format';
import { hashNormal } from '../../../engine/rng';
import { Pill, Act, ScreenIntro, Empty, CardHead, Bar, InfoButton, ConfirmButton } from '../../components/common';
import { Icon } from '../../icons';
import { RIVAL_HEADS, cityName } from '../../../engine/saga/ranking';
import { rivalPrice, rivalBlocker, acquireRival, CONTROL_PREMIUM } from '../../../engine/saga/corporate';
import type { PoachOffer } from '../../../engine/world/types';
import { monogram } from '../../contentIcons';

const STYLE: Record<string, { label: string; tone: 'loss' | 'info' | 'warn' }> = {
  agresivo: { label: 'Agresivo', tone: 'loss' },
  paciente: { label: 'Paciente', tone: 'info' },
  oportunista: { label: 'Oportunista', tone: 'warn' },
};

/** Ofertas de la competencia por tus empleados (también se muestran en cada empresa). */
export function PoachCard({ p }: { p: PoachOffer }) {
  const s = useGame();
  const co = s.companies.find((c) => c.id === p.companyId);
  const e = co?.employees.find((x) => x.id === p.employeeId);
  const r = rivalById(s, p.rivalId);
  if (!co || !e) return null;
  return (
    <div className="alert warning">
      <span className="stripe" />
      <div className="stack" style={{ gap: 6, flex: 1 }}>
        <strong className="small">{r?.name} quiere llevarse a {e.name} ({co.name})</strong>
        <span className="small muted">Habilidad {Math.round(e.skill)} · sueldo actual {fmtMoney(e.wage)} → le ofrecen {fmtMoney(p.wage)} (+{fmtPct(p.wage / e.wage - 1, 0)}). Vence el {formatDate(p.expires)}: si no respondés y la oferta es mucho mejor, se va.</span>
        <div className="btn-row">
          <Act label={`Igualar (${fmtMoney(p.wage)})`} help="accion_igualar_oferta" className="btn sm primary" onClick={() => store.run((x) => answerPoach(x, p.id, true))} />
          <Act label="Dejarlo ir" help="accion_dejar_ir" className="btn sm ghost" onClick={() => store.run((x) => answerPoach(x, p.id, false))} />
        </div>
      </div>
    </div>
  );
}

function attitudeLabel(a: number): string {
  return a >= 80 ? 'En guerra' : a >= 60 ? 'Hostil' : a >= 25 ? 'Desconfiado' : a > 5 ? 'Atento' : 'Indiferente';
}

export function RivalsScreen() {
  const s = useGame();
  useUI();
  useEffect(() => store.markSeen('grupos_rivales'), []);
  const poach = s.world.poach.filter((p) => p.status === 'abierta');
  const offers = s.companies.filter((c) => c.saleOffer && c.saleOffer.expires >= s.day && c.saleOffer.from);
  const rv = s.saga.rivalry;
  const wars = (rv?.wars ?? []).filter((w) => w.until >= s.day);
  const coalition = rv?.coalition && rv.coalition.until >= s.day ? rv.coalition : null;
  const shocks = s.world.supplierShocks.filter((x) => x.fromDay <= s.day && x.untilDay >= s.day);
  return (
    <>
      <ScreenIntro icon="rivals" title="Competencia" text="Cuatro grupos económicos compiten con vos: compran empresas e inmuebles, abren competidores, cierran exclusividades con proveedores, ofertan por tus empresas y tientan a tus empleados. Muchos movimientos se anticipan en Noticias." term="grupos_rivales" />
      {(poach.length > 0 || offers.length > 0) && <div className="section-title"><h2>Te necesitan</h2></div>}
      {poach.map((p) => <PoachCard key={p.id} p={p} />)}
      {offers.map((c) => (
        <button key={c.id} className="alert opportunity" style={{ textAlign: 'left' }} onClick={() => navStore.go('business', `co:${c.id}:manage`)}>
          <span className="stripe" />
          <div className="small" style={{ flex: 1 }}><strong>{c.saleOffer!.from} ofrece {fmtMoney(c.saleOffer!.price)} por {c.name}.</strong> Vence el {formatDate(c.saleOffer!.expires)}. Tocá para decidir.</div>
        </button>
      ))}
      {shocks.length > 0 && (
        <div className="card">
          <CardHead title="Proveedores con exclusividad" term="exclusividad_proveedor" />
          <div className="rows">
            {shocks.map((x) => {
              const sup = SECTOR_BY_ID[x.sector].suppliers.find((y) => y.id === x.supplierId);
              return <div className="row" key={x.id}><div className="grow small">{sup?.name ?? x.supplierId} · {SECTOR_BY_ID[x.sector].name}</div><span className="small loss">+{fmtPct(x.mult - 1, 0)} hasta {formatDate(x.untilDay)}</span></div>;
            })}
          </div>
        </div>
      )}
      {wars.length > 0 && (
        <div className="alert critical"><span className="stripe" /><div className="small" style={{ flex: 1 }}><strong>Guerra de precios.</strong> {wars.map((w) => `${s.world.rivals.find((r) => r.id === w.rivalId)?.name ?? ''} en ${SECTOR_BY_ID[w.sector].name.toLowerCase()} hasta el ${formatDate(w.until)}`).join(' · ')}. Revisá precios, calidad y marketing de tus empresas en ese sector.</div></div>
      )}
      {s.world.rivals.map((r) => {
        // Capital estimado públicamente (±20 %): estable durante el mes.
        const est = Math.round(r.capital * (1 + Math.max(-0.2, Math.min(0.2, hashNormal(`${r.id}|${Math.floor(s.day / 30)}`) * 0.1))));
        const head = s.saga.ranking.magnates.find((m) => m.rivalId === r.id);
        return (
          <div className="card" key={r.id}>
            <div className="card-head">
              <span className="store-logo monogram" aria-hidden>{monogram(r.name)}</span>
              <div style={{ flex: 1 }}>
                <h2>{r.name}</h2>
                <div className="tiny muted">{r.sectors.map((x) => SECTOR_BY_ID[x].name).join(' · ')}</div>
              </div>
              {rv?.nemesisId === r.id ? <Pill tone="loss">némesis</Pill> : r.ally && r.ally.until >= s.day ? <Pill tone="gain">aliado</Pill> : <Pill tone={STYLE[r.style].tone}>{STYLE[r.style].label}</Pill>}
            </div>
            <p className="small muted">{r.description}</p>
            <div className="kv"><dt>Capital estimado</dt><dd>~{fmtMoney(est, { decimals: false })}</dd><dt>Controla</dt><dd>{r.holdings.length ? `${r.holdings.length} negocio${r.holdings.length > 1 ? 's' : ''} o inmueble${r.holdings.length > 1 ? 's' : ''}` : '—'}</dd>{head && <><dt>Dueño</dt><dd>{head.name} · {RIVAL_HEADS[r.id] ? cityName(RIVAL_HEADS[r.id].city) : ''}</dd></>}</div>
            <div className="stack" style={{ gap: 4 }}>
              <span className="small" style={{ display: 'flex', gap: 6 }}><strong style={{ flex: 1 }}>Actitud hacia vos <InfoButton term="rencor_rivales" /></strong><span className="num">{attitudeLabel(r.attitude ?? 0)}</span></span>
              <Bar value={(r.attitude ?? 0) / 100} tone={(r.attitude ?? 0) >= 60 ? 'loss' : (r.attitude ?? 0) >= 25 ? 'warn' : 'gain'} />
              {r.truce && r.truce.until >= s.day && <span className="tiny gain"><Icon name="deal" size={12} /> Tregua hasta el {formatDate(r.truce.until)}: no te ataca y vos no entrás con empresas nuevas en {SECTOR_BY_ID[r.truce.sector].name.toLowerCase()}.</span>}
              {rv?.nemesisId === r.id && <span className="tiny loss"><Icon name="rivals" size={12} /> Es tu némesis desde el {formatDate(rv.nemesisSince)}: ataca más seguido. Lo vencés comprándolo o duplicando la fortuna de su dueño.</span>}
              {r.ally && r.ally.until >= s.day && <span className="tiny gain"><Icon name="deal" size={12} /> Aliado hasta el {formatDate(r.ally.until)}: no te ataca.</span>}
              {coalition && coalition.members.includes(r.id) && <span className="tiny loss"><Icon name="rivals" size={12} /> En coalición contra vos hasta el {formatDate(coalition.until)}.</span>}
              {wars.filter((w) => w.rivalId === r.id).map((w) => <span key={w.id} className="tiny loss"><Icon name="rivals" size={12} /> Guerra de precios en {SECTOR_BY_ID[w.sector].name.toLowerCase()} hasta el {formatDate(w.until)}.</span>)}
              {(r.memory ?? []).slice(-3).reverse().map((m, i) => <span key={i} className="tiny muted">· {m.text} ({formatDate(m.day)})</span>)}
            </div>
            {r.acquired ? (
              <p className="small gain"><Icon name="deal" size={13} /> Lo compraste el {formatDate(r.acquired.day)} por {fmtMoney(r.acquired.price, { decimals: false })}. Ya no compite con vos.</p>
            ) : (
              <div className="stack" style={{ gap: 4 }}>
                <span className="tiny muted">Comprar el grupo: {fmtMoney(rivalPrice(r), { decimals: false })} (su valor + {Math.round(CONTROL_PREMIUM * 100)} % de prima de control). <InfoButton term="adquisicion_rival" /></span>
                {rivalBlocker(s, r) ? <span className="tiny faint">{rivalBlocker(s, r)}</span> : (
                  <ConfirmButton label={`Comprar ${r.name}`} className="btn sm" confirmLabel="Comprar el grupo" detail={<>Pagás {fmtMoney(rivalPrice(r), { decimals: false })} de tu dinero. Recibís una holding con la caja del grupo, sus locales dejan de competir con vos y nunca más te ataca. La prima de control ({Math.round(CONTROL_PREMIUM * 100)} %) es el costo de quitarte un rival.</>} onConfirm={() => store.run((st) => acquireRival(st, r.id))} />
                )}
              </div>
            )}
            {r.moves.length === 0 ? <span className="tiny muted">Sin movimientos todavía.</span> : (
              <div className="rows">
                {r.moves.slice(-4).reverse().map((m, i) => (
                  <div className="row" key={i}><div className="grow small">{m.text}</div><span className="tiny muted">{formatDate(m.day)}{m.price ? ` · ${fmtMoney(m.price, { decimals: false })}` : ''}</span></div>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {s.world.rivals.length === 0 && <Empty icon="rivals">Sin rivales.</Empty>}
    </>
  );
}
