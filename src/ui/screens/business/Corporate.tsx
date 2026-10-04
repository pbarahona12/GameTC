import { useState } from 'react';
import { useGame, store } from '../../store';
import type { Company } from '../../../engine/business/types';
import { ipoBlocker, ipoPremium, goPublic, marketCap, buyBackShares, IPO_FEE, bondBlocker, bondCapacity, bondRate, issueBonds, mergeBlocker, mergeCost, mergeCompanies } from '../../../engine/saga/corporate';
import { execStatus, hireExecTeam, dismissExecTeam } from '../../../engine/saga/executive';
import { dealsOf, possibleDeals, signDeal, endDeal, DEAL_INFO, dealEstimate } from '../../../engine/saga/integration';
import { valuation, coMetrics } from '../../../engine/business/reports';
import { daysToBankruptcy } from '../../../engine/business/finance';
import { isOpen } from '../../../engine/business/common';
import { fmtMoney, fmtPct } from '../../../engine/format';
import { formatDate, formatMonth } from '../../../engine/time/calendar';
import { CardHead, ConfirmButton, LineChart, Seg, Pill, InfoButton, AmountInput } from '../../components/common';
import { navStore } from '../../nav';
import { Icon } from '../../icons';

/** SALIR A BOLSA: requisitos, precio según el ciclo y, si ya cotiza, su valor de mercado. */
export function IpoCard({ co }: { co: Company }) {
  const s = useGame();
  const [pct, setPct] = useState(20);
  if (co.listed) {
    const cap = marketCap(s, co);
    const caps = co.listed.caps;
    return (
      <div className="card">
        <CardHead title={`Cotiza en bolsa · ${co.listed.ticker}`} term="salida_bolsa" right={<Pill tone="accent">desde {formatDate(co.listed.day)}</Pill>} />
        <div className="kv">
          <dt>Valor de mercado</dt><dd><strong>{fmtMoney(cap, { decimals: false })}</strong></dd>
          <dt>Al salir a bolsa</dt><dd>{fmtMoney(co.listed.ipoValue, { decimals: false })}</dd>
          <dt>Tu participación</dt><dd>{fmtPct(co.ownership, 1)}</dd>
          <dt>En manos del público</dt><dd>{fmtPct(1 - co.ownership, 1)}</dd>
        </div>
        {caps.length >= 2 && <LineChart series={[{ name: 'Valor de mercado', values: caps.map((c) => c.v), color: 'var(--accent)' }]} pointLabels={caps.map((c) => formatMonth(c.d))} height={90} />}
        <p className="tiny muted">Cada trimestre la prensa publica sus resultados. Con acciones en manos del público, un rival puede intentar comprarlas.</p>
        {co.ownership < 1 && (
          <ConfirmButton label="Recomprar 5 % de acciones" className="btn sm" confirmLabel="Recomprar" detail={<>Cuesta ≈ {fmtMoney(Math.round(cap * Math.min(0.05, 1 - co.ownership) * 1.15), { decimals: false })} de tu dinero (15 % sobre el precio de mercado). Subís tu participación.</>} onConfirm={() => store.run((st) => { const c = st.companies.find((x) => x.id === co.id); return c ? buyBackShares(st, c, 0.05) : { ok: false, error: 'Empresa inexistente.' }; })} />
        )}
      </div>
    );
  }
  const why = ipoBlocker(s, co);
  const v = valuation(s, co).value * ipoPremium(s);
  const money = Math.round((v * pct) / 100 / (1 - pct / 100));
  return (
    <div className="card">
      <CardHead title="Salir a bolsa" term="salida_bolsa" />
      {why ? (
        <p className="small muted">{why}</p>
      ) : (
        <>
          <p className="small">Vendés acciones nuevas al público: el dinero entra a la caja de la empresa. En esta fase del ciclo los inversores pagan {ipoPremium(s) >= 1 ? `un ${fmtPct(ipoPremium(s) - 1, 0)} más` : `un ${fmtPct(1 - ipoPremium(s), 0)} menos`} que la valoración.</p>
          <Seg items={[10, 15, 20, 25, 30].filter((x) => co.ownership * (1 - x / 100) >= 0.51).map((x) => ({ id: x, label: `${x} %` }))} value={pct} onChange={setPct} />
          <span className="tiny muted">Solo se muestran los porcentajes con los que conservás al menos el 51 % (el control).</span>
          <div className="kv">
            <dt>Entran a la caja</dt><dd>≈ {fmtMoney(money, { decimals: false })} (menos {fmtPct(IPO_FEE, 0)} de comisiones)</dd>
            <dt>Tu participación después</dt><dd>{fmtPct(co.ownership * (1 - pct / 100), 1)}</dd>
          </div>
          <ConfirmButton label="Salir a bolsa" className="btn primary" confirmLabel={`Ofrecer el ${pct} %`} detail="Es permanente: los nuevos accionistas cobran su parte de los dividendos y de una futura venta. Suma reputación (+8)." onConfirm={() => store.run((st) => goPublic(st, co.id, pct / 100))} />
        </>
      )}
    </div>
  );
}

