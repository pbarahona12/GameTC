import { useEffect, useState } from 'react';
import { useGame, useUI, store } from '../../store';
import { navStore } from '../../nav';
import type { NewsItem, NewsTopic } from '../../../engine/world/types';
import { analyzeNews, markNewsRead, TOPIC_NAMES, TOPIC_SKILL, estimateError, newsSkillLevel } from '../../../engine/world/news';
import { SKILL_BY_ID } from '../../../content/skills';
import { formatDate } from '../../../engine/time/calendar';
import { fmtPct } from '../../../engine/format';
import { Pill, Seg, Act, ScreenIntro, Empty, InfoButton } from '../../components/common';
import { Icon } from '../../icons';
import { NEWS_TOPIC_ICON } from '../../contentIcons';

const KIND: Record<NewsItem['kind'], string> = { rumor: 'Rumor', anticipo: 'Anticipo', oficial: 'Oficial', hecho: 'Hecho' };

function StatusPill({ n }: { n: NewsItem }) {
  if (n.status === 'cumplida') return <Pill tone="gain">Se cumplió</Pill>;
  if (n.status === 'desmentida') return <Pill tone="loss">No se cumplió</Pill>;
  if (n.status === 'hecho') return <Pill tone="info">Hecho</Pill>;
  return <Pill tone="warn">{KIND[n.kind]} abierto</Pill>;
}

function Related({ n }: { n: NewsItem }) {
  const s = useGame();
  const r = n.ref;
  if (!r) return null;
  const links: Array<{ label: string; go: () => void }> = [];
  if (r.stockId && s.stocks.stocks.some((x) => x.id === r.stockId)) links.push({ label: `Ver ${r.stockId}`, go: () => navStore.go('invest', `lite:${r.stockId}`) });
  if (r.listingId && s.listings.some((l) => l.id === r.listingId)) links.push({ label: 'Ver empresa en venta', go: () => navStore.go('business', 'market') });
  if (r.propertyListingId && s.realEstate.listings.some((l) => l.id === r.propertyListingId)) links.push({ label: 'Ver inmueble', go: () => navStore.go('invest', `realestate:list:${r.propertyListingId}`) });
  if (r.sector && s.companies.some((c) => c.sector === r.sector && (c.status === 'active' || c.status === 'insolvent'))) {
    const co = s.companies.find((c) => c.sector === r.sector && (c.status === 'active' || c.status === 'insolvent'))!;
    links.push({ label: `Ir a ${co.name}`, go: () => navStore.go('business', `co:${co.id}:${n.topic === 'proveedores' ? 'inventory' : 'summary'}`) });
  }
  if (r.eventKind && n.topic === 'economia') links.push({ label: 'Ver economía', go: () => navStore.setSub('more', 'economy') });
  if (!links.length) return null;
  return <div className="chips">{links.map((l) => <button key={l.label} onClick={l.go}>{l.label} ›</button>)}</div>;
}

