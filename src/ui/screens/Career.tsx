import { imageJobBonus } from '../../engine/lifestyle/effects';
import { Fragment, useState } from 'react';
import { useGame, useUI, store } from '../store';
import { navStore, useNav } from '../nav';
import { JOBS, JOB_BY_ID, SECTOR_NAMES, Sector, EDUCATION_NAMES, FIELD_NAMES } from '../../content/jobs';
import { COURSES, COURSE_BY_ID, COURSE_KIND_NAMES, CourseKind } from '../../content/courses';
import { SKILLS, xpToNext, SKILL_MAX_LEVEL } from '../../content/skills';
import {
  apply, acceptOffer, declineOffer, negotiateOffer, negotiationChance, quitJob, applyBlocker, checkRequirements, applicationChance, jobSalary, performanceTarget, projectedRaisePct,
} from '../../engine/career/career';
import { enroll, dropCourse, courseRequirements, courseTotalCost, studyHoursPerWeek, timesCompleted, tuition, coursePrice } from '../../engine/skills/education';
import { studyMultiplier } from '../../engine/skills/skills';
import { payroll } from '../../engine/tax/incomeTax';
import { residence } from '../../engine/tax/taxEngine';
import { formatDate } from '../../engine/time/calendar';
import { fmtMoney, fmtPct, fmtNumber } from '../../engine/format';
import { usd } from '../../engine/money';
import { Money, InfoButton, Tabs, Bar, Pill, Empty, ConfirmButton, Learn, ScreenIntro } from '../components/common';
import { professionalLevel } from '../../engine/progression/progression';
import { SKILL_ICON } from '../contentIcons';
import { Icon } from '../icons';

type Sub = 'job' | 'board' | 'study' | 'skills';

function CurrentJob() {
  const s = useGame();
  const e = s.career.job;
  if (!e) {
    return (
      <div className="card">
        <Empty icon="career">
          <strong>Sin empleo.</strong>
          <div className="small">No es obligatorio trabajar, pero sin ingresos tus gastos fijos consumen tu efectivo cada mes.</div>
        </Empty>
        <span className="act"><button className="btn primary" onClick={() => navStore.setSub('career', 'board')}>Buscar empleo</button><InfoButton term="accion_postular" /></span>
      </div>
    );
  }
  const job = JOB_BY_ID[e.jobId];
  const pr = payroll(residence(s), e.salary, s.bank.pensionRate);
  const target = Math.round(performanceTarget(s));
  const next = job.promotesTo ? JOB_BY_ID[job.promotesTo] : null;
  return (
    <div className="card">
      <div className="card-head">
        <div style={{ flex: 1 }}>
          <span className="eyebrow">{SECTOR_NAMES[job.sector]} · Nivel {job.level}</span>
          <h2 style={{ fontSize: 18 }}>{job.title}</h2>
          <span className="small muted">{job.employer} · desde {formatDate(e.startDay)}</span>
        </div>
      </div>
      <div className="rows">
        <div className="row"><div className="grow">Salario bruto <InfoButton term="salario_bruto" /></div><Money c={pr.gross} className="amt" /></div>
        <div className="row sub"><div className="grow small muted">Aporte a jubilación ({fmtPct(s.bank.pensionRate, 0)})</div><span className="amt small">−{fmtMoney(pr.pensionEmployee)}</span></div>
        <div className="row sub"><div className="grow small muted">Seguridad social ({fmtPct(residence(s).socialSecurityRate, 1)}) <InfoButton term="seguridad_social" /></div><span className="amt small">−{fmtMoney(pr.socialSecurity)}</span></div>
        <div className="row sub"><div className="grow small muted">Retención de impuesto <InfoButton term="retencion" /></div><span className="amt small">−{fmtMoney(pr.incomeTaxWithheld)}</span></div>
        <div className="row total"><div className="grow">Salario neto <InfoButton term="salario_neto" /></div><Money c={pr.net} className="amt" /></div>
      </div>
      <Learn term="salario_neto" />
      <div className="kv">
        <dt>Comisión variable</dt><dd>{job.commission ? `${fmtPct(job.commission)} del sueldo × desempeño` : '—'}</dd>
        <dt>Bono anual objetivo</dt><dd>{job.bonusTarget ? fmtPct(job.bonusTarget) + ' del sueldo anual' : '—'}</dd>
        <dt>Aporte del empleador</dt><dd>{job.pensionMatch ? `iguala tu aporte hasta ${fmtPct(job.pensionMatch)}: recibís ${fmtPct(Math.min(s.bank.pensionRate, job.pensionMatch))}${s.bank.pensionRate < job.pensionMatch ? ` (aportá ${fmtPct(job.pensionMatch)} para el máximo)` : ''}` : 'No'}</dd>
        <dt>Seguro médico</dt><dd>{job.healthInsurance ? 'Incluido' : 'No incluido'}</dd>
        <dt>Jornada</dt><dd>{job.hoursPerWeek} h/semana</dd>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <strong className="small" style={{ flex: 1 }}>Desempeño {e.performance}/100 <InfoButton term="desempeno" /></strong>
          <span className="tiny muted">tendencia → {target}</span>
        </div>
        <Bar value={e.performance / 100} tone={e.performance < 30 ? 'loss' : e.performance < 50 ? 'warn' : 'gain'} />
        <p className="tiny muted">
          Evaluación anual el {formatDate(e.nextReviewDay)}: con el desempeño actual el aumento sería {fmtPct(projectedRaisePct(s, e.performance))} (incluye el ajuste por inflación y por el ciclo económico).
          {next && ` Con desempeño 70+ y los requisitos cumplidos, ascenso a ${next.title}:`}
        </p>
        {next && (
          <ul className="reqs tiny">
            <li className={e.performance >= 70 ? 'gain' : 'muted'}>{e.performance >= 70 ? '✓' : '✗'} Desempeño 70 o más (hoy {e.performance})</li>
            {checkRequirements(s, next).items.map((r) => <li key={r.label} className={r.met ? 'gain' : 'muted'}>{r.met ? '✓' : '✗'} {r.label}</li>)}
          </ul>
        )}
      </div>
      <ConfirmButton
        label="Renunciar"
        className="btn danger"
        help="accion_renunciar"
        confirmLabel="Sí, renunciar"
        detail={<>Cobrarás los días trabajados del mes y dejarás de recibir {fmtMoney(pr.net)} netos por mes. Tus gastos fijos siguen corriendo.</>}
        onConfirm={() => store.run(quitJob)}
      />
    </div>
  );
}

