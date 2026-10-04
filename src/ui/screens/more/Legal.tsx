import { useState } from 'react';
import { useGame, useUI, store } from '../../store';
import { navStore } from '../../nav';
import { CardHead, InfoButton, Pill, Act, ConfirmButton, Seg, Empty, Stat, Bar, AmountInput, Money } from '../../components/common';
import {
  VENTURES, bribe, setUnderreport, setCompanyIrregular, skimCash, startVenture, depositUndeclared, launderThroughCompany, voluntaryDisclosure,
  payFine, finePlan, resolveInspection, assignLawyer, reviewCase, estimatedConviction, prepareDefense, negotiatePlea, acceptPlea, goToTrial, appeal,
  bribeInvestigator, openCases, legalRiskSummary, heatLabel, jurisdictionName,
} from '../../../engine/legal/legal';
import { isOpen } from '../../../engine/business/common';
import { sectorOf } from '../../../engine/business/common';
import { fmtMoney, fmtPct } from '../../../engine/format';
import { formatDate } from '../../../engine/time/calendar';
import type { LegalCase } from '../../../engine/legal/types';
import { IllegalToggle } from '../../components/IllegalToggle';
import { Icon } from '../../icons';
import { ILLEGAL_ICON } from '../../contentIcons';

const STAGE: Record<LegalCase['stage'], string> = { investigacion: 'Investigación', imputacion: 'Imputación', juicio: 'Juicio', sentencia: 'Sentencia', cerrado: 'Cerrado' };

