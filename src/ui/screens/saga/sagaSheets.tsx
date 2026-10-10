import { useState } from 'react';
import { useGame, useDerived, store, useUI } from '../../store';
import { goalsOf } from '../../derived';
import { navStore } from '../../nav';
import { Icon } from '../../icons';
import { Sheet, Bar, Pill, Seg, Empty, InfoButton } from '../../components/common';
import { dilemmaView, decide } from '../../../engine/saga/dilemmas';
import { chooseGoal, dropGoal, GOAL_BY_ID, MAX_ACTIVE_GOALS, GoalCategory } from '../../../engine/saga/goals';
import { CHALLENGES, CHALLENGE_BY_ID, verifyCode, describeResult, MEDAL_LABEL } from '../../../engine/saga/challenges';
import type { ChronicleKind } from '../../../engine/saga/types';
import { dateOf, formatDate } from '../../../engine/time/calendar';
import { fmtMoneyFit, fmtMoney, fmtPct } from '../../../engine/format';
import { AgendaList, dueText, iconOf } from './SagaCards';
import { explainNetWorth, ExplainPeriod } from '../../../engine/reports/explain';
import { Money, AmountInput, ConfirmButton, Switch } from '../../components/common';
import { life, ageOf, childAge, heirs, estateTax, retire, succession, createFoundation, donateToFoundation, monthlyDeathRisk, RETIRE_AGE, heirProfile, skillName, setMortality, designatedHeir, setHeir, CHILD_COST_USD, FOUNDATION_MIN_USD } from '../../../engine/saga/life';
import { JURISDICTION_BY_ID } from '../../../content/jurisdictions';
import { renderChronicleImage } from './chronicleImage';
import { exportImage } from '../../../persistence/platformStorage';
import { usd } from '../../../engine/money';
import { balanceSheet } from '../../../engine/reports/statements';

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
    for (const c of s.saga.chronicle.filter((x) => ['inicio', 'etapa', 'meta', 'ranking', 'rival', 'anio', 'desafio', 'crisis', 'vida'].includes(x.kind))) lines.push(`${formatDate(c.day)} · ${c.title}${c.kind === 'anio' ? `: ${c.text}` : ''}`);
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
  const shareImage = async () => {
    const url = renderChronicleImage(s);
    if (!url) return store.toast('No se pudo generar la imagen en este dispositivo.', 'error');
    const r = await exportImage(url, `cronica-${s.player.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`, `La crónica de ${s.player.name}`);
    store.toast(r.message, r.ok ? 'ok' : 'error');
  };
  return (
    <Sheet title={`La crónica de ${s.player.name}`}>
      <p className="small muted">Tu historia como magnate, escrita sola a partir de lo que pasa en la partida. <InfoButton term="cronica_magnate" /></p>
      <div className="btn-row"><Seg items={KIND_FILTER.map(({ id, label }) => ({ id, label }))} value={f} onChange={setF} /><button className="btn sm" onClick={() => void share()}><Icon name="copy" size={14} /> Texto</button><button className="btn sm" onClick={() => void shareImage()}><Icon name="upload" size={14} /> Imagen</button></div>
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
  const [mode, setMode] = useState<'todos' | 'clase'>('todos');
  const run = s.saga.challenge;
  const cur = run ? CHALLENGE_BY_ID[run.id] : null;
  const checked = code.trim() ? verifyCode(code) : null;
  const medalText = (c: (typeof CHALLENGES)[number]) => {
    const f = (v: number) => (c.metric === 'days' ? (v < 365 ? `${Math.round(v / 30)} meses` : `${Math.round((v / 365) * 10) / 10} años`) : fmtMoney(v * 100, { decimals: false }));
    const cmp = c.metric === 'days' ? '≤' : '≥';
    return `🥇 ${cmp} ${f(c.medals[0])} · 🥈 ${cmp} ${f(c.medals[1])} · 🥉 ${cmp} ${f(c.medals[2])}`;
  };
  const list = mode === 'clase' ? CHALLENGES.filter((c) => c.learn) : CHALLENGES;
  return (
    <Sheet title="Desafíos con semilla">
      <p className="small muted">Mundos fijos para comparar resultados: todos empiezan con la misma bolsa, los mismos empleos y las mismas crisis. <InfoButton term="desafios_semilla" /></p>
      {cur && run && (
        <div className="card">
          <div className="card-head"><h2><Icon name={iconOf(cur.icon, 'rocket')} size={17} /> Estás jugando: {cur.title}</h2>{run.medal && <Pill tone="accent">{MEDAL_LABEL[run.medal]}</Pill>}</div>
          <p className="small">{cur.goal}. {run.completedDay !== null ? <strong className="gain">¡Cumplido!</strong> : run.failed ? <span className="loss">Se terminó el plazo.</span> : (() => { const left = cur.limitDays - s.day; return left >= 365 ? `Plazo: ${Math.ceil(left / 365)} año${Math.ceil(left / 365) === 1 ? '' : 's'} más.` : `Plazo: ${Math.max(1, Math.ceil(left / 30))} mes${Math.ceil(left / 30) === 1 ? '' : 'es'} más.`; })()}</p>
          <span className="tiny muted">Medallas: {medalText(cur)}</span>
          {run.code && <p className="small">Tu código: <strong className="num">{run.code}</strong> <button className="btn sm ghost" onClick={() => { void navigator.clipboard?.writeText(run.code!); store.toast('Código copiado.', 'ok'); }}><Icon name="copy" size={13} /> Copiar</button></p>}
        </div>
      )}
      <Seg items={[{ id: 'todos' as const, label: 'Todos' }, { id: 'clase' as const, label: 'Para clase' }]} value={mode} onChange={setMode} />
      {mode === 'clase' && <p className="small">Escenarios cortos de finanzas personales. Toda la clase juega el mismo mundo, así que los resultados se pueden comparar y discutir. Cada estudiante comparte su código al terminar; la verificación detecta errores de copia (no es una firma a prueba de trampas).</p>}
      {list.map((c) => (
        <div key={c.id} className="card">
          <div className="card-head"><h2><Icon name={iconOf(c.icon, 'rocket')} size={17} /> {c.title}</h2><Pill tone="neutral">{c.metric === 'days' ? 'gana el más rápido' : 'gana el más rico'}</Pill></div>
          <p className="small muted">{c.description}</p>
          <span className="tiny">Objetivo: {c.goal} · plazo {Math.round(c.limitDays / 365)} años</span>
          <span className="tiny muted">{medalText(c)}</span>
          {mode === 'clase' && c.learn && (
            <div className="learn">
              <p className="small"><strong>Qué se aprende:</strong> {c.learn.goal}</p>
              <span className="tiny">Para conversar después:</span>
              <ul className="tiny">{c.learn.questions.map((q) => <li key={q}>{q}</li>)}</ul>
            </div>
          )}
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

/** EXPLICAR ESTE NÚMERO: por qué cambió tu patrimonio, desde el libro mayor. */
export function ExplainView() {
  const s = useGame();
  const [p, setP] = useState<ExplainPeriod>('mes');
  const e = explainNetWorth(s, p);
  const max = Math.max(1, ...e.items.map((x) => Math.abs(x.amount)));
  return (
    <Sheet title="¿Por qué cambió tu patrimonio?">
      <Seg items={[{ id: 'mes' as const, label: 'Este mes' }, { id: 'mes_pasado' as const, label: 'Mes pasado' }, { id: 'anio' as const, label: 'Este año' }]} value={p} onChange={setP} />
      <p className="small"><strong>{e.summary}</strong></p>
      <div className="kv"><dt>Al empezar ({formatDate(e.from)})</dt><dd><Money c={e.start} fit /></dd><dt>Ahora ({formatDate(e.to)})</dt><dd><Money c={e.end} fit /></dd><dt>Diferencia</dt><dd><Money c={e.change} colored sign fit /></dd></div>
      <div className="explain-list">
        {e.items.map((x) => (
          <div key={x.key} className={`explain-row k-${x.kind}`}>
            <div className="explain-top"><span className="small">{x.label}</span><Money c={x.amount} colored sign fit /></div>
            <div className="explain-bar"><span style={{ width: `${(Math.abs(x.amount) / max) * 100}%` }} className={x.amount >= 0 ? 'up' : 'down'} /></div>
            {x.detail && <span className="tiny muted">{x.detail}</span>}
          </div>
        ))}
        {!e.items.length && <Empty icon="reports">No hubo movimientos en este período.</Empty>}
      </div>
      <p className="tiny faint">Cada línea es la suma de asientos reales de tu libro mayor. El detalle completo está en Más → Informes financieros. <InfoButton term="patrimonio_neto" /></p>
      <button className="btn sm ghost" onClick={() => { navStore.closeAll(); navStore.go('reports', 'is'); }}>Ver el estado de resultados</button>
    </Sheet>
  );
}

/** TU VIDA Y LEGADO: edad, familia, retiro, sucesión y fundación. */
export function LifeView() {
  const s = useGame();
  const ui = useUI();
  const l = life(s);
  const age = ageOf(s, l.birthDay);
  const hs = heirs(s);
  const heir = designatedHeir(s).id;
  const [fname, setFname] = useState(`Fundación ${s.player.name.split(' ').pop()}`);
  const [amount, setAmount] = useState(0);
  const tax = estateTax(s);
  const risk = monthlyDeathRisk(s);
  const j = JURISDICTION_BY_ID[s.tax.jurisdiction];
  const minutesPerYear = Math.round((365 * ui.settings.msPerDay) / 60000);
  const minors = l.children.filter((c) => childAge(s, c) < 22).length;
  const foundationMin = usd(FOUNDATION_MIN_USD * s.macro.priceIndex);
  const canFound = balanceSheet(s).netWorth >= foundationMin;
  const p = heirProfile(s, heir);
  const heirName = hs.find((h) => h.id === heir)?.name ?? '';
  return (
    <Sheet title="Tu vida y legado">
      <div className="card">
        <div className="card-head"><h2><Icon name="crown" size={17} /> {s.player.name}</h2><Pill tone="neutral">generación {l.generation}</Pill></div>
        <div className="kv">
          <dt>Edad</dt><dd><strong>{Math.floor(age)} años</strong></dd>
          <dt>Salud</dt><dd className={s.player.attributes.health < 50 ? 'warn' : ''}>{Math.round(s.player.attributes.health)}/100</dd>
          <dt>Situación</dt><dd className="txt">{s.career.job ? (l.retired ? 'Trabajando (volviste después de jubilarte)' : 'Trabajando') : l.retired ? 'Jubilado' : 'Sin empleo'}</dd>
          {l.mortal === false ? <><dt>Fallecimiento por edad</dt><dd>desactivado</dd></>
            : risk > 0 ? <><dt>Riesgo de fallecer este año</dt><dd className="loss">≈ {fmtPct(Math.min(1, 1 - Math.pow(1 - risk, 12)), 1)}</dd></>
            : <><dt>Riesgo de fallecer</dt><dd className="txt">desde los 68 (faltan {Math.ceil(68 - age)} años)</dd></>}
        </div>
        <p className="tiny muted">Un año de juego dura unos {minutesPerYear} minutos a 1×. Desde los 50 la salud tiende a bajar.{l.mortal === false ? ' Con el fallecimiento por edad apagado, la posta pasa solo cuando vos lo decidís' : <> Desde los 68 hay un riesgo real de fallecer, mayor con mala salud. Si pasa, hereda {heirName}</>}. <InfoButton term="legado" /></p>
        <Switch checked={l.mortal !== false} onChange={() => store.run((st) => setMortality(st, life(st).mortal === false))} label="Fallecimiento por edad" sub="Si lo apagás, tu personaje envejece pero solo pasa la posta cuando vos decidís." term="legado" />
      </div>

      <span className="eyebrow">Familia</span>
      <div className="card">
        <p className="small">{l.partner ? `Pareja: ${l.partner}.` : 'Sin pareja por ahora: la propuesta puede llegar como una decisión entre los 26 y los 42 años.'}</p>
        {l.children.length > 0 ? (
          <div className="rows">{l.children.map((c) => <div key={c.id} className="row"><Icon name="sparkles" size={15} /><div className="grow small">{c.name}</div><span className="tiny muted">{Math.floor(childAge(s, c))} años</span></div>)}</div>
        ) : <p className="tiny muted">Sin hijos. Si no hay hijos adultos, hereda un sobrino o una sobrina.</p>}
        {minors > 0 && <p className="tiny">Crianza y escuela: {fmtMoney(usd(CHILD_COST_USD * minors * s.macro.priceIndex), { decimals: false })} por mes ({minors === 1 ? 'un hijo menor' : `${minors} hijos menores`} de 22 años).</p>}
      </div>

      <span className="eyebrow">Sucesión</span>
      <div className="card">
        <p className="small">Si hoy pasaras la posta, el impuesto a la herencia en {j.flag} {j.name} sería <strong>{fmtMoney(tax.tax, { decimals: false })}</strong> ({fmtPct(tax.rate, 0)} sobre lo que supera {fmtMoney(tax.exempt, { decimals: false })}). Mudar tu residencia o donar a tu fundación lo cambia. Si no alcanza el efectivo, se paga en 24 cuotas automáticas (las ves en Más → Legal → Multas; si una falla, hay embargo).</p>
        <label className="small" htmlFor="heir-pick">Tu heredero (también si fallecés)</label>
        <select id="heir-pick" className="input" value={String(heir)} onChange={(e) => store.run((st) => setHeir(st, e.target.value === 'sobrino' ? 'sobrino' : Number(e.target.value)), { toast: false })}>
          {hs.map((h) => <option key={String(h.id)} value={String(h.id)}>{h.name} · {h.relation}, {h.age} años</option>)}
        </select>
        <p className="tiny">
          <strong>Se destaca en:</strong> {p.strengths.map((k) => `${skillName(k)} (${p.skills[k]})`).join(', ')} · <strong>Flojea en:</strong> {p.weaknesses.map((k) => `${skillName(k)} (${p.skills[k]})`).join(', ')}. {p.weaknesses.includes('management') ? 'Quizás convenga dejar las empresas en manos de gerentes.' : ''}
        </p>
        <div className="btn-row">
          {!l.retired && <ConfirmButton label="Jubilarme" className="btn sm" disabled={age < RETIRE_AGE} confirmLabel="Jubilarme" detail={<>Dejás tu empleo (si tenés) y baja tu estrés. Tus empresas, inmuebles e inversiones siguen. Sin empleo, tu reputación tiende a bajar con el tiempo.</>} onConfirm={() => store.run((st) => retire(st))} />}
          <ConfirmButton label="Pasar la posta" className="btn sm primary" disabled={age < RETIRE_AGE} confirmLabel="Pasar la posta" detail={<>{heirName} toma el control de todo: empresas, inmuebles e inversiones. Tiene sus propias habilidades y empieza sin empleo (sin empleo, la reputación tiende a bajar). Se paga el impuesto a la herencia: {fmtMoney(tax.tax, { decimals: false })}.</>} onConfirm={() => { const r = store.run((st) => succession(st, heir, 'retiro')); if (r.ok) navStore.close(); }} />
        </div>
        {age < RETIRE_AGE && <span className="tiny faint">Podés jubilarte o pasar la posta desde los {RETIRE_AGE} años (te faltan {Math.ceil(RETIRE_AGE - age)}).</span>}
      </div>

      <span className="eyebrow">Fundación</span>
      <div className="card">
        {l.foundation ? (
          <>
            <p className="small"><strong>{l.foundation.name}</strong> · donado {fmtMoney(l.foundation.given, { decimals: false })} desde {formatDate(l.foundation.since)}. Suma +3 de reputación por cada {fmtMoney(usd(1_000_000 * s.macro.priceIndex), { decimals: false })} donados (hasta +15) y cuenta para la meta de filántropo.</p>
            <AmountInput id="found-amt" value={amount} onChange={setAmount} label="Monto a donar" />
            <button className="btn sm" disabled={!amount} onClick={() => { const r = store.run((st) => donateToFoundation(st, amount)); if (r.ok) setAmount(0); }}>Donar</button>
          </>
        ) : (
          <>
            <p className="small muted">Una fundación financia becas, salud e investigación en el mundo del juego. Lo que le donás ya no es tuyo: baja tu patrimonio (y el impuesto a la herencia) y construye tu reputación.</p>
            <div className="field"><label htmlFor="fname">Nombre</label><input id="fname" className="input" value={fname} onChange={(e) => setFname(e.target.value)} /></div>
            <button className="btn sm" disabled={!canFound} onClick={() => store.run((st) => createFoundation(st, fname))}>Crear fundación</button>
            {!canFound && <span className="tiny faint">Hace falta un patrimonio de {fmtMoney(foundationMin, { decimals: false })}.</span>}
          </>
        )}
      </div>

      {l.ancestors.length > 0 && (
        <>
          <span className="eyebrow">Tu dinastía</span>
          <div className="rows card" style={{ paddingBlock: 4 }}>
            {l.ancestors.map((a, i) => <div key={i} className="row"><Icon name="history" size={15} /><div className="grow"><div className="title small">{a.name}</div><div className="meta">{a.cause === 'retiro' ? 'Se retiró' : 'Falleció'} el {formatDate(a.until)} a los {Math.floor((a.until - a.born) / 365.25)} años</div></div><span className="amt small">{fmtMoneyFit(a.netWorth, { decimals: false })}</span></div>)}
          </div>
        </>
      )}
    </Sheet>
  );
}
