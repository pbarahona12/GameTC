import type { GameState } from '../../../engine/state';
import { formatDate } from '../../../engine/time/calendar';
import { fmtMoneyFit } from '../../../engine/format';
import { balanceSheet } from '../../../engine/reports/statements';
import { cityName } from '../../../engine/saga/ranking';

/**
 * La crónica como imagen para compartir (1080 × 1350, formato de publicación).
 * Se dibuja en un canvas con los colores del juego; no usa fuentes externas.
 */
export function renderChronicleImage(s: GameState): string | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = 1080;
  c.height = 1350;
  const g = c.getContext('2d');
  if (!g) return null;
  const ink = '#ebe7dd';
  const muted = '#9aa3ad';
  const gold = '#d2a94f';
  g.fillStyle = '#0e1216';
  g.fillRect(0, 0, 1080, 1350);
  g.fillStyle = '#161b21';
  g.fillRect(60, 60, 960, 1230);
  g.strokeStyle = gold;
  g.lineWidth = 3;
  g.strokeRect(60, 60, 960, 1230);
  const text = (t: string, x: number, y: number, size: number, color: string, weight = 400) => {
    g.fillStyle = color;
    g.font = `${weight} ${size}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    g.fillText(t, x, y, 880);
  };
  text('ULTIMATE REALISTIC TYCOON', 110, 140, 26, gold, 700);
  text(`La crónica de ${s.player.name}`, 110, 215, 56, ink, 800);
  const nw = balanceSheet(s).netWorth;
  const rank = s.saga.ranking.player;
  text(`Patrimonio ${fmtMoneyFit(nw, { decimals: false })} · etapa ${s.progression.stage}/12${s.saga.life ? ` · generación ${s.saga.life.generation}` : ''}`, 110, 275, 30, muted);
  if (rank.city !== null) text(`Puesto ${rank.city} en ${cityName(s.tax.jurisdiction)}${rank.global ? ` · ${rank.global}° del mundo` : ''}`, 110, 320, 30, gold, 700);
  g.fillStyle = '#29313b';
  g.fillRect(110, 350, 860, 3);
  const keyKinds = new Set(['inicio', 'etapa', 'meta', 'ranking', 'rival', 'desafio', 'vida', 'empresa']);
  const items = s.saga.chronicle.filter((e) => keyKinds.has(e.kind)).slice(-14);
  let y = 420;
  for (const e of items) {
    g.fillStyle = gold;
    g.beginPath();
    g.arc(124, y - 10, 8, 0, Math.PI * 2);
    g.fill();
    text(formatDate(e.day), 150, y, 24, muted);
    text(e.title, 360, y, 28, ink, 700);
    y += 62;
    if (y > 1240) break;
  }
  text('Simulación ficticia · cada número sale de una contabilidad real', 110, 1265, 22, muted);
  return c.toDataURL('image/png');
}