function CaseCard({ c }: { c: LegalCase }) {
  const s = useGame();
  useUI();
  const lawyers = s.pros.hires.filter((h) => h.pro.kind === 'abogado');
  const lawyer = lawyers.find((h) => h.id === c.lawyerHireId);
  const est = estimatedConviction(s, c);
  const closed = c.stage === 'cerrado';
  const canAppeal = closed && c.outcome?.verdict === 'condenado' && !c.appealed && s.day - c.outcome.day <= 30;
  return (
    <div className="card" style={{ borderColor: closed ? undefined : 'var(--loss)' }}>
      <div className="card-head">
        <div style={{ flex: 1 }}>
          <h2>{c.title}</h2>
          <div className="tiny muted">{c.kind === 'penal' ? 'Causa penal' : 'Proceso fiscal'} · abierto el {formatDate(c.openedDay)} · {c.origin}</div>
        </div>
        <Pill tone={closed ? (c.outcome?.verdict === 'absuelto' || c.outcome?.verdict === 'archivado' ? 'gain' : 'loss') : 'warn'}>{closed ? c.outcome?.verdict ?? 'cerrado' : STAGE[c.stage]}</Pill>
      </div>
      {!closed && (
        <>
          <div className="kv">
            <dt>Etapa <InfoButton term={c.stage === 'investigacion' ? 'investigacion' : c.stage === 'imputacion' ? 'imputacion' : 'juicio'} /></dt><dd>{STAGE[c.stage]} · próximo paso {formatDate(c.nextStepDay)}</dd>
            <dt>Preparación de la defensa <InfoButton term="defensa_legal" /></dt><dd><Bar value={c.defense / 100} tone="gain" /> {Math.round(c.defense)}/100</dd>
            <dt>Solidez de la acusación</dt><dd>{c.reviewed ? <><Bar value={c.prosecution / 100} tone="loss" /> ≈{Math.round(c.prosecution)}/100</> : 'Desconocida (revisá el expediente con un abogado)'}</dd>
            <dt>Probabilidad de condena</dt><dd>{est ? `${fmtPct(est.estimate, 0)} ± ${fmtPct(est.error, 0)} (estimación)` : 'Sin estimar'}</dd>
            <dt>Representación <InfoButton term="abogado" /></dt><dd>{lawyer ? lawyer.pro.name : 'Defensor público'}</dd>
          </div>
          <p className="tiny muted">La condena depende de las pruebas, la defensa y el azar: incluso con el mejor abogado la probabilidad nunca baja del 5 % si hay pruebas, y nunca supera el 95 %.</p>
          {lawyers.length > 0 && (
            <div className="chips">
              {lawyers.map((h) => <button key={h.id} aria-pressed={c.lawyerHireId === h.id} onClick={() => store.run((x) => assignLawyer(x, c.id, h.id))} style={c.lawyerHireId === h.id ? { background: 'var(--text)', color: 'var(--bg)' } : undefined}>{h.pro.name}</button>)}
              <button aria-pressed={c.lawyerHireId === null} onClick={() => store.run((x) => assignLawyer(x, c.id, null))} style={c.lawyerHireId === null ? { background: 'var(--text)', color: 'var(--bg)' } : undefined}>Defensor público</button>
            </div>
          )}
          {lawyers.length === 0 && <button className="btn sm ghost" onClick={() => navStore.go('more', 'pros')}>Contratar un abogado</button>}
          <div className="btn-row">
            <Act label="Revisar expediente" help="accion_revisar_caso" className="btn sm" disabled={!lawyer || c.reviewed} onClick={() => store.run((x) => reviewCase(x, c.id))} />
            <Act label={`Preparar defensa${lawyer ? ` (${fmtMoney(lawyer.pro.fee, { decimals: false })})` : ''}`} help="accion_preparar_defensa" className="btn sm" disabled={!lawyer} onClick={() => store.run((x) => prepareDefense(x, c.id))} />
          </div>
          {c.plea && c.stage === 'imputacion' && (
            <div className="card flat" style={{ padding: 12, gap: 6 }}>
              <strong className="small">Oferta de acuerdo de la fiscalía <InfoButton term="accion_aceptar_acuerdo" /></strong>
              <span className="small">Multa {fmtMoney(c.plea.fine)}{c.plea.prisonMonths ? ` y ${c.plea.prisonMonths} meses de prisión` : ' sin prisión'} · vence {formatDate(c.plea.expires)}</span>
              <div className="btn-row">
                <Act label="Negociar" help="accion_negociar_acuerdo" className="btn sm" disabled={!lawyer || (c.negotiations ?? 0) >= 2} onClick={() => store.run((x) => negotiatePlea(x, c.id))} />
                <ConfirmButton label="Aceptar acuerdo" help="accion_aceptar_acuerdo" className="btn sm" detail="Aceptás la responsabilidad con una pena reducida y cierta. Queda en tus antecedentes." onConfirm={() => store.run((x) => acceptPlea(x, c.id))} />
                <ConfirmButton label="Ir a juicio" help="accion_ir_juicio" className="btn sm ghost" detail="Podés ser absuelto… o condenado con una pena mayor que la del acuerdo." onConfirm={() => store.run((x) => goToTrial(x, c.id))} />
              </div>
            </div>
          )}
          {c.stage === 'investigacion' && s.options.illegalEnabled && (
            <ConfirmButton label="Sobornar al investigador" help="accion_soborno" className="btn sm ghost" detail="Si lo rechaza, la acusación se fortalece mucho. Si acepta, es un delito nuevo que puede descubrirse." onConfirm={() => store.run((x) => bribeInvestigator(x, c.id))} />
          )}
        </>
      )}
      {closed && c.outcome && (
        <>
          <p className="small">{c.outcome.text}</p>
          <div className="kv">
            {c.outcome.fine > 0 && <><dt>Multa</dt><dd>{fmtMoney(c.outcome.fine)}</dd></>}
            {c.outcome.restitution > 0 && <><dt>Restitución</dt><dd>{fmtMoney(c.outcome.restitution)}</dd></>}
            {c.outcome.seized > 0 && <><dt>Decomiso</dt><dd>{fmtMoney(c.outcome.seized)}</dd></>}
            {c.outcome.prisonMonths > 0 && <><dt>Prisión</dt><dd>{c.outcome.prisonMonths} meses{c.outcome.suspended ? ' (en suspenso)' : ''}</dd></>}
          </div>
          {canAppeal && <Act label="Apelar la sentencia" help="accion_apelar" className="btn sm" disabled={!lawyer && lawyers.length === 0} onClick={() => store.run((x) => appeal(x, c.id))} />}
        </>
      )}
    </div>
  );
}

