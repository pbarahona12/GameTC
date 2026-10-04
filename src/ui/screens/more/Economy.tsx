import { Fragment, useEffect } from 'react';
import { useGame, useUI, store } from '../../store';
import { CardHead, InfoButton, Learn, LineChart, Legend, Pill, Stat } from '../../components/common';
import { PHASES, phaseInfo, consumerDemand, creditSpread, stockMarketDrift, housingDrift } from '../../../engine/economy/economy';
import { difficultyOf } from '../../../engine/economy/difficulty';
import { fmtPct } from '../../../engine/format';
import { formatDate, formatDateShort } from '../../../engine/time/calendar';
import { SECTORS } from '../../../content/sectors';
import { PHASE_ICON } from '../../contentIcons';
import { Icon } from '../../icons';

/** Panel macroeconómico: todo sale del estado real de la simulación. */
export function EconomyScreen() {
  const s = useGame();
  useUI();
  useEffect(() => store.markSeen('ciclo_economico'), []);
  const m = s.macro;
  const ph = phaseInfo(s);
  const months = m.monthly.slice(-36);
  const active = m.events.filter((e) => e.startDay <= s.day && e.endDay >= s.day);
  const past = m.events.filter((e) => e.endDay < s.day).slice(-6).reverse();
  const diff = difficultyOf(s);
  const mkt = stockMarketDrift(s);
  const series = [
    { name: 'Crecimiento PIB', values: months.map((x) => x.gdp * 1000), color: 'var(--accent)' },
    { name: 'Desempleo', values: months.map((x) => x.unemployment * 1000), color: 'var(--loss)' },
    { name: 'Inflación', values: months.map((x) => x.inflation * 1000), color: 'var(--warn)' },
    { name: 'Tasa', values: months.map((x) => x.policyRate * 1000), color: 'var(--info)' },
  ];
  return (
    <>
      <section className="hero">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="eyebrow">Ciclo económico</span>
          <InfoButton term="ciclo_economico" />
        </div>
        <div className="big"><Icon name={PHASE_ICON[s.macro.phase]} size={26} /> {ph.name}</div>
        <div className="small">{ph.description} Lleva {m.phaseMonths} mes(es) en esta fase.</div>
        <Learn term="ciclo_economico" />
      </section>
      <div className="grid2">
        <Stat label="Crecimiento del PIB" term="pib" value={fmtPct(m.gdpGrowth, 1)} sub="Anualizado" />
        <Stat label="Desempleo" term="desempleo" value={fmtPct(m.unemployment, 1)} sub="Afecta búsqueda de empleo, despidos y morosidad" />
        <Stat label="Inflación anual" term="inflacion" value={fmtPct(m.inflation, 1)} sub={`Índice de precios ${m.priceIndex.toFixed(3)}`} />
        <Stat label="Tasa de política" term="interes" value={fmtPct(m.policyRate, 2)} sub={`Diferencial de crédito ${creditSpread(s) >= 0 ? "+" : ""}${fmtPct(creditSpread(s), 1)}`} />
        <Stat label="Confianza del consumidor" term="confianza_consumidor" value={m.confidence.toFixed(2)} sub="1.00 = normal" />
        <Stat label="Costos de proveedores" term="costo_proveedores" value={m.supplierCost.toFixed(2)} sub="Multiplica el costo de insumos" />
      </div>
      {months.length > 1 && (
        <div className="card">
          <CardHead title="Evolución mensual (%)" term="inflacion" />
          <LineChart series={series} labels={months.map((x) => formatDateShort(x.day))} height={150} format={(v) => (v / 10).toFixed(1)} />
          <Legend series={series} />
        </div>
      )}
      <div className="card">
        <CardHead title="Efecto actual sobre tu mundo" term="evento_economico" />
        <div className="kv">
          <dt>Deriva esperada de la bolsa</dt><dd>{fmtPct(mkt.drift, 1)} anual · volatilidad ×{mkt.vol.toFixed(2)} frente a lo normal</dd>
          <dt>Tendencia inmobiliaria</dt><dd>{fmtPct(housingDrift(s), 1)} anual</dd>
          {SECTORS.map((sec) => <Fragment key={sec.id}><dt>Demanda: {sec.name}</dt><dd>×{consumerDemand(s, sec.id).toFixed(2)}</dd></Fragment>)}
        </div>
        <p className="tiny muted">Estos multiplicadores son los que usa la simulación de tus empresas, inversiones e inmuebles: no son decorativos.</p>
      </div>
      <div className="card">
        <CardHead title="Eventos económicos" term="evento_economico" />
        {active.length === 0 && <p className="small muted">No hay eventos en curso.</p>}
        {active.map((e) => (
          <div className="alert info" key={e.id}>
            <span className="stripe" />
            <div className="grow small" style={{ flex: 1 }}><strong>{e.name}</strong> · hasta {formatDate(e.endDay)}<br />{e.description}</div>
          </div>
        ))}
        {past.length > 0 && <p className="tiny muted">Anteriores: {past.map((e) => `${e.name} (${formatDateShort(e.startDay)})`).join(' · ')}</p>}
      </div>
      <div className="card">
        <CardHead title="Las cinco fases" term="recesion" />
        <div className="rows">
          {Object.entries(PHASES).map(([id, p]) => (
            <div className="row" key={id}>
              <Icon name={PHASE_ICON[id as keyof typeof PHASE_ICON]} size={18} />
              <div className="grow"><div className="title small">{p.name} {id === m.phase && <Pill tone="accent">actual</Pill>}</div><div className="meta">{p.description}</div></div>
            </div>
          ))}
        </div>
      </div>
      <div className="card">
        <CardHead title={`Dificultad económica: ${diff.name}`} term="dificultad" />
        <p className="small">{diff.description}</p>
        <p className="tiny muted">Se cambia en Ajustes. Afecta la volatilidad, la frecuencia de recesiones y eventos, la dureza de los controles y la exigencia de los bancos.</p>
      </div>
    </>
  );
}
