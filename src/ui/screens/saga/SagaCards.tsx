import { useGame, useUI, useDerived, store } from '../../store';
import { agendaOf, positionOf, goalsOf, metricsOf } from '../../derived';
import { navStore } from '../../nav';
import { Icon, isIconName, IconName } from '../../icons';
import { Bar, Money } from '../../components/common';
import { firstMonthSteps, firstMonthActive, markFirstStep, dismissFirstMonth } from '../../../engine/saga/firstMonth';
import type { AgendaItem, AgendaTarget } from '../../../engine/saga/agenda';
import { cityName } from '../../../engine/saga/ranking';
import { fmtMoney, fmtMoneyFit, fmtNumber } from '../../../engine/format';
import { formatDate } from '../../../engine/time/calendar';
import { MAX_ACTIVE_GOALS } from '../../../engine/saga/goals';
import { bestVehicle } from '../../../engine/lifestyle/effects';
import { ITEM_BY_ID } from '../../../content/shops';
import { SECTOR_ICON } from '../../contentIcons';
import { surplusBreakdown, investSurplus } from '../../../engine/saga/quick';
import { usd } from '../../../engine/money';
import { ConfirmButton } from '../../components/common';

export const iconOf = (name: string, fallback: IconName = 'sparkles'): IconName => (isIconName(name) ? name : fallback);

export function goTarget(t: AgendaTarget): void {
  if (t.kind === 'dilemma') navStore.open({ kind: 'dilemma', id: t.id });
  else navStore.go(t.tab, t.sub);
}

/** "vence hoy", "vence en 3 días", "venció". */
export function dueText(day: number, due: number | null): string {
  if (due === null) return '';
  const d = due - day;
  if (d < 0) return 'venció';
  if (d === 0) return 'vence hoy';
  if (d === 1) return 'vence mañana';
  return d <= 14 ? `vence en ${d} días` : `hasta el ${formatDate(due)}`;
}

/** TU PRIMER MES: la guía de los primeros minutos (reemplaza a la tarjeta de misiones mientras dura). */
export function FirstMonthCard() {
  const s = useGame();
  const ui = useUI();
  if (!firstMonthActive(s)) return null;
  const steps = firstMonthSteps(s);
  const done = steps.filter((x) => x.done).length;
  const current = steps.find((x) => !x.done)!;
  const act = () => {
    if (current.id === 'gastos' || current.id === 'cierre') store.run((st) => markFirstStep(st, current.id), { toast: false });
    if (current.id === 'tiempo' || current.id === 'cierre') {
      if (ui.speed === 0) store.togglePlay();
      return;
    }
    if (current.target.kind === 'tab') navStore.go(current.target.tab, current.target.sub);
  };
  return (
    <section className="card first-month" aria-label="Tu primer mes">
      <div className="card-head">
        <span className="eyebrow" style={{ flex: 1 }}><Icon name="rocket" size={13} /> Tu primer mes · {done} de {steps.length}</span>
        <button className="btn sm ghost" aria-label="Ocultar la guía del primer mes" onClick={() => store.run((st) => dismissFirstMonth(st), { toast: false })}><Icon name="close" size={15} /></button>
      </div>
      <ol className="fm-steps">
        {steps.map((x) => (
          <li key={x.id} className={x.done ? 'done' : x === current ? 'now' : ''}>
            <span className="fm-dot" aria-hidden>{x.done ? <Icon name="check" size={12} /> : null}</span>
            <span className="small">{x.title}</span>
          </li>
        ))}
      </ol>
      <strong>{current.title}</strong>
      <p className="small muted">{current.body}</p>
      <button className="btn sm primary" onClick={act}>{current.id === 'tiempo' && ui.speed !== 0 ? 'El tiempo ya corre' : current.action}</button>
    </section>
  );
}

/** Resumen honesto del primer cierre de mes (aparece una vez cerrado). */
export function FirstMonthSummary() {
  const s = useGame();
  const h = s.history[0];
  if (!h || s.history.length > 2 || s.saga.firstMonth.dismissed) return null;
  const left = h.cashIn - h.cashOut;
  return (
    <div className="card first-summary">
      <span className="eyebrow"><Icon name="calendar" size={13} /> Así fue tu primer mes</span>
      <div className="fs-row">
        <span>Entró <strong className="num gain">{fmtMoney(h.cashIn, { decimals: false })}</strong></span>
        <span>Salió <strong className="num loss">{fmtMoney(h.cashOut, { decimals: false })}</strong></span>
        <span>{left >= 0 ? 'Te quedó' : 'Te faltó'} <strong className={`num ${left >= 0 ? 'gain' : 'loss'}`}>{fmtMoney(Math.abs(left), { decimals: false })}</strong></span>
      </div>
      <p className="small muted">{left > 0 ? 'Lo que sobra decide tu futuro: un fondo de emergencia primero, después invertir.' : 'Gastaste más de lo que entró. Revisá tu estilo de vida o buscá un empleo mejor pago.'}</p>
    </div>
  );
}

