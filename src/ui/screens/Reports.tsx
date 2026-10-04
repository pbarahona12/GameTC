import { Fragment, useEffect, useState } from 'react';
import { useGame, useUI, useDerived, store } from '../store';
import { incomeOf, cashFlowOf, taxProjectionOf } from '../derived';
import { navStore, useNav } from '../nav';
import { balanceSheet, transactions, ledgerCsv, IncomeStatement, Line } from '../../engine/reports/statements';
import { ACCOUNTS, ACCOUNT_IDS, AccountId } from '../../engine/ledger/accounts';
import { startOfMonth, startOfYear, dateOf, dayOf, formatDate, formatMonth, addMonths } from '../../engine/time/calendar';
import { fmtMoney, fmtPct } from '../../engine/format';
import { payTaxes } from '../../engine/tax/taxEngine';
import { residence } from '../../engine/tax/taxEngine';
import { practice } from '../../engine/skills/skills';
import { Money, InfoButton, Tabs, Seg, LineChart, Legend, Pill, Empty, Learn } from '../components/common';

type Sub = 'is' | 'bs' | 'cf' | 'nw' | 'tax' | 'ledger';
type Period = 'month' | 'prev' | 'year' | 'lastyear' | 'all';

function periodRange(day: number, p: Period): [number, number] {
  switch (p) {
    case 'month': return [startOfMonth(day), day];
    case 'prev': { const e = startOfMonth(day) - 1; return [Math.max(0, startOfMonth(Math.max(0, e))), Math.max(0, e)]; }
    case 'year': return [startOfYear(day), day];
    case 'lastyear': { const y = dateOf(day).y - 1; return [Math.max(0, dayOf(y, 1, 1)), Math.max(0, dayOf(y, 12, 31))]; }
    case 'all': return [0, day];
  }
}

/** Período comparable anterior (misma longitud). */
function previousRange(from: number, to: number, p: Period): [number, number] | null {
  if (p === 'all') return null;
  if (p === 'month' || p === 'prev') { const s = addMonths(from, -1); return s < 0 ? null : [s, s + (to - from)]; }
  const s = addMonths(from, -12);
  return s < 0 && from === 0 ? null : [Math.max(0, s), Math.max(0, s + (to - from))];
}

function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  return <Seg items={[{ id: 'month', label: 'Mes' }, { id: 'prev', label: 'Mes ant.' }, { id: 'year', label: 'Año' }, { id: 'lastyear', label: 'Año ant.' }, { id: 'all', label: 'Todo' }]} value={value} onChange={onChange} />;
}

function Lines({ lines, prev, sign = 1 }: { lines: Line[]; prev?: Line[]; sign?: number }) {
  return (
    <>
      {lines.map((l) => {
        const pv = prev?.find((x) => x.account === l.account)?.amount;
        return (
          <div className="row sub" key={l.account}>
            <div className="grow small">{l.name}</div>
            {pv !== undefined && <span className="tiny faint num">{fmtMoney(pv * sign, { decimals: false })}</span>}
            <span className="amt small">{fmtMoney(l.amount * sign)}</span>
          </div>
        );
      })}
    </>
  );
}

function TotalRow({ label, value, prev, term, strong }: { label: string; value: number; prev?: number; term?: string; strong?: boolean }) {
  return (
    <div className={`row ${strong ? 'total' : ''}`}>
      <div className="grow" style={{ fontWeight: 800 }}>{label} {term && <InfoButton term={term} />}</div>
      {prev !== undefined && <span className="tiny faint num">{fmtMoney(prev, { decimals: false })}</span>}
      <Money c={value} className="amt" colored={strong} />
    </div>
  );
}

