import { useEffect, useState } from 'react';
import { useGame, useUI, store } from '../../store';
import { InfoButton, CardHead, Pill, Act, Learn, LineChart, Money, Seg, AmountInput, ConfirmButton, Empty, Stat } from '../../components/common';
import { Donut, CHART_COLORS } from '../../components/charts';
import {
  openMandate, depositMandate, withdrawMandate, setMandateProfile, mandateForHire, mandateSummary, minMandate, PROFILE_INFO, NAV_START,
} from '../../../engine/invest/managed';
import { hirePro, firePro, trainPro, trainingCost, proMarketByKind, describeQuality, feeLabel, nextRefresh, TRAINING_COOLDOWN_DAYS } from '../../../engine/pros/pros';
import { FUND_BY_ID } from '../../../content/funds';
import { fmtMoney, fmtPct } from '../../../engine/format';
import { spendable } from '../../../engine/finance/payments';
import { formatDate } from '../../../engine/time/calendar';
import type { ProHire } from '../../../engine/pros/types';
import type { MandateProfile } from '../../../engine/invest/types';
import { Icon } from '../../icons';

const PROFILES: Array<{ id: MandateProfile; label: string }> = [
  { id: 'conservador', label: 'Conservador' },
  { id: 'moderado', label: 'Moderado' },
  { id: 'agresivo', label: 'Agresivo' },
];

