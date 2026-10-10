import { useState } from 'react';
import { useGame, useUI, store } from '../../store';
import { InfoButton, CardHead, Pill, NumInput, Act, Learn, LineChart, AmountInput, Money } from '../../components/common';
import { buyFund, sellFund, fundReturn } from '../../../engine/invest/funds';
import { FUND_DEFS } from '../../../content/funds';
import { fmtMoney, fmtPct, fmtNumber } from '../../../engine/format';
import { spendable } from '../../../engine/finance/payments';
import { usd } from '../../../engine/money';

function FundCard({ id }: { id: string }) {
  const s = useGame();
  useUI();
  const d = FUND_DEFS.find((x) => x.id === id)!;
  const f = s.funds.funds.find((x) => x.id === id)!;
  const h = s.funds.holdings[id];
  const [amount, setAmount] = useState(usd(500));
  const [units, setUnits] = useState(0);
  const [open, setOpen] = useState(false);
  const r1 = fundReturn(f, 365);
  const r3 = fundReturn(f, 90);
  const riskTone = d.risk <= 2 ? 'gain' : d.risk <= 3 ? 'info' : d.risk <= 4 ? 'warn' : 'loss';
  return (
    <div className="card">
      <button className="card-head" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', width: '100%' }} onClick={() => setOpen(!open)} aria-expanded={open}>
        <div style={{ flex: 1 }}>
          <h2>{d.name}</h2>
          <div className="tiny muted">{d.description}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="amt small">{fmtMoney(Math.round(f.nav))}</div>
          <Pill tone={riskTone}>Riesgo {d.risk}/5</Pill>
        </div>
      </button>
      {h && <p className="small">Tenés {fmtNumber(h.qty, 2)} participaciones · valor {fmtMoney(Math.round(h.qty * f.nav))} (<Money c={Math.round(h.qty * f.nav) - h.cost} colored sign />)</p>}
      {open && (
        <>
          <LineChart series={[{ name: d.id, values: f.history.slice(-180).map((x) => x.v), color: 'var(--accent)' }]} height={110} />
          <div className="kv">
            <dt>Valor liquidativo <InfoButton term="valor_liquidativo" /></dt><dd>{fmtMoney(Math.round(f.nav))}</dd>
            <dt>Rendimiento 3 meses</dt><dd>{r3 === null ? '—' : fmtPct(r3, 1)}</dd>
            <dt>Rendimiento 12 meses</dt><dd>{r1 === null ? '—' : fmtPct(r1, 1)}</dd>
            <dt>Comisión anual <InfoButton term="comision" /></dt><dd>{fmtPct(d.fee, 1)}</dd>
            <dt>Comisión de entrada</dt><dd className={d.entryFee ? undefined : 'txt'}>{d.entryFee ? fmtPct(d.entryFee, 1) : 'Sin comisión'}</dd>
            <dt>Reparte rendimientos</dt><dd className="txt">{d.distributes ? 'Sí, cada trimestre' : 'No, los reinvierte'}</dd>
          </div>
          <p className="small"><strong>Cómo funciona:</strong> {d.howItWorks}</p>
          <p className="small"><strong>Riesgos:</strong> {d.risks}</p>
          <div className="field">
            <label htmlFor={`fund-amt-${id}`}>Monto a invertir</label>
            <AmountInput id={`fund-amt-${id}`} value={amount} onChange={setAmount} max={spendable(s)} />
          </div>
          <Act label="Invertir" help="accion_invertir_fondo" className="btn primary" onClick={() => store.run((x) => buyFund(x, id, amount))} />
          {h && (
            <div className="field">
              <label htmlFor={`fund-u-${id}`}>Participaciones a rescatar (tenés {fmtNumber(h.qty, 2)})</label>
              <NumInput id={`fund-u-${id}`} live value={units} onChange={setUnits} step={0.01} />
              <div className="btn-row">
                <button className="btn sm ghost" onClick={() => setUnits(Math.floor(h.qty * 100) / 100)}>Todo</button>
                <Act label={`Rescatar ≈ ${fmtMoney(Math.round(Math.min(units, h.qty) * f.nav))}`} help="accion_rescatar_fondo" className="btn" disabled={!(units > 0)} onClick={() => store.run((x) => sellFund(x, id, units >= h.qty - 0.005 ? h.qty : units))} />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export function FundsScreen() {
  const s = useGame();
  useUI();
  return (
    <>
      <div className="card">
        <CardHead title="Fondos de inversión" term="fondo_inversion" />
        <Learn term="fondo_inversion" />
        <p className="small">Un fondo junta el dinero de muchos inversores y lo invierte por ellos. Es la forma más simple de diversificar con poco dinero: comprás participaciones al valor del día y podés rescatarlas cuando quieras. Tocá un fondo para ver cómo funciona y sus riesgos.</p>
        <div className="kv"><dt>Repartos cobrados (histórico)</dt><dd>{fmtMoney(s.funds.distributionsReceived)}</dd></div>
      </div>
      {FUND_DEFS.map((d) => <FundCard key={d.id} id={d.id} />)}
    </>
  );
}
