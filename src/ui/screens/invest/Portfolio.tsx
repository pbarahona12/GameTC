import { useState } from 'react';
import { useGame, useUI, useDerived, store } from '../../store';
import { navStore } from '../../nav';
import { Money, BigAmount, Stat, InfoButton, CardHead, Learn, Pill, NumInput, AmountInput, Act } from '../../components/common';
import { Donut, CHART_COLORS, Sparkline } from '../../components/charts';
import { positions, investmentsValue, InvestClass, PositionSummary } from '../../../engine/invest/portfolio';
import { projectPortfolio } from '../../../engine/pros/pros';
import { quoteMarket, placeStockOrder, isTradingDay } from '../../../engine/invest/stocks';
import { bondQuote, buyBond, sellBond } from '../../../engine/invest/bonds';
import { buyFund, sellFund } from '../../../engine/invest/funds';
import { buyMogul, sellMogul, mogulQuote } from '../../../engine/invest/mogul';
import { depositMandate, withdrawMandate, mandateById, mandateValue } from '../../../engine/invest/managed';
import { propertyReport } from '../../../engine/realestate/realestate';
import { fmtMoney, fmtMoneyFit, fmtPct, fmtNumber } from '../../../engine/format';
import { formatDate } from '../../../engine/time/calendar';
import { usd } from '../../../engine/money';
import { FUND_BY_ID } from '../../../content/funds';
import { annualVol, beta, maxDrawdown, valueAtRisk, herfindahl } from '../../../engine/invest/indicators';
import type { GameState } from '../../../engine/state';
import { Icon } from '../../icons';
import { INVEST_CLASS_ICON, PROPERTY_ICON } from '../../contentIcons';
import { insightsOf } from '../../derived';

const CLASS_NAMES: Record<InvestClass, string> = { stocks: 'Acciones', bonds: 'Bonos', funds: 'Fondos', mogul: 'Mogul Exchange', managed: 'Cuenta con gestor' };
const CLASS_TAB: Record<InvestClass, string> = { stocks: 'lite', bonds: 'bonds', funds: 'funds', mogul: 'mogul', managed: 'gestor' };

function assetName(s: GameState, cls: InvestClass, id: string): string {
  if (cls === 'stocks') return `${id} · ${s.stocks.stocks.find((x) => x.id === id)?.name ?? ''}`;
  if (cls === 'bonds') return s.bonds.issues.find((x) => x.id === id)?.name ?? id;
  if (cls === 'funds') return FUND_BY_ID[id]?.name ?? id;
  if (cls === 'managed') return `Cuenta de ${mandateById(s, id)?.managerName ?? 'gestor'}`;
  return s.mogul.assets.find((x) => x.id === id)?.name ?? id;
}

function trend(s: GameState, cls: InvestClass, id: string): number[] {
  if (cls === 'stocks') return s.stocks.stocks.find((x) => x.id === id)?.history.slice(-40).map((c) => c.c) ?? [];
  if (cls === 'bonds') return s.bonds.issues.find((x) => x.id === id)?.history.slice(-40).map((x) => x.p) ?? [];
  if (cls === 'funds') return s.funds.funds.find((x) => x.id === id)?.history.slice(-26).map((x) => x.v) ?? [];
  if (cls === 'managed') return mandateById(s, id)?.history.slice(-26).map((x) => x.nav) ?? [];
  return s.mogul.assets.find((x) => x.id === id)?.history.slice(-12).map((x) => x.v) ?? [];
}

/** Riesgo de la cartera de acciones con los precios reales (últimos 120 días hábiles). */
export function portfolioRisk(s: GameState) {
  const ps = positions(s, 'stocks');
  const total = ps.reduce((a, p) => a + p.value, 0);
  if (total <= 0) return null;
  const len = Math.min(120, ...ps.map((p) => s.stocks.stocks.find((x) => x.id === p.id)?.history.length ?? 0));
  if (len < 20) return null;
  const series: number[] = [];
  for (let i = 0; i < len; i++) {
    let v = 0;
    for (const p of ps) {
      const h = s.stocks.stocks.find((x) => x.id === p.id)!.history;
      v += p.qty * h[h.length - len + i].c;
    }
    series.push(v);
  }
  const idx = s.stocks.index.history.slice(-len).map((x) => x.v);
  const vol = annualVol(series);
  return { vol, beta: beta(series, idx), var21: valueAtRisk(vol) * total, drawdown: maxDrawdown(series), hhi: herfindahl(ps.map((p) => p.value)), total };
}

