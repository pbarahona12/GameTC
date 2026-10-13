import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { store, useUI, useDerived, NEXT_SPEED } from './store';
import { insightsOf } from './derived';
import { navStore, useNav, Tab } from './nav';
import { formatDate, formatDateShort, formatMonthLong } from '../engine/time/calendar';
import { Onboarding } from './screens/Onboarding';
import { Home } from './screens/Home';
import { useOta } from './useOta';
import { useAdsSupported } from './ads';
import { Icon, IconName } from './icons';
import { unreadNews } from '../engine/world/news';
const More = lazy(() => import('./screens/More').then((m) => ({ default: m.More })));
const Invest = lazy(() => import('./screens/Invest').then((m) => ({ default: m.Invest })));
const Reports = lazy(() => import('./screens/Reports').then((m) => ({ default: m.Reports })));
const Business = lazy(() => import('./screens/Business').then((m) => ({ default: m.Business })));
const Finance = lazy(() => import('./screens/Finance').then((m) => ({ default: m.Finance })));
const Career = lazy(() => import('./screens/Career').then((m) => ({ default: m.Career })));
// Las hojas (glosario, asesor, ajustes…) se cargan aparte: no demoran el primer arranque.
const SheetHost = lazy(() => import('./sheets').then((m) => ({ default: m.SheetHost })));
import { Money, Sheet, DotBudget, ScreenSkeleton } from './components/common';
import { MenuButton, type MenuItem } from './components/Menu';
import { fmtMoney } from '../engine/format';
import { spendable } from '../engine/finance/payments';
import { ErrorBoundary } from './components/ErrorBoundary';
import { BootErrorScreen, SimErrorSheet } from './screens/Recovery';
import { logIcon } from './contentIcons';
import { Celebrations } from './screens/saga/Celebrations';
import { AgendaRow } from './screens/saga/SagaCards';

const TABS: Array<{ id: Tab; label: string; icon: IconName }> = [
  { id: 'home', label: 'Inicio', icon: 'home' },
  { id: 'career', label: 'Carrera', icon: 'career' },
  { id: 'finance', label: 'Finanzas', icon: 'finance' },
  { id: 'invest', label: 'Invertir', icon: 'invest' },
  { id: 'business', label: 'Negocios', icon: 'business' },
  { id: 'more', label: 'Más', icon: 'more' },
];

/**
 * Barra superior en una fila: fecha (y lo disponible) · Play/Pausa · Velocidad · Más.
 * Los saltos de tiempo, las noticias, el asesor y los ajustes van en el menú «Más».
 */
