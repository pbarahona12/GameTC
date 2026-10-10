import { balanceSheet } from '../../engine/reports/statements';
import { CHALLENGE_BY_ID } from '../../engine/saga/challenges';
import { fmtPct } from '../../engine/format';
import { LEGAL } from '../../content/legal';
import { APP_VERSION } from '../../version';
import type { ReactNode } from 'react';
import { useNav, navStore } from '../nav';
import { useGame, useUI } from '../store';
import { EconomyScreen } from './more/Economy';
import { TaxesScreen } from './more/Taxes';
import { ProsScreen } from './more/Pros';
import { LegalScreen } from './more/Legal';
import { ShopsScreen } from './more/Shops';
import { WardrobeScreen } from './more/Wardrobe';
import { NewsScreen } from './more/News';
import { RivalsScreen } from './more/Rivals';
import { RankingScreen } from './saga/RankingScreen';
import { positionOf } from '../derived';
import { useDerived } from '../store';
import { fmtNumber } from '../../engine/format';
import { cityName } from '../../engine/saga/ranking';
import { monthlyDeathRisk, ageOf } from '../../engine/saga/life';
import { phaseInfo } from '../../engine/economy/economy';
import { residence } from '../../engine/tax/taxEngine';
import { legalRiskSummary, heatLabel } from '../../engine/legal/legal';
import { imageScore, imageLabel } from '../../engine/lifestyle/effects';
import { unreadNews } from '../../engine/world/news';
import { missionProgress } from '../../engine/progression/tutorial';
import { Icon, IconName } from '../icons';
import { Avatar, avatarOf } from '../components/Avatar';

type Sub = 'menu' | 'economy' | 'tax' | 'pros' | 'legal' | 'shops' | 'wardrobe' | 'news' | 'rivals' | 'ranking';

const TITLES: Record<Exclude<Sub, 'menu'>, string> = {
  economy: 'Economía', tax: 'Impuestos y residencia', pros: 'Profesionales', legal: 'Legal y actividades ilegales',
  shops: 'Tiendas', wardrobe: 'Tu personaje', news: 'Noticias', rivals: 'Competencia', ranking: 'Listas de fortunas',
};

interface Tile {
  icon: IconName;
  title: string;
  sub: string;
  onClick: () => void;
  alert?: boolean;
  badge?: number;
  visual?: ReactNode;
  /** Etapa desde la que la sección suele servir: antes queda plegada al final del grupo (nunca bloqueada). */
  later?: boolean;
}

