import { useState } from 'react';
import { useGame, useUI, store } from '../../store';
import { CardHead, InfoButton, Learn, Pill, Act, ConfirmButton, Empty } from '../../components/common';
import { PRO_INFO, hirePro, firePro, commissionAudit, prosSummary, proMarketByKind, nextRefresh, describeQuality, feeLabel, projectPortfolio, trainPro, trainingCost, TRAINING_COOLDOWN_DAYS, SPECIALTY_SECTOR } from '../../../engine/pros/pros';
import { navStore } from '../../nav';
import { isOpen } from '../../../engine/business/common';
import { fmtMoney, fmtPct } from '../../../engine/format';
import { formatDate } from '../../../engine/time/calendar';
import type { ProKind, Professional } from '../../../engine/pros/types';
import { Icon } from '../../icons';
import { PRO_ICON } from '../../contentIcons';

const KINDS: ProKind[] = ['contador', 'asesor', 'gestor', 'abogado', 'auditor', 'gerente'];
const TERM: Record<ProKind, string> = { contador: 'contador', asesor: 'asesor_financiero', abogado: 'abogado', auditor: 'auditor', gerente: 'gerente_profesional', gestor: 'gestor_inversiones' };

function ProRow({ p }: { p: Professional }) {
  const s = useGame();
  const companies = s.companies.filter((c) => isOpen(c));
  const scopes: Array<{ id: string; label: string }> = [
    ...(p.kind === 'gerente' || p.kind === 'auditor' ? [] : [{ id: 'personal', label: 'Personal' }]),
    ...(p.kind === 'asesor' || p.kind === 'gestor' ? [] : companies.map((c) => ({ id: String(c.id), label: c.name }))),
  ];
  const [scope, setScope] = useState(scopes[0]?.id ?? '');
  const scopeVal: 'personal' | number = scope === 'personal' ? 'personal' : Number(scope);
  return (
    <div className="card flat" style={{ padding: 12, gap: 6 }}>
      <div className="card-head">
        <div style={{ flex: 1 }}>
          <strong className="small">{p.name}</strong>
          <div className="tiny muted">{p.specialty} · {p.experience} años de experiencia</div>
        </div>
        <Pill tone={p.reputation >= 70 ? 'gain' : p.reputation >= 45 ? 'info' : 'warn'}>{describeQuality(p)} · {p.reputation}</Pill>
      </div>
      <span className="small">{feeLabel(p)}</span>
      <span className="tiny muted">La reputación es una estimación pública: la calidad real del servicio puede ser algo mejor o peor.</span>
      {scopes.length === 0 ? (
        <span className="tiny muted">{p.kind === 'asesor' ? '' : 'Necesitás una empresa abierta.'}</span>
      ) : (
        <>
          {scopes.length > 1 && (
            <div className="chips">{scopes.map((o) => <button key={o.id} aria-pressed={scope === o.id} onClick={() => setScope(o.id)} style={scope === o.id ? { background: 'var(--text)', color: 'var(--bg)' } : undefined}>{o.label}</button>)}</div>
          )}
          {p.kind === 'auditor' ? (
            <ConfirmButton label="Encargar auditoría" help="accion_auditoria" className="btn sm" detail={`La empresa paga ${fmtMoney(p.fee)}. Una auditoría limpia mejora la valoración y el crédito durante 12 meses; si hay irregularidades, el auditor debe informarlas.`} onConfirm={() => store.run((x) => commissionAudit(x, Number(scope), p.id))} />
          ) : (
            p.kind === 'gerente' && typeof scopeVal === 'number' ? (() => {
              const co = s.companies.find((c) => c.id === scopeVal);
              const fits = !!co && SPECIALTY_SECTOR[p.specialty] === co.sector;
              return <ConfirmButton label="Contratar" help="accion_contratar_pro" className="btn sm primary" confirmLabel="Contratar gerente" detail={<>La empresa paga {fmtMoney(Math.round(p.fee * 0.5))} de búsqueda y contratación y después {fmtMoney(p.fee)} de sueldo por mes. {fits ? 'Es de su especialidad: rinde con toda su habilidad.' : `Fuera de su especialidad rinde un 15 % menos (habilidad efectiva ≈ ${Math.round(p.quality * 0.85)}).`}</>} onConfirm={() => store.run((x) => hirePro(x, p.id, scopeVal))} />;
            })() : <Act label="Contratar" help="accion_contratar_pro" className="btn sm primary" onClick={() => store.run((x) => hirePro(x, p.id, scopeVal))} />
          )}
        </>
      )}
    </div>
  );
}

