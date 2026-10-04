import { ageOf } from '../../../engine/saga/life';
import { useState } from 'react';
import { useGame, useDerived } from '../../store';
import { cityTableOf, positionOf } from '../../derived';
import { navStore } from '../../nav';
import { Icon } from '../../icons';
import { Money, Pill, Seg, InfoButton, LineChart } from '../../components/common';
import { CITIES, CITY_BY_ID, SOURCE_INFO } from '../../../content/cities';
import type { JurisdictionId } from '../../../content/jurisdictions';
import { CITY_SIZE, cityName } from '../../../engine/saga/ranking';
import type { RankRow } from '../../../engine/saga/ranking';
import { fmtMoneyFit, fmtNumber } from '../../../engine/format';
import { formatMonth } from '../../../engine/time/calendar';
import { iconOf } from './SagaCards';

type View = JurisdictionId | 'global';

/**
 * LISTAS DE FORTUNAS (1.4): las 100 personas más ricas de cada ciudad y el
 * ranking global. Las posiciones se mueven cada mes con el mercado de la partida.
 */
export function RankingScreen() {
  const s = useGame();
  const pos = useDerived(positionOf);
  const [view, setView] = useState<View>(s.tax.jurisdiction);
  const [open, setOpen] = useState<number | null>(null);
  const [all, setAll] = useState(false);
  const rows = useDerived(cityTableOf, view);
  const meIdx = rows.findIndex((r) => r.kind === 'player');
  const shown = rows.slice(0, all ? CITY_SIZE : 20);
  const rk = s.saga.ranking;
  const hist = rk.history.filter((h) => h.city !== null).slice(-36);
  const items = [...CITIES.map((c) => ({ id: c.id as View, label: c.name })), { id: 'global' as View, label: 'Mundo' }];
  return (
    <>
      <div className="card standing-hero">
        <div className="card-head">
          <h2><Icon name="crown" size={18} /> Tu lugar en {cityName(pos.city)}</h2>
          <InfoButton term="ranking_fortunas" />
        </div>
        <div className="sh-rank">
          <strong className="num">{pos.exact ? pos.rank : `~${fmtNumber(pos.rank)}`}</strong>
          <span className="small muted">{pos.exact ? `de las ${CITY_SIZE} fortunas más grandes` : `de ${fmtNumber(CITY_BY_ID[pos.city].adults)} adultos (estimado)`}</span>
        </div>
        {!pos.exact && <p className="small">Para entrar en la lista hacen falta <strong>{fmtMoneyFit(pos.floor, { decimals: false })}</strong> (el puesto 100 de hoy). Las fortunas también crecen: es una carrera.</p>}
        {pos.exact && pos.ahead && <p className="small">Adelante: <strong>{pos.ahead.name}</strong> con {fmtMoneyFit(pos.ahead.wealth, { decimals: false })}.{pos.behind ? <> Atrás: {pos.behind.name} con {fmtMoneyFit(pos.behind.wealth, { decimals: false })}.</> : null}</p>}
        {pos.exact && pos.rank === 1 && <p className="small">Sos el número 1{rk.reignMonths ? ` hace ${rk.reignMonths} mes${rk.reignMonths > 1 ? 'es' : ''}` : ''}. Quien está segundo puede lanzar una ofensiva: si es un grupo rival, se va a notar en tus negocios.</p>}
        <div className="btn-row">
          <span className="tiny muted" style={{ flex: 1 }}>{pos.globalRank ? `Puesto ${pos.globalRank} del mundo.` : 'Todavía fuera del top 100 mundial.'} Tu ciudad es la de tu residencia fiscal.</span>
          <button className="btn sm ghost" onClick={() => navStore.open({ kind: 'goals' })}>Metas</button>
        </div>
        {hist.length >= 2 && (
          <LineChart series={[{ name: 'Tu puesto (más alto es mejor)', values: hist.map((h) => CITY_SIZE + 1 - (h.city ?? CITY_SIZE + 1)), color: 'var(--accent)' }]} pointLabels={hist.map((h) => formatMonth(h.day))} height={80} format={(v) => String(Math.round(CITY_SIZE + 1 - v))} />
        )}
      </div>

      <Seg items={items} value={view} onChange={(v) => { setView(v); setOpen(null); }} />
      {view !== 'global' && <p className="tiny muted">{CITY_BY_ID[view].blurb}</p>}
      {view === 'global' && <p className="tiny muted">Las 400 fortunas de las cuatro ciudades, juntas.</p>}

      <div className="card rank-card" style={{ paddingBlock: 4 }}>
        <div className="rows">
          {shown.map((r, i) => <RankLine key={r.m?.id ?? 'me'} r={r} n={i + 1} open={open === (r.m?.id ?? -1)} onToggle={() => setOpen(open === (r.m?.id ?? -1) ? null : r.m?.id ?? -1)} view={view} />)}
          {!all && meIdx >= 20 && meIdx < CITY_SIZE && (
            <>
              <div className="row tiny faint" style={{ justifyContent: 'center', minHeight: 28 }}>⋯</div>
              <RankLine r={rows[meIdx]} n={meIdx + 1} open={false} onToggle={() => undefined} view={view} />
            </>
          )}
        </div>
        <button className="btn sm ghost" onClick={() => setAll(!all)}>{all ? 'Ver solo el top 20' : `Ver los ${CITY_SIZE}`}</button>
      </div>
      <p className="tiny faint">Fortunas estimadas por la Revista Fortuna (ficticia). Siguen a la bolsa, los inmuebles y las tasas de tu partida, más la suerte y los gastos de cada persona.</p>
    </>
  );
}

