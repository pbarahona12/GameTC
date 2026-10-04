import { useEffect, useRef } from 'react';
import { useUI, store } from '../../store';
import { navStore } from '../../nav';
import { Icon } from '../../icons';
import { dismissCelebration } from '../../../engine/saga/chronicle';
import { celebrateFeedback } from '../../feedback';
import { iconOf } from './SagaCards';

/**
 * FESTEJOS (1.4): los hitos grandes muestran una pantalla breve (etapa nueva,
 * primer millón, número 1 de la ciudad, meta cumplida…); los chicos, un aviso
 * arriba que se va solo. De a uno: si hay varios, se muestran en orden.
 */
export function Celebrations() {
  const ui = useUI();
  const s = ui.state;
  const c = s?.saga?.celebrations[0];
  const shown = useRef<number | null>(null);
  const close = (id: number) => store.run((st) => dismissCelebration(st, id), { toast: false });
  // Muchos avisos chicos juntos (al volver de una ausencia o importar): quedan los 2 más nuevos.
  const smalls = s?.saga?.celebrations.filter((x) => x.size === 'small') ?? [];
  useEffect(() => {
    if (smalls.length <= 2) return;
    const drop = new Set(smalls.slice(0, -2).map((x) => x.id));
    store.run((st) => { st.saga.celebrations = st.saga.celebrations.filter((x) => !drop.has(x.id)); }, { toast: false });
  }, [smalls.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!c || shown.current === c.id) return;
    shown.current = c.id;
    celebrateFeedback(c.size);
    if (c.size === 'small') {
      const t = setTimeout(() => close(c.id), 3400);
      return () => clearTimeout(t);
    }
  }, [c?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!c) return null;
  if (c.size === 'small') {
    return (
      <button className="celebrate-banner" onClick={() => close(c.id)} aria-live="polite" aria-label={`${c.title}. ${c.text} (tocar para cerrar)`}>
        <span className="cb-ic" aria-hidden><Icon name={iconOf(c.icon, 'medal')} size={18} /></span>
        <span className="cb-text"><strong className="small">{c.title}</strong><span className="tiny">{c.text}</span></span>
      </button>
    );
  }
  return (
    <div className="celebrate-backdrop" role="dialog" aria-modal="true" aria-labelledby={`cel-${c.id}`} onClick={() => close(c.id)}>
      <div className="celebrate-card" onClick={(e) => e.stopPropagation()}>
        <div className="confetti" aria-hidden>{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ ['--i' as string]: i }} />)}</div>
        <span className="celebrate-ic" aria-hidden><Icon name={iconOf(c.icon, 'crown')} size={40} /></span>
        <h2 id={`cel-${c.id}`}>{c.title}</h2>
        <p className="small">{c.text}</p>
        <div className="btn-row">
          <button className="btn primary" autoFocus onClick={() => close(c.id)}>¡Seguimos!</button>
          <button className="btn ghost" onClick={() => { close(c.id); navStore.open({ kind: 'chronicle' }); }}>Ver crónica</button>
        </div>
      </div>
    </div>
  );
}