function IS({ period }: { period: Period }) {
  const s = useGame();
  const [from, to] = periodRange(s.day, period);
  const is = useDerived(incomeOf, from, to);
  const pr = previousRange(from, to, period);
  const prevRange = pr ?? [from, to];
  const prevIs = useDerived(incomeOf, prevRange[0], prevRange[1]);
  const prev: IncomeStatement | undefined = pr ? prevIs : undefined;
  return (
    <div className="card">
      <div className="card-head"><h2>Estado de resultados</h2><InfoButton term="estado_resultados" /></div>
      <p className="tiny muted">{formatDate(from)} – {formatDate(to)}{prev && ' · la columna gris es el período anterior'}</p>
      <p className="small is-summary">
        {is.grossIncome || is.totalExpensesBeforeTax ? <>Ganaste <strong className="gain">{fmtMoney(is.grossIncome, { decimals: false })}</strong>, gastaste <strong className="loss">{fmtMoney(is.totalExpensesBeforeTax + is.totalTaxes, { decimals: false })}</strong> (con impuestos) y {is.netResult >= 0 ? <>te sobró <strong className="gain">{fmtMoney(is.netResult, { decimals: false })}</strong></> : <>te faltó <strong className="loss">{fmtMoney(-is.netResult, { decimals: false })}</strong></>}.{is.unrealized ? <> De lo ganado, {fmtMoney(is.unrealized, { decimals: false })} es revalorización (no es dinero cobrado).</> : null}</> : 'Sin movimientos en este período.'}
      </p>
      <Learn term="ingresos_vs_beneficio" />
      <div className="rows">
        <Lines lines={is.income} prev={prev?.income} />
        <TotalRow label="Ingresos brutos" value={is.grossIncome} prev={prev?.grossIncome} />
        <Lines lines={is.living} prev={prev?.living} sign={-1} />
        <Lines lines={is.financial} prev={prev?.financial} sign={-1} />
        <Lines lines={is.education} prev={prev?.education} sign={-1} />
        <Lines lines={is.property} prev={prev?.property} sign={-1} />
        <Lines lines={is.legal} prev={prev?.legal} sign={-1} />
        <Lines lines={is.other} prev={prev?.other} sign={-1} />
        <TotalRow label="Resultado antes de impuestos" value={is.resultBeforeTax} prev={prev?.resultBeforeTax} />
        <Lines lines={is.taxes} prev={prev?.taxes} sign={-1} />
        <TotalRow label="Resultado neto" value={is.netResult} prev={prev?.netResult} strong />
      </div>
      <p className="small">Tasa de ahorro contable: <strong>{fmtPct(is.savingsRate)}</strong> de tus ingresos brutos se convirtió en patrimonio.</p>
      <p className="tiny muted">Base devengado: un gasto con tarjeta cuenta cuando lo hacés, no cuando pagás la tarjeta. El aporte a jubilación no es gasto: pasa a tu fondo (activo).</p>
    </div>
  );
}

function BS() {
  const s = useGame();
  const bs = balanceSheet(s);
  return (
    <div className="card">
      <div className="card-head"><h2>Balance general</h2><InfoButton term="balance_general" /></div>
      <p className="tiny muted">Al {formatDate(s.day)}</p>
      <div className="rows">
        <div className="row"><div className="grow eyebrow">Activos <InfoButton term="activo" /></div></div>
        <Lines lines={bs.assets} />
        <TotalRow label="Total activos" value={bs.totalAssets} />
        <div className="row"><div className="grow eyebrow">Pasivos <InfoButton term="pasivo" /></div></div>
        {bs.liabilities.length === 0 && <div className="row sub"><div className="grow small muted">Sin deudas</div></div>}
        <Lines lines={bs.liabilities} />
        <TotalRow label="Total pasivos" value={bs.totalLiabilities} />
        <TotalRow label="Patrimonio neto" value={bs.netWorth} term="patrimonio_neto" strong />
      </div>
      <div className="kv">
        <dt>Patrimonio inicial</dt><dd>{fmtMoney(bs.equityCheck.openingEquity)}</dd>
        <dt>+ Resultados acumulados</dt><dd>{fmtMoney(bs.equityCheck.accumulatedResult)}</dd>
        <dt>Ecuación contable</dt><dd>{bs.equityCheck.balanced ? <span className="gain">✓ cuadra</span> : <span className="loss">✗ descuadre</span>}</dd>
      </div>
    </div>
  );
}

