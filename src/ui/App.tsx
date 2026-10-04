import { ageOf, monthlyDeathRisk } from '../engine/saga/life';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { store, useUI, useDerived, NEXT_SPEED } from './store';
import { insightsOf } from './derived';
import { navStore, useNav, Tab } from './nav';
import { formatDateShort } from '../engine/time/calendar';
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
        <div className="date-block">
          <div className="d">
            {formatDateShort(s.day)}
            {s.saga && (
              <button type="button" className={`age-chip ${monthlyDeathRisk(s) > 0 ? 'risk' : ''}`} onClick={() => navStore.open({ kind: 'life' })} aria-label={`${s.player.name} tiene ${Math.floor(ageOf(s))} años${monthlyDeathRisk(s) > 0 ? ', con riesgo de fallecer por edad' : ''}. Abrir Tu vida y legado`}>
                {Math.floor(ageOf(s))} años
              </button>
            )}
          </div>
          <div className="tiny muted" title="Lo que podés pagar desde tu cuenta corriente y tu ahorro (no incluye el efectivo en mano)">
            Disponible <Money c={spendable(s)} fit />
          </div>
        </div>
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
      <p className="muted small">Pasaron {days} día{days === 1 ? '' : 's'} de juego con las mismas reglas económicas que en vivo (máximo configurable en Ajustes).</p>
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
  if (!ui.state) return <><DotBudget><Onboarding /></DotBudget><Suspense fallback={null}><SheetHost /></Suspense><Toasts /></>;
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
      <SimErrorSheet />
      <Celebrations />
      <Toasts />
    </div>
  );
}