function TopBar() {
  const ui = useUI();
  const s = ui.state!;
  const alerts = useDerived(insightsOf).filter((i) => (i.severity === 'critical' || i.severity === 'warning') && ui.settings.alertCategories.includes(i.category)).length;
  const unread = unreadNews(s);
  const running = ui.speed !== 0;
  const speed = ui.settings.playSpeed;
  const next = NEXT_SPEED[speed];
  const adsOk = useAdsSupported();
  const items: MenuItem[] = [
    { label: 'Avanzar 1 día', icon: 'skip', onSelect: () => store.step(1) },
    { label: 'Avanzar 1 semana', icon: 'fastForward', onSelect: () => store.step(7) },
    { label: 'Avanzar 1 mes', icon: 'calendar', onSelect: () => store.step(30) },
    { label: 'Noticias', icon: 'news', divider: true, badge: unread ? (unread > 9 ? '9+' : String(unread)) : undefined, tone: unread ? 'info' : undefined, onSelect: () => navStore.go('more', 'news') },
    { label: 'Asesor', icon: 'advisor', badge: alerts ? String(alerts) : undefined, tone: alerts ? 'danger' : undefined, onSelect: () => navStore.open({ kind: 'advisor' }) },
    ...(adsOk ? [{ label: 'Recompensas', icon: 'gift' as IconName, onSelect: () => navStore.open({ kind: 'rewards' }) }] : []),
    { label: 'Ajustes y guardado', icon: 'settings', onSelect: () => navStore.open({ kind: 'settings' }) },
    { label: 'Cómo funciona el tiempo', icon: 'info', divider: true, onSelect: () => navStore.open({ kind: 'term', id: 'accion_velocidad' }) },
  ];
  return (
    <header className="topbar">
      <div className="topbar-row">
        <button type="button" className="date-block" onClick={() => navStore.go('finance', 'accounts')}
          title={s.bank.overdraftSweep ? 'Lo que podés pagar ya: cuenta corriente + ahorro (sin el efectivo en mano). Tocá para ver tus cuentas.' : 'Lo que podés pagar ya: tu cuenta corriente (el ahorro y el efectivo en mano no se usan solos). Tocá para ver tus cuentas.'}
          aria-label={`${formatDateShort(s.day)}. Disponible para pagar: ${fmtMoney(spendable(s), { decimals: false })}. Ver tus cuentas`}>
          <span className="d">{formatDateShort(s.day)}</span>
          <span className="tiny muted avail">Disponible <Money c={spendable(s)} short /></span>
        </button>
        <button className={`time-btn ${running ? 'on' : ''}`} aria-label={running ? 'Pausar el tiempo' : `Reanudar el tiempo a ${speed}×`} aria-pressed={running} onClick={() => store.togglePlay()}>
          <Icon name={running ? 'pause' : 'play'} size={18} />
        </button>
        <button className="time-btn speed-btn" aria-label={`Velocidad ${speed}×. Tocar para ${next}×`} onClick={() => store.cycleSpeed()}>
          {speed}×
        </button>
        <MenuButton
          label={`Más opciones${alerts ? ` (${alerts} alertas)` : ''}${unread ? ` (${unread} noticias nuevas)` : ''}`}
          trigger={<><Icon name="dots" />{alerts > 0 ? <span className="badge">{alerts}</span> : unread > 0 ? <span className="badge info dot" /> : null}</>}
          items={items}
        />
      </div>
    </header>
  );
}

/** Aviso de versión nueva (solo en la app de Android). */
function UpdateBanner() {
  const ota = useOta();
  if (ota.check?.kind !== 'available') return null;
  return (
    <div style={{ padding: '10px 16px 0' }}>
      <button className="update-banner" onClick={() => navStore.open({ kind: 'update' })}>
        <Icon name="update" size={18} />
        <span style={{ flex: 1, textAlign: 'left' }}><strong>Versión {ota.check.manifest.version} disponible.</strong> <span className="tiny">Se actualiza en segundos y conserva tu partida.</span></span>
        <span className="btn sm primary">Ver</span>
      </button>
    </div>
  );
}

function BottomNav() {
  const nav = useNav();
  return (
    <nav className="bottomnav" aria-label="Secciones">
      <div className="inner">
        {TABS.map((t) => {
          const on = nav.tab === t.id || (t.id === 'more' && nav.tab === 'reports');
          return (
          <button key={t.id} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined} onClick={() => (t.id === 'more' && nav.tab === 'more' ? navStore.setSub('more', 'menu') : navStore.go(t.id))}>
            <span className="ic" aria-hidden><Icon name={t.icon} size={21} stroke={on ? 2.3 : 1.9} /></span>
            {t.label}
          </button>
          );
        })}
      </div>
    </nav>
  );
}

function Toasts() {
  const ui = useUI();
  return (
    <div className="toasts" aria-live="polite">
      {ui.toasts.map((t) => (
        <button key={t.id} className={`toast ${t.tone}`} onClick={() => store.dismissToast(t.id)} aria-label={`${t.text} (tocar para cerrar)`}>{t.text}</button>
      ))}
    </div>
  );
}