/** PROVEEDORES PROPIOS: acuerdos entre tus empresas. */
export function DealsCard({ co }: { co: Company }) {
  const s = useGame();
  const mine = dealsOf(s, co.id);
  const options = possibleDeals(s).filter((p) => p.supplier.id === co.id || p.buyer.id === co.id);
  if (!mine.length && !options.length) return null;
  const name = (id: number) => s.companies.find((c) => c.id === id)?.name ?? '—';
  return (
    <div className="card">
      <CardHead title="Proveedores propios" term="integracion_vertical" />
      {mine.map((d) => (
        <div key={d.id} className="row">
          <Icon name="network" size={16} />
          <div className="grow"><div className="title small">{DEAL_INFO[d.kind].name}: {name(d.supplierId)} → {name(d.buyerId)}</div><div className="meta">{DEAL_INFO[d.kind].what} · paga el {fmtPct(DEAL_INFO[d.kind].fee, 1)} de sus ventas · desde {formatDate(d.since)}</div></div>
          <button className="btn sm ghost" onClick={() => store.run((st) => endDeal(st, d.id))}>Terminar</button>
        </div>
      ))}
      {options.map((p) => (
        <div key={`${p.kind}-${p.supplier.id}-${p.buyer.id}`} className="row">
          <Icon name="plus" size={16} />
          <div className="grow"><div className="title small">{DEAL_INFO[p.kind].name}: {p.supplier.name} → {p.buyer.name}</div><div className="meta">{p.buyer.name} obtiene {DEAL_INFO[p.kind].what} y le paga a {p.supplier.name} el {fmtPct(DEAL_INFO[p.kind].fee, 1)} de sus ventas. {(() => { const e = dealEstimate(s, p.kind, p.buyer); return `Con su último mes: ahorra ≈ ${fmtMoney(e.save, { decimals: false })}/mes y paga ≈ ${fmtMoney(e.pay, { decimals: false })}/mes (queda en tu grupo).`; })()}</div></div>
          <button className="btn sm" onClick={() => store.run((st) => signDeal(st, p.kind, p.supplier.id, p.buyer.id))}>Firmar</button>
        </div>
      ))}
    </div>
  );
}