/** Panel de compra/venta inmediata para una inversión que ya tenés. */
function QuickTrade({ p }: { p: PositionSummary }) {
  const s = useGame();
  useUI();
  const [qty, setQty] = useState(p.cls === 'stocks' ? Math.max(1, Math.floor(p.qty / 2)) : p.cls === 'bonds' ? 1 : Math.round(p.qty * 50) / 100);
  const [amount, setAmount] = useState(usd(500));
  const cls = p.cls;
  const go = () => navStore.setSub('invest', cls === 'stocks' ? `lite:${p.id}` : CLASS_TAB[cls]);
  let body: JSX.Element;
  if (cls === 'stocks') {
    const st = s.stocks.stocks.find((x) => x.id === p.id);
    const q = st ? quoteMarket(s, st, 'venta', Math.max(1, qty)) : null;
    const b = st ? quoteMarket(s, st, 'compra', Math.max(1, qty)) : null;
    body = (
      <>
        <div className="inline-form small"><span>Acciones</span><NumInput id={`qt-${p.id}`} live value={qty} onChange={setQty} min={1} /><button className="chip-btn" onClick={() => setQty(p.qty)}>Todas ({p.qty})</button></div>
        <span className="tiny muted">Comprar ≈ {fmtMoney(b?.total ?? 0)} · Vender ≈ {fmtMoney(q?.total ?? 0)} neto{!isTradingDay(s.day) ? ' · Mercado cerrado: se ejecuta en la apertura' : ''}</span>
        <div className="btn-row">
          <Act label="Comprar más" help="accion_comprar_accion" className="btn sm primary" disabled={st?.status !== 'activa'} onClick={() => store.run((x) => placeStockOrder(x, { stockId: p.id, side: 'compra', type: 'mercado', qty }))} />
          <Act label="Vender" help="accion_vender_accion" className="btn sm" onClick={() => store.run((x) => placeStockOrder(x, { stockId: p.id, side: 'venta', type: 'mercado', qty: Math.min(qty, p.qty) }))} />
        </div>
      </>
    );
  } else if (cls === 'bonds') {
    const b = s.bonds.issues.find((x) => x.id === p.id);
    const q = b ? bondQuote(s, b, Math.max(1, qty), 'venta') : null;
    body = (
      <>
        <div className="inline-form small"><span>Bonos</span><NumInput id={`qt-${p.id}`} live value={qty} onChange={setQty} min={1} /><button className="chip-btn" onClick={() => setQty(p.qty)}>Todos ({p.qty})</button></div>
        <span className="tiny muted">Vender ≈ {fmtMoney(q?.total ?? 0)} neto</span>
        <div className="btn-row">
          <Act label="Comprar más" help="accion_comprar_bono" className="btn sm primary" disabled={b?.status !== 'vigente'} onClick={() => store.run((x) => buyBond(x, p.id, qty))} />
          <Act label="Vender" help="accion_vender_bono" className="btn sm" onClick={() => store.run((x) => sellBond(x, p.id, Math.min(qty, p.qty)))} />
        </div>
      </>
    );
  } else if (cls === 'funds') {
    body = (
      <>
        <div className="field"><label htmlFor={`qa-${p.id}`}>Invertir más</label><AmountInput id={`qa-${p.id}`} value={amount} onChange={setAmount} /></div>
        <Act label="Invertir" help="accion_invertir_fondo" className="btn sm primary" onClick={() => store.run((x) => buyFund(x, p.id, amount))} />
        <div className="inline-form small"><span>Rescatar participaciones</span><NumInput id={`qt-${p.id}`} live value={qty} onChange={setQty} step={0.01} /><button className="chip-btn" onClick={() => setQty(p.qty)}>Todas</button></div>
        <Act label={`Rescatar ≈ ${fmtMoney(Math.round(Math.min(qty, p.qty) * p.price))}`} help="accion_rescatar_fondo" className="btn sm" disabled={!(qty > 0)} onClick={() => store.run((x) => sellFund(x, p.id, qty >= p.qty - 0.005 ? p.qty : qty))} />
      </>
    );
  } else if (cls === 'mogul') {
    const a = s.mogul.assets.find((x) => x.id === p.id);
    const q = a ? mogulQuote(s, a, Math.max(0.01, Math.min(qty, p.qty)), 'venta') : null;
    body = (
      <>
        <div className="inline-form small"><span>Participaciones</span><NumInput id={`qt-${p.id}`} live value={qty} onChange={setQty} step={0.01} /><button className="chip-btn" onClick={() => setQty(p.qty)}>Todas</button></div>
        <span className="tiny muted">Vender ≈ {fmtMoney(q?.total ?? 0)} neto (diferencial incluido)</span>
        <div className="btn-row">
          <Act label="Comprar más" help="accion_mogul_comprar" className="btn sm primary" disabled={a?.status !== 'activo'} onClick={() => store.run((x) => buyMogul(x, p.id, qty))} />
          <Act label="Vender" help="accion_mogul_vender" className="btn sm" onClick={() => store.run((x) => sellMogul(x, p.id, Math.min(qty, p.qty)))} />
        </div>
      </>
    );
  } else {
    const m = mandateById(s, p.id);
    const v = m ? Math.round(mandateValue(s, m)) : 0;
    body = (
      <>
        <div className="field"><label htmlFor={`qa-${p.id}`}>Monto</label><AmountInput id={`qa-${p.id}`} value={amount} onChange={setAmount} /></div>
        <div className="btn-row">
          <Act label="Darle más" help="accion_gestor_aportar" className="btn sm primary" onClick={() => store.run((x) => depositMandate(x, p.id, amount))} />
          <Act label="Retirar" help="accion_gestor_retirar" className="btn sm" onClick={() => store.run((x) => withdrawMandate(x, p.id, Math.min(amount, v)))} />
        </div>
      </>
    );
  }
  return (
    <div className="quick-trade">
      {body}
      <button className="btn sm ghost" onClick={go}>{cls === 'stocks' ? 'Ver gráfico y análisis' : cls === 'managed' ? 'Ver cuenta del gestor' : `Ir a ${CLASS_NAMES[cls]}`} ›</button>
    </div>
  );
}

