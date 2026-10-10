import { Fragment, useState } from 'react';
import { useGame, useUI, useDerived } from '../../store';
import { coIncomeOf, coCashFlowOf } from '../../derived';
import type { Company, Channel, Audience } from '../../../engine/business/types';
import { SECTOR_BY_ID, LEGAL_FORM_BY_ID } from '../../../content/sectors';
import { CHANNELS, CHANNEL_BY_ID, AUDIENCES, startCampaign, stopCampaign, buyResearch, hasResearch, RESEARCH_COST, activeCampaigns } from '../../../engine/business/marketing';
import { coIncomeStatement, coBalanceSheet, coMetrics, valuation } from '../../../engine/business/reports';
import { BIZ_BANKS, quoteCoLoan, takeCoLoan, prepayCoLoan, payCoArrearsNow, coTaxRateLabel } from '../../../engine/business/finance';
import { injectCapital, distribute, maxDistribution, companyTaxRates, requestSaleOffer, acceptSale, liquidate, raiseEquity, SALE_FEE } from '../../../engine/business/ownership';
import { rivalsAttraction } from '../../../engine/business/market';
import { expectedShare, refPrice, companyAttraction, effectivePrice } from '../../../engine/business/operations';
import { distributableProfit, isOpen } from '../../../engine/business/common';
import { fmtMoney, fmtPct, fmtNumber } from '../../../engine/format';
import { spendable } from '../../../engine/finance/payments';
import { formatDate, startOfMonth, startOfYear, addMonths, last30Start } from '../../../engine/time/calendar';
import { Cents, usd } from '../../../engine/money';
import { Money, InfoButton, Pill, AmountInput, ConfirmButton, CardHead, Act, Seg, NumInput, Learn } from '../../components/common';
import { runCo } from './CompanyView';
import { navStore } from '../../nav';
import { CapitalMarketsCards, DealsCard, MergeCard } from './Corporate';