export function ProsScreen() {
  const s = useGame();
  useUI();
  const [kind, setKind] = useState<ProKind>('contador');
  const hires = prosSummary(s);
  const market = proMarketByKind(s, kind);
  const proj = hires.some((h) => h.hire.pro.kind === 'asesor') ? projectPortfolio(s, 12) : null;
  const audits = s.pros.audits.slice(-6).reverse();
  return (
    <>
      <div className="card">
        <CardHead title="Profesionales" term="profesionales" />
        <Learn term="profesionales" />
        <p className="small">Contratar es opcional. Cada profesional tiene experiencia, especialidad, costo y reputación; la calidad real de su trabajo se nota con el tiempo. Ninguno garantiza resultados.</p>
      </div>
      <div className="card">
        <CardHead title="Tu equipo" />
        {hires.length === 0 && <Empty icon="deal">No contrataste a nadie todavía.</Empty>}
        <div className="rows">
          {hires.map(({ hire, monthly, where }) => (
            <div className="row" key={hire.id}>
              <Icon name={PRO_ICON[hire.pro.kind]} size={18} />
              <div className="grow">
                <div className="title small">{hire.pro.name} · {PRO_INFO[hire.pro.kind].name}</div>
                <div className="meta">{where} · desde {formatDate(hire.since)} · {hire.pro.kind === 'gestor' ? feeLabel(hire.pro) : monthly ? `${fmtMoney(monthly)}/mes` : 'por encargo'}</div>
                <div className="tiny faint">{hire.pro.experience} años de experiencia · {hire.trainings ?? 0} capacitación(es)</div>
              </div>
              <div className="stack" style={{ gap: 4, alignItems: 'flex-end' }}>
                {hire.pro.kind === 'gestor' && <button className="btn sm" onClick={() => navStore.go('invest', 'gestor')}>Ver cuenta</button>}
                {hire.pro.kind !== 'gerente' && hire.pro.kind !== 'auditor' && (
                  <Act label={`Capacitar (${fmtMoney(trainingCost(s, hire), { decimals: false })})`} help="accion_capacitar_pro" className="btn sm" disabled={hire.lastTraining !== undefined && s.day - hire.lastTraining < TRAINING_COOLDOWN_DAYS} onClick={() => store.run((x) => trainPro(x, hire.id))} />
                )}
                <ConfirmButton label="Despedir" help="accion_despedir_pro" className="btn sm ghost" detail={`Dejás de pagar sus honorarios. ${hire.pro.kind === 'abogado' ? 'Si tenía un caso asignado, te representará un defensor público.' : hire.pro.kind === 'gestor' ? 'Vende lo que administra y te devuelve el dinero.' : ''}`} onConfirm={() => store.run((x) => firePro(x, hire.id))} />
              </div>
            </div>
          ))}
        </div>
      </div>
      {proj && (
        <div className="card">
          <CardHead title="Proyección del asesor (12 meses)" term="asesor_financiero" />
          <div className="kv">
            <dt>Pesimista (10 %)</dt><dd>{fmtMoney(proj.p10)}</dd>
            <dt>Central (50 %)</dt><dd>{fmtMoney(proj.p50)}</dd>
            <dt>Optimista (90 %)</dt><dd>{fmtMoney(proj.p90)}</dd>
            <dt>Probabilidad de pérdida</dt><dd>{fmtPct(proj.probLoss, 0)}</dd>
          </div>
          <p className="tiny muted">{proj.note}</p>
        </div>
      )}
      <div className="card">
        <CardHead title="Mercado de profesionales" term={TERM[kind]} right={<span className="tiny muted">Se renueva el {formatDate(nextRefresh(s))}</span>} />
        <div className="chips">{KINDS.map((k) => <button key={k} aria-pressed={kind === k} onClick={() => setKind(k)} style={kind === k ? { background: 'var(--text)', color: 'var(--bg)' } : undefined}>{PRO_INFO[k].name.split(' ')[0]}</button>)}</div>
        <p className="small">{PRO_INFO[kind].what} <InfoButton term={TERM[kind]} /></p>
        {market.length === 0 && <p className="small muted">No quedan candidatos de este tipo hasta la próxima renovación.</p>}
        {market.map((p) => <ProRow key={p.id} p={p} />)}
      </div>
      {audits.length > 0 && (
        <div className="card">
          <CardHead title="Auditorías realizadas" term="auditoria_limpia" />
          {audits.map((a) => (
            <details key={a.id}>
              <summary className="small">{s.companies.find((c) => c.id === a.companyId)?.name ?? 'Empresa'} · {formatDate(a.day)} · <Pill tone={a.clean ? 'gain' : 'loss'}>{a.clean ? 'Limpia' : 'Con hallazgos'}</Pill></summary>
              <ul className="small" style={{ paddingLeft: 18 }}>{a.findings.map((f) => <li key={f}>{f}</li>)}</ul>
              <span className="tiny muted">Auditor: {a.auditorName} · vigente hasta {formatDate(a.validUntil)}</span>
            </details>
          ))}
        </div>
      )}
    </>
  );
}