function HoldingRow({ p, open, onToggle }: { p: PositionSummary; open: boolean; onToggle: () => void }) {
  const s = useGame();
  const t = trend(s, p.cls, p.id);
  return (
    <div className={`holding ${open ? 'open' : ''}`}>
      <button className="row clickable holding-row" onClick={onToggle} aria-expanded={open}>
        <span className="h-icon" aria-hidden><Icon name={INVEST_CLASS_ICON[p.cls]} size={18} /></span>
        <div className="grow">
          <div className="title small">{assetName(s, p.cls, p.id)}</div>
          <div className="meta">{p.cls === 'stocks' || p.cls === 'bonds' ? `${fmtNumber(p.qty)} u.` : `${fmtNumber(p.qty, 2)} ${p.cls === 'managed' ? 'unid.' : 'part.'}`} · pagaste {fmtMoneyFit(p.cost, { decimals: false })}</div>
        </div>
        <Sparkline values={t} width={54} />
        <div style={{ textAlign: 'right', minWidth: 84 }}>
          <div className="amt small">{fmtMoneyFit(p.value, { decimals: false })}</div>
          <div className="tiny"><Money c={p.unrealized} colored sign fit /> <span className="faint">{p.cost > 0 ? fmtPct(p.unrealizedPct, 1) : ''}</span></div>
        </div>
      </button>
      {open && <QuickTrade p={p} />}
    </div>
  );
}

/** Resumen de "Mis inversiones": posiciones, valor, riesgo y proyección a 12 meses. */
function portfolioOf(s: GameState) {
  const b = s.ledger.balances;
  const all = (['stocks', 'bonds', 'funds', 'mogul', 'managed'] as InvestClass[]).flatMap((cls) => positions(s, cls)).sort((a, x) => x.value - a.value);
  const cost = all.reduce((a, p) => a + p.cost, 0);
  const value = investmentsValue(s);
  const personalProps = s.realEstate.properties.filter((p) => p.owner.kind === 'personal');
  const reEquity = b.real_estate - b.mortgages;
  return { all, cost, value, reEquity, props: personalProps, risk: portfolioRisk(s), proj: projectPortfolio(s, 12) };
}

