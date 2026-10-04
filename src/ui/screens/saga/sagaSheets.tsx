import { useState } from 'react';
import { useGame, useDerived, store } from '../../store';
import { goalsOf } from '../../derived';
import { navStore } from '../../nav';
import { Icon } from '../../icons';
import { Sheet, Bar, Pill, Seg, Empty, InfoButton } from '../../components/common';
import { dilemmaView, decide } from '../../../engine/saga/dilemmas';
import { chooseGoal, dropGoal, GOAL_BY_ID, MAX_ACTIVE_GOALS, GoalCategory } from '../../../engine/saga/goals';
import { CHALLENGES, CHALLENGE_BY_ID, verifyCode, describeResult } from '../../../engine/saga/challenges';
import type { ChronicleKind } from '../../../engine/saga/types';
import { dateOf, formatDate } from '../../../engine/time/calendar';
import { fmtMoneyFit } from '../../../engine/format';
import { AgendaList, dueText, iconOf } from './SagaCards';

const CAT_NAMES: Record<GoalCategory, string> = { riqueza: 'Riqueza', negocios: 'Negocios', vida: 'Vida', competencia: 'Competencia', carrera: 'Carrera', valores: 'Valores' };

/** METAS DE VIDA: elegir, seguir y abandonar. */
export function GoalsView() {
  const s = useGame();
  const g = useDerived(goalsOf);
  const [cat, setCat] = useState<GoalCategory | 'todas'>('todas');
  const done = Object.entries(s.saga.goals.completed).sort((a, b) => b[1] - a[1]);
  const full = g.active.length >= MAX_ACTIVE_GOALS;
  const list = g.suggested.filter((x) => cat === 'todas' || x.def.category === cat);
  return (
    <Sheet title="Metas de vida">
      <p className="small muted">Elegí qué querés lograr en esta partida (hasta {MAX_ACTIVE_GOALS} a la vez). Se cumplen por lo que hacés de verdad, suman reputación y quedan en tu crónica. <InfoButton term="metas_vida" /></p>
      {g.active.length > 0 && <span className="eyebrow">En curso</span>}
      {g.active.map((a) => (
        <div key={a.id} className="card goal-card">
          <div className="card-head"><h2><Icon name={iconOf(a.def.icon, 'missions')} size={17} /> {a.def.title}</h2><Pill tone="neutral">{CAT_NAMES[a.def.category]}</Pill></div>
          <p className="small muted">{a.def.description}</p>
          <Bar value={a.p.progress} tone={a.p.failed ? 'loss' : undefined} />
          <span className="tiny">{a.p.label}</span>
          <div className="btn-row"><span className="tiny faint" style={{ flex: 1 }}>Desde el {formatDate(a.since)}</span><button className="btn sm ghost" onClick={() => store.run((st) => dropGoal(st, a.id))}>Abandonar</button></div>
        </div>
      ))}
      <span className="eyebrow">Para elegir</span>
      <Seg items={[{ id: 'todas' as const, label: 'Todas' }, ...(['vida', 'carrera', 'riqueza', 'negocios', 'competencia', 'valores'] as GoalCategory[]).map((c) => ({ id: c, label: CAT_NAMES[c] }))]} value={cat} onChange={setCat} />
      {full && <p className="tiny warn">Ya tenés {MAX_ACTIVE_GOALS} metas. Abandoná una para elegir otra.</p>}
      <div className="rows card" style={{ paddingBlock: 4 }}>
        {list.map(({ def, p }) => (
          <div key={def.id} className="row">
            <span className="log-ic" aria-hidden><Icon name={iconOf(def.icon, 'missions')} size={16} /></span>
            <div className="grow">
              <div className="title small">{def.title} {def.stage > s.progression.stage + 1 && <Pill tone="neutral">largo plazo</Pill>}</div>
              <div className="meta">{def.description}</div>
              {p.progress > 0 && <div className="tiny faint">{p.label}</div>}
            </div>
            <button className="btn sm" disabled={full} onClick={() => store.run((st) => chooseGoal(st, def.id))}>Elegir</button>
          </div>
        ))}
        {!list.length && <p className="small muted" style={{ padding: '10px 0' }}>No hay más metas en esta categoría.</p>}
      </div>
      {done.length > 0 && (
        <>
          <span className="eyebrow">Cumplidas ({done.length})</span>
          <div className="grid2">
            {done.map(([id, day]) => GOAL_BY_ID[id] && (
              <div key={id} className="stat">
                <div className="label"><Icon name="medal" size={14} /> {GOAL_BY_ID[id].title}</div>
                <div className="tiny gain">{formatDate(day)}</div>
              </div>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

/** Una decisión con plazo. */
export function DilemmaSheet({ id }: { id: number }) {
  const s = useGame();
  const open = s.saga.dilemmas.open.find((d) => d.id === id);
  const past = s.saga.dilemmas.past.find((d) => d.id === id);
  if (!open) {
    return (
      <Sheet title="Decisión">
        {past ? <><p className="small"><strong>{past.status === 'vencido' ? 'Venció sin respuesta.' : 'Ya decidiste.'}</strong></p><p className="small">{past.outcome}</p></> : <Empty icon="check">Esta decisión ya no está pendiente.</Empty>}
        <button className="btn block" onClick={() => navStore.close()}>Cerrar</button>
      </Sheet>
    );
  }
  const v = dilemmaView(s, open)!;
  const pick = (choice: string) => {
    const r = store.run((st) => decide(st, id, choice), { toast: false });
    if (r.ok) {
      store.toast(r.message ?? 'Decisión tomada.', 'ok');
      navStore.close();
    } else store.toast(r.error, 'error');
  };
  return (
    <Sheet title="Decisión pendiente">
      <div className="dilemma-head">
        <span className="dilemma-ic" aria-hidden><Icon name={iconOf(v.icon, 'idea')} size={24} /></span>
        <div>
          <h3 className="dilemma-title">{v.title}</h3>
          <span className="tiny warn"><Icon name="clock" size={12} /> {dueText(s.day, v.deadline)} ({formatDate(v.deadline)})</span>
        </div>
      </div>
      <p className="small">{v.body}</p>
      <div className="stack" style={{ gap: 8 }}>
        {v.options.map((o) => (
          <button key={o.id} className={`choice dilemma-opt ${o.blocked ? 'blocked' : ''}`} disabled={!!o.blocked} onClick={() => pick(o.id)}>
            <strong>{o.label}</strong>
            <span className="small muted">{o.detail}</span>
            {o.blocked && <span className="tiny loss">{o.blocked}</span>}
            {o.fallback && <span className="tiny faint">Si no decidís, se aplica esta.</span>}
          </button>
        ))}
      </div>
      <p className="tiny faint">Los montos pasan por tu contabilidad como cualquier otro movimiento. <InfoButton term="dilemas" /></p>
    </Sheet>
  );
}

export function AgendaSheet() {
  return (
    <Sheet title="Pendientes">
      <p className="small muted">Todo lo que espera una respuesta tuya, ordenado por vencimiento.</p>
      <AgendaList />
    </Sheet>
  );
}

const KIND_FILTER: Array<{ id: 'todo' | 'hitos' | 'decisiones' | 'competencia'; label: string; kinds: ChronicleKind[] | null }> = [
  { id: 'todo', label: 'Todo', kinds: null },
  { id: 'hitos', label: 'Hitos', kinds: ['inicio', 'etapa', 'logro', 'meta', 'anio', 'desafio', 'vida'] },
  { id: 'decisiones', label: 'Decisiones', kinds: ['dilema', 'crisis'] },
  { id: 'competencia', label: 'Competencia', kinds: ['ranking', 'rival', 'empresa'] },
];

/** CRÓNICA: la historia de la partida, año por año. */
export function ChronicleView() {
  const s = useGame();
  const [f, setF] = useState<(typeof KIND_FILTER)[number]['id']>('todo');
  const kinds = KIND_FILTER.find((x) => x.id === f)!.kinds;
  const list = s.saga.chronicle.filter((c) => !kinds || kinds.includes(c.kind)).slice().reverse();
  const years = new Map<number, typeof list>();
  for (const c of list) {
    const y = dateOf(c.day).y;
    years.set(y, [...(years.get(y) ?? []), c]);
  }
  const share = async () => {
    const lines = [`La crónica de ${s.player.name} (Ultimate Realistic Tycoon)`, ''];
    for (const c of s.saga.chronicle.filter((x) => ['inicio', 'etapa', 'meta', 'ranking', 'rival', 'anio', 'desafio', 'crisis'].includes(x.kind))) lines.push(`${formatDate(c.day)} · ${c.title}${c.kind === 'anio' ? `: ${c.text}` : ''}`);
    const text = lines.join('\n');
    try {
      if (navigator.share) await navigator.share({ title: `La crónica de ${s.player.name}`, text });
      else {
        await navigator.clipboard.writeText(text);
        store.toast('Crónica copiada: pegala donde quieras.', 'ok');
      }
    } catch {
      /* el jugador canceló */
    }
  };
  return (
    <Sheet title={`La crónica de ${s.player.name}`}>
      <p className="small muted">Tu historia como magnate, escrita sola a partir de lo que pasa en la partida. <InfoButton term="cronica_magnate" /></p>
      <div className="btn-row"><Seg items={KIND_FILTER.map(({ id, label }) => ({ id, label }))} value={f} onChange={setF} /><button className="btn sm" onClick={() => void share()}><Icon name="copy" size={14} /> Compartir</button></div>
      {list.length === 0 && <Empty icon="history">Todavía no hay nada en esta sección.</Empty>}
      {[...years.entries()].map(([y, items]) => (
        <section key={y} className="chron-year">
          <h3 className="chron-y num">{y}</h3>
          <ol className="chron-list">
            {items.map((c) => (
              <li key={c.id} className={`chron-item k-${c.kind}`}>
                <span className="chron-dot" aria-hidden><Icon name={iconOf(c.icon, 'sparkles')} size={14} /></span>
                <div className="chron-body">
                  <div className="small"><strong>{c.title}</strong></div>
                  <div className="tiny muted">{c.text}</div>
                  <div className="tiny faint">{formatDate(c.day)}{c.netWorth !== undefined ? ` · patrimonio ${fmtMoneyFit(c.netWorth, { decimals: false })}` : ''}</div>
                </div>
              </li>
            ))}
          </ol>
        </section>
      ))}
    </Sheet>
  );
}

/** DESAFÍOS: el que estás jugando, los disponibles y la verificación de códigos. */
export function ChallengesView() {
  const s = useGame();
  const [code, setCode] = useState('');
  const run = s.saga.challenge;
  const cur = run ? CHALLENGE_BY_ID[run.id] : null;
  const checked = code.trim() ? verifyCode(code) : null;
  return (
    <Sheet title="Desafíos con semilla">
      <p className="small muted">Mundos fijos para comparar resultados: todos empiezan con la misma bolsa, los mismos empleos y las mismas crisis. <InfoButton term="desafios_semilla" /></p>
      {cur && run && (
        <div className="card">
          <div className="card-head"><h2><Icon name={iconOf(cur.icon, 'rocket')} size={17} /> Estás jugando: {cur.title}</h2></div>
          <p className="small">{cur.goal}. {run.completedDay !== null ? <strong className="gain">¡Cumplido!</strong> : run.failed ? <span className="loss">Se terminó el plazo.</span> : `Plazo: ${Math.ceil((cur.limitDays - s.day) / 365)} años más.`}</p>
          {run.code && <p className="small">Tu código: <strong className="num">{run.code}</strong> <button className="btn sm ghost" onClick={() => { void navigator.clipboard?.writeText(run.code!); store.toast('Código copiado.', 'ok'); }}><Icon name="copy" size={13} /> Copiar</button></p>}
        </div>
      )}
      <span className="eyebrow">Disponibles</span>
      {CHALLENGES.map((c) => (
        <div key={c.id} className="card">
          <div className="card-head"><h2><Icon name={iconOf(c.icon, 'rocket')} size={17} /> {c.title}</h2><Pill tone="neutral">{c.metric === 'days' ? 'gana el más rápido' : 'gana el más rico'}</Pill></div>
          <p className="small muted">{c.description}</p>
          <span className="tiny">Objetivo: {c.goal} · plazo {Math.round(c.limitDays / 365)} años</span>
        </div>
      ))}
      <p className="small muted">Para jugar uno, empezá una partida nueva (Ajustes → Partida → Nueva partida) y elegí «Desafío». Tu partida actual queda guardada.</p>
      <div className="field">
        <label htmlFor="ch-code">Verificar un código de resultado</label>
        <input id="ch-code" className="input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Ej.: MILLON-3650-AB12CD" autoComplete="off" />
        {code.trim() && (checked ? <span className="small gain">Código válido · {describeResult(checked.id, checked.value)}</span> : <span className="small loss">El código no es válido (¿está bien copiado?).</span>)}
      </div>
    </Sheet>
  );
}
