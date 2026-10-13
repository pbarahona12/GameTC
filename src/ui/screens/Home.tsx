import { SKILL_BY_ID } from '../../content/skills';
import { startOfMonth } from '../../engine/time/calendar';
import { ageOf } from '../../engine/saga/life';
import { ReactNode } from 'react';
import { useGame, useUI, useDerived, store } from '../store';
import { metricsOf, insightsOf, monthOf, stageOf } from '../derived';
import { navStore } from '../nav';
import { formatMonth, formatDate } from '../../engine/time/calendar';
import { STAGES } from '../../engine/progression/progression';
import { nextMission, missionProgress } from '../../engine/progression/tutorial';
import { goToMission } from '../missions';
import { Icon, IconName } from '../icons';
import { imageScore, imageLabel } from '../../engine/lifestyle/effects';
import { unreadNews, TOPIC_NAMES } from '../../engine/world/news';
import { cardTier } from '../../engine/finance/cardRewards';
import { Money, BigAmount, LineChart, Bar } from '../components/common';
import { JOB_BY_ID } from '../../content/jobs';
import { fmtMoney, fmtMoneyShort } from '../../engine/format';
import type { LogItem } from '../../engine/state';
import { logIcon, NEWS_TOPIC_ICON } from '../contentIcons';
import { ExportReminder } from '../components/Slots';
import { FirstMonthCard, AgendaCard, StandingCard, GoalsCard, EmpireScene, SurplusAction } from './saga/SagaCards';
import { firstMonthActive } from '../../engine/saga/firstMonth';

export function LogRow({ l, short = false }: { l: LogItem; short?: boolean }) {
  return (
    <div className="row">
      <span className="log-ic" aria-hidden><Icon name={logIcon(l)} size={16} /></span>
      <div className="grow">
        <div className={`small ${short ? 'clamp-2' : ''}`}>{l.text}</div>
        <div className="tiny faint">{formatDate(l.day)}</div>
      </div>
      {l.amount !== undefined && (
        <span className={`amt small ${l.kind === 'income' ? 'gain' : l.kind === 'expense' || l.kind === 'danger' ? 'loss' : ''}`}>{short ? fmtMoneyShort(l.amount) : fmtMoney(l.amount)}</span>
      )}
    </div>
  );
}

