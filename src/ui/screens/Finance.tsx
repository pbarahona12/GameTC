import { residence } from '../../engine/tax/taxEngine';
import { JOB_BY_ID } from '../../content/jobs';
import { Fragment, useState } from 'react';
import { useGame, useUI, useDerived, store } from '../store';
import { loanOffersOf, lastMonthOf } from '../derived';
import { navStore, useNav } from '../nav';
import type { AccountId } from '../../engine/ledger/accounts';
import { accountDef } from '../../engine/ledger/accounts';
import { transfer, savingsRate, depositRate, openDeposit, breakDeposit, depositInterest, earlyBreakCost, DEPOSIT_TERMS, MIN_DEPOSIT, setPensionRate, CHECKING_FEE_WAIVER_AVG } from '../../engine/finance/banking';
import { payCard, setAutopay, requestLimitIncrease, limitIncreaseTarget, statementRemaining, minRemaining, cardAvailable, STATEMENT_DAY, effectiveApr, checkTier, requestTier } from '../../engine/finance/creditCard';
import { cardTier } from '../../engine/finance/cardRewards';
import { CARD_TIER_ORDER, CardTier } from '../../content/cards';
import { Icon } from '../icons';
import { takeLoan, negotiateRate, rateNegotiationInfo, prepayLoan, amortizationSchedule, LOAN_TERMS, MAX_ACTIVE_LOANS } from '../../engine/finance/loans';
import { changeLifestyle, movingCost, lifestyleMonthly, livesInOwnHome, setPaymentMethod, setPrivateInsurance, payArrears, hasEmployerInsurance, insuranceCost, monthlyRecurring, effectiveAmount } from '../../engine/finance/budget';
import { computeCreditScore, scoreBand } from '../../engine/finance/credit';
import { BANK_BY_ID } from '../../content/banks';
import { LIFESTYLES } from '../../content/lifestyle';
import { addMonths, formatDate, startOfMonth, formatMonth } from '../../engine/time/calendar';
import { fmtMoney, fmtPct } from '../../engine/format';
import { spendable } from '../../engine/finance/payments';
import { usd } from '../../engine/money';
import type { Loan, PaymentMethod } from '../../engine/state';
import { Money, InfoButton, Tabs, Seg, AmountInput, ConfirmButton, Pill, Bar, LineChart, Learn, ScreenIntro } from '../components/common';

type Sub = 'accounts' | 'card' | 'loans' | 'invest' | 'budget' | 'credit';

const MOVABLE: Array<{ id: AccountId; label: string }> = [
  { id: 'checking', label: 'Cuenta corriente' },
  { id: 'savings', label: 'Cuenta de ahorro' },
  { id: 'cash_wallet', label: 'Efectivo' },
];