export function MarketingTab({ co }: { co: Company }) {
  const s = useGame();
  useUI();
  const [channel, setChannel] = useState<Channel>('digital');
  const [audience, setAudience] = useState<Audience>('general');
  const [budget, setBudget] = useState<Cents>(usd(30 * s.macro.priceIndex));
  const [days, setDays] = useState(30);
  const ch = CHANNEL_BY_ID[channel];
  const revenue30 = coIncomeStatement(co, Math.max(co.openDay, last30Start(s.day)), s.day).revenue;
  return (
    <>
      <div className="card">
        <CardHead title="Marca" term="conocimiento_marca" />
        <div className="kv">
          <dt>Conocimiento de marca</dt><dd>{Math.round(co.awareness)}/100</dd>
          <dt>Reputación</dt><dd>{Math.round(co.reputation)}/100</dd>
          <dt>Calidad</dt><dd>{Math.round(co.quality)}/100</dd>
        </div>
        <Learn term="marketing" />
      </div>
      <div className="card">
        <CardHead title="Campañas" term="marketing" />
        {co.campaigns.length === 0 && <p className="small muted">Sin campañas todavía.</p>}
        {co.campaigns.slice().reverse().slice(0, 8).map((c) => {
          const active = c.startDay <= s.day && c.endDay >= s.day;
          const est = co.awareness > 0 ? Math.round((c.awarenessGained / Math.max(5, co.awareness)) * revenue30 * 0.5) : 0;
          return (
            <div key={c.id} className="stack" style={{ gap: 4, borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <strong className="small" style={{ flex: 1 }}>{CHANNEL_BY_ID[c.channel].name}</strong>
                {active ? <Pill tone="gain">activa</Pill> : c.startDay > s.day ? <Pill tone="info">programada</Pill> : <Pill tone="neutral">terminada</Pill>}
              </div>
              <div className="kv">
                <dt>Presupuesto · público</dt><dd>{fmtMoney(c.dailyBudget)}/día · {AUDIENCES.find((a) => a.id === c.audience)?.name}</dd>
                <dt>Período</dt><dd>{formatDate(c.startDay)} – {formatDate(c.endDay)}</dd>
                <dt>Gastado</dt><dd>{fmtMoney(c.spent)}</dd>
                <dt>Alcance estimado</dt><dd>{fmtNumber(c.reach)} personas</dd>
                <dt>Conocimiento ganado</dt><dd>+{c.awarenessGained.toFixed(1)} puntos</dd>
                <dt>Retorno (estimación aprox.)</dt><dd className={est - c.spent >= 0 ? 'gain' : 'loss'}>{fmtMoney(est - c.spent)}</dd>
              </div>
              {active && <button className="btn sm ghost" onClick={() => runCo(co.id, (st, x) => stopCampaign(st, x, c.id))}>Detener</button>}
            </div>
          );
        })}
        <p className="tiny muted">El retorno es una estimación: atribuye a la campaña una parte de las ventas proporcional al conocimiento que aportó. La demanda también depende de precio, calidad y stock.</p>
      </div>
      <div className="card">
        <CardHead title="Nueva campaña" term="accion_campana" />
        <select className="input" aria-label="Canal" value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
          {CHANNELS.map((c) => <option key={c.id} value={c.id} disabled={activeCampaigns(s, co).some((x) => x.channel === c.id)}>{c.name}</option>)}
        </select>
        <p className="small muted">{ch.description}</p>
        <div className="field"><label>Público objetivo</label><Seg items={AUDIENCES.map((a) => ({ id: a.id, label: a.name }))} value={audience} onChange={setAudience} /></div>
        <div className="field"><label htmlFor="mk-budget">Presupuesto diario</label><AmountInput id="mk-budget" value={budget} onChange={setBudget} /></div>
        <div className="inline-form small"><span>Duración</span><NumInput id="mk-days" live value={days} onChange={setDays} suffix="días" /></div>
        <p className="small">Costo total: <strong>{fmtMoney(budget * days)}</strong>. Caja de la empresa: {fmtMoney(co.ledger.balances.cash)}.</p>
        <Act label="Lanzar campaña" help="accion_campana" className="btn primary" onClick={() => runCo(co.id, (st, x) => startCampaign(st, x, channel, budget, days, audience))} />
      </div>
      <div className="card">
        <CardHead title="Estudio de mercado" term="accion_estudio" />
        {hasResearch(s, co) ? <p className="small gain">Estudio vigente hasta {formatDate(co.research!.validUntil)}: la pestaña Mercado muestra datos exactos.</p> : (
          <Act label={`Contratar estudio (${fmtMoney(usd(RESEARCH_COST * s.macro.priceIndex), { decimals: false })})`} help="accion_estudio" className="btn" onClick={() => runCo(co.id, (st, x) => buyResearch(st, x))} />
        )}
      </div>
    </>
  );
}

export function MarketTab({ co }: { co: Company }) {
  const s = useGame();
  useUI();
  const sec = SECTOR_BY_ID[co.sector];
  const market = s.markets[co.sector];
  const exact = hasResearch(s, co);
  const p = sec.products[0];
  const { rivals, outside, each } = rivalsAttraction(market, p.elasticity);
  const mine = companyAttraction(s, co, p, effectivePrice(s, co, p.id));
  const total = rivals + outside + mine;
  const fuzz = (v: number, key: number) => (exact ? v : Math.round(v / 10) * 10 + ((key * 7) % 5) - 2);
  return (
    <>
      <div className="card">
        <CardHead title="Competencia" term="cuota_mercado" />
        <p className="small muted">{exact ? 'Datos exactos del estudio de mercado.' : 'Sin estudio de mercado, los datos de los rivales son aproximados (unos ±7 puntos). Contratá uno en Marketing.'}</p>
        <div className="hscroll">
          <table className="table">
            <thead><tr><th>Empresa</th><th className="r">Precio vs ref.</th><th className="r">Calidad</th><th className="r">Reputación</th><th className="r">Marca</th><th className="r">Cuota ({p.name})</th></tr></thead>
            <tbody>
              <tr style={{ fontWeight: 700 }}>
                <td>{co.name} (vos)</td>
                <td className="r">{fmtPct(co.products[0].price / refPrice(s, p) - 1, 0)}</td>
                <td className="r">{Math.round(co.quality)}</td>
                <td className="r">{Math.round(co.reputation)}</td>
                <td className="r">{Math.round(co.awareness)}</td>
                <td className="r">{fmtPct(mine / total)}</td>
              </tr>
              {each.map(({ c, a }) => (
                <tr key={c.id}>
                  <td>{c.name}{c.enteredDay > 0 && <div className="tiny faint">entró {formatDate(c.enteredDay)}</div>}</td>
                  <td className="r">{exact ? fmtPct(c.priceMult - 1, 0) : `≈ ${fmtPct(Math.round((c.priceMult - 1) * 20) / 20, 0)}`}</td>
                  <td className="r">{fuzz(c.quality, c.id)}</td>
                  <td className="r">{fuzz(c.reputation, c.id + 1)}</td>
                  <td className="r">{fuzz(c.awareness, c.id + 2)}</td>
                  <td className="r">{exact ? fmtPct(a / total) : `≈ ${fmtPct(Math.round((a / total) * 20) / 20, 0)}`}</td>
                </tr>
              ))}
              <tr className="muted"><td>No compran</td><td /><td /><td /><td /><td className="r">{exact ? fmtPct(outside / total) : '—'}</td></tr>
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <CardHead title="Demanda del sector" term="elasticidad" />
        <div className="kv">
          <dt>Índice de demanda del sector</dt><dd>{market.index.toFixed(2)}</dd>
          <dt>Tasa de política (afecta a sectores sensibles)</dt><dd>{fmtPct(s.macro.policyRate, 2)}</dd>
          {exact && sec.products.map((x) => (
            <Fragment key={x.id}>
              <dt>{x.name}: mercado diario · elasticidad</dt><dd>{x.marketDaily} · {x.elasticity}</dd>
              <dt>Tu cuota esperada a tu precio</dt><dd>{fmtPct(expectedShare(s, co, x, effectivePrice(s, co, x.id)))}</dd>
            </Fragment>
          ))}
        </div>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{sec.economics.map((e) => <li key={e}>{e}</li>)}</ul>
      </div>
    </>
  );
}

type Period = 'month' | 'year' | 'all';

/** Renglón de un estado contable de la empresa. */
function Row({ label, v, strong, term }: { label: string; v: Cents; strong?: boolean; term?: string }) {
  return <div className={`row ${strong ? 'total' : 'sub'}`}><div className="grow small" style={strong ? { fontWeight: 800 } : undefined}>{label} {term && <InfoButton term={term} />}</div><Money c={v} className="amt small" colored={strong} /></div>;
}

export function FinanceTab({ co }: { co: Company }) {
  const s = useGame();
  const [period, setPeriod] = useState<Period>('month');
  const [inject, setInject] = useState<Cents>(0);
  const [div, setDiv] = useState<Cents>(0);
  const [loanAmt, setLoanAmt] = useState<Cents>(usd(5000));
  const [loanTerm, setLoanTerm] = useState(24);
  const from = period === 'month' ? Math.max(co.foundedDay, startOfMonth(s.day)) : period === 'year' ? Math.max(co.foundedDay, startOfYear(s.day)) : co.foundedDay;
  const is = useDerived(coIncomeOf, co.id, from);
  const bs = coBalanceSheet(co);
  const cf = useDerived(coCashFlowOf, co.id, from);
  const lim = maxDistribution(s, co);
  const lf = LEGAL_FORM_BY_ID[co.legalForm];
  const m = coMetrics(s, co);
  return (
    <>
      {bs.liabilities.some((l) => l.account === 'arrears') && (
        <div className="card" style={{ borderColor: 'var(--loss)' }}>
          <CardHead title="Deudas vencidas" term="quiebra" />
          {co.arrears.map((a) => <div className="row" key={a.id}><div className="grow small">{a.label}<div className="tiny faint">desde {formatDate(a.since)}</div></div><span className="amt small loss">{fmtMoney(a.amount)}</span></div>)}
          <button className="btn sm" onClick={() => runCo(co.id, (st, c) => payCoArrearsNow(st, c))}>Pagar con la caja disponible</button>
        </div>
      )}
      <Seg items={[{ id: 'month', label: 'Este mes' }, { id: 'year', label: 'Este año' }, { id: 'all', label: 'Desde el inicio' }]} value={period} onChange={setPeriod} />
      <div className="card">
        <CardHead title="Estado de resultados" term="estado_resultados" />
        <p className="tiny muted">{formatDate(from)} – {formatDate(s.day)}</p>
        <div className="rows">
          <Row label="Ventas (ingresos brutos)" v={is.revenue} />
          {is.cogs.map((l) => <Row key={l.account} label={`− ${l.name}`} v={-l.amount} />)}
          <Row label="Beneficio bruto" v={is.grossProfit} strong term="margen_bruto" />
          {is.opex.map((l) => <Row key={l.account} label={`− ${l.name}`} v={-l.amount} />)}
          <Row label="EBITDA" v={is.ebitda} strong term="ebitda" />
          <Row label="− Depreciación" v={-is.depreciation} />
          <Row label="Beneficio operativo" v={is.operatingProfit} strong term="beneficio_operativo" />
          {is.financial.map((l) => <Row key={l.account} label={`− ${l.name}`} v={-l.amount} />)}
          {is.otherIncome !== 0 && <Row label="+ Otros ingresos" v={is.otherIncome} />}
          <Row label="Beneficio antes de impuestos" v={is.preTax} strong />
          <Row label="− Impuesto empresarial" v={-is.tax} />
          <Row label="Beneficio neto" v={is.netIncome} strong />
        </div>
        <p className="tiny muted">Margen bruto {fmtPct(is.grossMargin)} · margen neto {fmtPct(is.netMargin)} · {coTaxRateLabel(co)}.</p>
      </div>
      <div className="card">
        <CardHead title="Balance general" term="balance_general" />
        <div className="rows">
          {bs.assets.map((l) => <Row key={l.account} label={l.name} v={l.amount} />)}
          <Row label="Total activos" v={bs.totalAssets} strong />
          {bs.liabilities.map((l) => <Row key={l.account} label={l.name} v={l.amount} />)}
          <Row label="Total pasivos" v={bs.totalLiabilities} strong />
          <Row label="Capital aportado" v={bs.capital} />
          <Row label="Dividendos y retiros" v={bs.distributions} />
          <Row label="Resultados acumulados" v={bs.retained} />
          <Row label="Patrimonio" v={bs.equity} strong />
        </div>
        <div className="kv">
          <dt>Capital de trabajo <InfoButton term="capital_trabajo" /></dt><dd>{fmtMoney(bs.workingCapital)}</dd>
          <dt>Liquidez corriente</dt><dd>{bs.currentRatio === null ? '—' : bs.currentRatio.toFixed(2)}</dd>
          <dt>Endeudamiento <InfoButton term="solvencia" /></dt><dd>{bs.debtRatio === Infinity ? '—' : fmtPct(bs.debtRatio)}</dd>
          <dt>Ecuación contable</dt><dd>{bs.balanced ? <span className="gain">✓ cuadra</span> : <span className="loss">✗</span>}</dd>
        </div>
      </div>
      <div className="card">
        <CardHead title="Flujo de caja" term="flujo_caja" />
        <div className="rows">
          <Row label="Saldo inicial" v={cf.opening} />
          {cf.operating.map((x) => <Row key={'o' + x.label} label={x.label} v={x.amount} />)}
          <Row label="Flujo operativo" v={cf.totalOperating} strong />
          {cf.investing.map((x) => <Row key={'i' + x.label} label={x.label} v={x.amount} />)}
          <Row label="Flujo de inversión" v={cf.totalInvesting} strong />
          {cf.financing.map((x) => <Row key={'f' + x.label} label={x.label} v={x.amount} />)}
          <Row label="Flujo de financiamiento" v={cf.totalFinancing} strong />
          <Row label="Saldo final" v={cf.closing} strong />
        </div>
        <div className="kv"><dt>Flujo de caja libre <InfoButton term="flujo_caja_libre" /></dt><dd>{fmtMoney(cf.freeCashFlow)}</dd></div>
      </div>
      <div className="card">
        <CardHead title="Aportar capital" term="accion_aportar" />
        {(() => {
          const parent = co.parentId ? s.companies.find((x) => x.id === co.parentId) : undefined;
          const max = parent ? parent.ledger.balances.cash : spendable(s);
          const from = parent ? `la caja de ${parent.name}` : 'tu cuenta corriente';
          return (
            <>
              <AmountInput id={`inj-${co.id}`} label={`Monto (sale de ${from})`} value={inject} onChange={setInject} max={max} />
              <ConfirmButton label="Aportar" className="btn dark" help="accion_aportar" disabled={inject <= 0} confirmLabel="Transferir" detail={<>Pasan {fmtMoney(inject)} de {from} a la caja de {co.name}.</>} onConfirm={() => { const r = runCo(co.id, (st, c) => injectCapital(st, c, inject)); if (r.ok) setInject(0); }} />
            </>
          );
        })()}
      </div>
      <div className="card">
        <CardHead title={lf.passThrough ? 'Retiros del dueño' : 'Dividendos'} term="dividendos_empresa" />
        <div className="kv">
          <dt>Caja menos reserva ({co.dividendPolicy.reserveDays} días)</dt><dd>{fmtMoney(lim.cashLimit)}</dd>
          {lim.legalLimit !== null && <><dt>Beneficio distribuible</dt><dd>{fmtMoney(Math.max(0, distributableProfit(co)))}</dd></>}
          <dt>Máximo a repartir hoy</dt><dd><strong>{fmtMoney(lim.max)}</strong></dd>
          <dt>Tu parte</dt><dd>{fmtPct(co.ownership, 1)}{!co.parentId && !lf.passThrough && companyTaxRates(co).dividend ? ` · retención ${fmtPct(companyTaxRates(co).dividend, 0)}` : ''}</dd>
        </div>
        <AmountInput id={`div-${co.id}`} value={div} onChange={setDiv} max={lim.max} />
        <Act label={lf.passThrough ? 'Retirar' : 'Repartir dividendos'} help="accion_dividendos" className="btn primary" disabled={div <= 0} onClick={() => { const r = runCo(co.id, (st, c) => distribute(st, c, div)); if (r.ok) setDiv(0); }} />
        <div className="field">
          <label>Política automática</label>
          <Seg items={[{ id: 'none', label: 'Manual' }, { id: 'monthly', label: 'Mensual' }, { id: 'quarterly', label: 'Trimestral' }, { id: 'annual', label: 'Anual' }]} value={co.dividendPolicy.frequency} onChange={(v) => runCo(co.id, (_st, c) => { c.dividendPolicy.frequency = v; })} />
          {co.dividendPolicy.frequency !== 'none' && (
            <div className="inline-form small"><span>Repartir</span><NumInput id={`payout-${co.id}`} value={Math.round(co.dividendPolicy.payout * 100)} onChange={(n) => runCo(co.id, (_st, c) => { c.dividendPolicy.payout = Math.min(1, n / 100); })} suffix="% del beneficio del período" /></div>
          )}
          <div className="inline-form small"><span>Reserva mínima de caja</span><NumInput id={`reserve-${co.id}`} value={co.dividendPolicy.reserveDays} onChange={(n) => runCo(co.id, (_st, c) => { c.dividendPolicy.reserveDays = n; })} suffix="días de gastos fijos" /></div>
        </div>
      </div>
      <div className="card">
        <CardHead title="Préstamos de la empresa" term="accion_prestamo_empresa" />
        {co.loans.filter((l) => l.balance > 0).map((l) => (
          <div key={l.id} className="row" style={{ flexWrap: 'wrap' }}>
            <div className="grow"><div className="title small">{BIZ_BANKS.find((b) => b.id === l.bankId)?.name ?? (l.bullet ? 'Bonos corporativos' : l.bankId)}{l.guaranteed && <Pill tone="warn">con tu garantía</Pill>}</div><div className="meta">Saldo {fmtMoney(l.balance)} · {l.bullet ? 'cupón' : 'cuota'} {fmtMoney(l.payment)} · {fmtPct(l.apr, 2)} · próxima {formatDate(l.nextDueDay)}</div></div>
            {(() => {
              const room = Math.max(0, Math.min(l.balance, co.ledger.balances.cash - maxDistribution(s, co).reserve));
              return <ConfirmButton label="Amortizar con caja" className="btn sm ghost" disabled={room <= 0} confirmLabel={`Amortizar ${fmtMoney(room, { decimals: false })}`} detail={<>Se paga con la caja de la empresa, dejando la reserva para sueldos y gastos fijos ({fmtMoney(maxDistribution(s, co).reserve, { decimals: false })}).</>} onConfirm={() => runCo(co.id, (st, c) => prepayCoLoan(st, c, l.id, room))} />;
            })()}
          </div>
        ))}
        <div className="field"><label htmlFor={`la-${co.id}`}>Monto</label><AmountInput id={`la-${co.id}`} value={loanAmt} onChange={setLoanAmt} /></div>
        <div className="inline-form small"><span>Plazo</span><NumInput id={`lt-${co.id}`} live value={loanTerm} onChange={setLoanTerm} suffix="meses" /></div>
        {BIZ_BANKS.map((b) => {
          const q = quoteCoLoan(s, co, b, loanAmt, loanTerm);
          return (
            <div key={b.id} className="card flat" style={{ padding: 10, gap: 6 }}>
              <div style={{ display: 'flex', gap: 8 }}><strong className="small" style={{ flex: 1 }}>{b.name}</strong>{q.approved ? <Pill tone="gain">Preaprobado</Pill> : <Pill tone="loss">No califica</Pill>}</div>
              <span className="tiny muted">{b.tagline}</span>
              <div className="kv">
                <dt>Tasa · cuota</dt><dd>{fmtPct(q.apr, 2)} · {fmtMoney(q.payment)}</dd>
                <dt>Intereses totales · comisión</dt><dd>{fmtMoney(q.totalInterest)} · {fmtMoney(q.fee)}</dd>
                <dt>Monto máximo</dt><dd>{fmtMoney(q.maxAmount)}</dd>
                {q.dscr !== null && <><dt>Cobertura (EBITDA/cuotas)</dt><dd>{q.dscr.toFixed(2)}×</dd></>}
              </div>
              {!q.approved && <ul className="tiny loss" style={{ margin: 0, paddingLeft: 16 }}>{q.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
              <ConfirmButton label="Solicitar" className="btn sm primary" help="accion_prestamo_empresa" disabled={!q.approved || !(loanAmt > 0)} confirmLabel="Firmar" detail={<>{b.requiresGuarantee ? 'Garantizás personalmente: si la empresa quiebra, pagás el saldo vos. ' : ''}Primera cuota el {formatDate(addMonths(s.day, 1))}.</>} onConfirm={() => runCo(co.id, (st, c) => takeCoLoan(st, c, b.id, loanAmt, loanTerm))} />
            </div>
          );
        })}
      </div>
      <div className="card">
        <CardHead title="Impuestos" term="impuesto_empresarial" />
        <p className="small">{coTaxRateLabel(co)}.</p>
        {co.taxFilings.length === 0 && <p className="small muted">El primer cierre fiscal es el 1 de enero.</p>}
        {co.taxFilings.slice().reverse().map((f) => (
          <div key={f.year} className="kv" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 6 }}>
            <dt>Año {f.year}: resultado</dt><dd>{fmtMoney(f.profit)}</dd>
            {f.passThrough ? <><dt>A tu declaración personal</dt><dd>{fmtMoney(f.taxable)}</dd></> : <>
              <dt>Pérdidas compensadas</dt><dd>{fmtMoney(f.carryUsed)}</dd>
              <dt>Impuesto (vence {formatDate(f.dueDay)})</dt><dd>{fmtMoney(f.tax)}{f.outstanding ? ' · pendiente' : f.late ? <span className="loss"> · no se pagó: está en deudas vencidas con 5 % de multa</span> : f.tax > 0 ? ' · pagado' : ''}</dd>
            </>}
          </div>
        ))}
        {co.lossCarry.length > 0 && <p className="tiny muted">Pérdidas a compensar: {co.lossCarry.map((l) => `${l.year}: ${fmtMoney(l.amount)}`).join(' · ')}.</p>}
        <p className="tiny muted">Ventas de equilibrio mensuales estimadas: {m.breakEvenRevenue ? fmtMoney(m.breakEvenRevenue) : '—'} <InfoButton term="punto_equilibrio" /></p>
      </div>
    </>
  );
}

export function ManageTab({ co }: { co: Company }) {
  const s = useGame();
  useUI();
  const lf = LEGAL_FORM_BY_ID[co.legalForm];
  const v = valuation(s, co);
  const [pct, setPct] = useState(10);
  const offer = co.saleOffer && co.saleOffer.expires >= s.day ? co.saleOffer : null;
  return (
    <>
      <div className="card">
        <CardHead title="Propiedad y forma legal" term="forma_legal" />
        <div className="kv">
          <dt>Forma legal</dt><dd>{lf.name}</dd>
          <dt>Responsabilidad</dt><dd>{lf.limitedLiability ? 'Limitada' : 'Ilimitada'}</dd>
          <dt>Tu participación</dt><dd>{fmtPct(co.ownership, 1)}</dd>
          <dt>Aportado por vos</dt><dd>{fmtMoney(co.investedByOwner)}</dd>
          <dt>Recibido por vos</dt><dd>{fmtMoney(co.receivedByOwner)}</dd>
          <dt>Valor contable en tu balance <InfoButton term="metodo_participacion" /></dt><dd>{fmtMoney(co.carrying)}</dd>
          {co.goodwill !== 0 && <><dt>Plusvalía pagada <InfoButton term="plusvalia" /></dt><dd>{fmtMoney(co.goodwill)}</dd></>}
          {co.capitalRaised > 0 && <><dt>Capital de inversionistas</dt><dd>{fmtMoney(co.capitalRaised)}</dd></>}
        </div>
        <p className="tiny muted">{lf.pros} {lf.cons}</p>
      </div>
      <div className="card">
        <CardHead title="Valoración" term="valoracion" />
        <div className="kv">
          <dt>Valoración estimada</dt><dd><strong>{fmtMoney(v.value)}</strong></dd>
          <dt>Método</dt><dd>{v.method}</dd>
          <dt>EBITDA anualizado ({v.monthsOfData.toFixed(1)} meses de datos)</dt><dd>{fmtMoney(v.ebitdaAnnual)}</dd>
          <dt>Múltiplo del sector</dt><dd>{v.multiple.toFixed(1)}×</dd>
          <dt>Valor por ganancias</dt><dd>{fmtMoney(v.earningsValue)}</dd>
          <dt>Valor de activos</dt><dd>{fmtMoney(v.assetValue)}</dd>
          {v.recurringValue !== null && <><dt>Valor por ingresos recurrentes</dt><dd>{fmtMoney(v.recurringValue)}</dd></>}
        </div>
        {v.monthsOfData < 6 && <p className="tiny warn">Con menos de 6 meses de datos la valoración es poco confiable.</p>}
      </div>
      <div className="card">
        <CardHead title="Vender la empresa" term="accion_vender_empresa" />
        {offer ? (
          <>
            <p className="small">Oferta{offer.from ? <> de <strong>{offer.from}</strong></> : ''}: <strong>{fmtMoney(offer.price)}</strong> por el 100 % (tu parte {fmtMoney(Math.round(offer.price * co.ownership))}). {v.value > 0 && <>Es {offer.price >= v.value ? `${Math.round((offer.price / v.value - 1) * 100)} % más` : `${Math.round((1 - offer.price / v.value) * 100)} % menos`} que la valoración. </>}Vence el {formatDate(offer.expires)}.</p>
            <ConfirmButton label="Aceptar oferta" className="btn primary" confirmLabel="Vender" help="accion_vender_empresa" detail={co.parentId !== null
              ? <>La holding recibe su parte menos {fmtPct(SALE_FEE, 0)} de comisión; el resultado de la venta queda en sus libros.</>
              : <>Recibirás tu parte menos {fmtPct(SALE_FEE, 0)} de comisión. La ganancia (lo que cobrás menos lo que aportaste, {fmtMoney(co.investedByOwner)}) tributa como ganancia de capital en tu declaración anual, según tu jurisdicción.</>} onConfirm={() => { const r = runCo(co.id, (st, c) => acceptSale(st, c)); if (r.ok) navStore.setSub('business', 'portfolio'); }} />
          </>
        ) : (
          <Act label="Pedir ofertas a compradores" help="accion_vender_empresa" className="btn" onClick={() => runCo(co.id, (st, c) => requestSaleOffer(st, c))} />
        )}
      </div>
      {lf.canRaiseEquity && <CapitalMarketsCards co={co} />}
      <DealsCard co={co} />
      {!co.parentId && <MergeCard co={co} />}
      {lf.canRaiseEquity && (
        <div className="card">
          <CardHead title="Vender acciones a inversionistas" term="accion_emitir" />
          <div className="inline-form small"><span>Porcentaje a vender</span><NumInput id={`raise-${co.id}`} live min={5} max={30} value={pct} onChange={setPct} suffix="%" /></div>
          <span className="tiny muted">Entre 5 % y 30 % por ronda, conservando al menos el 51 %.</span>
          <p className="small">Ingresarían ≈ {fmtMoney(Math.round((v.value * pct) / 100 / (1 - pct / 100)))} a la caja. Tu participación pasaría a {fmtPct(co.ownership * (1 - pct / 100), 1)}.</p>
          <ConfirmButton label="Emitir acciones" className="btn" confirmLabel="Emitir" detail="La dilución es permanente: los inversionistas recibirán su parte de los dividendos y de una futura venta." onConfirm={() => runCo(co.id, (st, c) => raiseEquity(st, c, pct / 100))} />
        </div>
      )}
      <div className="card">
        <CardHead title="Cerrar la empresa" term="accion_liquidar" />
        <p className="small muted">Se venden los activos (inventario 50 %, equipos 60 %, cobranzas 95 %), se pagan las deudas y los sueldos e indemnizaciones, y el remanente vuelve a vos. {lf.limitedLiability ? 'Si no alcanza, los acreedores asumen la diferencia (salvo préstamos que garantizaste).' : 'Si no alcanza, pagás la diferencia con tu dinero (responsabilidad ilimitada).'}</p>
        <ConfirmButton label="Cerrar de forma ordenada" className="btn danger" confirmLabel="Cerrar definitivamente" detail="Es irreversible." onConfirm={() => { const r = runCo(co.id, (st, c) => (isOpen(c) ? liquidate(st, c, 'voluntary') : { ok: false, error: 'Ya cerrada.' })); if (r.ok) navStore.setSub('business', 'portfolio'); }} />
      </div>
    </>
  );
}