function AbsenceReport() {
  const ui = useUI();
  const r = ui.absence;
  if (!r) return null;
  const days = r.toDay - r.fromDay;
  const important = r.logs.filter((l) => l.kind !== 'info').slice(-12).reverse();
  return (
    <Sheet title="Mientras no estabas" onClose={() => store.dismissAbsence()}>
      <p className="muted small">Pasaron {days} día{days === 1 ? '' : 's'} de juego con las mismas reglas económicas que en vivo (máximo configurable en Ajustes). Mientras no estás, ninguna decisión ni pago de tu agenda vence: el tiempo se detiene antes.</p>
      {r.note && <p className="small warn">{r.note}</p>}
      <dl className="kv">
        <dt>Patrimonio neto</dt>
        <dd>{fmtMoney(r.netWorthBefore)} → {fmtMoney(r.netWorthAfter)}</dd>
        <dt>Variación</dt>
        <dd><Money c={r.netWorthAfter - r.netWorthBefore} colored sign /></dd>
        <dt>Liquidez</dt>
        <dd>{fmtMoney(r.liquidBefore)} → {fmtMoney(r.liquidAfter)}</dd>
      </dl>
      <div className="rows">
        {important.length === 0 && <p className="muted small">Sin novedades importantes.</p>}
        {important.map((l) => (
          <div className="row" key={l.id}>
            <span className="log-ic" aria-hidden><Icon name={logIcon(l)} size={16} /></span>
            <div className="grow small">{l.text}</div>
            {l.amount !== undefined && <span className={`amt small ${l.kind === 'income' || l.kind === 'success' ? 'gain' : l.kind === 'danger' || l.kind === 'expense' ? 'loss' : ''}`}>{fmtMoney(l.amount)}</span>}
          </div>
        ))}
      </div>
      <button className="btn primary block" onClick={() => store.dismissAbsence()}>Continuar</button>
    </Sheet>
  );
}

/**
 * EL MES COMO TURNO (fase 1 · E5): al cerrar cada mes, un informe breve con un
 * titular, tres datos, la lista de fortunas, tu némesis, lo proyectado contra lo
 * real y como mucho dos decisiones. El tiempo queda en pausa hasta que sigas.
 */
function MonthReportSheet() {
  const ui = useUI();
  const r = ui.monthReport;
  const s = ui.state;
  if (!r || !s) return null;
  const lines: Array<[IconName, string]> = [];
  if (r.rank) lines.push(['crown', r.rank]);
  if (r.nemesis) lines.push(['poach', r.nemesis]);
  if (r.vsPlan) lines.push(['reports', r.vsPlan]);
  return (
    <Sheet title={`Cierre de ${r.month}`} onClose={() => store.closeMonthReport()}>
      <div className="month-report">
        <h3 className="mr-headline">{r.headline}</h3>
        {r.deck && <p className="small muted" style={{ margin: 0 }}>{r.deck}</p>}
        <div className="mr-facts">
          {r.facts.map((f) => (
            <div key={f.label} className="mr-fact">
              <span className="tiny muted">{f.label}</span>
              <strong className={`num ${f.tone === 'neutral' ? '' : f.tone}`}>{f.value}</strong>
            </div>
          ))}
        </div>
        {lines.map(([icon, text]) => (
          <p key={text} className="small mr-line"><Icon name={icon} size={15} /> <span>{text}</span></p>
        ))}
        {r.decisions.length > 0 && (
          <>
            <span className="eyebrow">Para decidir este mes</span>
            <div className="agenda-list" onClick={() => store.closeMonthReport()}>{r.decisions.map((a) => <AgendaRow key={a.key} a={a} day={s.day} />)}</div>
          </>
        )}
      </div>
      <div className="btn-row">
        <button className="btn ghost" onClick={() => { store.closeMonthReport(); navStore.open({ kind: 'explain' }); }}>¿Por qué cambió?</button>
        <button className="btn primary" style={{ flex: 1 }} onClick={() => store.closeMonthReport(true)}><Icon name="play" size={15} /> Seguir a {formatMonthLong(r.day + 1).split(' ')[0]}</button>
      </div>
      <p className="tiny faint" style={{ margin: 0 }}>Podés dejar de pausar en cada cierre en Ajustes → Tiempo y avisos.</p>
    </Sheet>
  );
}