function AgendaRow({ a, day }: { a: AgendaItem; day: number }) {
  return (
    <button className={`agenda-row tone-${a.tone}`} onClick={() => goTarget(a.target)}>
      <span className="agenda-ic" aria-hidden><Icon name={iconOf(a.icon, 'bell')} size={16} /></span>
      <span className="agenda-text">
        <span className="small agenda-title">{a.title}</span>
        <span className="tiny muted">{a.detail}</span>
      </span>
      {a.due !== null && <span className={`tiny agenda-due ${a.due - day <= 2 ? 'soon' : ''}`}>{dueText(day, a.due)}</span>}
      <Icon name="chevron" size={15} className="faint" />
    </button>
  );
}

/** AGENDA: lo que espera una respuesta tuya, ordenado por vencimiento. */
export function AgendaCard() {
  const s = useGame();
  const items = useDerived(agendaOf);
  if (!items.length) return null;
  return (
    <section className="card agenda" aria-label="Agenda de pendientes">
      <div className="card-head">
        <span className="eyebrow" style={{ flex: 1 }}><Icon name="list" size={13} /> Pendientes · {items.length}</span>
        {items.length > 3 && <button className="btn sm ghost" onClick={() => navStore.open({ kind: 'agenda' })}>Ver todo</button>}
      </div>
      <div className="agenda-list">{items.slice(0, 3).map((a) => <AgendaRow key={a.key} a={a} day={s.day} />)}</div>
    </section>
  );
}

export function AgendaList() {
  const s = useGame();
  const items = useDerived(agendaOf);
  if (!items.length) return <p className="small muted">No hay nada pendiente. Buen momento para planear: elegí metas de vida o mirá la lista de fortunas.</p>;
  return <div className="agenda-list">{items.map((a) => <AgendaRow key={a.key} a={a} day={s.day} />)}</div>;
}

/** TU LUGAR EN EL MUNDO: puesto en tu ciudad (exacto o estimado) y la próxima meta concreta. */
export function StandingCard() {
  const s = useGame();
  const p = useDerived(positionOf);
  const nw = useDerived(metricsOf).netWorth;
  const rk = s.saga.ranking;
  const city = cityName(p.city);
  let next: string;
  if (nw <= 0) next = 'Con patrimonio negativo no figurás en ninguna lista: primero, salir de las deudas.';
  else if (!p.exact) next = p.ahead ? `El puesto 100 tiene ${fmtMoneyFit(p.floor, { decimals: false })}.` : '';
  else if (p.rank === 1) next = rk.reignMonths ? `Llevás ${rk.reignMonths} mes${rk.reignMonths > 1 ? 'es' : ''} en el primer puesto.${p.behind ? ` ${p.behind.name} te sigue con ${fmtMoneyFit(p.behind.wealth, { decimals: false })}.` : ''}` : 'Sos la persona más rica de la ciudad.';
  else next = p.ahead ? `Para subir: superar a ${p.ahead.name} (${fmtMoneyFit(p.ahead.wealth, { decimals: false })}).` : '';
  return (
    <button className="card standing" onClick={() => navStore.go('more', 'ranking')} aria-label="Ver la lista de fortunas">
      <span className="standing-ic" aria-hidden><Icon name={p.exact && p.rank <= 3 ? 'crown' : 'medal'} size={20} /></span>
      <span className="standing-text">
        <span className="tiny muted">Tu lugar en {city}</span>
        <strong className="standing-rank">{nw <= 0 ? 'Sin puesto todavía' : p.exact ? `Puesto ${p.rank}` : `Puesto ~${fmtNumber(p.rank)}`}{p.globalRank ? <span className="tiny muted"> · {p.globalRank}° del mundo</span> : null}</strong>
        {next && <span className="tiny faint">{next}</span>}
      </span>
      <Icon name="chevron" size={16} className="faint" />
    </button>
  );
}