function Offers() {
  const s = useGame();
  const offers = s.career.applications.filter((a) => a.status === 'offer');
  const pending = s.career.applications.filter((a) => a.status === 'pending');
  const recent = s.career.applications.filter((a) => a.status !== 'offer' && a.status !== 'pending').slice(-5).reverse();
  if (!offers.length && !pending.length && !recent.length) return null;
  return (
    <>
      {offers.map((a) => {
        const job = JOB_BY_ID[a.jobId];
        const pr = payroll(residence(s), a.offerSalary!, s.bank.pensionRate);
        return (
          <div className="card" key={a.id} style={{ borderColor: 'var(--gain)' }}>
            <div className="card-head">
              <Pill tone="gain">Oferta</Pill>
              <h2>{job.title}</h2>
              <InfoButton term="accion_negociar" />
            </div>
            <div className="small muted">{job.employer} · vence el {formatDate(a.offerExpiresDay!)}</div>
            <div className="kv">
              <dt>Salario bruto</dt><dd>{fmtMoney(a.offerSalary!)}</dd>
              <dt>Neto estimado</dt><dd>{fmtMoney(pr.net)}</dd>
              {s.career.job && <><dt>Tu neto actual</dt><dd>{fmtMoney(payroll(residence(s), s.career.job.salary, s.bank.pensionRate).net)}</dd></>}
            </div>
            <div className="chips tiny">
              <Pill tone="neutral">{job.hoursPerWeek} h/sem</Pill>
              {job.healthInsurance ? <Pill tone="gain">Seguro médico</Pill> : <Pill tone="neutral">Sin seguro médico</Pill>}
              {job.pensionMatch > 0 && <Pill tone="gain">Aporte jubilación {fmtPct(job.pensionMatch)}</Pill>}
              {job.commission && <Pill tone="accent">Comisión {fmtPct(job.commission)}</Pill>}
              {job.bonusTarget > 0 && <Pill tone="accent">Bono {fmtPct(job.bonusTarget)}</Pill>}
            </div>
            {!a.negotiated && (
              <div className="stack" style={{ gap: 6 }}>
                <span className="tiny muted">Negociar (una sola vez). Probabilidad estimada de éxito:</span>
                <div className="chips">
                  {[0.05, 0.1, 0.15, 0.2].map((p) => {
                    const ok = negotiationChance(s, p);
                    return (
                      <button key={p} onClick={() => store.run((st) => negotiateOffer(st, a.id, p))}>
                        +{p * 100} % · {Math.round(ok * 100)} %{p >= 0.15 ? ` · riesgo de perder la oferta ${Math.round((1 - ok) * 30)} %` : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="btn-row">
              <span className="act"><button className="btn ghost" onClick={() => store.run((st) => declineOffer(st, a.id))}>Rechazar</button><InfoButton term="accion_oferta" /></span>
              <span className="act">
                {s.career.job ? (() => {
                  const cur = JOB_BY_ID[s.career.job.jobId];
                  const lostInsurance = cur.healthInsurance && !job.healthInsurance && !s.budget.privateInsurance;
                  return <ConfirmButton label="Aceptar y cambiar" className="btn primary" confirmLabel="Cambiar de empleo" detail={<>Dejás {cur.title}: perdés la evaluación del {formatDate(s.career.job.nextReviewDay)}{cur.bonusTarget > 0 ? ' y su bono anual' : ''}, tu desempeño vuelve a 50 y la próxima evaluación será en 12 meses.{lostInsurance ? ' El nuevo empleo no incluye seguro médico: quedás sin cobertura.' : ''}</>} onConfirm={() => store.run((st) => acceptOffer(st, a.id))} />;
                })() : <button className="btn primary" onClick={() => store.run((st) => acceptOffer(st, a.id))}>Aceptar</button>}
                <InfoButton term="accion_oferta" />
              </span>
            </div>
          </div>
        );
      })}
      {pending.length > 0 && (
        <div className="card">
          <div className="card-head"><h2>Postulaciones en curso</h2></div>
          <div className="rows">
            {pending.map((a) => (
              <div className="row" key={a.id}>
                <div className="grow"><div className="title">{JOB_BY_ID[a.jobId].title}</div><div className="meta">{JOB_BY_ID[a.jobId].employer} · respuesta hacia el {formatDate(a.resolveDay)}</div></div>
                <Pill tone="info">{Math.round(a.chance * 100)} %</Pill>
              </div>
            ))}
          </div>
        </div>
      )}
      {recent.length > 0 && (
        <details className="card">
          <summary className="small"><strong>Respuestas recientes</strong></summary>
          <div className="rows">
            {recent.map((a) => (
              <div className="row" key={a.id}>
                <div className="grow"><div className="title small">{JOB_BY_ID[a.jobId].title}</div><div className="meta">{a.message ?? ''}</div></div>
                <Pill tone={a.status === 'accepted' ? 'gain' : a.status === 'rejected' || a.status === 'withdrawn' ? 'loss' : 'neutral'}>
                  {{ accepted: 'Aceptada', rejected: 'Rechazada', declined: 'Declinada', expired: 'Vencida', withdrawn: 'Retirada' }[a.status as 'accepted']}
                </Pill>
              </div>
            ))}
          </div>
        </details>
      )}
    </>
  );
}

function JobBoard() {
  const s = useGame();
  const [sector, setSector] = useState<Sector | 'all' | 'eligible'>('eligible');
  const list = JOBS.filter((j) => (sector === 'all' ? true : sector === 'eligible' ? checkRequirements(s, j).ok : j.sector === sector));
  return (
    <>
      <div className="field">
        <label htmlFor="sector">Filtrar vacantes</label>
        <select id="sector" className="input" value={sector} onChange={(e) => setSector(e.target.value as Sector)}>
          <option value="eligible">Solo las que cumplo</option>
          <option value="all">Todas</option>
          {Object.entries(SECTOR_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </div>
      {list.length === 0 && <Empty icon="search">No hay vacantes que cumplan el filtro. Revisá "Todas" para ver qué requisitos te faltan.</Empty>}
      {list.map((j) => {
        const req = checkRequirements(s, j);
        const active = s.career.applications.some((a) => a.jobId === j.id && (a.status === 'pending' || a.status === 'offer'));
        const current = s.career.job?.jobId === j.id;
        const pr = payroll(residence(s), jobSalary(s, j), s.bank.pensionRate);
        return (
          <div className="card" key={j.id}>
            <div className="card-head">
              <div style={{ flex: 1 }}>
                <span className="eyebrow">{SECTOR_NAMES[j.sector]} · Nivel {j.level}</span>
                <h2>{j.title}</h2>
                <span className="small muted">{j.employer}</span>
              </div>
              <div style={{ textAlign: 'right' }}>
                <Money c={jobSalary(s, j)} className="amt" />
                <div className="tiny muted">neto ≈ {fmtMoney(pr.net, { decimals: false })}</div>
              </div>
            </div>
            <div className="chips tiny">
              <Pill tone="neutral">{j.hoursPerWeek} h/sem</Pill>
              {j.healthInsurance && <Pill tone="gain">Seguro médico</Pill>}
              {j.pensionMatch > 0 && <Pill tone="gain">Aporte jubilación {fmtPct(j.pensionMatch)}</Pill>}
              {j.commission && <Pill tone="accent">Comisión {fmtPct(j.commission)}</Pill>}
              {j.bonusTarget > 0 && <Pill tone="accent">Bono {fmtPct(j.bonusTarget)}</Pill>}
            </div>
            {req.items.length > 0 && (
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {req.items.map((r) => <li key={r.label} className={r.met ? 'gain' : 'loss'}>{r.met ? '✓' : '✗'} {r.label}</li>)}
              </ul>
            )}
            <div className="btn-row" style={{ alignItems: 'center' }}>
              {req.ok && !current && (() => {
                const ib = Math.round(imageJobBonus(s, j.level) * 100);
                return <span className="small muted" style={{ flex: 1 }}>Probabilidad de oferta ≈ {Math.round(applicationChance(s, j) * 100)} % <InfoButton term="probabilidad_oferta" />{ib !== 0 && <span className={`tiny ${ib > 0 ? 'gain' : 'loss'}`} style={{ display: 'block' }}>Tu imagen: {ib > 0 ? '+' : ''}{ib} pts{ib < 0 ? ' · vestite mejor en Tiendas' : ''}</span>}</span>;
              })()}
              <InfoButton term="accion_postular" />
              {(() => {
                const blocked = !current && !active ? applyBlocker(s, j) : null;
                return (
                  <button className="btn sm primary" disabled={!req.ok || active || current || !!blocked} onClick={() => store.run((st) => apply(st, j.id))}>
                    {current ? 'Tu puesto actual' : active ? 'Postulado' : blocked ?? 'Postularme'}
                  </button>
                );
              })()}
            </div>
          </div>
        );
      })}
    </>
  );
}

function Study() {
  const s = useGame();
  const [kind, setKind] = useState<CourseKind>('libro');
  const hours = studyHoursPerWeek(s);
  const jobHours = s.career.job ? JOB_BY_ID[s.career.job.jobId].hoursPerWeek : 0;
  return (
    <>
      <div className="card">
        <div className="card-head"><h2>Tu formación</h2></div>
        <div className="kv">
          <dt>Nivel educativo</dt><dd>{EDUCATION_NAMES[s.education.level]}</dd>
          <dt>Títulos</dt><dd>{s.education.fields.map((f) => FIELD_NAMES[f]).join(', ') || '—'}</dd>
          <dt>Certificados</dt><dd>{s.education.certificates.join(', ') || '—'}</dd>
          <dt>Carga semanal</dt><dd className={jobHours + hours > 60 ? 'loss' : ''}>{jobHours} h trabajo + {hours} h estudio</dd>
        </div>
        {jobHours + hours > 50 && <p className="tiny warn">Más de 50 h semanales suman estrés cada mes; más de 60 h bajan tu desempeño.</p>}
        {s.education.active.map((a) => {
          const c = COURSE_BY_ID[a.courseId];
          const prog = Math.min(1, (s.day - a.startDay) / c.durationDays);
          return (
            <div key={a.courseId} className="stack" style={{ gap: 4 }}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <strong className="small" style={{ flex: 1 }}>{c.name}</strong>
                <span className="tiny muted">termina {formatDate(a.endDay)}</span>
              </div>
              <Bar value={prog} />
              <ConfirmButton label="Abandonar" className="btn sm ghost" help="accion_abandonar_curso" confirmLabel="Abandonar" detail={c.kind === 'titulo' ? 'Conservás la XP obtenida, pero se pierde todo el avance hacia el título: si volvés a inscribirte empezás de cero y pagás la matrícula completa. Lo pagado no se devuelve.' : 'Conservás la XP obtenida; lo pagado no se devuelve.'} onConfirm={() => store.run((st) => dropCourse(st, a.courseId))} />
            </div>
          );
        })}
      </div>
      <p className="small muted">La educación es opcional: también podés progresar trabajando y practicando. {residence(s).educationCreditRate > 0 ? `Los gastos educativos generan un crédito fiscal del ${fmtPct(residence(s).educationCreditRate, 0)} (máx. ${fmtMoney(usd(residence(s).educationCreditMax), { decimals: false })}/año) en ${residence(s).name}.` : `En ${residence(s).name} los gastos educativos no generan crédito fiscal.`} <InfoButton term="credito_fiscal" /></p>
      <div className="seg" style={{ overflowX: 'auto' }}>
        {(Object.keys(COURSE_KIND_NAMES) as CourseKind[]).map((k) => (
          <button key={k} className={kind === k ? 'on' : ''} aria-pressed={kind === k} onClick={() => setKind(k)}>{COURSE_KIND_NAMES[k].split(' ')[0]}</button>
        ))}
      </div>
      {COURSES.filter((c) => c.kind === kind).map((c) => {
        const reqs = courseRequirements(s, c);
        const done = timesCompleted(s, c.id);
        const active = s.education.active.some((a) => a.courseId === c.id);
        return (
          <div className="card" key={c.id}>
            <div className="card-head">
              <div style={{ flex: 1 }}>
                <span className="eyebrow">{COURSE_KIND_NAMES[c.kind]} · {c.provider}</span>
                <h2>{c.name}</h2>
              </div>
              <div style={{ textAlign: 'right' }}>
                <Money c={c.monthlyTuition ? tuition(s, c) : coursePrice(s, c)} className="amt" />
                <div className="tiny muted">{c.monthlyTuition ? `/mes · total ≈ ${fmtMoney(courseTotalCost(s, c), { decimals: false })}` : 'pago único'}</div>
              </div>
            </div>
            <div className="chips tiny">
              <Pill tone="neutral">{c.durationDays >= 365 ? `${Math.round(c.durationDays / 365)} años` : `${c.durationDays} días`}</Pill>
              <Pill tone="neutral">{c.hoursPerWeek} h/sem</Pill>
              {Object.entries(c.xp).map(([sk, xp]) => <Pill key={sk} tone="accent">{SKILLS.find((x) => x.id === sk)!.name} +{fmtNumber(Math.floor((xp as number) * studyMultiplier(s) * (done > 0 ? 0.2 : 1)))} XP</Pill>)}
              {c.grants?.education && <Pill tone="gain">Título {EDUCATION_NAMES[c.grants.education]}</Pill>}
              {c.grants?.certificate && <Pill tone="gain">Certificado</Pill>}
              {done > 0 && <Pill tone="info">Completado{c.kind !== 'titulo' ? ' · repetir rinde 20 %' : ''}</Pill>}
            </div>
            {reqs.length > 0 && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{reqs.map((r) => <li key={r.label} className={r.met ? 'gain' : 'loss'}>{r.met ? '✓' : '✗'} {r.label}</li>)}</ul>}
            <span className="act">
              <button className="btn sm dark" disabled={active || reqs.some((r) => !r.met) || (c.kind === 'titulo' && done > 0)} onClick={() => store.run((st) => enroll(st, c.id))}>
                {active ? 'Cursando' : 'Inscribirme'}
              </button>
              <InfoButton term="accion_inscribirse" />
            </span>
          </div>
        );
      })}
    </>
  );
}

function Skills() {
  const s = useGame();
  const [open, setOpen] = useState<string | null>(null);
  const prof = professionalLevel(s);
  return (
    <>
      <div className="card">
        <div className="card-head"><h2>Nivel profesional {prof.level}</h2></div>
        <Bar value={prof.progress} />
        <p className="tiny muted">Sube con meses trabajados, ponderados por el nivel del puesto y tu desempeño.</p>
        <div className="kv">
          {Object.entries(s.career.experience).filter(([, v]) => (v ?? 0) > 0).map(([k, v]) => (
            <Fragment key={k}><dt>Experiencia en {SECTOR_NAMES[k as Sector]}</dt><dd>{v} {v === 1 ? 'mes' : 'meses'}</dd></Fragment>
          ))}
        </div>
      </div>
      <p className="small muted">Las habilidades suben solo con estudio, trabajo y práctica. Repetir la misma práctica el mismo día rinde cada vez menos. <InfoButton term="habilidades" /></p>
      {SKILLS.map((d) => {
        const p = s.skills[d.id];
        const need = xpToNext(p.level);
        const isOpen = open === d.id;
        return (
          <div className="card" key={d.id} style={{ gap: 8 }}>
            <button className="row clickable" style={{ border: 0, background: 'none', padding: 0, textAlign: 'left' }} onClick={() => setOpen(isOpen ? null : d.id)} aria-expanded={isOpen}>
              <span className="skill-ic" aria-hidden><Icon name={SKILL_ICON[d.id]} size={18} /></span>
              <div className="grow">
                <div className="title">{d.name}</div>
                {d.trainable ? <Bar value={p.level >= SKILL_MAX_LEVEL ? 1 : p.xp / need} /> : <span className="tiny muted">Rasgo fijo</span>}
              </div>
              <span className="num" style={{ fontWeight: 700, fontSize: 18 }}>{p.level}</span>
            </button>
            {isOpen && (
              <div className="stack small" style={{ gap: 6 }}>
                <p className="muted">{d.description}</p>
                {d.trainable && <p className="tiny faint">XP {fmtNumber(p.xp)} / {fmtNumber(need)} para nivel {p.level + 1} · máximo {SKILL_MAX_LEVEL}</p>}
                {d.effects.length > 0 && <div><strong className="tiny">Efectos actuales</strong><ul style={{ margin: 0, paddingLeft: 18 }}>{d.effects.map((x) => <li key={x}>{x}</li>)}</ul></div>}
                {d.futureEffects && <div><strong className="tiny">Próximamente</strong><ul style={{ margin: 0, paddingLeft: 18 }} className="muted">{d.futureEffects.map((x) => <li key={x}>{x}</li>)}</ul></div>}
                <div><strong className="tiny">Cómo desarrollarla</strong><ul style={{ margin: 0, paddingLeft: 18 }}>{d.methods.map((x) => <li key={x}>{x}</li>)}</ul></div>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

export function Career() {
  const nav = useNav();
  useUI();
  const s = useGame();
  const sub = (nav.sub.career as Sub) ?? 'job';
  const offers = s.career.applications.filter((a) => a.status === 'offer').length;
  return (
    <>
      <ScreenIntro icon="career" title="Carrera" text="Tu trabajo y tu formación: postulate a empleos, estudiá para subir tus habilidades y negociá tu sueldo." term="nivel_profesional" />
      <Tabs<Sub>
        items={[
          { id: 'job', label: offers ? `Empleo · ${offers} oferta${offers > 1 ? 's' : ''}` : 'Empleo' },
          { id: 'board', label: 'Vacantes' },
          { id: 'study', label: 'Formación' },
          { id: 'skills', label: 'Habilidades' },
        ]}
        value={sub}
        onChange={(v) => navStore.setSub('career', v)}
      />
      {sub === 'job' && <><Offers /><CurrentJob /></>}
      {sub === 'board' && <JobBoard />}
      {sub === 'study' && <Study />}
      {sub === 'skills' && <Skills />}
    </>
  );
}