function CF({ period }: { period: Period }) {
  const s = useGame();
  const [from, to] = periodRange(s.day, period);
  const cf = useDerived(cashFlowOf, from, to);
  const block = (title: string, items: { label: string; amount: number }[], total: number, term?: string) => (
    <>
      <div className="row"><div className="grow eyebrow">{title} {term && <InfoButton term={term} />}</div></div>
      {items.length === 0 && <div className="row sub"><div className="grow small muted">Sin movimientos</div></div>}
      {items.map((i) => <div className="row sub" key={i.label}><div className="grow small">{i.label}</div><Money c={i.amount} className="amt small" /></div>)}
      <TotalRow label={`Total ${title.toLowerCase()}`} value={total} />
    </>
  );
  return (
    <div className="card">
      <div className="card-head"><h2>Flujo de caja</h2><InfoButton term="flujo_caja" /></div>
      <p className="tiny muted">{formatDate(from)} – {formatDate(to)} · método directo: solo movimientos de efectivo real (efectivo, corriente y ahorro)</p>
      <div className="rows">
        <div className="row"><div className="grow">Saldo inicial</div><Money c={cf.opening} className="amt" /></div>
        {block('Operaciones', cf.operating, cf.totalOperating)}
        {block('Inversión', cf.investing, cf.totalInvesting)}
        {block('Financiamiento', cf.financing, cf.totalFinancing)}
        <TotalRow label="Variación neta" value={cf.netChange} strong />
        <div className="row"><div className="grow">Saldo final</div><Money c={cf.closing} className="amt" /></div>
      </div>
      <div className="kv">
        <dt>Flujo de caja libre <InfoButton term="flujo_caja_libre" /></dt><dd>{fmtMoney(cf.freeCashFlow)}</dd>
      </div>
    </div>
  );
}

