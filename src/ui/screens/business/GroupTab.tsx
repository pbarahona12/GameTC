import { useState } from 'react';
import { useGame, useUI, useDerived, store } from '../../store';
import { groupOf, groupRisksOf } from '../../derived';
import { navStore } from '../../nav';
import type { Company } from '../../../engine/business/types';
import { LEGAL_FORM_BY_ID } from '../../../content/sectors';
import { JURISDICTION_BY_ID } from '../../../content/jurisdictions';
import { isOpen } from '../../../engine/business/common';
import { coMetrics } from '../../../engine/business/reports';
import { CO_CHART } from '../../../engine/business/companyLedger';
import {
  parentOf, childrenOf, rootOf, isHolding, icLoansOf, grantIcLoan, repayIcLoan, setGroupPolicy, setManagementFee, canJoinGroup, groupMembers,
} from '../../../engine/business/groups';
import { transferToGroup, spinOff } from '../../../engine/business/ownership';
import { companyTaxRates } from '../../../engine/business/ownership';
import { propertyReport } from '../../../engine/realestate/realestate';
import { fmtMoney, fmtPct } from '../../../engine/format';
import { formatDate } from '../../../engine/time/calendar';
import { Money, InfoButton, CardHead, Act, ConfirmButton, Seg, AmountInput, NumInput, Pill, Stat, Empty } from '../../components/common';
import { runCo } from './CompanyView';
import { SECTOR_ICON, PROPERTY_ICON } from '../../contentIcons';
import { Icon } from '../../icons';

function Consolidated({ root }: { root: Company }) {
  const c = useDerived(groupOf, root.id);
  const r = useDerived(groupRisksOf, root.id);
  return (
    <>
      <div className="card">
        <CardHead title={`Estados consolidados · ${c.members.length} empresas`} term="consolidacion" />
        <div className="grid2">
          <Stat label="Ventas 30 días" value={<Money c={c.revenue} />} sub={`EBITDA ${fmtMoney(c.ebitda, { decimals: false })}`} />
          <Stat label="Resultado atribuible 30 d" term="interes_minoritario" value={<Money c={c.attributableNet} colored sign />} sub={c.minorityNet ? `Minoritarios ${fmtMoney(c.minorityNet, { decimals: false })}` : 'Sin minoritarios'} />
          <Stat label="Activos consolidados" value={<Money c={c.totalAssets} />} sub={`Pasivos ${fmtMoney(c.totalLiabilities, { decimals: false })}`} />
          <Stat label="Patrimonio atribuible" value={<Money c={c.attributableEquity} />} sub={`Endeudamiento ${fmtPct(c.debtRatio, 0)}`} />
        </div>
        <div className="rows">
          {c.assets.map((a) => <div className="row sub" key={a.account}><div className="grow small">{CO_CHART[a.account].name}</div><Money c={a.amount} className="amt small" /></div>)}
          {c.goodwill !== 0 && <div className="row sub"><div className="grow small">Plusvalía</div><Money c={c.goodwill} className="amt small" /></div>}
          <div className="row total"><div className="grow">Activos</div><Money c={c.totalAssets} className="amt" /></div>
          {c.liabilities.map((a) => <div className="row sub" key={a.account}><div className="grow small">{CO_CHART[a.account].name}</div><Money c={a.amount} className="amt small" /></div>)}
          <div className="row total"><div className="grow">Pasivos</div><Money c={c.totalLiabilities} className="amt" /></div>
          {c.minority > 0 && <div className="row sub"><div className="grow small">Interés minoritario</div><Money c={c.minority} className="amt small" /></div>}
        </div>
        <details>
          <summary className="small"><strong>Eliminaciones (sin doble conteo)</strong></summary>
          <div className="kv">
            <dt>Inversión de las matrices en subsidiarias</dt><dd>−{fmtMoney(c.eliminated.investments)}</dd>
            <dt>Préstamos entre empresas del grupo</dt><dd>−{fmtMoney(c.eliminated.icBalances)} (cobrar y pagar)</dd>
            <dt>Intereses y honorarios intragrupo (30 d)</dt><dd>{fmtMoney(c.eliminated.icResults)} se cancelan</dd>
            <dt>Resultado de subsidiarias (método de participación)</dt><dd>−{fmtMoney(c.eliminated.subsidiaryResults)}</dd>
          </div>
          <p className="tiny muted">Se suman los libros de todas las empresas y se quita lo que solo existe dentro del grupo: así los activos y los resultados no se cuentan dos veces.</p>
        </details>
        {c.checks.map((x) => <p key={x} className="tiny warn">{x}</p>)}
      </div>
      <div className="card">
        <CardHead title="Riesgos del grupo" term="subsidiaria" />
        <div className="rows">
          {r.members.map((m) => (
            <div className="row" key={m.company.id}>
              <div className="grow">
                <div className="title small">{m.company.name}</div>
                <div className="meta">Deuda/activos {fmtPct(m.debtRatio, 0)} · caja {m.runwayDays === null ? 'genera' : `~${Math.round(m.runwayDays)} días`}{m.arrears ? ` · atrasos ${fmtMoney(m.arrears, { decimals: false })}` : ''}{m.exposure ? ` · prestó ${fmtMoney(m.exposure, { decimals: false })} al grupo` : ''}</div>
              </div>
              <Money c={m.netIncome30} colored sign className="small" />
            </div>
          ))}
        </div>
        <div className="kv">
          <dt>Caja consolidada</dt><dd>{fmtMoney(r.consolidated.cash)}</dd>
          <dt>Préstamos intragrupo vigentes</dt><dd>{fmtMoney(r.consolidated.intercompany)}</dd>
          <dt>Garantías personales</dt><dd>{fmtMoney(r.consolidated.guaranteed)}</dd>
        </div>
        {r.consolidated.warnings.length === 0 ? <p className="small gain">Sin alertas consolidadas.</p> : r.consolidated.warnings.map((w) => <p key={w} className="small loss"><Icon name="alert" size={14} /> {w}</p>)}
      </div>
    </>
  );
}