export function Portfolio() {
  const s = useGame();
  const [open, setOpen] = useState<string | null>(null);
  const data = useDerived(portfolioOf);
  const b = s.ledger.balances;
  const y = s.tax.ytd;
  const total = data.value + Math.max(0, data.reEquity);
  // Diagnóstico en una frase (1.4): la alerta de inversiones más importante del asesor.
  const diag = useDerived(insightsOf).find((i) => i.category === 'inversiones' || i.category === 'inmuebles');
  return (
    <>
      {diag && (
        <button className={`alert ${diag.severity}`} style={{ textAlign: 'left' }} onClick={() => navStore.open({ kind: 'advisor' })}>
          <span className="stripe" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}><strong className="small">{diag.title}</strong><span className="small muted">{diag.what}</span></div>
        </button>
      )}
      <section className="hero">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="eyebrow">Todo lo que tenés invertido</span>
          <InfoButton term="mis_inversiones" />
        </div>
        <BigAmount c={total} />
        <div className="small">
          Financieras {fmtMoneyFit(data.value, { decimals: false })} · inmuebles (neto) {fmtMoneyFit(Math.max(0, data.reEquity), { decimals: false })}
        </div>
        {data.cost > 0 && <div className="small">Ganancia sin vender <Money c={data.value - data.cost} colored sign fit /> <span className="faint">({fmtPct(data.value / data.cost - 1, 1)})</span></div>}
      </section>

      <div className="card" style={{ paddingBlock: 8 }}>
        <CardHead title="Mis inversiones" term="mis_inversiones" />
        {data.all.length === 0 && data.props.length === 0 ? (
          <div className="stack" style={{ gap: 8 }}>
            <p className="small muted">Todavía no invertiste. Tres formas simples de empezar:</p>
            <button className="start-option" onClick={() => navStore.setSub('invest', 'funds')}><strong><Icon name="funds" size={15} /> Fondo índice</strong><span className="tiny muted">Desde $50. Compra toda la bolsa de una vez: lo más simple y diversificado.</span></button>
            <button className="start-option" onClick={() => navStore.setSub('invest', 'gestor')}><strong><Icon name="gestor" size={15} /> Contratar un gestor</strong><span className="tiny muted">Le das dinero y lo invierte por vos. Cobra comisiones.</span></button>
            <button className="start-option" onClick={() => navStore.setSub('invest', 'lite')}><strong><Icon name="stocks" size={15} /> Elegir acciones</strong><span className="tiny muted">Vos decidís qué empresas comprar. Más riesgo, más aprendizaje.</span></button>
          </div>
        ) : (
          <>
            <p className="tiny muted">Tocá una inversión para comprar más o vender ahí mismo.</p>
            <div className="rows">
              {data.all.map((p) => <HoldingRow key={`${p.cls}:${p.id}`} p={p} open={open === `${p.cls}:${p.id}`} onToggle={() => setOpen(open === `${p.cls}:${p.id}` ? null : `${p.cls}:${p.id}`)} />)}
              {data.props.map((p) => {
                const r = propertyReport(s, p);
                return (
                  <button key={p.id} className="row clickable holding-row" onClick={() => navStore.setSub('invest', `realestate:prop:${p.id}`)}>
                    <span className="h-icon" aria-hidden><Icon name={PROPERTY_ICON[p.type]} size={18} /></span>
                    <div className="grow">
                      <div className="title small">{p.name}</div>
                      <div className="meta">Inmueble · flujo <Money c={r.monthlyCashFlow} colored sign />/mes</div>
                    </div>
                    <div style={{ textAlign: 'right', minWidth: 84 }}>
                      <div className="amt small">{fmtMoney(r.equity, { decimals: false })}</div>
                      <div className="tiny"><Money c={r.gainSincePurchase} colored sign /></div>
                    </div>
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {total > 0 && (
        <div className="card">
          <CardHead title="Composición" term="diversificacion" />
          <Donut parts={[
            { label: 'Acciones', value: b.stocks, color: CHART_COLORS[0] },
            { label: 'Bonos', value: b.bonds, color: CHART_COLORS[1] },
            { label: 'Fondos', value: b.funds, color: CHART_COLORS[2] },
            { label: 'Cuenta con gestor', value: b.managed ?? 0, color: CHART_COLORS[4] },
            { label: 'Mogul Exchange', value: b.mogul, color: CHART_COLORS[5] },
            { label: 'Inmuebles (neto de hipotecas)', value: Math.max(0, data.reEquity), color: CHART_COLORS[3] },
            { label: 'Depósitos a plazo', value: b.term_deposits, color: CHART_COLORS[6] },
          ]} />
          <Learn term="diversificacion" />
        </div>
      )}

      <div className="grid2">
        <Stat label="Ganancias realizadas (año)" term="ganancia_capital" value={<Money c={(y.gainsShort ?? 0) + (y.gainsLong ?? 0)} colored sign />} sub={`Comisiones ${fmtMoney(y.investFees ?? 0, { decimals: false })}`} />
        <Stat label="Dividendos y rentas (año)" term="dividend_yield" value={<Money c={(y.dividends ?? 0) + (y.bondInterest ?? 0)} />} sub="Dividendos + cupones + repartos" />
      </div>

      {data.risk && (
        <div className="card">
          <CardHead title="Riesgo de tus acciones" term="volatilidad" />
          <div className="kv">
            <dt>Volatilidad anual <InfoButton term="volatilidad" /></dt><dd>{fmtPct(data.risk.vol, 1)}</dd>
            <dt>Beta frente al índice <InfoButton term="beta" /></dt><dd>{data.risk.beta !== null ? data.risk.beta.toFixed(2) : '—'}</dd>
            <dt>Pérdida posible en un mes malo (VaR 95 %) <InfoButton term="var" /></dt><dd>{fmtMoney(Math.round(data.risk.var21))}</dd>
            <dt>Caída máxima (120 días) <InfoButton term="drawdown" /></dt><dd>{fmtPct(data.risk.drawdown, 1)}</dd>
            <dt>Concentración <InfoButton term="diversificacion" /></dt><dd>{data.risk.hhi > 0.5 ? 'Muy concentrada' : data.risk.hhi > 0.25 ? 'Concentrada' : 'Diversificada'} ({data.risk.hhi.toFixed(2)})</dd>
          </div>
          <p className="tiny muted">Calculado con los precios reales de tus acciones en los últimos meses. El pasado no garantiza el futuro.</p>
        </div>
      )}

      {data.proj && (
        <div className="card">
          <CardHead title="¿Cuánto podría valer en 12 meses?" term="escenarios_bandas" />
          <div className="kv">
            <dt>Escenario malo (10 %)</dt><dd>{fmtMoney(data.proj.p10)}</dd>
            <dt>Escenario central (50 %)</dt><dd>{fmtMoney(data.proj.p50)}</dd>
            <dt>Escenario bueno (90 %)</dt><dd>{fmtMoney(data.proj.p90)}</dd>
            <dt>Probabilidad de terminar con pérdida</dt><dd>{fmtPct(data.proj.probLoss, 0)}</dd>
          </div>
          <p className="tiny muted">{data.proj.note}</p>
        </div>
      )}

      {s.stocks.trades.length > 0 && (
        <div className="card">
          <CardHead title="Últimas operaciones" term="costo_fifo" />
          <div className="rows">
            {s.stocks.trades.slice(-8).reverse().map((t) => (
              <div className="row" key={t.id}>
                <div className="grow">
                  <div className="small"><Pill tone={t.side === 'compra' ? 'info' : 'accent'}>{t.side}</Pill> {t.market} · {t.market === 'gestor' ? 'cuenta con gestor' : t.assetId}</div>
                  <div className="tiny faint">{formatDate(t.day)} · {Number.isInteger(t.qty) ? t.qty : t.qty.toFixed(2)} × {fmtMoney(t.price)} · comisión {fmtMoney(t.fee)}</div>
                </div>
                {t.realized !== undefined && <span className="tiny"><Money c={t.realized} colored sign /></span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