function Accounts() {
  const s = useGame();
  const b = s.ledger.balances;
  const [from, setFrom] = useState<AccountId>('checking');
  const [to, setTo] = useState<AccountId>('savings');
  const [amount, setAmount] = useState(0);
  return (
    <>
      <div className="card">
        <div className="rows">
          {MOVABLE.map((a) => (
            <div className="row" key={a.id}>
              <div className="grow">
                <div className="title">{a.label} <InfoButton term={accountDef(a.id).term!} /></div>
                <div className="meta">
                  {a.id === 'savings' && `Interés ${fmtPct(savingsRate(s), 2)} anual sobre saldo promedio diario`}
                  {a.id === 'checking' && `Sin interés · comisión $4/mes si el promedio es < ${fmtMoney(CHECKING_FEE_WAIVER_AVG, { decimals: false })}`}
                  {a.id === 'cash_wallet' && 'Sin interés · respaldo para pagos'}
                </div>
              </div>
              <Money c={b[a.id]} className="amt" />
            </div>
          ))}
          <div className="row total"><div className="grow">Liquidez total <InfoButton term="liquidez" /></div><Money c={b.checking + b.savings + b.cash_wallet} className="amt" /></div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h2>Transferir</h2><InfoButton term="accion_transferir" /></div>
        <div className="grid2">
          <div className="field">
            <label htmlFor="tr-from">Desde</label>
            <select id="tr-from" className="input" value={from} onChange={(e) => setFrom(e.target.value as AccountId)}>
              {MOVABLE.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="tr-to">Hacia</label>
            <select id="tr-to" className="input" value={to} onChange={(e) => setTo(e.target.value as AccountId)}>
              {MOVABLE.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          </div>
        </div>
        <AmountInput id="tr-amt" label="Monto a transferir" value={amount} onChange={setAmount} max={b[from]} />
        <span className="act"><button className="btn primary" disabled={amount <= 0 || from === to} onClick={() => { const r = store.run((st) => transfer(st, from, to, amount)); if (r.ok) setAmount(0); }}>Transferir {amount > 0 && fmtMoney(amount)}</button><InfoButton term="accion_transferir" /></span>
      </div>

      <div className="card">
        <div className="card-head">
          <h2>Barrido automático</h2>
          <InfoButton term="accion_barrido" />
        </div>
        <p className="small muted">Si la cuenta corriente no alcanza para un pago, se toma lo que falta del ahorro.</p>
        <Seg items={[{ id: 'on', label: 'Activado' }, { id: 'off', label: 'Desactivado' }]} value={s.bank.overdraftSweep ? 'on' : 'off'} onChange={(v) => store.run((st) => { st.bank.overdraftSweep = v === 'on'; })} />
      </div>
    </>
  );
}

function CardVisual() {
  const s = useGame();
  const t = cardTier(s);
  return (
    <div className="cc" style={{ background: `linear-gradient(135deg, ${t.colors[0]}, ${t.colors[1]})`, color: t.ink }}>
      <div className="cc-top"><span className="cc-bank">Banco de Valoria</span><span className="cc-tier">{t.name.toUpperCase()}</span></div>
      <div className="cc-chip" aria-hidden />
      <div className="cc-num num">•••• •••• •••• {String(1000 + (Math.abs(s.seed) % 9000))}</div>
      <div className="cc-bottom"><span>{s.player.name.toUpperCase()}</span><span className="num">{fmtMoney(s.bank.card.limit, { decimals: false })}</span></div>
    </div>
  );
}

function TierOption({ id }: { id: CardTier }) {
  const s = useGame();
  const cur = s.bank.card.tier ?? 'clasica';
  const chk = checkTier(s, id);
  const t = chk.tier;
  const higher = CARD_TIER_ORDER.indexOf(id) > CARD_TIER_ORDER.indexOf(cur);
  const wait = higher && s.day - (s.bank.card.lastTierRequest ?? -999) < 30;
  return (
    <div className="card flat tier-opt">
      <div className="card-head">
        <span className="tier-dot" style={{ background: `linear-gradient(135deg, ${t.colors[0]}, ${t.colors[1]})` }} aria-hidden />
        <h2>{t.name}</h2>
        <span className="tiny muted">{t.annualFee ? `${fmtMoney(usd(t.annualFee * s.macro.priceIndex), { decimals: false })}/año` : 'Sin costo'}</span>
      </div>
      <ul className="small tier-perks">{t.perks.map((p) => <li key={p}>{p}</li>)}</ul>
      {higher && (
        <>
          <div className="stack" style={{ gap: 3 }}>
            {chk.items.map((i) => <span key={i.label} className={`tiny ${i.met ? 'gain' : 'loss'}`}>{i.met ? '✓' : '✗'} {i.label}</span>)}
          </div>
          <span className="tiny muted">{chk.eligible ? `Aprobación estimada ${Math.round(chk.chance * 100)} % · límite ofrecido ~${fmtMoney(chk.limit, { decimals: false })}` : 'Todavía no cumplís los requisitos.'}</span>
          <ConfirmButton label={wait ? `Podés volver a pedir el ${formatDate((s.bank.card.lastTierRequest ?? 0) + 30)}` : `Pedir tarjeta ${t.name}`} disabled={wait || !chk.eligible} help="accion_pedir_tarjeta" className={`btn sm ${chk.eligible ? 'primary' : ''}`} confirmLabel="Pedir" detail="El banco consulta tu historial: tu puntaje baja unos 11 puntos durante 12 meses. Si la aprueban, se cobra el costo anual." onConfirm={() => store.run((x) => requestTier(x, id))} />
        </>
      )}
      {!higher && id !== cur && <ConfirmButton label={`Pasar a ${t.name}`} help="accion_pedir_tarjeta" className="btn sm ghost" confirmLabel="Cambiar" detail="Pagás menos costo anual y perdés beneficios. Tu límite puede bajar al máximo de ese nivel." onConfirm={() => store.run((x) => requestTier(x, id))} />}
      {id === cur && <Pill tone="accent">Tu tarjeta actual</Pill>}
    </div>
  );
}

function Card() {
  const s = useGame();
  useUI();
  const c = s.bank.card;
  const bal = s.ledger.balances.credit_card;
  const inst = s.ledger.balances.card_installments ?? 0;
  const [amount, setAmount] = useState(0);
  const util = c.limit ? (bal + inst) / c.limit : 0;
  const rem = statementRemaining(s);
  const min = minRemaining(s);
  const t = cardTier(s);
  return (
    <>
      <CardVisual />
      <div className="card">
        <div className="card-head"><h2>Tarjeta {t.name}</h2><InfoButton term="tarjeta_credito" /><InfoButton term="nivel_tarjeta" /></div>
        <div className="kv">
          <dt>Saldo actual</dt><dd>{fmtMoney(bal)}</dd>
          {inst > 0 && <><dt>Cuotas a vencer <InfoButton term="cuotas_tarjeta" /></dt><dd>{fmtMoney(inst)}</dd></>}
          <dt>Límite</dt><dd>{fmtMoney(c.limit)}</dd>
          <dt>Disponible</dt><dd>{fmtMoney(cardAvailable(s))}</dd>
          <dt>Tasa anual (variable)</dt><dd>{fmtPct(effectiveApr(s))}{t.aprDiscount > 0 && <span className="tiny muted"> (−{fmtPct(t.aprDiscount, 0)} por tu nivel)</span>}</dd>
          <dt>Reintegro <InfoButton term="reintegro_tarjeta" /></dt><dd>{t.cashback ? `${fmtPct(t.cashback, 1)} · acumulado ${fmtMoney(c.rewardsPending ?? 0)} · total ${fmtMoney(c.rewardsTotal ?? 0, { decimals: false })}` : 'Sin reintegro'}</dd>
          <dt>Corte · vencimiento</dt><dd>día {STATEMENT_DAY} · +20 días</dd>
          <dt>Período de gracia <InfoButton term="periodo_gracia" /></dt><dd>{c.revolving ? <span className="loss">Perdido</span> : <span className="gain">Activo</span>}</dd>
        </div>
        <div className="stack" style={{ gap: 4 }}>
          <span className="small">Uso del límite {Math.round(util * 100)} %{inst > 0 ? ' (incluye cuotas a vencer; para tu puntaje cuenta solo el saldo)' : ''} <InfoButton term="utilizacion_credito" /></span>
          <Bar value={util} tone={util > 0.3 ? 'warn' : 'gain'} />
        </div>
        <div className="btn-row"><button className="btn sm" onClick={() => navStore.go('more', 'shops')}><Icon name="shop" size={15} /> Usarla en Tiendas</button></div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Resumen</h2><InfoButton term="periodo_gracia" /></div>
        {c.dueDay >= 0 ? (
          <div className="kv">
            <dt>Saldo del resumen</dt><dd>{fmtMoney(c.statementBalance)}</dd>
            <dt>Pago mínimo</dt><dd>{fmtMoney(c.minPayment)}</dd>
            <dt>Ya pagado</dt><dd>{fmtMoney(c.paidSinceStatement)}</dd>
            <dt>Vence</dt><dd>{formatDate(c.dueDay)}</dd>
          </div>
        ) : (
          <p className="small muted">No hay resumen pendiente. El próximo corte es el día {STATEMENT_DAY}.</p>
        )}
        <AmountInput id="card-pay" label="Monto a pagar" value={amount} onChange={setAmount} max={bal} />
        <div className="chips">
          {min > 0 && <button onClick={() => setAmount(min)}>Mínimo pendiente {fmtMoney(min)}</button>}
          {rem > 0 && <button onClick={() => setAmount(rem)}>Total del resumen {fmtMoney(rem)}</button>}
          {bal > 0 && <button onClick={() => setAmount(bal)}>Todo el saldo {fmtMoney(bal)}</button>}
        </div>
        <span className="act"><button className="btn primary" disabled={amount <= 0} onClick={() => { const r = store.run((st) => payCard(st, amount)); if (r.ok) setAmount(0); }}>Pagar desde cuenta corriente</button><InfoButton term="accion_pagar_tarjeta" /></span>
      </div>
      {(c.installments ?? []).length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Compras en cuotas</h2><InfoButton term="cuotas_tarjeta" /></div>
          <div className="rows">
            {c.installments.map((i) => (
              <div className="row" key={i.id}>
                <div className="grow"><div className="title small">{i.desc}</div><div className="meta">Cuota {i.paidCount}/{i.n} · {fmtMoney(i.payment)} por mes{i.rate > 0 ? ` · ${fmtPct(i.rate * 12, 1)} anual` : ' · sin interés'}</div></div>
                <span className="amt small">{fmtMoney(i.remaining)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="card">
        <div className="card-head"><h2>Débito automático</h2><InfoButton term="accion_debito_automatico" /></div>
        <Seg items={[{ id: 'none', label: 'No' }, { id: 'min', label: 'Mínimo' }, { id: 'full', label: 'Total' }]} value={c.autopay} onChange={(v) => store.run((st) => setAutopay(st, v))} />
        <p className="tiny muted">Se ejecuta el día del vencimiento con los fondos de la cuenta corriente (y el ahorro, si el barrido está activo).</p>
      </div>
      <div className="section-title"><h2>Niveles de tarjeta</h2><InfoButton term="nivel_tarjeta" /></div>
      <p className="small muted">Con mejor puntaje e ingresos podés pedir una tarjeta de mayor nivel: más límite, reintegro en todo lo que pagues con ella, cuotas sin interés en tiendas y mejor trato. Tiene un costo anual.</p>
      {CARD_TIER_ORDER.map((id) => <TierOption key={id} id={id} />)}
      <div className="card">
        <div className="card-head"><h2>Aumento de límite</h2><InfoButton term="accion_aumento_limite" /></div>
        <p className="small muted">Requiere puntaje ≥ 680 e ingreso estable, hasta {Math.max(1.5, t.limitMult)}× tu ingreso mensual con tope de {fmtMoney(usd(t.limitCap), { decimals: false })} para una {t.name} (y como mucho el doble del límite actual). Registra una consulta de crédito.</p>
        {(() => {
          const target = limitIncreaseTarget(s);
          const why = s.credit.score < 680 ? `Tu puntaje es ${s.credit.score}: hace falta 680.` : target === null ? 'Hace falta un ingreso estable.' : target <= c.limit ? `Tu límite (${fmtMoney(c.limit, { decimals: false })}) ya es el máximo con tus ingresos y tu nivel de tarjeta.` : null;
          return (
            <>
              {target !== null && target > c.limit && <p className="small">Límite que te aprobarían: <strong>{fmtMoney(target, { decimals: false })}</strong> (hoy {fmtMoney(c.limit, { decimals: false })}).</p>}
              {why && <p className="tiny faint">{why}</p>}
              <ConfirmButton label="Solicitar aumento" help="accion_aumento_limite" disabled={!!why} confirmLabel="Solicitar" detail="Se registrará una consulta en tu historial crediticio (unos −11 puntos durante 12 meses)." onConfirm={() => store.run(requestLimitIncrease)} />
            </>
          );
        })()}
      </div>
    </>
  );
}

/** Un préstamo activo con SU propio monto de amortización (no se comparte entre préstamos). */
function LoanCard({ l }: { l: Loan }) {
  const s = useGame();
  const [prepay, setPrepay] = useState(0);
  return (
    <div className="card" style={l.status === 'default' ? { borderColor: 'var(--loss)' } : undefined}>
      <div className="card-head">
        <h2>{BANK_BY_ID[l.bankId].name}</h2>
        {l.status === 'default' ? <Pill tone="loss">Impago</Pill> : <Pill tone="info">Activo</Pill>}
      </div>
      <div className="kv">
        <dt>Saldo</dt><dd>{fmtMoney(l.balance)}</dd>
        <dt>Cuota mensual</dt><dd>{fmtMoney(l.payment)}</dd>
        <dt>Tasa anual fija</dt><dd>{fmtPct(l.apr, 2)}</dd>
        <dt>Cuotas pagadas</dt><dd>{l.paymentsMade} de {l.termMonths}</dd>
        <dt>Próximo vencimiento</dt><dd>{formatDate(l.nextDueDay)}</dd>
        <dt>Intereses pagados</dt><dd>{fmtMoney(l.interestPaid)}</dd>
      </div>
      <AmountInput id={`prepay-${l.id}`} label={`Amortizar el préstamo de ${BANK_BY_ID[l.bankId].name}`} value={prepay} onChange={setPrepay} max={Math.min(l.balance, spendable(s))} />
      <span className="act"><button className="btn sm dark" disabled={prepay <= 0} onClick={() => { const r = store.run((st) => prepayLoan(st, l.id, prepay)); if (r.ok) setPrepay(0); }}>Amortizar anticipadamente</button><InfoButton term="accion_amortizar" /></span>
    </div>
  );
}

function Loans() {
  const s = useGame();
  const [amount, setAmount] = useState(usd(1000));
  const [term, setTerm] = useState(12);
  const [showSched, setShowSched] = useState<string | null>(null);
  const offers = useDerived(loanOffersOf, amount, term);
  const active = s.bank.loans.filter((l) => l.status !== 'paid');
  return (
    <>
      {active.map((l) => <LoanCard key={l.id} l={l} />)}

      <div className="card">
        <div className="card-head"><h2>Comparar préstamos</h2><InfoButton term="prestamo" /></div>
        <Learn term="prestamo" />
        <div className="field"><label htmlFor="loan-amt">Monto</label><AmountInput id="loan-amt" value={amount} onChange={setAmount} /></div>
        <div className="field">
          <label>Plazo</label>
          <div className="chips">{LOAN_TERMS.map((t) => <button key={t} aria-pressed={term === t} onClick={() => setTerm(t)} style={term === t ? { background: 'var(--text)', color: 'var(--bg)' } : undefined}>{t} meses</button>)}</div>
        </div>
        <p className="tiny muted">Tu puntaje: {s.credit.score} · préstamos activos {active.length}/{MAX_ACTIVE_LOANS}. Cada solicitud registra una consulta de crédito.</p>
      </div>
      {amount > 0 && offers.map((o) => (
        <div className="card" key={o.bank.id} style={{ opacity: o.approved ? 1 : 0.85 }}>
          <div className="card-head">
            <div style={{ flex: 1 }}><h2>{o.bank.name}</h2><span className="tiny muted">{o.bank.tagline}</span></div>
            {o.approved ? <Pill tone="gain">Preaprobado</Pill> : <Pill tone="loss">No califica</Pill>}
          </div>
          <div className="kv">
            <dt>Tasa anual</dt><dd>{fmtPct(o.apr, 2)}{o.negotiatedDiscount > 0 && <span className="gain"> (−{fmtPct(o.negotiatedDiscount, 2)})</span>}</dd>
            <dt>Cuota</dt><dd>{fmtMoney(o.payment)}</dd>
            <dt>Comisión de apertura</dt><dd>{fmtMoney(o.fee)}</dd>
            <dt>Recibís</dt><dd>{fmtMoney(o.netDisbursed)}</dd>
            <dt>Intereses totales</dt><dd>{fmtMoney(o.totalInterest)}</dd>
            <dt><strong>Costo total del crédito</strong></dt><dd><strong>{fmtMoney(o.totalCost)}</strong></dd>
            {o.dtiAfter !== null && <><dt>Deuda/ingreso después <InfoButton term="ratio_deuda_ingreso" /></dt><dd>{Math.round(o.dtiAfter * 100)} %</dd></>}
          </div>
          {!o.approved && <ul className="small loss" style={{ margin: 0, paddingLeft: 18 }}>{o.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
          <span className="act"><button className="btn sm ghost" onClick={() => setShowSched(showSched === o.bank.id ? null : o.bank.id)}>Tabla de amortización</button><InfoButton term="amortizacion" /></span>
          {showSched === o.bank.id && (
            <div className="hscroll">
              <table className="small num" style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr className="muted"><th align="left">#</th><th align="right">Cuota</th><th align="right">Interés</th><th align="right">Capital</th><th align="right">Saldo</th></tr></thead>
                <tbody>
                  {amortizationSchedule(o.amount, o.apr, o.termMonths).map((r) => (
                    <tr key={r.n}><td>{r.n}</td><td align="right">{fmtMoney(r.payment)}</td><td align="right">{fmtMoney(r.interest)}</td><td align="right">{fmtMoney(r.principal)}</td><td align="right">{fmtMoney(r.balance)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="btn-row">
            {(() => {
              const ni = rateNegotiationInfo(s, o.bank.id);
              return <span className="act"><button className="btn sm" disabled={ni.nextDay !== null} onClick={() => store.run((st) => negotiateRate(st, o.bank.id))}>{ni.nextDay !== null ? `Negociar de nuevo el ${formatDate(ni.nextDay)}` : `Negociar tasa · ≈${Math.round(ni.chance * 100)} % · −${fmtPct(ni.discount, 2)}`}</button><InfoButton term="accion_negociar" /></span>;
            })()}
            <ConfirmButton
              label="Solicitar"
              className="btn sm primary"
              help="accion_solicitar_prestamo"
              disabled={!o.approved}
              confirmLabel="Firmar préstamo"
              detail={<>Recibirás {fmtMoney(o.netDisbursed)} y pagarás {o.termMonths} cuotas de {fmtMoney(o.payment)} desde el {formatDate(addMonths(s.day, 1))}. Tu patrimonio baja {fmtMoney(o.fee)} por la comisión.</>}
              onConfirm={() => store.run((st) => takeLoan(st, o.bank.id, amount, term))}
            />
          </div>
        </div>
      ))}
    </>
  );
}

function Invest() {
  const s = useGame();
  const [amount, setAmount] = useState(MIN_DEPOSIT);
  const [term, setTerm] = useState<number>(12);
  const [source, setSource] = useState<AccountId>(() => (s.ledger.balances.savings >= MIN_DEPOSIT ? 'savings' : 'checking'));
  const rate = depositRate(s, term);
  const preview = depositInterest({ principal: amount, rate, startDay: s.day, maturityDay: addMonths(s.day, term) });
  return (
    <>
      <div className="card">
        <div className="card-head"><h2>Depósitos a plazo</h2><InfoButton term="deposito_plazo" /></div>
        {s.bank.deposits.length === 0 && <p className="small muted">No tenés depósitos activos.</p>}
        <div className="rows">
          {s.bank.deposits.map((d) => (
            <div className="row" key={d.id} style={{ flexWrap: 'wrap' }}>
              <div className="grow">
                <div className="title">{fmtMoney(d.principal)} · {d.termMonths} meses al {fmtPct(d.rate, 2)}</div>
                <div className="meta">Vence {formatDate(d.maturityDay)} · cobrarás {fmtMoney(depositInterest(d))} de interés</div>
              </div>
              <ConfirmButton label="Cancelar" className="btn sm ghost" help="accion_cancelar_deposito" confirmLabel="Cancelar depósito" detail={<>Perdés {fmtMoney(depositInterest(d))} de intereses y pagás {fmtMoney(earlyBreakCost(d))} de comisión.</>} onConfirm={() => store.run((st) => breakDeposit(st, d.id))} />
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Nuevo depósito</h2><InfoButton term="accion_abrir_deposito" /></div>
        <div className="field">
          <label>Plazo</label>
          <Seg items={DEPOSIT_TERMS.map((t) => ({ id: t as number, label: `${t} m · ${fmtPct(depositRate(s, t), 2)}` }))} value={term} onChange={setTerm} />
        </div>
        <div className="field">
          <label htmlFor="dep-src">Origen</label>
          <select id="dep-src" className="input" value={source} onChange={(e) => setSource(e.target.value as AccountId)}>
            <option value="savings">Cuenta de ahorro ({fmtMoney(s.ledger.balances.savings)})</option>
            <option value="checking">Cuenta corriente ({fmtMoney(s.ledger.balances.checking)})</option>
          </select>
        </div>
        <AmountInput id="dep-amt" label="Monto del depósito" value={amount} onChange={setAmount} max={s.ledger.balances[source]} />
        <p className="small">Al vencer ({formatDate(addMonths(s.day, term))}) cobrarás <strong className="gain">{fmtMoney(preview)}</strong> de interés. El ahorro rendiría ≈ {fmtMoney(Math.round((amount * savingsRate(s) * term) / 12))}.</p>
        <span className="act"><button className="btn primary" disabled={amount < MIN_DEPOSIT} onClick={() => store.run((st) => openDeposit(st, amount, term, source))}>Abrir depósito</button><InfoButton term="accion_abrir_deposito" /></span>
        <p className="tiny muted">Mínimo {fmtMoney(MIN_DEPOSIT, { decimals: false })}. Tasa fija durante todo el plazo.</p>
      </div>
      <div className="card">
        <div className="card-head"><h2>Fondo de jubilación</h2><InfoButton term="jubilacion" /></div>
        <div className="kv">
          <dt>Saldo</dt><dd>{fmtMoney(s.ledger.balances.pension)}</dd>
          <dt>Tu aporte</dt><dd>{fmtPct(s.bank.pensionRate, 0)} del salario bruto</dd>
        </div>
        <div className="chips">
          {[...new Set([0, 0.03, 0.05, 0.08, 0.1, 0.15, ...(s.career.job && JOB_BY_ID[s.career.job.jobId].pensionMatch ? [JOB_BY_ID[s.career.job.jobId].pensionMatch] : [])])].sort((a, b) => a - b).map((r) => (
            <button key={r} aria-pressed={Math.abs(s.bank.pensionRate - r) < 0.001} onClick={() => store.run((st) => setPensionRate(st, r))} style={Math.abs(s.bank.pensionRate - r) < 0.001 ? { background: 'var(--text)', color: 'var(--bg)' } : undefined}>{fmtPct(r, 0)}{s.career.job && Math.abs(JOB_BY_ID[s.career.job.jobId].pensionMatch - r) < 0.001 ? ' · máximo del empleador' : ''}</button>
          ))}
        </div>
        <p className="tiny muted">{residence(s).maxPensionDeductionRate > 0 ? `Deducible hasta ${fmtPct(residence(s).maxPensionDeductionRate, 0)} de tu sueldo en ${residence(s).name}.` : `En ${residence(s).name} el aporte no es deducible.`} No es liquidez: no se puede usar para gastos. Aportar al menos lo que iguala tu empleador es dinero adicional.</p>
      </div>
    </>
  );
}

function Budget() {
  const s = useGame();
  useUI();
  const last = useDerived(lastMonthOf);
  const [pay, setPay] = useState(0);
  const arrears = s.ledger.balances.arrears;
  return (
    <>
      {arrears > 0 && (
        <div className="card" style={{ borderColor: 'var(--loss)' }}>
          <div className="card-head"><h2>Pagos vencidos</h2><InfoButton term="mora" /></div>
          <div className="big num loss" style={{ fontSize: 22 }}>{fmtMoney(arrears)}</div>
          <AmountInput id="arr-pay" label="Monto de atrasos a pagar" value={pay} onChange={setPay} max={Math.min(arrears, spendable(s))} />
          <span className="act"><button className="btn primary" disabled={pay <= 0} onClick={() => { const r = store.run((st) => payArrears(st, pay)); if (r.ok) setPay(0); }}>Pagar atrasos</button><InfoButton term="accion_pagar_atrasos" /></span>
        </div>
      )}
      <div className="card">
        <div className="card-head"><h2>Gastos recurrentes</h2><InfoButton term="presupuesto" /><InfoButton term="accion_medio_pago" /></div>
        <div className="rows">
          {s.budget.items.map((it) => {
            return (
              <div className="row" key={it.key} style={{ flexWrap: 'wrap' }}>
                <div className="grow">
                  <div className="title">{it.name}</div>
                  <div className="meta">Día {it.day} · {it.essential ? 'esencial' : 'discrecional'}</div>
                </div>
                <select aria-label={`Medio de pago para ${it.name}`} className="input" style={{ width: 'auto', minHeight: 36, fontSize: 13 }} value={it.method} onChange={(e) => store.run((st) => setPaymentMethod(st, it.key, e.target.value as PaymentMethod))}>
                  <option value="checking">Débito</option>
                  {it.key !== 'rent' && <option value="card">Tarjeta</option>}
                  <option value="cash">Efectivo</option>
                </select>
                <span className="amt"><Money c={effectiveAmount(s, it)} />{effectiveAmount(s, it) !== it.amount && <span className="tiny muted" style={{ display: 'block' }}>{it.key === 'transport' ? 'con tu vehículo' : 'con tu cocina'}</span>}</span>
              </div>
            );
          })}
          {s.budget.privateInsurance && <div className="row"><div className="grow"><div className="title">Seguro médico privado</div><div className="meta">Día 20</div></div><Money c={insuranceCost(s)} className="amt" /></div>}
          <div className="row total"><div className="grow">Total mensual</div><Money c={monthlyRecurring(s)} className="amt" /></div>
        </div>
        {last && (
          <p className="tiny muted">
            Real de {formatMonth(startOfMonth(s.day) - 1)} (devengado): vida {fmtMoney(last.living.reduce((a, l) => a + l.amount, 0))} · financieros {fmtMoney(last.financial.reduce((a, l) => a + l.amount, 0))} · educación {fmtMoney(last.education.reduce((a, l) => a + l.amount, 0))}.
          </p>
        )}
      </div>

      <div className="card">
        <div className="card-head"><h2>Seguro médico</h2><InfoButton term="seguro" /></div>
        {hasEmployerInsurance(s) ? <p className="small gain">Tu empleo incluye seguro médico.</p> : (
          <>
            <p className="small muted">Sin seguro, un imprevisto de salud cuesta {fmtMoney(usd(300 * s.macro.priceIndex), { decimals: false })}–{fmtMoney(usd(2500 * s.macro.priceIndex), { decimals: false })}. Con seguro, un copago de {fmtMoney(usd(40 * s.macro.priceIndex), { decimals: false })}–{fmtMoney(usd(150 * s.macro.priceIndex), { decimals: false })}.</p>
            <Seg items={[{ id: 'no', label: 'Sin seguro' }, { id: 'yes', label: `Contratar · ${fmtMoney(insuranceCost(s), { decimals: false })}/mes` }]} value={s.budget.privateInsurance ? 'yes' : 'no'} onChange={(v) => store.run((st) => setPrivateInsurance(st, v === 'yes'))} />
          </>
        )}
      </div>

      <div className="section-title"><h2>Estilo de vida</h2><InfoButton term="accion_estilo" /></div>
      {livesInOwnHome(s) && <p className="tiny muted">Vivís en una vivienda propia: los importes no incluyen alquiler.</p>}
      {LIFESTYLES.map((l) => {
        const on = s.budget.lifestyle === l.id;
        return (
          <div className="card" key={l.id} style={on ? { borderColor: 'var(--accent)' } : undefined}>
            <div className="card-head">
              <h2>{l.name}</h2>
              <span className="num">{fmtMoney(lifestyleMonthly(s, l.id), { decimals: false })}/mes</span>
            </div>
            <p className="small muted">{l.description}</p>
            <div className="chips tiny">
              <Pill tone={l.stress > 0 ? 'loss' : l.stress < 0 ? 'gain' : 'neutral'}>Estrés {l.stress > 0 ? '+' : ''}{l.stress}/mes</Pill>
              <Pill tone={l.health > 0 ? 'gain' : l.health < 0 ? 'loss' : 'neutral'}>Salud {l.health > 0 ? '+' : ''}{l.health}</Pill>
              <Pill tone="neutral">Reputación {l.reputation > 0 ? '+' : ''}{l.reputation}</Pill>
            </div>
            {on ? <Pill tone="accent">Tu estilo actual</Pill> : (
              <ConfirmButton label="Mudarme" className="btn sm" help="accion_estilo" confirmLabel="Confirmar mudanza" detail={<>{movingCost(s, l.id) > 0 ? `La mudanza cuesta ${fmtMoney(movingCost(s, l.id))} (se paga hoy).` : 'Seguís en tu casa: no hay costo de mudanza.'} Los nuevos importes rigen desde el próximo cobro.</>} onConfirm={() => store.run((st) => changeLifestyle(st, l.id))} />
            )}
          </div>
        );
      })}
    </>
  );
}

function Credit() {
  const s = useGame();
  const bd = computeCreditScore(s);
  // Los bancos ven el puntaje registrado (se actualiza al cierre de mes, al pagar la tarjeta
  // o al pedir crédito); el desglose muestra cómo quedaría si se recalculara hoy.
  const shown = s.credit.score;
  const band = scoreBand(shown);
  const parts: Array<[string, number, number]> = [
    ['Historial de pagos', bd.paymentHistory, 192],
    ['Utilización', bd.utilization, 165],
    ['Antigüedad', bd.age, 82],
    ['Mezcla de crédito', bd.mix, 55],
    ['Consultas recientes', bd.inquiries, 55],
  ];
  return (
    <>
      <div className="card">
        <div className="card-head"><h2>Puntaje crediticio</h2><InfoButton term="puntaje_crediticio" /></div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
          <span className="num" style={{ fontSize: 40, fontWeight: 600 }}>{shown}</span>
          <Pill tone={band.tone === 'good' ? 'gain' : band.tone === 'ok' ? 'info' : band.tone === 'warn' ? 'warn' : 'loss'}>{band.label}</Pill>
        </div>
        <Bar value={(shown - 300) / 550} tone={band.tone === 'bad' ? 'loss' : band.tone === 'warn' ? 'warn' : 'gain'} />
        <p className="tiny muted">Es el puntaje que ven los bancos hoy. {bd.score !== shown ? <>Si se recalculara ahora sería <strong className={bd.score > shown ? 'gain' : 'loss'}>{bd.score}</strong> (por ejemplo, por lo que usaste de la tarjeta): se actualiza al cierre del mes, al pagar la tarjeta o al pedir un crédito. El desglose de abajo es el de ese cálculo.</> : 'Se actualiza al cierre del mes, al pagar la tarjeta o al pedir un crédito.'}</p>
        <Learn term="puntaje_crediticio" />
        <div className="rows">
          {parts.map(([label, v, max]) => (
            <Fragment key={label}>
              <div className="row"><div className="grow small">{label}</div><span className="amt small">{v} / {max}</span></div>
            </Fragment>
          ))}
          <div className="row total"><div className="grow small">Base + componentes</div><span className="amt small">300 + {bd.score - 300}</span></div>
        </div>
        {bd.notes.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{bd.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      </div>
      <div className="card">
        <div className="card-head"><h2>Evolución</h2></div>
        <LineChart series={[{ name: 'Puntaje', values: s.credit.history.map((h) => h.score), color: 'var(--info)' }]} format={(v) => String(Math.round(v))} />
        <div className="kv">
          <dt>Pagos a tiempo</dt><dd>{s.credit.onTimePayments}</dd>
          <dt>Pagos atrasados (24 meses)</dt><dd>{s.credit.latePayments.filter((d) => s.day - d <= 730).length}</dd>
          <dt>Impagos</dt><dd>{s.credit.defaults}</dd>
        </div>
      </div>
    </>
  );
}

export function Finance() {
  const nav = useNav();
  useUI();
  const sub = (nav.sub.finance as Sub) ?? 'accounts';
  return (
    <>
      <ScreenIntro icon="finance" title="Finanzas" text="Tu dinero del día a día: cuentas, presupuesto, tarjeta, préstamos, depósitos y puntaje de crédito." term="presupuesto" />
      <Tabs<Sub>
        items={[
          { id: 'accounts', label: 'Cuentas' },
          { id: 'budget', label: 'Presupuesto' },
          { id: 'card', label: 'Tarjeta' },
          { id: 'loans', label: 'Préstamos' },
          { id: 'invest', label: 'Inversión' },
          { id: 'credit', label: 'Crédito' },
        ]}
        value={sub}
        onChange={(v) => navStore.setSub('finance', v)}
      />
      {sub === 'accounts' && <Accounts />}
      {sub === 'card' && <Card />}
      {sub === 'loans' && <Loans />}
      {sub === 'invest' && <Invest />}
      {sub === 'budget' && <Budget />}
      {sub === 'credit' && <Credit />}
    </>
  );
}