function IcLoans({ co }: { co: Company }) {
  const s = useGame();
  useUI();
  const root = rootOf(s, co);
  const members = groupMembers(s, root).filter((m) => isOpen(m) && m.id !== co.id);
  const { lent, borrowed } = icLoansOf(s, co);
  const [to, setTo] = useState<number | null>(members[0]?.id ?? null);
  const [amount, setAmount] = useState(0);
  const [rate, setRate] = useState(5);
  const [months, setMonths] = useState(12);
  const [repay, setRepay] = useState(0);
  const name = (id: number) => s.companies.find((c) => c.id === id)?.name ?? '—';
  return (
    <div className="card">
      <CardHead title="Préstamos intragrupo" term="prestamo_intragrupo" />
      {lent.length + borrowed.length === 0 && <p className="small muted">Sin préstamos vigentes.</p>}
      <div className="rows">
        {[...lent.map((l) => ({ l, dir: 'prestó a' as const })), ...borrowed.map((l) => ({ l, dir: 'debe a' as const }))].map(({ l, dir }) => (
          <div className="row" key={l.id}>
            <div className="grow">
              <div className="small">{co.name} {dir} {name(dir === 'prestó a' ? l.borrowerId : l.lenderId)}</div>
              <div className="tiny faint">Saldo {fmtMoney(l.balance)} · {fmtPct(l.rate, 1)} anual · vence {formatDate(l.dueDay)}</div>
            </div>
            {dir === 'debe a' && <Act label="Devolver" help="accion_prestamo_intragrupo" className="btn sm ghost" disabled={!(repay > 0)} onClick={() => store.run((x) => repayIcLoan(x, l.id, repay))} />}
          </div>
        ))}
      </div>
      {borrowed.length > 0 && <div className="field"><label htmlFor="ic-repay">Monto a devolver</label><AmountInput id="ic-repay" value={repay} onChange={setRepay} max={co.ledger.balances.cash} /></div>}
      {members.length > 0 && (
        <>
          <strong className="small">Prestar desde {co.name} a…</strong>
          <div className="chips">{members.map((m) => <button key={m.id} aria-pressed={to === m.id} onClick={() => setTo(m.id)} style={to === m.id ? { background: 'var(--text)', color: 'var(--bg)' } : undefined}>{m.name}</button>)}</div>
          <AmountInput id="ic-amt" value={amount} onChange={setAmount} max={co.ledger.balances.cash} />
          <div className="inline-form small"><span>Tasa anual</span><NumInput id="ic-rate" live value={rate} onChange={setRate} step={0.5} suffix="%" /><span>Plazo</span><NumInput id="ic-m" live value={months} onChange={setMonths} suffix="meses" /></div>
          <p className="tiny muted">Los intereses son ingreso para quien presta y gasto para quien recibe (cambia dónde tributa la ganancia si están en distintas jurisdicciones). En los estados consolidados se eliminan.</p>
          <Act label="Otorgar préstamo" help="accion_prestamo_intragrupo" className="btn sm" disabled={!to || !(amount > 0)} onClick={() => store.run((x) => grantIcLoan(x, co.id, to!, amount, rate / 100, months))} />
        </>
      )}
    </div>
  );
}

