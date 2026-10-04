import { useState } from 'react';
import { useGame, useUI, store } from '../../store';
import { navStore } from '../../nav';
import { CardHead, InfoButton, Learn, Pill, Act, ConfirmButton, Stat, Money } from '../../components/common';
import { residence, compareJurisdictions, requestResidence, taxObligations, projectCurrentYear, deductionCapture } from '../../../engine/tax/taxEngine';
import { accountantReport } from '../../../engine/pros/pros';
import { JURISDICTION_BY_ID, type JurisdictionId } from '../../../content/jurisdictions';
import { balanceSheet } from '../../../engine/reports/statements';
import { fmtMoney, fmtPct } from '../../../engine/format';
import { formatDate } from '../../../engine/time/calendar';
import { usd } from '../../../engine/money';

function JurisdictionCard({ id }: { id: JurisdictionId }) {
  const s = useGame();
  const j = JURISDICTION_BY_ID[id];
  const top = j.incomeBrackets[j.incomeBrackets.length - 1].rate;
  const current = s.tax.jurisdiction === id;
  const pending = s.tax.pendingJurisdiction === id;
  const nw = balanceSheet(s).netWorth;
  const minNw = usd(j.minNetWorth * s.macro.priceIndex);
  return (
    <details className="card flat" style={{ padding: 12 }}>
      <summary className="small"><strong>{j.flag} {j.name}</strong> {current && <Pill tone="accent">Residencia actual</Pill>} {pending && <Pill tone="info">Desde el 1/1</Pill>}</summary>
      <p className="small">{j.summary}</p>
      <div className="kv">
        <dt>Impuesto a la renta <InfoButton term="impuesto_progresivo" /></dt><dd>{j.incomeBrackets.map((b, i) => `${fmtPct(b.rate, 0)}${b.upTo !== null ? ` hasta ${fmtMoney(usd(b.upTo), { decimals: false })}` : i > 0 ? ' en adelante' : ''}`).join(' → ')} (máx. {fmtPct(top, 0)})</dd>
        <dt>Seguridad social</dt><dd>{fmtPct(j.socialSecurityRate, 1)}</dd>
        <dt>Ganancias de capital <InfoButton term="ganancia_corto_largo" /></dt><dd>{j.capitalGains.shortRate === 0 && j.capitalGains.longRate === 0 ? 'Sin impuesto'
          : j.capitalGains.shortRate === j.capitalGains.longRate ? `${fmtPct(j.capitalGains.shortRate, 0)} (igual a corto y largo plazo)`
          : `${fmtPct(j.capitalGains.shortRate, 0)} corto / ${fmtPct(j.capitalGains.longRate, 0)} largo (tras ${Math.round(j.capitalGains.longAfterDays / 30)} meses)`}
          {j.capitalGains.shortRate + j.capitalGains.longRate > 0 && ` · pérdidas arrastrables ${j.capitalGains.lossCarryYears >= 99 ? 'sin límite' : `${j.capitalGains.lossCarryYears} años`}`}</dd>
        <dt>Dividendos <InfoButton term="retencion" /></dt><dd>{fmtPct(j.dividendRate, 0)}</dd>
        <dt>Sociedades <InfoButton term="impuesto_empresarial" /></dt><dd>{fmtPct(j.corporateRate, 0)}</dd>
        <dt>Alquileres</dt><dd>{j.rental.depreciationYears ? `Deprecia el edificio en ${j.rental.depreciationYears} años` : 'Sin depreciación'}{j.rental.mortgageInterestDeductible ? ' · deduce intereses' : ''}{j.rental.lossOffsetsOrdinary ? ' · pérdidas compensan sueldo' : ''}</dd>
        <dt>Inmuebles</dt><dd>Anual {fmtPct(j.propertyTaxRate, 2)} · transferencia {fmtPct(j.transferTaxRate, 1)} · hipotecas {j.mortgageRecourse ? 'con' : 'sin'} recurso</dd>
        <dt>Controles</dt><dd>Intensidad ×{j.enforcement.toFixed(1)} · auditoría anual {fmtPct(j.auditRate, 1)}</dd>
        <dt>Costo de vida</dt><dd>×{j.costOfLiving.toFixed(2)}</dd>
        <dt>Mudanza</dt><dd>{fmtMoney(usd(j.moveCost * s.macro.priceIndex), { decimals: false })}{j.minNetWorth ? ` · patrimonio mínimo ${fmtMoney(minNw, { decimals: false })}` : ''}</dd>
      </div>
      <ul className="small" style={{ margin: '6px 0', paddingLeft: 18 }}>{j.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      {!current && !pending && (
        <ConfirmButton label={`Mudar mi residencia a ${j.name}`} help="accion_residencia" className="btn sm" disabled={nw < minNw}
          detail={`Pagás ${fmtMoney(usd(j.moveCost * s.macro.priceIndex))} hoy y la residencia rige desde el 1 de enero. Tu costo de vida pasa a ×${j.costOfLiving.toFixed(2)}; tus empresas y inmuebles siguen tributando donde están registrados.`}
          onConfirm={() => store.run((x) => requestResidence(x, id))} />
      )}
      {pending && <ConfirmButton label="Cancelar mudanza" className="btn sm ghost" confirmLabel="Cancelar la mudanza" detail="Seguís residiendo donde estás. El trámite que ya pagaste no se devuelve." onConfirm={() => store.run((x) => requestResidence(x, s.tax.jurisdiction))} />}
    </details>
  );
}

export function TaxesScreen() {
  const s = useGame();
  useUI();
  const [showReport, setShowReport] = useState(false);
  const j = residence(s);
  const proj = projectCurrentYear(s);
  const cmp = compareJurisdictions(s);
  const obligations = taxObligations(s, 365);
  const report = showReport ? accountantReport(s) : null;
  const capture = deductionCapture(s);
  return (
    <>
      <section className="hero">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span className="eyebrow">Residencia fiscal</span>
          <InfoButton term="residencia_fiscal" />
        </div>
        <div className="big">{j.flag} {j.name}</div>
        <div className="small">{s.tax.pendingJurisdiction ? `Mudanza aprobada a ${JURISDICTION_BY_ID[s.tax.pendingJurisdiction].name} desde el 1 de enero.` : j.summary}</div>
        <Learn term="jurisdiccion" />
      </section>
      <div className="grid2">
        <Stat label="Impuesto estimado del año" term="declaracion_fiscal" value={<Money c={proj.projected.taxAfterCredits} />} sub={`Retenido hasta hoy ${fmtMoney(s.tax.ytd.withheld, { decimals: false })}`} />
        <Stat label="Saldo estimado al declarar" term="declaracion_fiscal" value={<Money c={proj.projected.balance} colored />} sub={proj.projected.balance > 0 ? 'A pagar' : proj.projected.balance < 0 ? 'A devolver' : 'Sin saldo'} />
        <Stat label="Ganancias de capital (año)" term="ganancia_capital" value={<Money c={(s.tax.ytd.gainsShort ?? 0) + (s.tax.ytd.gainsLong ?? 0)} colored sign />} sub={`Impuesto est. ${fmtMoney(proj.projected.capitalGainsTax ?? 0, { decimals: false })}`} />
        {s.realEstate.properties.some((p) => p.owner.kind === 'personal' && (p.lease || p.listedForRent)) && <Stat label="Deducciones de alquileres" term="deduccion_documental" value={fmtPct(capture, 0)} sub={capture < 1 ? 'Solo afecta la depreciación e intereses de inmuebles alquilados: un contador reclama más' : 'Completo'} />}
      </div>
      <div className="card">
        <CardHead title="Próximas obligaciones (12 meses)" term="declaracion_fiscal" />
        {obligations.length === 0 && <p className="small muted">Nada pendiente.</p>}
        <div className="rows">
          {obligations.map((o, i) => (
            <div className="row" key={i}>
              <div className="grow"><div className="small">{o.label}</div><div className="tiny faint">{formatDate(o.day)}</div></div>
              <Pill tone={o.kind === 'multa' ? 'loss' : o.kind === 'empresa' ? 'info' : o.kind === 'inmueble' ? 'accent' : 'neutral'}>{o.kind}</Pill>
              <span className="amt small">{o.amount === null ? '—' : fmtMoney(o.amount)}</span>
            </div>
          ))}
        </div>
        <button className="btn sm ghost" onClick={() => navStore.go('reports', 'tax')}>Ver declaraciones presentadas</button>
      </div>
      <div className="card">
        <CardHead title="Informe del contador" term="contador" />
        <p className="small">Revisa tus obligaciones y tu liquidez con los datos reales de tu partida. {s.pros.hires.some((h) => h.pro.kind === 'contador' && h.scope === 'personal') ? '' : 'Sin contador contratado solo verás la lista de obligaciones.'}</p>
        <Act label={showReport ? 'Actualizar informe' : 'Pedir informe'} help="contador" className="btn sm" onClick={() => setShowReport(true)} />
        {report && (
          <div className="stack" style={{ gap: 6 }}>
            <span className="tiny muted">{report.preparedBy ? `Preparado por ${report.preparedBy}` : 'Sin contador: contratá uno en Profesionales para un análisis completo.'}</span>
            {report.checks.map((c, i) => <div key={i} className={`small ${c.ok ? '' : 'loss'}`}>{c.ok ? '✔︎' : '⚠︎'} {c.text}</div>)}
          </div>
        )}
      </div>
      <div className="card">
        <CardHead title="Comparar jurisdicciones (planificación legal)" term="jurisdiccion" />
        <p className="small">Impuesto personal del año en curso si tus mismos ingresos se declararan en cada país (sin contar retenciones ya hechas). Cambiar de residencia es legal, pero cuesta dinero, cambia tu costo de vida y rige desde el 1 de enero.</p>
        <div className="rows">
          {cmp.sort((a, b) => a.tax - b.tax).map((c) => (
            <div className="row" key={c.id}>
              <div className="grow small">{JURISDICTION_BY_ID[c.id].flag} {c.name} {c.id === s.tax.jurisdiction && <Pill tone="accent">actual</Pill>}</div>
              <div style={{ textAlign: 'right' }}><div className="amt small">{fmtMoney(c.tax, { decimals: false })}</div><div className="tiny faint">de ello ganancias de capital {fmtMoney(c.cgt, { decimals: false })}</div></div>
            </div>
          ))}
        </div>
      </div>
      <div className="stack" style={{ gap: 8 }}>
        {(Object.keys(JURISDICTION_BY_ID) as JurisdictionId[]).map((id) => <JurisdictionCard key={id} id={id} />)}
      </div>
    </>
  );
}