function GreyZone() {
  const s = useGame();
  useUI();
  const [amount, setAmount] = useState(0);
  const [venture, setVenture] = useState('falsificados');
  const cos = s.companies.filter((c) => isOpen(c) && !c.parentId);
  const [coId, setCoId] = useState<number | null>(cos[0]?.id ?? null);
  const co = cos.find((c) => c.id === coId) ?? null;
  const undeclared = s.ledger.balances.undeclared_cash;
  return (
    <div className="card" style={{ borderColor: 'var(--warn)' }}>
      <CardHead title="Zona gris (actividades ilegales ficticias)" term="evasion_fiscal" />
      <p className="small">Todo esto es ficción del juego con consecuencias probabilísticas: cada acto deja pruebas y testigos, sube la sospecha y puede terminar en auditorías, multas, embargos, pérdida de reputación o prisión. No hay garantía de éxito. Se puede desactivar en Ajustes.</p>
      <div className="kv">
        <dt>Efectivo no declarado <InfoButton term="efectivo_no_declarado" /></dt><dd>{fmtMoney(undeclared)}</dd>
      </div>

      <strong className="small">Ocultar ingresos en tu declaración <InfoButton term="accion_evasion" /></strong>
      <Seg items={[{ id: '0', label: 'Nada' }, { id: '0.25', label: '25 %' }, { id: '0.5', label: '50 %' }, { id: '0.75', label: '75 %' }]} value={String(s.tax.underreport ?? 0)} onChange={(v) => store.run((x) => setUnderreport(x, Number(v)))} />
      <span className="tiny muted">Se aplica en la próxima declaración anual sobre ingresos no salariales (el sueldo ya tiene retención).</span>

      <strong className="small">Operación clandestina <InfoButton term="accion_clandestino" /></strong>
      <div className="chips">{Object.entries(VENTURES).map(([k, v]) => <button key={k} aria-pressed={venture === k} onClick={() => setVenture(k)} style={venture === k ? { background: 'var(--text)', color: 'var(--bg)' } : undefined}>{v.name.replace(' (ficticia)', '').replace(' (ficticio)', '')}</button>)}</div>
      <span className="tiny muted">{VENTURES[venture].description} Rendimiento esperado {fmtPct(VENTURES[venture].expected, 0)} en {VENTURES[venture].days} días · riesgo de allanamiento {fmtPct(VENTURES[venture].risk, 0)}.</span>
      <AmountInput id="illegal-amt" value={amount} onChange={setAmount} />
      <div className="btn-row">
        <ConfirmButton label="Invertir en la operación" help="accion_clandestino" className="btn sm" detail="Se paga con efectivo no declarado si alcanza; si no, desde tu cuenta (deja más rastro)." onConfirm={() => store.run((x) => startVenture(x, venture, amount))} />
        <ConfirmButton label="Depositar efectivo no declarado" help="accion_depositar_no_declarado" className="btn sm ghost" disabled={undeclared <= 0} detail="Los depósitos grandes se reportan al fisco y aumentan la sospecha." onConfirm={() => store.run((x) => depositUndeclared(x, Math.min(amount || undeclared, undeclared)))} />
      </div>

      {cos.length > 0 && (
        <>
          <strong className="small">Con tus empresas</strong>
          <div className="chips">{cos.map((c) => <button key={c.id} aria-pressed={coId === c.id} onClick={() => setCoId(c.id)} style={coId === c.id ? { background: 'var(--text)', color: 'var(--bg)' } : undefined}>{c.name}</button>)}</div>
          {co && (
            <>
              <span className="tiny muted">Ventas no declaradas <InfoButton term="accion_irregular_empresa" /></span>
              <div>
                <Seg items={[{ id: '0', label: 'Nada' }, { id: '0.15', label: '15 %' }, { id: '0.3', label: '30 %' }]} value={String(co.irregular.underreport)} onChange={(v) => store.run((x) => setCompanyIrregular(x, co.id, { underreport: Number(v) }))} />
              </div>
              <span className="tiny muted">Inflar cifras ante bancos y compradores <InfoButton term="fraude" /></span>
              <div>
                <Seg items={[{ id: '0', label: 'Nada' }, { id: '0.2', label: '+20 %' }, { id: '0.4', label: '+40 %' }]} value={String(co.irregular.inflatedBooks)} onChange={(v) => store.run((x) => setCompanyIrregular(x, co.id, { inflatedBooks: Number(v) }))} />
              </div>
              <div className="btn-row">
                <ConfirmButton label="Retirar caja sin declarar" help="accion_retiro_no_declarado" className="btn sm" detail={`Retira ${fmtMoney(amount)} de ${co.name} como efectivo no declarado (evita la retención de dividendos). Los empleados pueden notarlo.`} onConfirm={() => store.run((x) => skimCash(x, co.id, amount))} />
                {sectorOf(co).model !== 'holding' && <ConfirmButton label="Lavar a través de la empresa" help="accion_lavado" className="btn sm ghost" disabled={undeclared <= 0} detail={`Registra ${fmtMoney(Math.min(amount, undeclared))} como ventas falsas: tributan y el crecimiento anómalo puede llamar la atención.`} onConfirm={() => store.run((x) => launderThroughCompany(x, co.id, Math.min(amount, undeclared)))} />}
              </div>
              <div className="btn-row">
                {co.openDay > s.day && <ConfirmButton label="Sobornar para agilizar permisos" help="accion_soborno" className="btn sm ghost" detail="El funcionario puede rechazarlo y denunciarte." onConfirm={() => store.run((x) => bribe(x, 'permisos', co.id))} />}
                {['consultora', 'muebles', 'saas'].includes(co.sector) && <ConfirmButton label="Sobornar por un contrato público" help="accion_soborno" className="btn sm ghost" detail="Seis meses de ventas extra si sale bien; una denuncia si sale mal." onConfirm={() => store.run((x) => bribe(x, 'contrato', co.id))} />}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function LegalScreen() {
  const s = useGame();
  useUI();
  const L = s.legal;
  const risk = legalRiskSummary(s);
  const cases = openCases(s);
  const closed = L.cases.filter((c) => c.stage === 'cerrado').slice(-5).reverse();
  const fines = L.fines.filter((f) => f.balance > 0);
  const insp = L.inspections.filter((i) => !i.resolved);
  const acts = L.acts.filter((a) => a.status === 'oculto');
  return (
    <>
      <IllegalToggle />
      {L.prison && (
        <div className="alert critical">
          <span className="stripe" />
          <div className="grow small" style={{ flex: 1 }}><strong><Icon name="lock" size={14} /> Estás en prisión hasta el {formatDate(L.prison.until)}.</strong> No podés trabajar ni operar; tus empresas siguen funcionando con sus gerentes y tus deudas siguen corriendo. Puede haber libertad anticipada por buena conducta.</div>
        </div>
      )}
      <div className="grid2">
        <Stat label="Sospecha de las autoridades" term="sospecha" value={<>{heatLabel(risk.heat)} <span className="tiny faint">{Math.round(risk.heat)}/100</span></>} sub={<Bar value={risk.heat / 100} tone={risk.heat > 50 ? 'loss' : risk.heat > 25 ? 'warn' : 'gain'} />} />
        <Stat label="Antecedentes penales" term="antecedentes" value={String(risk.record)} sub={risk.record ? 'Afectan empleos, crédito y penas futuras' : 'Sin antecedentes'} />
        <Stat label="Multas pendientes" term="multa" value={<Money c={risk.pendingFines} />} sub={`${fines.length} multa(s)`} />
        <Stat label="Procesos abiertos" term="investigacion" value={String(risk.openCases)} sub={risk.hiddenActs ? `${risk.hiddenActs} acto(s) no descubierto(s)` : 'Sin exposición oculta'} />
      </div>
      {cases.map((c) => <CaseCard key={c.id} c={c} />)}
      {cases.length === 0 && !L.prison && <Empty icon="legal">No tenés procesos judiciales abiertos.</Empty>}

      {fines.length > 0 && (
        <div className="card">
          <CardHead title="Multas" term="multa" />
          {fines.map((f) => (
            <div className="card flat" style={{ padding: 12, gap: 6 }} key={f.id}>
              <strong className="small">{f.label}</strong>
              <span className="small">Saldo {fmtMoney(f.balance)} de {fmtMoney(f.original)} · vence {formatDate(f.dueDay)}{f.installment ? ` · plan ${fmtMoney(f.installment)}/mes` : ''}{f.garnishing ? ' · EMBARGO en curso' : ''}</span>
              {f.garnishing && <span className="tiny loss">Con la multa vencida se embargan tus cuentas y, si no alcanza, tus inversiones. <InfoButton term="embargo" /></span>}
              <div className="btn-row">
                <Act label="Pagar todo" help="accion_pagar_multa" className="btn sm" onClick={() => store.run((x) => payFine(x, f.id))} />
                {!f.installment && <Act label="Plan de 12 cuotas (+10 %)" help="accion_plan_pagos" className="btn sm ghost" onClick={() => store.run((x) => finePlan(x, f.id))} />}
              </div>
            </div>
          ))}
        </div>
      )}

      {insp.length > 0 && (
        <div className="card">
          <CardHead title="Inspecciones a tus empresas" term="inspeccion" />
          {insp.map((i) => (
            <div className="card flat" style={{ padding: 12, gap: 6 }} key={i.id}>
              <span className="small"><strong>{s.companies.find((c) => c.id === i.companyId)?.name}</strong>: {i.reason}. Multa {fmtMoney(i.fine)} · vence {formatDate(i.dueDay)} (si vence, se duplica).</span>
              <div className="btn-row">
                <Act label="Pagar" help="accion_resolver_inspeccion" className="btn sm" onClick={() => store.run((x) => resolveInspection(x, i.id, 'pagar'))} />
                <Act label="Impugnar con abogado" help="accion_resolver_inspeccion" className="btn sm ghost" onClick={() => store.run((x) => resolveInspection(x, i.id, 'impugnar'))} />
                {s.options.illegalEnabled && <ConfirmButton label="Sobornar al inspector" help="accion_soborno" className="btn sm ghost" detail="Si lo rechaza, además de la multa se abre una causa penal." onConfirm={() => store.run((x) => resolveInspection(x, i.id, 'sobornar'))} />}
              </div>
            </div>
          ))}
        </div>
      )}

      {acts.length > 0 && (
        <div className="card">
          <CardHead title="Actos no descubiertos" term="prescripcion" />
          <p className="small">Cada acto puede descubrirse por auditorías, denuncias de testigos o controles hasta que prescribe. Las evasiones pueden regularizarse voluntariamente: pagás impuesto + 20 % + intereses, sin proceso penal.</p>
          <div className="rows">
            {acts.map((a) => (
              <div className="row" key={a.id}>
                <Icon name={ILLEGAL_ICON[a.kind]} size={18} />
                <div className="grow">
                  <div className="small">{a.label}</div>
                  <div className="tiny faint">{formatDate(a.day)} · {jurisdictionName(a.jurisdiction)} · pruebas {Math.round(a.evidence)}/100 · {a.witnesses} testigo(s) · prescribe {formatDate(a.statuteDay)}</div>
                </div>
                {(a.kind === 'evasion' || a.kind === 'evasion_empresa') && <ConfirmButton label="Regularizar" help="accion_regularizar" className="btn sm" detail="Se genera una deuda fiscal con recargo e intereses; el acto queda cerrado sin causa penal." onConfirm={() => store.run((x) => voluntaryDisclosure(x, a.id))} />}
              </div>
            ))}
          </div>
        </div>
      )}

      {L.ventures.length > 0 && (
        <div className="card">
          <CardHead title="Operaciones clandestinas en curso" term="negocio_clandestino" />
          {L.ventures.map((v) => <p className="small" key={v.id}>{fmtMoney(v.invested)} invertidos · se resuelve el {formatDate(v.resolveDay)} · riesgo {fmtPct(v.risk, 0)}</p>)}
        </div>
      )}

      {s.options.illegalEnabled && !L.prison && <GreyZone />}
      {!s.options.illegalEnabled && <p className="tiny muted">Las actividades ilegales ficticias están desactivadas (Ajustes → Partida).</p>}

      {closed.length > 0 && (
        <div className="card">
          <CardHead title="Procesos cerrados" />
          {closed.map((c) => <CaseCard key={c.id} c={c} />)}
        </div>
      )}
      {L.log.length > 0 && (
        <details className="card">
          <summary className="small"><strong>Historial legal</strong></summary>
          {L.log.slice(-20).reverse().map((l, i) => <div className="tiny" key={i}>{formatDate(l.day)} · {l.text}</div>)}
        </details>
      )}
    </>
  );
}