export function GroupTab({ co }: { co: Company }) {
  const s = useGame();
  useUI();
  const parent = parentOf(s, co);
  const kids = childrenOf(s, co);
  const holding = isHolding(co);
  const j = JURISDICTION_BY_ID[co.jurisdiction];
  const rates = companyTaxRates(co);
  const holdings = s.companies.filter((c) => isOpen(c) && isHolding(c) && c.id !== co.id);
  const candidates = holding ? s.companies.filter((c) => isOpen(c) && !canJoinGroup(c) && c.id !== co.id) : [];
  const props = s.realEstate.properties.filter((p) => p.owner.kind === 'company' && p.owner.id === co.id);
  const [fee, setFee] = useState(Math.round((co.managementFee ?? 0) * 1000) / 10);
  const pol = co.group ?? { upstreamPayout: 0, cashPooling: false, centralDelegation: false };
  const joinWhy = canJoinGroup(co);
  const inGroup = holding || !!parent;
  return (
    <>
      <div className="card">
        <CardHead title="Jurisdicción de registro" term="jurisdiccion" />
        <div className="kv">
          <dt>País</dt><dd>{j.flag} {j.name}</dd>
          <dt>Impuesto de sociedades</dt><dd>{LEGAL_FORM_BY_ID[co.legalForm].passThrough ? 'Tributa en tu declaración personal' : fmtPct(rates.corporate, 0)}</dd>
          <dt>Retención sobre dividendos</dt><dd>{parent ? 'Exentos hacia la matriz (participación)' : fmtPct(rates.dividend, 0)} <InfoButton term="exencion_participacion" /></dd>
          {co.jurisdiction !== s.tax.jurisdiction && <><dt>Administración extranjera</dt><dd>{fmtMoney(Math.round(j.foreignCompanyAdmin * 100 * s.macro.priceIndex))}/mes</dd></>}
        </div>
      </div>

      {parent && (
        <div className="card">
          <CardHead title={`Subsidiaria de ${parent.name}`} term="subsidiaria" />
          <p className="small">Su resultado se refleja en el patrimonio de {parent.name} por el método de participación. Los dividendos hacia la matriz no pagan retención.</p>
          <div className="inline-form small"><span>Honorario de gestión a la matriz</span><NumInput id="mgmt-fee" live value={fee} onChange={setFee} step={0.5} suffix="% de ventas" /></div>
          <Act label="Guardar honorario" help="honorario_gestion" className="btn sm" onClick={() => store.run((x) => setManagementFee(x, co.id, fee / 100))} />
          <ConfirmButton label="Sacar del grupo (a tu nombre)" help="accion_spinoff" className="btn sm ghost" detail="La matriz te entrega la empresa como dividendo en especie. Los préstamos intragrupo se cancelan primero." onConfirm={() => runCo(co.id, (st, c) => spinOff(st, c))} />
          <button className="btn sm ghost" onClick={() => navStore.setSub('business', `co:${parent.id}:group`)}>Ver el grupo completo</button>
        </div>
      )}

      {holding && (
        <>
          <div className="card">
            <CardHead title="Subsidiarias" term="holding" />
            {kids.length === 0 && <Empty icon="network">Esta holding todavía no tiene subsidiarias. Transferile empresas tuyas, fundá una nueva a su nombre o comprá una en el mercado.</Empty>}
            <div className="rows">
              {kids.map((k) => {
                const m = coMetrics(s, k);
                return (
                  <button key={k.id} className="row clickable" style={{ border: 0, borderBottom: '1px solid var(--line)', background: 'none', textAlign: 'left', width: '100%' }} onClick={() => navStore.setSub('business', `co:${k.id}:summary`)}>
                    <Icon name={SECTOR_ICON[k.sector]} size={16} />
                    <div className="grow"><div className="title small">{k.name}</div><div className="meta">{fmtPct(k.ownership, 0)} · valor contable {fmtMoney(k.carrying, { decimals: false })} · caja {fmtMoney(m.cash, { decimals: false })}</div></div>
                    <Money c={m.net30} colored sign className="small" />
                  </button>
                );
              })}
            </div>
            <div className="btn-row">
              <Act label="Fundar subsidiaria" help="accion_fundar" className="btn sm" onClick={() => navStore.setSub('business', `found:${co.id}`)} />
              <Act label="Comprar empresa para el grupo" help="accion_comprar_empresa" className="btn sm ghost" onClick={() => navStore.setSub('business', `market:${co.id}`)} />
            </div>
            {candidates.length > 0 && (
              <>
                <strong className="small">Transferir una empresa tuya a la holding <InfoButton term="accion_transferir_grupo" /></strong>
                {candidates.map((c) => (
                  <ConfirmButton key={c.id} label={`Transferir ${c.name}`} className="btn sm ghost" detail="Aporte en especie al valor contable: tu patrimonio no cambia, pero ahora la tenés a través de la holding." onConfirm={() => store.run((x) => transferToGroup(x, c.id, co.id))} />
                ))}
              </>
            )}
          </div>
          <div className="card">
            <CardHead title="Administración centralizada" term="accion_politica_grupo" />
            <div className="field">
              <label>Dividendos de las subsidiarias a la matriz (cada mes)</label>
              <Seg items={[{ id: '0', label: '0 %' }, { id: '0.25', label: '25 %' }, { id: '0.5', label: '50 %' }, { id: '1', label: '100 %' }]} value={String(pol.upstreamPayout)} onChange={(v) => store.run((x) => setGroupPolicy(x, co.id, { upstreamPayout: Number(v) }))} />
              <span className="tiny muted">Porcentaje de la ganancia mensual (si hay caja por encima de la reserva). Exento de retención.</span>
            </div>
            <div className="field">
              <label>Centralizar caja (cash pooling) <InfoButton term="centralizacion_caja" /></label>
              <Seg items={[{ id: 'no', label: 'No' }, { id: 'si', label: 'Sí' }]} value={pol.cashPooling ? 'si' : 'no'} onChange={(v) => store.run((x) => setGroupPolicy(x, co.id, { cashPooling: v === 'si' }))} />
              <span className="tiny muted">Los excedentes de las subsidiarias se prestan a la matriz (préstamo intragrupo) para usarlos donde hagan falta.</span>
            </div>
            <div className="field">
              <label>Aplicar la delegación a todo el grupo <InfoButton term="delegacion" /></label>
              <Seg items={[{ id: 'no', label: 'No' }, { id: 'si', label: 'Sí' }]} value={pol.centralDelegation ? 'si' : 'no'} onChange={(v) => store.run((x) => setGroupPolicy(x, co.id, { centralDelegation: v === 'si' }))} />
            </div>
          </div>
          {kids.length > 0 && <Consolidated root={co} />}
        </>
      )}

      {inGroup && <IcLoans co={co} />}

      {!inGroup && (
        <div className="card">
          <CardHead title="Grupo empresarial" term="holding" />
          {joinWhy ? <p className="small muted">{joinWhy}</p> : holdings.length === 0 ? (
            <p className="small">Podés crear una holding (en Negocios → Crear holding) y transferirle esta empresa para administrarlas como grupo.</p>
          ) : (
            holdings.map((h) => <ConfirmButton key={h.id} label={`Transferir a ${h.name}`} help="accion_transferir_grupo" className="btn sm" detail="Tu patrimonio no cambia: la tendrás a través de la holding." onConfirm={() => store.run((x) => transferToGroup(x, co.id, h.id))} />)
          )}
        </div>
      )}

      <div className="card">
        <CardHead title="Inmuebles de la empresa" term="inmueble" />
        {props.length === 0 && <p className="small muted">La empresa no tiene inmuebles. Puede comprarlos en Invertir → Inmuebles eligiéndola como compradora (se registran al costo y se deprecian). Usar un local propio evita pagar alquiler.</p>}
        {props.map((p) => {
          const r = propertyReport(s, p);
          return (
            <button key={p.id} className="row clickable" style={{ border: 0, background: 'none', textAlign: 'left', width: '100%' }} onClick={() => navStore.go('invest', `realestate:prop:${p.id}`)}>
              <Icon name={PROPERTY_ICON[p.type]} size={16} />
              <div className="grow"><div className="title small">{p.name} {p.usedBy === co.id && <Pill tone="accent">Local propio</Pill>}</div><div className="meta">Libros {fmtMoney(p.carrying, { decimals: false })} · tasación {fmtMoney(p.appraisal, { decimals: false })}</div></div>
              <Money c={r.monthlyCashFlow} colored sign className="small" />
            </button>
          );
        })}
      </div>
    </>
  );
}