function NW() {
  const s = useGame();
  const h = s.history;
  if (h.length < 2) return <div className="card"><Empty icon="reports">La evolución se registra en cada cierre de mes. Avanzá el tiempo para ver tu historial.</Empty></div>;
  const series = [
    { name: 'Patrimonio neto', values: h.map((x) => x.netWorth), color: 'var(--accent)' },
    { name: 'Liquidez', values: h.map((x) => x.liquid), color: 'var(--info)' },
    { name: 'Pasivos', values: h.map((x) => x.liabilities), color: 'var(--loss)', dashed: true },
  ];
  const labels = [formatMonth(h[0].day), formatMonth(h[h.length - 1].day)];
  return (
    <>
      <div className="card">
        <div className="card-head"><h2>Evolución del patrimonio</h2><InfoButton term="patrimonio_neto" /></div>
        <LineChart series={series} labels={labels} height={180} />
        <Legend series={series} />
      </div>
      <div className="card">
        <div className="card-head"><h2>Ingresos vs. gastos por mes</h2></div>
        <LineChart series={[{ name: 'Ingresos', values: h.map((x) => x.income), color: 'var(--gain)' }, { name: 'Gastos', values: h.map((x) => x.expenses), color: 'var(--loss)' }]} labels={labels} />
        <Legend series={[{ name: 'Ingresos', values: [], color: 'var(--gain)' }, { name: 'Gastos e impuestos', values: [], color: 'var(--loss)' }]} />
        <div className="hscroll">
          <table className="small num" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr className="muted"><th align="left">Mes</th><th align="right">Patrimonio</th><th align="right">Ingresos</th><th align="right">Gastos</th></tr></thead>
            <tbody>
              {h.slice(-24).reverse().map((x) => (
                <tr key={x.day}><td>{formatMonth(x.day)}</td><td align="right">{fmtMoney(x.netWorth, { decimals: false })}</td><td align="right">{fmtMoney(x.income, { decimals: false })}</td><td align="right">{fmtMoney(x.expenses, { decimals: false })}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function Tax() {
  const s = useGame();
  const { toDate, projected } = useDerived(taxProjectionOf);
  const y = s.tax.ytd;
  return (
    <>
      <div className="card">
        <div className="card-head"><h2>Año {y.year} en curso</h2><InfoButton term="impuesto_progresivo" /></div>
        <div className="kv">
          <dt>Salarios brutos</dt><dd>{fmtMoney(y.wages)}</dd>
          <dt>Bonos y comisiones</dt><dd>{fmtMoney(y.bonuses)}</dd>
          <dt>Intereses (sin retención)</dt><dd>{fmtMoney(y.interest)}</dd>
          <dt>Deducción jubilación <InfoButton term="deduccion" /></dt><dd>−{fmtMoney(toDate.deductions)}</dd>
          <dt>Base imponible</dt><dd>{fmtMoney(toDate.taxable)}</dd>
          <dt>Impuesto calculado</dt><dd>{fmtMoney(toDate.taxBeforeCredits)}</dd>
          <dt>Crédito educativo <InfoButton term="credito_fiscal" /></dt><dd>−{fmtMoney(toDate.credits)}</dd>
          <dt>Retenido <InfoButton term="retencion" /></dt><dd>{fmtMoney(y.withheld)}</dd>
          <dt>Tasa marginal · efectiva</dt><dd>{fmtPct(toDate.marginalRate)} · {fmtPct(toDate.effectiveRate)}</dd>
        </div>
        <div className="rows">
          {toDate.slices.map((sl) => (
            <div className="row sub" key={sl.from}>
              <div className="grow small">{fmtPct(sl.rate, 0)} sobre {fmtMoney(sl.taxedAmount, { decimals: false })}</div>
              <span className="amt small">{fmtMoney(sl.tax)}</span>
            </div>
          ))}
        </div>
        <div className="alert info">
          <span className="stripe" />
          <div className="small">
            <strong>Proyección a diciembre (estimación)</strong>
            <div>Si tu sueldo se mantiene: impuesto {fmtMoney(projected.taxAfterCredits)}, retenciones {fmtMoney(projected.withheld)} → {projected.balance >= 0 ? <span className="loss">pagarías {fmtMoney(projected.balance)}</span> : <span className="gain">te devolverían {fmtMoney(-projected.balance)}</span>} en la declaración.</div>
          </div>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Declaraciones</h2><InfoButton term="declaracion_fiscal" /></div>
        {s.tax.filings.length === 0 && <p className="small muted">La primera declaración se presenta automáticamente el 1 de enero.</p>}
        {s.tax.filings.slice().reverse().map((f) => (
          <div key={f.year} className="stack" style={{ gap: 6, borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <strong style={{ flex: 1 }}>Año {f.year}</strong>
              <Pill tone={f.status === 'due' ? 'loss' : f.status === 'refund_pending' ? 'info' : 'gain'}>{{ due: 'A pagar', paid: 'Pagada', refund_pending: 'Devolución pendiente', refunded: 'Devuelta', nothing: 'Sin saldo' }[f.status]}</Pill>
            </div>
            <div className="kv">
              <dt>Ingresos</dt><dd>{fmtMoney(f.grossIncome)}</dd>
              <dt>Impuesto final</dt><dd>{fmtMoney(f.taxAfterCredits)}</dd>
              <dt>Retenido</dt><dd>{fmtMoney(f.withheld)}</dd>
              <dt>Saldo</dt><dd>{f.balance >= 0 ? fmtMoney(f.balance) : `devolución ${fmtMoney(-f.balance)}`}</dd>
              {f.penalties > 0 && <><dt>Multas</dt><dd className="loss">{fmtMoney(f.penalties)}</dd></>}
              <dt>{f.status === 'refund_pending' ? 'Fecha de devolución' : 'Vencimiento'}</dt><dd>{formatDate(f.dueDay)}</dd>
            </div>
            {f.status === 'due' && <span className="act"><button className="btn sm primary" onClick={() => store.run((st) => payTaxes(st, f.year))}>Pagar {fmtMoney(f.outstanding)}</button><InfoButton term="accion_pagar_impuestos" /></span>}
          </div>
        ))}
      </div>
      <details className="card">
        <summary><strong>Reglas fiscales de {residence(s).name}</strong></summary>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{residence(s).notes.map((n) => <li key={n}>{n}</li>)}</ul>
      </details>
    </>
  );
}

function Ledger() {
  const s = useGame();
  const [account, setAccount] = useState<AccountId | ''>('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(40);
  const list = transactions(s, { account: account || undefined, search: q || undefined, limit });
  const copy = async () => {
    const csv = ledgerCsv(transactions(s, { account: account || undefined, search: q || undefined }).reverse());
    try {
      await navigator.clipboard.writeText(csv);
      store.toast('CSV copiado al portapapeles. Pegalo en una hoja de cálculo.', 'ok');
    } catch {
      store.toast('No se pudo acceder al portapapeles en este dispositivo.', 'error');
    }
  };
  return (
    <div className="card">
      <div className="card-head"><h2>Libro mayor</h2><InfoButton term="partida_doble" /></div>
      <p className="tiny muted">{s.ledger.entries.length} asientos detallados{s.ledger.archive ? ` (y ${s.ledger.archive.entries} más antiguos resumidos por mes, que no aparecen en la búsqueda)` : ''}. Cada uno cuadra: Debe = Haber.</p>
      <div className="grid2">
        <select aria-label="Filtrar por cuenta" className="input" value={account} onChange={(e) => setAccount(e.target.value as AccountId)}>
          <option value="">Todas las cuentas</option>
          {ACCOUNT_IDS.map((id) => <option key={id} value={id}>{ACCOUNTS[id].name}</option>)}
        </select>
        <input aria-label="Buscar concepto" className="input" placeholder="Buscar concepto" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <span className="act"><button className="btn sm" onClick={copy}>Copiar CSV (exportar)</button><InfoButton term="accion_exportar" /></span>
      {list.map((e) => (
        <div className="ledger-entry" key={e.id}>
          <div style={{ display: 'flex', gap: 8 }}>
            <span className="small" style={{ flex: 1, fontWeight: 700 }}>{e.memo}</span>
            <span className="tiny faint">#{e.id} · {formatDate(e.day)}</span>
          </div>
          <div className="lines">
            {e.lines.map((l, i) => (
              <Fragment key={i}>
                <span className={l.credit ? 'cr' : ''}>{ACCOUNTS[l.account].name}</span>
                <span>{l.debit ? fmtMoney(l.debit) : ''}</span>
                <span>{l.credit ? fmtMoney(l.credit) : ''}</span>
              </Fragment>
            ))}
          </div>
        </div>
      ))}
      {list.length >= limit && <button className="btn sm ghost" onClick={() => setLimit(limit + 60)}>Cargar más</button>}
    </div>
  );
}

export function Reports() {
  const nav = useNav();
  useUI();
  const sub = (nav.sub.reports as Sub) ?? 'is';
  const [period, setPeriod] = useState<Period>('month');
  useEffect(() => {
    if (sub === 'is') store.markSeen('estado_resultados');
    // Revisar informes es práctica contable (con rendimientos decrecientes por día).
    if (sub === 'is' || sub === 'bs' || sub === 'cf') store.run((st) => { practice(st, `report_${sub}`, 'accounting', 30); }, { toast: false });
  }, [sub]);
  return (
    <>
      <Tabs<Sub>
        items={[
          { id: 'is', label: 'Resultados' },
          { id: 'bs', label: 'Balance' },
          { id: 'cf', label: 'Flujo de caja' },
          { id: 'nw', label: 'Patrimonio' },
          { id: 'tax', label: 'Impuestos' },
          { id: 'ledger', label: 'Libro mayor' },
        ]}
        value={sub}
        onChange={(v) => navStore.setSub('reports', v)}
      />
      {(sub === 'is' || sub === 'cf') && <PeriodPicker value={period} onChange={setPeriod} />}
      {sub === 'is' && <IS period={period} />}
      {sub === 'bs' && <BS />}
      {sub === 'cf' && <CF period={period} />}
      {sub === 'nw' && <NW />}
      {sub === 'tax' && <Tax />}
      {sub === 'ledger' && <Ledger />}
    </>
  );
}