/** METAS DE VIDA: las que elegiste, con su avance. */
export function GoalsCard() {
  const s = useGame();
  const g = useDerived(goalsOf);
  if (!g.active.length) {
    const done = Object.keys(s.saga.goals.completed).length;
    return (
      <button className="card goals-cta" onClick={() => navStore.open({ kind: 'goals' })}>
        <span className="standing-ic" aria-hidden><Icon name="missions" size={20} /></span>
        <span className="standing-text">
          <strong className="small">{done ? 'Elegí tu próxima meta de vida' : 'Elegí tus metas de vida'}</strong>
          <span className="tiny muted">¿Qué querés lograr? Tu casa, la cima de tu carrera, la lista de fortunas, una fortuna limpia… Hasta {MAX_ACTIVE_GOALS} a la vez.</span>
        </span>
        <Icon name="chevron" size={16} className="faint" />
      </button>
    );
  }
  return (
    <section className="card goals-card" aria-label="Tus metas de vida">
      <div className="card-head">
        <span className="eyebrow" style={{ flex: 1 }}><Icon name="missions" size={13} /> Tus metas de vida</span>
        <button className="btn sm ghost" onClick={() => navStore.open({ kind: 'goals' })}>{g.active.length < MAX_ACTIVE_GOALS ? 'Elegir más' : 'Ver'}</button>
      </div>
      {g.active.map((a) => (
        <div key={a.id} className="goal-mini">
          <span className="small goal-title"><Icon name={iconOf(a.def.icon, 'missions')} size={14} /> {a.def.title}</span>
          <Bar value={a.p.progress} tone={a.p.failed ? 'loss' : undefined} />
          <span className="tiny muted">{a.p.label}</span>
        </div>
      ))}
    </section>
  );
}

/** Monto chico con signo, para filas del ranking. */
export function WealthCell({ c }: { c: number }) {
  return <Money c={c} fit />;
}

/** TU IMPERIO: el progreso material a la vista (casa, auto, inmuebles, empresas, fundación, puesto). */
export function EmpireScene() {
  const s = useGame();
  const p = useDerived(positionOf);
  const items: Array<{ key: string; icon: IconName; label: string; tone?: 'accent' | 'muted' }> = [];
  const home = s.realEstate.properties.find((x) => x.owner.kind === 'personal' && x.usedBy === 'jugador');
  items.push(home ? { key: 'home', icon: 'home', label: 'Tu casa', tone: 'accent' } : { key: 'rent', icon: 'key', label: 'Alquilás', tone: 'muted' });
  const v = bestVehicle(s);
  if (v) items.push({ key: 'car', icon: 'car', label: ITEM_BY_ID[v.itemId]?.name ?? 'Vehículo' });
  const props = s.realEstate.properties.filter((x) => (x.owner.kind === 'personal' || x.owner.kind === 'company') && x !== home);
  props.slice(0, 5).forEach((x) => items.push({ key: `p${x.id}`, icon: x.type === 'cochera' ? 'parking' : 'realestate', label: x.name }));
  if (props.length > 5) items.push({ key: 'pmore', icon: 'realestate', label: `+${props.length - 5} inmuebles` });
  s.companies.filter((c) => (c.status === 'active' || c.status === 'insolvent') && !c.npc).slice(0, 6).forEach((c) => items.push({ key: `c${c.id}`, icon: c.listed ? 'bell' : SECTOR_ICON[c.sector] ?? 'business', label: c.listed ? `${c.name} (${c.listed.ticker})` : c.name, tone: c.listed ? 'accent' : undefined }));
  if (s.saga.life?.foundation) items.push({ key: 'found', icon: 'gift', label: s.saga.life.foundation.name, tone: 'accent' });
  if (p.exact) items.push({ key: 'rank', icon: 'crown', label: `Puesto ${p.rank} en ${cityName(p.city)}`, tone: 'accent' });
  if (items.length <= 1) return null;
  return (
    <section className="card empire" aria-label="Tu imperio">
      <span className="eyebrow"><Icon name="realestate" size={13} /> Tu imperio</span>
      <div className="empire-street">
        {items.map((it) => (
          <div key={it.key} className={`empire-lot ${it.tone ?? ''}`} title={it.label}>
            <span className="empire-ic" aria-hidden><Icon name={it.icon} size={22} /></span>
            <span className="tiny empire-label">{it.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** INVERTIR LO QUE SOBRA: una sola acción, con la reserva a la vista. */
export function SurplusAction() {
  const s = useGame();
  const b = surplusBreakdown(s);
  if (b.surplus < usd(50 * s.macro.priceIndex) || s.progression.stage < 2) return null;
  return (
    <div className="surplus">
      <span className="small"><Icon name="idea" size={14} /> Te sobran <strong>{fmtMoney(b.surplus, { decimals: false })}</strong> por encima de tu reserva de 6 meses ({fmtMoney(b.reserve, { decimals: false })}).</span>
      <ConfirmButton label="Invertirlo en el fondo índice" className="btn sm" confirmLabel="Invertir" detail={<>Se compra el Fondo Índice (toda la bolsa) por {fmtMoney(b.surplus, { decimals: false })}, con su comisión de entrada. Podés rescatarlo cuando quieras desde Invertir → Fondos.</>} onConfirm={() => store.run((st) => investSurplus(st))} />
    </div>
  );
}