function MandateCard({ h }: { h: ProHire }) {
  const s = useGame();
  useUI();
  const m = mandateForHire(s, h.id);
  const [amount, setAmount] = useState(Math.max(minMandate(s), 0));
  const [out, setOut] = useState(0);
  const [profile, setProfile] = useState<MandateProfile>('moderado');
  const cost = trainingCost(s, h);
  const canTrain = h.lastTraining === undefined || s.day - h.lastTraining >= TRAINING_COOLDOWN_DAYS;
  const sum = m ? mandateSummary(s, m) : null;
  const stockName = (id: string) => s.stocks.stocks.find((x) => x.id === id)?.name ?? id;
  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <div className="card-head">
        <div style={{ flex: 1 }}>
          <h2><Icon name="gestor" size={18} /> {h.pro.name}</h2>
          <div className="tiny muted">{h.pro.specialty} · {h.pro.experience} años de experiencia · {h.trainings ?? 0} capacitación(es) · desde {formatDate(h.since)}</div>
          <div className="tiny muted">{feeLabel(h.pro)}</div>
        </div>
      </div>
      {m && sum ? (
        <>
          <div className="grid2">
            <Stat label="Valor de tu cuenta" term="gestor_inversiones" value={<Money c={sum.value} />} sub={<>Aportaste {fmtMoney(m.contributed - m.withdrawn, { decimals: false })} netos (lo depositado menos lo retirado)</>} />
            <Stat label="Ganancia" term="ganancia_no_realizada" value={<Money c={sum.gain} colored sign />} sub={`Desde el inicio ${fmtPct(sum.totalReturn, 1)} · índice ${fmtPct(sum.benchReturn, 1)}`} />
          </div>
          {m.history.length > 1 && (
            <>
              <LineChart
                series={[
                  { name: 'Tu cuenta', values: m.history.map((x) => (x.nav / m.navStart) * 100), color: 'var(--accent)' },
                  { name: 'Fondo índice', values: m.history.map((x) => (x.bench / m.benchStart) * 100), color: 'var(--faint)', dashed: true },
                ]}
                pointLabels={m.history.map((x) => formatDate(x.d))}
                format={(v) => v.toFixed(0)}
                height={130}
              />
              <p className="tiny muted">Base 100 al empezar. Línea punteada: lo que habría rendido el Fondo Índice (sin gestor). Tocá el gráfico para ver cada fecha.</p>
            </>
          )}
          <strong className="small">Dónde está invertido tu dinero</strong>
          <Donut parts={[
            ...sum.positions.map((p, i) => ({ label: p.kind === 'stock' ? `${p.id} · ${stockName(p.id)}` : FUND_BY_ID[p.id]?.name ?? p.id, value: p.value, color: CHART_COLORS[i % CHART_COLORS.length] })),
            { label: 'Efectivo', value: Math.round(m.cash), color: 'var(--faint)' },
          ]} />
          <div className="kv">
            <dt>Perfil <InfoButton term="perfil_inversion" /></dt><dd>{PROFILE_INFO[m.profile].name}</dd>
            <dt>Comisiones de gestión pagadas <InfoButton term="comision_gestion" /></dt><dd>{fmtMoney(Math.round(m.mgmtFeesPaid))}</dd>
            <dt>Comisiones de éxito pagadas <InfoButton term="comision_exito" /></dt><dd>{fmtMoney(Math.round(m.perfFeesPaid))}</dd>
            <dt>Costos de compraventa</dt><dd>{fmtMoney(Math.round(m.tradingCosts))}</dd>
            <dt>Valor por unidad</dt><dd>{fmtMoney(Math.round(m.nav))} (empezó en {fmtMoney(NAV_START)})</dd>
          </div>
          {m.notes.length > 0 && (
            <details>
              <summary className="small"><strong>Últimas decisiones del gestor</strong></summary>
              {m.notes.slice().reverse().slice(0, 8).map((n, i) => <p key={i} className="tiny">{formatDate(n.d)} · {n.text}</p>)}
            </details>
          )}
          <div className="field">
            <label htmlFor={`dep-${m.id}`}>Darle más dinero</label>
            <AmountInput id={`dep-${m.id}`} value={amount} onChange={setAmount} max={spendable(s)} />
          </div>
          <Act label="Aportar" help="accion_gestor_aportar" className="btn primary" disabled={!(amount > 0)} onClick={() => store.run((x) => depositMandate(x, m.id, amount))} />
          <div className="field">
            <label htmlFor={`out-${m.id}`}>Retirar dinero</label>
            <AmountInput id={`out-${m.id}`} value={out} onChange={setOut} max={sum.value} />
          </div>
          <div className="btn-row">
            <Act label="Retirar" help="accion_gestor_retirar" className="btn" disabled={!(out > 0)} onClick={() => store.run((x) => withdrawMandate(x, m.id, out))} />
            <ConfirmButton label="Retirar todo y cerrar" help="accion_gestor_retirar" className="btn ghost" detail="Vende todo, cobra la comisión de éxito pendiente y te devuelve el dinero. La ganancia tributa como ganancia de capital." onConfirm={() => store.run((x) => withdrawMandate(x, m.id, 'todo'))} />
          </div>
          <span className="small">Perfil de riesgo <InfoButton term="accion_gestor_perfil" /></span>
          <p className="tiny muted">Actual: <strong>{PROFILE_INFO[m.profile].name}</strong>. {PROFILE_INFO[m.profile].description}</p>
          <div className="btn-row">
            {PROFILES.filter((p) => p.id !== m.profile).map((p) => (
              <ConfirmButton key={p.id} label={`Pasar a ${p.label.toLowerCase()}`} className="btn sm ghost" confirmLabel="Cambiar y rebalancear" detail={<>{PROFILE_INFO[p.id].description} El gestor vende y compra hoy para adaptar la cartera: se pagan comisiones de compraventa y, si hay ganancias, impuesto a las ganancias de capital.</>} onConfirm={() => store.run((x) => setMandateProfile(x, m.id, p.id))} />
            ))}
          </div>
        </>
      ) : (
        <>
          <p className="small">{s.managed.mandates.some((x) => x.hireId === h.id) ? 'Cerraste la cuenta anterior. Podés abrir una nueva:' : 'Todavía no le diste dinero.'} Elegí cuánto y con qué perfil de riesgo: lo invertirá en acciones y fondos del mercado del juego.</p>
          <div className="field">
            <label htmlFor={`open-${h.id}`}>Monto a entregar (mínimo {fmtMoney(minMandate(s), { decimals: false })})</label>
            <AmountInput id={`open-${h.id}`} value={amount} onChange={setAmount} max={spendable(s)} />
          </div>
          <Seg items={PROFILES} value={profile} onChange={setProfile} />
          <p className="tiny muted">{PROFILE_INFO[profile].description} Acciones {fmtPct(PROFILE_INFO[profile].stocks, 0)} · bonos {fmtPct(PROFILE_INFO[profile].bonds, 0)} · liquidez {fmtPct(PROFILE_INFO[profile].money, 0)}.</p>
          <Act label="Entregar dinero al gestor" help="accion_gestor_aportar" className="btn primary" onClick={() => store.run((x) => openMandate(x, h.id, amount, profile))} />
        </>
      )}
      <div className="btn-row">
        <Act label={canTrain ? `Capacitar (${fmtMoney(cost, { decimals: false })})` : `Capacitar (desde ${formatDate((h.lastTraining ?? 0) + TRAINING_COOLDOWN_DAYS)})`} help="accion_capacitar_pro" className="btn sm" disabled={!canTrain} onClick={() => store.run((x) => trainPro(x, h.id))} />
        <ConfirmButton label="Despedir" help="accion_despedir_pro" className="btn sm ghost" detail={m ? 'Se vende todo lo que administra y el dinero vuelve a tu cuenta corriente (con la comisión de éxito pendiente).' : 'Termina el contrato.'} onConfirm={() => store.run((x) => firePro(x, h.id))} />
      </div>
    </div>
  );
}