function RankLine({ r, n, open, onToggle, view }: { r: RankRow; n: number; open: boolean; onToggle: () => void; view: View }) {
  const s = useGame();
  if (r.kind === 'player') {
    return (
      <div className="row rank-row me">
        <span className="rank-n num">{n}</span>
        <div className="grow"><div className="title small">{s.player.name} (vos)</div><div className="meta">{Math.floor(ageOf(s))} años · {view === 'global' ? cityName(s.tax.jurisdiction) : 'tu patrimonio neto'}</div></div>
        <span className="amt small"><Money c={r.wealth} fit /></span>
      </div>
    );
  }
  const m = r.m!;
  const rival = m.rivalId ? s.world.rivals.find((x) => x.id === m.rivalId) : undefined;
  const moved = view !== 'global' && m.lastRank && m.prevCityRank ? m.lastRank - m.prevCityRank : 0;
  return (
    <>
      <button className={`row rank-row ${rival ? 'rival' : ''}`} onClick={onToggle} aria-expanded={open}>
        <span className="rank-n num">{n}</span>
        <div className="grow">
          <div className="title small">{m.name} {rival && <Pill tone="warn">{rival.name === m.name ? 'Grupo rival' : rival.name}</Pill>} {m.offensive ? <Pill tone="loss">ofensiva</Pill> : null}</div>
          <div className="meta"><Icon name={iconOf(SOURCE_INFO[m.source].icon)} size={12} /> {SOURCE_INFO[m.source].label}{view === 'global' ? ` · ${cityName(m.city)}` : ''}</div>
        </div>
        {moved !== 0 && <span className={`tiny ${moved > 0 ? 'gain' : 'loss'}`}>{moved > 0 ? `▲${moved}` : `▼${-moved}`}</span>}
        <span className="amt small"><Money c={r.wealth} fit /></span>
      </button>
      {open && (
        <div className="rank-detail small">
          <p>{m.bio}</p>
          <p className="muted">Edad {m.age + Math.floor(s.day / 365)} · mejor puesto en {cityName(m.city)}: {m.bestCityRank <= CITY_SIZE ? m.bestCityRank : '—'}</p>
          {rival && (
            <p>
              Controla <strong>{rival.name}</strong>. {(rival.attitude ?? 0) >= 60 ? 'Te tiene en la mira: espera más ataques en sus sectores.' : (rival.attitude ?? 0) >= 25 ? 'Te mira con desconfianza.' : 'Por ahora no te considera una amenaza.'}{' '}
              <button className="btn sm ghost" onClick={() => navStore.go('more', 'rivals')}>Ver grupo</button>
            </p>
          )}
        </div>
      )}
    </>
  );
}