/** Sección "Más": tu vida, el mundo, dinero y reglas, y el juego. */
export function More() {
  const nav = useNav();
  const s = useGame();
  const ui = useUI();
  const pos = useDerived(positionOf);
  const sub = ((nav.sub.more ?? 'menu').split(':')[0] as Sub) || 'menu';
  if (sub !== 'menu') {
    return (
      <>
        <div className="sub-head">
          <button className="btn sm ghost" onClick={() => navStore.setSub('more', 'menu')} aria-label="Volver a Más">← Más</button>
          <span className="tiny muted">{TITLES[sub]}</span>
        </div>
        {sub === 'economy' && <EconomyScreen />}
        {sub === 'tax' && <TaxesScreen />}
        {sub === 'pros' && <ProsScreen />}
        {sub === 'legal' && <LegalScreen />}
        {sub === 'shops' && <ShopsScreen />}
        {sub === 'wardrobe' && <WardrobeScreen />}
        {sub === 'news' && <NewsScreen />}
        {sub === 'rivals' && <RivalsScreen />}
        {sub === 'ranking' && <RankingScreen />}
      </>
    );
  }
  const ph = phaseInfo(s);
  const j = residence(s);
  const lr = legalRiskSummary(s);
  const img = imageScore(s);
  const unread = unreadNews(s);
  const poach = s.world.poach.filter((p) => p.status === 'abierta').length;
  const mp = missionProgress(s);
  const goals = s.saga.goals.active.length;
  const chron = s.saga.chronicle.length;
  const missionsLeft = mp.total - mp.done;
  // Lo avanzado aparece cuando sirve: antes queda plegado (con su nombre visible), salvo que pida atención.
  const showAll = ui.settings.showAllSections;
  const stage = s.progression.stage;
  const hasCompany = s.companies.length > 0 || s.formerCompanies.length > 0;
  const groups: Array<{ title: string; tiles: Tile[] }> = [
    {
      title: 'Tu vida',
      tiles: [
        { icon: 'wardrobe', title: 'Tu personaje', sub: `Imagen ${img} · ${imageLabel(img)} · vestidor y bienes`, onClick: () => navStore.setSub('more', 'wardrobe'), visual: <Avatar data={avatarOf(s)} size={34} bust /> },
        { icon: 'shop', title: 'Tiendas', sub: 'Ropa, vehículos, tecnología, hogar y lujo', onClick: () => navStore.setSub('more', 'shops') },
        { icon: 'progress', title: 'Progreso y habilidades', sub: `Etapa ${s.progression.stage}/12 · atributos, etapas y logros`, onClick: () => navStore.open({ kind: 'progress' }) },
        { icon: 'crown', title: 'Tu vida y legado', sub: `${Math.floor(ageOf(s))} años · generación ${s.saga.life?.generation ?? 1}${s.saga.life?.partner ? ' · en pareja' : ''}`, onClick: () => navStore.open({ kind: 'life' }), alert: monthlyDeathRisk(s) > 0 },
        { icon: 'missions', title: 'Metas de vida', sub: goals ? `${goals} en curso · ${Object.keys(s.saga.goals.completed).length} cumplidas` : 'Elegí qué querés lograr en esta partida', onClick: () => navStore.open({ kind: 'goals' }) },
        { icon: 'history', title: 'Tu crónica', sub: `${chron} momento${chron === 1 ? '' : 's'} de tu historia como magnate`, onClick: () => navStore.open({ kind: 'chronicle' }) },
        { icon: 'list', title: 'Misiones', sub: missionsLeft ? `${missionsLeft} por hacer · te enseñan cada sistema` : 'Todas cumplidas', onClick: () => navStore.open({ kind: 'tutorial' }) },
      ],
    },
    {
      title: 'El mundo',
      tiles: [
        { icon: 'crown', title: 'Listas de fortunas', sub: `${balanceSheet(s).netWorth <= 0 ? 'Sin puesto todavía' : pos.exact ? `Puesto ${pos.rank}` : `Puesto ~${fmtNumber(pos.rank)}`} en ${cityName(pos.city)}${pos.globalRank ? ` · ${pos.globalRank}° del mundo` : ''}`, onClick: () => navStore.setSub('more', 'ranking') },
        { icon: 'news', title: 'Noticias', sub: unread ? `${unread} nueva${unread > 1 ? 's' : ''} · rumores y anticipos` : 'Rumores y anticipos: analizalos', onClick: () => navStore.setSub('more', 'news'), badge: unread },
        { icon: 'rivals', title: 'Competencia', sub: poach ? `${poach} oferta${poach > 1 ? 's' : ''} por tus empleados` : 'Grupos rivales y sus movimientos', onClick: () => navStore.setSub('more', 'rivals'), alert: poach > 0, later: !hasCompany && stage < 3 && poach === 0 },
        { icon: 'economy', title: 'Economía', sub: `${ph.name} · inflación ${fmtPct(s.macro.inflation, 1)} · tasa ${fmtPct(s.macro.policyRate, 2)}`, onClick: () => navStore.setSub('more', 'economy') },
      ],
    },
    {
      title: 'Dinero y reglas',
      tiles: [
        { icon: 'reports', title: 'Informes financieros', sub: 'Resultados, balance, flujo de caja y libro mayor', onClick: () => navStore.go('reports') },
        { icon: 'tax', title: 'Impuestos y residencia', sub: `${j.flag} ${j.name}${s.tax.pendingJurisdiction ? ' · mudanza pendiente' : ''}`, onClick: () => navStore.setSub('more', 'tax') },
        { icon: 'pros', title: 'Profesionales', sub: `${s.pros.hires.length} contratado(s) · contadores, abogados, gestores`, onClick: () => navStore.setSub('more', 'pros'), later: stage < 3 && !hasCompany && s.pros.hires.length === 0 },
        { icon: 'legal', title: 'Legal y actividades ilegales', sub: `${s.options.illegalEnabled ? 'Actividades ilegales activadas' : 'Actividades ilegales desactivadas'} · sospecha ${heatLabel(lr.heat).toLowerCase()}${lr.openCases ? ` · ${lr.openCases} proceso(s)` : ''}`, onClick: () => navStore.setSub('more', 'legal'), alert: lr.openCases > 0 || lr.pendingFines > 0 || !!lr.prison, later: stage < 4 && !hasCompany && !s.options.illegalEnabled && lr.openCases === 0 && lr.pendingFines === 0 && !lr.prison },
      ],
    },
    {
      title: 'Juego',
      tiles: [
        { icon: 'rocket', title: 'Desafíos con semilla', sub: s.saga.challenge ? `Jugando: ${CHALLENGE_BY_ID[s.saga.challenge.id]?.title ?? s.saga.challenge.id}` : 'Mundos fijos para comparar resultados', onClick: () => navStore.open({ kind: 'challenges' }) },
        { icon: 'log', title: 'Registro de actividad', sub: 'Los últimos 400 movimientos de tu partida', onClick: () => navStore.open({ kind: 'log' }) },
        { icon: 'glossary', title: 'Glosario', sub: 'Cada concepto explicado con ejemplos', onClick: () => navStore.open({ kind: 'glossary' }) },
        { icon: 'settings', title: 'Ajustes', sub: 'Partida, apariencia, guardado y actualizaciones', onClick: () => navStore.open({ kind: 'settings' }) },
        { icon: 'mail', title: 'Enviar un comentario', sub: 'Abrí tu correo para contarnos qué te gustó o dónde te trabaste (no se envía ningún dato de tu partida)', onClick: openFeedback },
        { icon: 'shield', title: 'Privacidad y términos', sub: 'Qué datos guarda el juego, términos de uso y licencias', onClick: () => navStore.open({ kind: 'legal' }) },
      ],
    },
  ];
  return (
    <>
      {groups.map((g) => {
        const now = g.tiles.filter((t) => showAll || !t.later);
        const later = g.tiles.filter((t) => !showAll && t.later);
        return (
          <section key={g.title} className="menu-group">
            <div className="section-title"><h2>{g.title}</h2></div>
            <div className="card menu-card">
              {now.map((t) => <MenuRow key={t.title} t={t} />)}
              {later.length > 0 && (
                <details className="menu-later">
                  <summary className="menu-row">
                    <span className="menu-icon" aria-hidden><Icon name="telescope" size={19} /></span>
                    <span className="menu-text">
                      <span className="menu-title">Para más adelante</span>
                      <span className="menu-sub">{later.map((t) => t.title).join(' · ')}: sirven cuando tengas una empresa o más patrimonio. Podés abrirlas igual.</span>
                    </span>
                    <Icon name="chevron" size={16} className="faint later-chevron" />
                  </summary>
                  {later.map((t) => <MenuRow key={t.title} t={t} />)}
                </details>
              )}
            </div>
          </section>
        );
      })}
    </>
  );
}

function MenuRow({ t }: { t: Tile }) {
  return (
    <button className="menu-row" onClick={t.onClick}>
      <span className="menu-icon" aria-hidden>{t.visual ?? <Icon name={t.icon} size={19} />}</span>
      <span className="menu-text">
        <span className="menu-title">{t.title}{t.alert && <><span className="badge-dot" aria-hidden> ●</span><span className="sr-only"> (requiere atención)</span></>}</span>
        <span className="menu-sub">{t.sub}</span>
      </span>
      {t.badge ? <span className="count-badge">{t.badge}</span> : null}
      <Icon name="chevron" size={16} className="faint" />
    </button>
  );
}

function openFeedback(): void {
  window.location.assign(feedbackLink());
}

/** Comentario por correo: lo escribe la persona; el juego no adjunta datos. */
function feedbackLink(): string {
  const subject = encodeURIComponent(`Comentario sobre Ultimate Realistic Tycoon ${APP_VERSION}`);
  const body = encodeURIComponent('Contanos qué te gustó, qué te confundió o dónde te trabaste:\n\n');
  return `mailto:${LEGAL.contact}?subject=${subject}&body=${body}`;
}