/** Partida que llegó desde otra app («Abrir con…»): se confirma antes de importar. */
function IncomingImportSheet() {
  const ui = useUI();
  const [busy, setBusy] = useState(false);
  const inc = ui.incomingImport;
  if (!inc) return null;
  const sum = inc.summary;
  const open = async () => {
    setBusy(true);
    const r = await store.acceptIncomingImport();
    setBusy(false);
    if (r.ok) navStore.closeAll();
  };
  return (
    <Sheet title="Abrir una partida" onClose={() => store.dismissIncomingImport()}>
      {sum ? (
        <dl className="kv">
          {sum.name && <><dt>Personaje</dt><dd>{sum.name}</dd></>}
          {sum.day !== undefined && <><dt>Fecha en el juego</dt><dd>{formatDate(sum.day)} (año {Math.floor(sum.day / 365) + 1})</dd></>}
          {sum.netWorth !== undefined && <><dt>Patrimonio</dt><dd>{fmtMoney(sum.netWorth, { decimals: false })}</dd></>}
        </dl>
      ) : (
        <p className="small">Recibiste {inc.label}. Si es una partida exportada del juego, se puede abrir.</p>
      )}
      <p className="small muted">Se verifica la contabilidad y se abre como una partida nueva. {ui.state ? 'La que tenés abierta queda guardada.' : ''}</p>
      <div className="btn-row">
        <button className="btn ghost" disabled={busy} onClick={() => store.dismissIncomingImport()}>Cancelar</button>
        <button className="btn primary" disabled={busy} onClick={() => void open()}>{busy ? 'Abriendo…' : 'Abrir partida'}</button>
      </div>
    </Sheet>
  );
}

export function App() {
  const ui = useUI();
  const nav = useNav();
  const ota = useOta();
  const hasNews = !!(ota.justUpdated || ota.rolledBack);
  useEffect(() => {
    if (hasNews && ui.ready && !navStore.get().sheets.some((x) => x.kind === 'whatsnew')) navStore.open({ kind: 'whatsnew' });
  }, [hasNews, ui.ready]);
  // Otra partida abierta: se empieza en Inicio y sin el historial de la anterior.
  const openSlot = ui.state ? ui.activeSlot : null;
  const lastSlot = useRef(openSlot);
  useEffect(() => {
    if (lastSlot.current === openSlot) return;
    lastSlot.current = openSlot;
    if (openSlot) navStore.reset();
  }, [openSlot]);
  if (!ui.ready) {
    return (
      <div className="onboard" aria-busy="true">
        <div className="boot-mark" aria-hidden><Icon name="invest" size={34} /></div>
        <div className="brand">Ultimate <em>Realistic</em> Tycoon</div>
        <p className="muted">Cargando tu partida y verificando la contabilidad…</p>
      </div>
    );
  }
  if (!ui.state && ui.bootError) return <><BootErrorScreen /><Toasts /></>;
  if (!ui.state) return <><DotBudget><Onboarding /></DotBudget><Suspense fallback={null}><SheetHost /></Suspense><IncomingImportSheet /><Toasts /></>;
  return (
    <div className={`app ${nav.tab === 'home' ? 'home-wide' : ''}`}>
      <TopBar />
      <UpdateBanner />
      {ui.loadNotice && (
        <div style={{ padding: '10px 16px 0' }}>
          <div className="alert warning">
            <span className="stripe" />
            <div className="grow small" style={{ flex: 1 }}>{ui.loadNotice}</div>
            <button className="btn sm" onClick={() => store.dismissNotice()}>OK</button>
          </div>
        </div>
      )}
      <main className="screen">
        <ErrorBoundary key={nav.tab} scope="section">
        <DotBudget>
        <Suspense fallback={<ScreenSkeleton />}>
        {nav.tab === 'home' && <Home />}
        {nav.tab === 'career' && <Career />}
        {nav.tab === 'finance' && <Finance />}
        {nav.tab === 'invest' && <Invest />}
        {nav.tab === 'business' && <Business />}
        {nav.tab === 'more' && <More />}
        {nav.tab === 'reports' && (
          <>
            <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => navStore.go('more', 'menu')}>← Más</button>
            <Reports />
          </>
        )}
        </Suspense>
        </DotBudget>
        </ErrorBoundary>
      </main>
      <BottomNav />
      <Suspense fallback={null}><SheetHost /></Suspense>
      <AbsenceReport />
      <MonthReportSheet />
      <IncomingImportSheet />
      <SimErrorSheet />
      <Celebrations />
      <Toasts />
    </div>
  );
}