function NewsCard({ n }: { n: NewsItem }) {
  const s = useGame();
  const skill = newsSkillLevel(s, n);
  const sk = SKILL_BY_ID[TOPIC_SKILL[n.topic]];
  const canAnalyze = n.status === 'abierta' && n.kind !== 'hecho' && n.kind !== 'oficial' && (!n.analysis || skill >= n.analysis.skill + 10);
  return (
    <article className={`card news-card ${n.status}`}>
      <div className="news-head">
        <span className="news-icon" aria-hidden><Icon name={NEWS_TOPIC_ICON[n.topic]} size={18} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong className="news-title">{n.title}</strong>
          <div className="tiny muted">{formatDate(n.day)} · {TOPIC_NAMES[n.topic]} · {n.source}{n.kind !== 'hecho' ? ` (suele acertar ~${fmtPct(n.sourceTypical, 0)})` : ''}</div>
        </div>
        <StatusPill n={n} />
      </div>
      <p className="small">{n.body}</p>
      {n.analysis && (
        <div className="news-analysis">
          <Icon name="gauge" size={16} />
          <span className="small">Tu análisis: <strong>~{fmtPct(n.analysis.estimate, 0)}</strong> de que sea cierta <span className="tiny muted">(error típico ±{fmtPct(estimateError(n.analysis.skill), 0)} con nivel {n.analysis.skill})</span>
            {n.analysis.clue === 'respalda' && <> · <span className="gain">pista a favor</span></>}
            {n.analysis.clue === 'contradice' && <> · <span className="loss">pista en contra</span></>}
          </span>
        </div>
      )}
      <div className="btn-row" style={{ alignItems: 'center' }}>
        {canAnalyze && <Act label={n.analysis ? 'Reanalizar' : 'Analizar'} help="accion_analizar_noticia" className="btn sm dark" onClick={() => store.run((x) => analyzeNews(x, n.id))} />}
        {n.status === 'abierta' && n.kind !== 'hecho' && !canAnalyze && n.analysis && <span className="tiny muted">Podrás reanalizarla con {sk.name} nivel {n.analysis.skill + 10}.</span>}
        {n.status === 'abierta' && n.kind !== 'hecho' && !n.analysis && <span className="tiny muted">Habilidad: {sk.name} {skill}</span>}
      </div>
      <Related n={n} />
    </article>
  );
}

export function NewsScreen() {
  const s = useGame();
  useUI();
  const [filter, setFilter] = useState<'abiertas' | 'todas' | 'hechos'>('todas');
  const [topic, setTopic] = useState<NewsTopic | 'todos'>('todos');
  useEffect(() => {
    store.run((x) => markNewsRead(x), { toast: false });
    store.markSeen('noticias_rumores');
  }, []);
  const list = [...s.world.news].reverse().filter((n) => (filter === 'todas' || (filter === 'abiertas' ? n.status === 'abierta' : n.status !== 'abierta')) && (topic === 'todos' || n.topic === topic));
  const resolved = s.world.news.filter((n) => n.status === 'cumplida' || n.status === 'desmentida');
  const hit = resolved.filter((n) => n.status === 'cumplida').length;
  return (
    <>
      <ScreenIntro icon="news" title="Noticias" text="Rumores y anticipos de lo que puede pasar: eventos económicos, balances, compras de rivales y exclusividades. Algunos son falsos. Analizarlos te da ventaja, nunca certeza." term="noticias_rumores" />
      <div className="card">
        <div className="card-head"><h2>Cómo leerlas</h2><InfoButton term="confiabilidad_fuente" /></div>
        <p className="small muted">Cada fuente suele acertar un porcentaje distinto. Analizá una noticia para estimar la de ESA noticia: cuanto más nivel tengas en la habilidad del tema, menos te equivocás.</p>
        {resolved.length > 0 && <p className="small">De {resolved.length} noticias ya resueltas, se cumplieron {hit} ({fmtPct(hit / resolved.length, 0)}).</p>}
      </div>
      <Seg items={[{ id: 'abiertas', label: 'Abiertas' }, { id: 'todas', label: 'Todas' }, { id: 'hechos', label: 'Resueltas' }]} value={filter} onChange={setFilter} />
      <div className="chips">
        {(['todos', 'economia', 'bolsa', 'empresas', 'inmuebles', 'proveedores', 'fortunas'] as Array<NewsTopic | 'todos'>).map((t) => (
          <button key={t} className={topic === t ? 'on' : ''} aria-pressed={topic === t} onClick={() => setTopic(t)}>{t === 'todos' ? 'Todos los temas' : TOPIC_NAMES[t]}</button>
        ))}
      </div>
      {list.length === 0 && <Empty icon="news">{filter === 'abiertas' ? 'No hay rumores abiertos. Avanzá el tiempo: las noticias llegan solas.' : 'Todavía no hay noticias.'}</Empty>}
      {list.slice(0, 40).map((n) => <NewsCard key={n.id} n={n} />)}
    </>
  );
}