export function GestorScreen() {
  const s = useGame();
  useUI();
  useEffect(() => store.markSeen('gestor_inversiones'), []);
  const hires = s.pros.hires.filter((h) => h.pro.kind === 'gestor');
  const market = proMarketByKind(s, 'gestor');
  return (
    <>
      <div className="card">
        <CardHead title="Gestor de inversiones" term="gestor_inversiones" />
        <Learn term="gestor_inversiones" />
        <p className="small">Contratás a un profesional, le das dinero y lo invierte por vos en acciones y fondos. <strong>Cuanto mejor capacitado y con más experiencia, mejor elige</strong> — pero nadie garantiza ganancias: si el mercado cae, tu cuenta también. Podés capacitarlo para que mejore.</p>
      </div>
      {hires.map((h) => <MandateCard key={h.id} h={h} />)}
      <div className="card">
        <CardHead title={hires.length ? 'Otros gestores disponibles' : 'Gestores disponibles'} right={<span className="tiny muted">Nuevos el {formatDate(nextRefresh(s))}</span>} />
        {market.length === 0 && <Empty icon="gestor">No hay gestores disponibles ahora. El mercado de profesionales se renueva cada 60 días.</Empty>}
        {market.map((p) => (
          <div className="card flat" key={p.id} style={{ padding: 12, gap: 6 }}>
            <div className="card-head">
              <div style={{ flex: 1 }}>
                <strong className="small">{p.name}</strong>
                <div className="tiny muted">{p.specialty} · {p.experience} años de experiencia</div>
              </div>
              <Pill tone={p.reputation >= 70 ? 'gain' : p.reputation >= 45 ? 'info' : 'warn'}>{describeQuality(p)} · {p.reputation}</Pill>
            </div>
            <span className="small">{feeLabel(p)}</span>
            <span className="tiny muted">La reputación estima su calidad con error; la experiencia sí es un dato. Los más reconocidos cobran más.</span>
            <Act label="Contratar" help="accion_contratar_pro" className="btn sm primary" onClick={() => store.run((x) => hirePro(x, p.id, 'personal'))} />
          </div>
        ))}
      </div>
    </>
  );
}