/** CÓMO VAN TUS EMPRESAS: un semáforo de un vistazo. */
export function CompanyTraffic() {
  const s = useGame();
  const open = s.companies.filter((c) => isOpen(c) && c.sector !== 'holding');
  if (open.length < 2) return null;
  const rows = open.map((co) => {
    const m = coMetrics(s, co);
    const left = daysToBankruptcy(s, co);
    const tone = co.status === 'insolvent' || left !== null || (m.runwayDays !== null && m.runwayDays < 60) ? 'loss' : m.net30 < 0 ? 'warn' : 'gain';
    const why = tone === 'loss' ? (left !== null ? `quiebra en ${left} días` : 'caja para menos de 2 meses') : tone === 'warn' ? 'pierde dinero este mes' : 'gana dinero';
    return { co, m, tone, why };
  }).sort((a, b) => ['loss', 'warn', 'gain'].indexOf(a.tone) - ['loss', 'warn', 'gain'].indexOf(b.tone));
  return (
    <div className="card">
      <CardHead title="Cómo van tus empresas" right={<InfoButton term="estado_resultados" />} />
      <div className="rows">
        {rows.map(({ co, m, tone, why }) => (
          <button key={co.id} className="row traffic-row" onClick={() => navStore.setSub('business', `co:${co.id}:summary`)}>
            <span className={`traffic ${tone}`} aria-label={why} />
            <div className="grow"><div className="title small">{co.name}</div><div className="meta">{why}</div></div>
            <span className={`amt small ${m.net30 >= 0 ? 'gain' : 'loss'}`}>{fmtMoney(m.net30, { decimals: false, sign: true })}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** EQUIPO DIRECTIVO: el costo de la complejidad, a la vista. */
export function ExecCard() {
  const s = useGame();
  const st = execStatus(s);
  if (st.companies < 3 && !st.hired) return null;
  return (
    <div className="card">
      <CardHead title="Equipo directivo" term="equipo_directivo" right={st.hired ? <Pill tone="gain">contratado</Pill> : st.adjustment < 0 ? <Pill tone="loss">{st.adjustment} a tus gerentes</Pill> : undefined} />
      {st.hired ? (
        <p className="small">Un director general, uno de finanzas y uno de operaciones coordinan tus {st.companies} empresas: tus gerentes rinden +5. Cuesta {fmtMoney(st.cost, { decimals: false })} por mes.</p>
      ) : (
        <p className="small">{st.adjustment < 0 ? `Con ${st.companies} empresas y nadie que coordine, tus gerentes pierden ${-st.adjustment} puntos de habilidad: deciden peor, producen menos y la calidad baja.` : `Hasta ${st.free} empresas podés coordinarlas vos. Desde la ${st.free + 1}.ª, sin equipo directivo, tus gerentes pierden eficacia.`} Un equipo cuesta {fmtMoney(st.cost, { decimals: false })} por mes.</p>
      )}
      {st.hired
        ? <button className="btn sm ghost" onClick={() => store.run((x) => dismissExecTeam(x))}>Despedir al equipo</button>
        : <ConfirmButton label="Contratar equipo directivo" className="btn sm primary" confirmLabel="Contratar" detail={<>Se paga el día 1 de cada mes desde tu cuenta. Si no alcanza, renuncian.</>} onConfirm={() => store.run((x) => hireExecTeam(x))} />}
    </div>
  );
}

/** BONOS CORPORATIVOS: deuda que se paga con cupones y se devuelve al vencer. */
export function BondsCard({ co }: { co: Company }) {
  const s = useGame();
  const [years, setYears] = useState(5);
  const cap = bondCapacity(s, co);
  const [amount, setAmount] = useState(0);
  const why = bondBlocker(s, co);
  const bonds = co.loans.filter((l) => l.bullet && l.balance > 0);
  const rate = bondRate(s, co) + (years === 10 ? 0.01 : years === 5 ? 0.004 : 0);
  return (
    <div className="card">
      <CardHead title="Emitir bonos" term="bonos_corporativos" />
      {bonds.map((b) => <p key={b.id} className="small">Bonos por {fmtMoney(b.balance, { decimals: false })} al {fmtPct(b.apr, 2)} · cupón {fmtMoney(b.payment, { decimals: false })}/mes · vencen en {b.termMonths - b.paymentsMade} meses.</p>)}
      {why ? <p className="small muted">{why}</p> : (
        <>
          <p className="small">Pedís prestado al mercado: pagás solo intereses cada mes y devolvés todo el capital al vencer. Podés emitir hasta {fmtMoney(cap, { decimals: false })} (3 veces el EBITDA anual menos la deuda actual).</p>
          <Seg items={[3, 5, 10].map((x) => ({ id: x, label: `${x} años` }))} value={years} onChange={setYears} />
          <AmountInput id={`bond-${co.id}`} value={amount} onChange={setAmount} label="Monto a emitir" />
          <div className="kv"><dt>Tasa estimada</dt><dd>{fmtPct(rate, 2)} anual</dd><dt>Cupón mensual</dt><dd>{fmtMoney(Math.round((amount * rate) / 12), { decimals: false })}</dd><dt>Comisión de colocación</dt><dd>{fmtMoney(Math.round(amount * 0.02), { decimals: false })}</dd></div>
          <ConfirmButton label="Emitir bonos" className="btn primary" disabled={!amount} confirmLabel="Emitir" detail={<>Al vencer hay que devolver {fmtMoney(amount, { decimals: false })} de una vez: si la caja no alcanza, queda como deuda vencida.</>} onConfirm={() => { const r = store.run((st) => issueBonds(st, co.id, amount, years)); if (r.ok) setAmount(0); }} />
        </>
      )}
    </div>
  );
}

/** FUSIÓN: absorber otra empresa propia del mismo rubro. */
export function MergeCard({ co }: { co: Company }) {
  const s = useGame();
  const peers = s.companies.filter((c) => c.id !== co.id && c.sector === co.sector && isOpen(c) && !c.npc);
  const [target, setTarget] = useState<number | null>(peers[0]?.id ?? null);
  if (!peers.length || co.sector === 'holding') return null;
  const b = peers.find((c) => c.id === target) ?? peers[0];
  const why = mergeBlocker(s, co, b);
  return (
    <div className="card">
      <CardHead title="Fusionar empresas" term="fusion_empresas" />
      <p className="small">{co.name} absorbe a otra empresa tuya del mismo rubro: un solo equipo, una sola administración y un solo alquiler. Cuesta una integración y la absorbida desaparece.</p>
      <select className="input" aria-label="Empresa a absorber" value={b.id} onChange={(e) => setTarget(Number(e.target.value))}>
        {peers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {why ? <p className="small muted">{why}</p> : (
        <ConfirmButton label={`Absorber ${b.name}`} className="btn sm" confirmLabel="Fusionar" detail={<>Integración: {fmtMoney(mergeCost(s, b), { decimals: false })}. Todo lo de {b.name} (personal, equipos, inventario, deudas e inmuebles) pasa a {co.name}. Sus pérdidas fiscales de años anteriores se pierden. No se puede deshacer.</>} onConfirm={() => store.run((st) => mergeCompanies(st, co.id, b.id))} />
      )}
    </div>
  );
}