export function Home() {
  const ui = useUI();
  const s = useGame();
  const m = useDerived(metricsOf);
  const insights = useDerived(insightsOf).filter((i) => ui.settings.alertCategories.includes(i.category));
  const month = useDerived(monthOf);
  const ev = useDerived(stageOf);
  // El último día del mes el cierre ya está en el historial: no repetirlo como «Hoy».
  const histAll = s.history.slice(-25);
  const hist = histAll.length && histAll[histAll.length - 1].day === s.day ? histAll.slice(0, -1).slice(-24) : histAll.slice(-24);
  const nwSeries = [...hist.map((h) => h.netWorth), m.netWorth];
  const prev = [...s.history].reverse().find((h) => h.day < startOfMonth(s.day));
  const change = prev ? m.netWorth - prev.netWorth : 0;
  const stage = STAGES[s.progression.stage - 1];
  const job = s.career.job ? JOB_BY_ID[s.career.job.jobId] : null;
  // Mientras dura la guía del primer mes, la tarjeta de misiones espera (una sola guía a la vez).
  const guiding = firstMonthActive(s);
  const tutorialOpen = !s.tutorial.dismissed && !guiding;
  const { done: tutDone, total: tutTotal } = missionProgress(s);
  const nextStep = nextMission(s);
  const img = imageScore(s);
  const unread = unreadNews(s);
  const openNews = s.world.news.filter((n) => n.status === 'abierta').slice(-1).reverse();

  const nwLabels = [...hist.map((h) => formatMonth(h.day)), 'Hoy'];
  const openCos = s.companies.filter((c) => c.status === 'active' || c.status === 'insolvent');
  const invValue = m.securities + (s.ledger.balances.term_deposits ?? 0);
  const areas: Array<{ icon: IconName; title: string; value: ReactNode; sub: string; go: () => void; badge?: number }> = [
    { icon: 'career', title: 'Trabajo', value: job ? <Money c={m.monthlyGross} short /> : 'Sin empleo', sub: job ? `${job.title} · bruto/mes` : 'Buscá empleo en Carrera', go: () => navStore.go('career') },
    { icon: 'invest', title: 'Inversiones', value: <Money c={invValue} short />, sub: invValue > 0 ? 'Tocá para ver y operar todo' : 'Empezá con un fondo índice', go: () => navStore.go('invest', 'portfolio') },
    { icon: 'realestate', title: 'Inmuebles', value: <Money c={m.realEstate - m.mortgages} short />, sub: m.realEstate ? `Alquileres ${fmtMoney(m.rentIncome, { decimals: false })}/mes` : 'Cocheras y estudios desde poco', go: () => navStore.go('invest', 'realestate') },
    { icon: 'business', title: 'Negocios', value: openCos.length ? `${openCos.length} empresa${openCos.length > 1 ? 's' : ''}` : 'Ninguno', sub: openCos.length ? `Tu parte ${fmtMoney(s.ledger.balances.business_equity, { decimals: false })}` : 'Proyectá y fundá tu primera', go: () => navStore.go('business') },
    { icon: 'card', title: `Crédito · ${cardTier(s).name}`, value: String(s.credit.score), sub: m.debt ? `Deudas ${fmtMoney(m.debt, { decimals: false })}` : 'Sin deudas', go: () => navStore.go('finance', 'card') },
    { icon: 'wardrobe', title: 'Tu imagen', value: `${img} · ${imageLabel(img)}`, sub: `${Math.floor(ageOf(s))} años · salud ${Math.round(s.player.attributes.health)}/100 · vestidor y bienes`, go: () => navStore.go('more', 'wardrobe') },
    { icon: 'news', title: 'Noticias', value: unread ? `${unread} nueva${unread > 1 ? 's' : ''}` : 'Al día', sub: 'Rumores que podés analizar', go: () => navStore.go('more', 'news'), badge: unread },
    { icon: 'progress', title: 'Progreso', value: `Etapa ${s.progression.stage}/12`, sub: stage.name, go: () => navStore.open({ kind: 'progress' }) },
  ];
  // Inicio como escena (auditoría E6): arriba, cuatro bloques — la escena de tu imperio,
  // lo que hay que decidir, tu mes en una línea y tu próximo objetivo. Una sola guía a la
  // vez; mientras dura la del primer mes, las metas, la lista de fortunas y el resto esperan.
  const next = ev.details.find((d) => d.stage.n === s.progression.stage + 1);
  const nextMissing = next?.criteria.filter((c) => !c.met && !c.future) ?? [];
  const inflow = month.cf.cashIn;
  const outflow = month.cf.cashOut;
  return (
    <>
      {s.legal.prison && (
        <button className="alert critical" style={{ textAlign: 'left' }} onClick={() => navStore.go('more', 'legal')}>
          <span className="stripe" />
          <div className="small" style={{ flex: 1 }}><strong><Icon name="lock" size={14} /> Cumplís una condena hasta el {formatDate(s.legal.prison.until)}.</strong> No podés trabajar ni operar; tus empresas, inversiones y deudas siguen su curso.</div>
        </button>
      )}
      {ui.speed === 0 && (
        <div className="pause-strip" role="status">
          <Icon name="pause" size={16} />
          <span className="grow small"><strong>El tiempo está en pausa.</strong></span>
          <button className="btn primary" onClick={() => store.togglePlay()}><Icon name="play" size={14} /> {s.day === 0 ? 'Empezar' : 'Reanudar'} a {ui.settings.playSpeed}×</button>
        </div>
      )}
      <ExportReminder />

      <EmpireScene />

      <AgendaCard />

      <FirstMonthCard />
      {tutorialOpen && nextStep && (
        <div className="card next-step">
          <div className="card-head">
            <span className="eyebrow" style={{ flex: 1 }}><Icon name="missions" size={13} /> Misiones {tutDone}/{tutTotal}</span>
            <button className="btn ghost" onClick={() => navStore.open({ kind: 'tutorial' })}>Ver todas</button>
            <button className="btn ghost" aria-label="Ocultar misiones" onClick={() => { store.quick((st) => { st.tutorial.dismissed = true; }); store.toast('Misiones ocultas. Podés volver a verlas en Ajustes → Partida.', 'ok'); }}><Icon name="close" size={15} /></button>
          </div>
          <strong>{nextStep.title}</strong>
          <p className="small muted">{nextStep.body}</p>
          <div className="btn-row" style={{ alignItems: 'center' }}>
            <button className="btn dark" onClick={() => goToMission(nextStep)}>Hacerlo ahora</button>
            {nextStep.reward && <span className="tiny muted">+{nextStep.reward.xp} XP en {SKILL_BY_ID[nextStep.reward.skill].name}</span>}
          </div>
        </div>
      )}

      <div className="home-grid">
      <div className="home-col">
      <section className="hero" aria-label="Patrimonio neto">
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="eyebrow">Patrimonio neto</span>
          <span style={{ flex: 1 }} />
          {prev && <span className="small"><Money c={change} colored sign short /> <span className="faint">este mes</span></span>}
          <button className="btn ghost explain-btn" onClick={() => navStore.open({ kind: 'explain' })} aria-label="Explicar por qué cambió tu patrimonio"><Icon name="idea" size={14} /> ¿Por qué?</button>
        </div>
        <BigAmount c={m.netWorth} short />
        {nwSeries.length >= 2 && <LineChart series={[{ name: 'Patrimonio neto', values: nwSeries, color: 'var(--accent)' }]} pointLabels={nwLabels} height={100} />}
      </section>

      <button className="month-line" onClick={() => navStore.go('reports', 'cf')} aria-label={`Tu mes: entraron ${fmtMoneyShort(inflow)} y salieron ${fmtMoneyShort(outflow)}. Ver el flujo de caja`}>
        <Icon name="calendar" size={16} />
        <span className="small grow">
          <strong>{formatMonth(s.day)}:</strong> entraron <span className="num gain">{fmtMoneyShort(inflow)}</span>, salieron <span className="num loss">{fmtMoneyShort(outflow)}</span>
          {m.runwayMonths !== null ? <span className="muted"> · tu dinero alcanza {m.runwayMonths.toFixed(1)} meses</span> : null}
        </span>
        <Icon name="chevron" size={15} className="faint" />
      </button>

      {!guiding && next && nextMissing.length > 0 && (
        <button className="next-goal" onClick={() => navStore.open({ kind: 'progress' })}>
          <span className="eyebrow"><Icon name="progress" size={13} /> Tu próximo objetivo · etapa {next.stage.n}</span>
          <strong className="small">{next.stage.name}: {nextMissing[0].label}</strong>
          <Bar value={(next.criteria.length - nextMissing.length) / next.criteria.length} />
          <span className="tiny muted">{next.criteria.length - nextMissing.length} de {next.criteria.length} requisitos</span>
        </button>
      )}

      <SurplusAction />

      {!guiding && (
        <div className="saga-pair">
          <StandingCard />
          <GoalsCard />
        </div>
      )}
      </div>
      <div className="home-col">

      {!guiding && insights.length > 0 && (
        <div className="stack" style={{ gap: 8 }}>
          {insights.slice(0, 1).map((i) => (
            <button key={i.id} className={`alert ${i.severity}`} style={{ textAlign: 'left' }} onClick={() => { store.markSeen('asesor'); navStore.open({ kind: 'advisor' }); }}>
              <span className="stripe" />
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                <strong className="small">{i.title}</strong>
                <span className="small muted">{i.what}</span>
              </div>
            </button>
          ))}
          {insights.length > 1 && <button className="btn ghost" onClick={() => { store.markSeen('asesor'); navStore.open({ kind: 'advisor' }); }}>Ver {insights.length - 1 === 1 ? '1 alerta más' : `${insights.length - 1} alertas más`} en el Asesor</button>}
        </div>
      )}

      {!guiding && <>
      <div className="section-title"><h2>Tu mundo</h2></div>
      <div className="area-grid">
        {areas.map((a) => (
          <button key={a.title} className="area" onClick={a.go}>
            <span className="area-top"><span className="area-icon" aria-hidden><Icon name={a.icon} size={16} /></span><span className="tiny muted">{a.title}</span>{a.badge ? <span className="count-badge">{a.badge}</span> : null}</span>
            <strong className="area-value">{a.value}</strong>
            <span className="tiny faint">{a.sub}</span>
          </button>
        ))}
      </div>

      </>}

      {!guiding && openNews.length > 0 && (
        <>
          <div className="section-title">
            <h2>Rumores abiertos</h2>
            <button className="btn ghost" onClick={() => navStore.go('more', 'news')}>Ver todos</button>
          </div>
          {openNews.map((n) => (
            <button key={n.id} className="news-mini" onClick={() => navStore.go('more', 'news')}>
              <span className="news-icon" aria-hidden><Icon name={NEWS_TOPIC_ICON[n.topic]} size={18} /></span>
              <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <strong className="small">{n.title}</strong>
                <span className="tiny muted" style={{ display: 'block' }}>{TOPIC_NAMES[n.topic]} · {n.source}{n.analysis ? ` · tu estimación ~${Math.round(n.analysis.estimate * 100)} %` : ' · sin analizar'}</span>
              </span>
              <Icon name="chevron" size={16} />
            </button>
          ))}
        </>
      )}

      {s.log.length > 0 && (
        <>
          <div className="section-title">
            <h2>Actividad reciente</h2>
            <button className="btn ghost" onClick={() => navStore.open({ kind: 'log' })}>Ver todo</button>
          </div>
          <div className="card" style={{ paddingBlock: 4 }}>
            <div className="rows">
              {s.log.slice(-3).reverse().map((l) => <LogRow key={l.id} l={l} short />)}
            </div>
          </div>
        </>
      )}
      </div>
      </div>
    </>
  );
}
