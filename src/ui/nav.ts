import { useSyncExternalStore } from 'react';

export type Tab = 'home' | 'career' | 'finance' | 'invest' | 'business' | 'more' | 'reports';

export type SheetSpec =
  | { kind: 'term'; id: string }
  | { kind: 'glossary' }
  | { kind: 'advisor' }
  | { kind: 'settings' }
  | { kind: 'progress' }
  | { kind: 'log' }
  | { kind: 'tutorial' }
  | { kind: 'update' }
  | { kind: 'whatsnew' }
  | { kind: 'legal'; tab?: 'privacy' | 'terms' | 'licenses' }
  | { kind: 'rewards' }
  // 1.4 · la historia del magnate
  | { kind: 'chronicle' }
  | { kind: 'goals' }
  | { kind: 'dilemma'; id: number }
  | { kind: 'agenda' }
  | { kind: 'challenges' }
  | { kind: 'explain' }
  | { kind: 'life' };

interface NavState {
  tab: Tab;
  sub: Partial<Record<Tab, string>>;
  sheets: SheetSpec[];
}

/** Un lugar visitado: pestaña y su vista interna. */
interface Place {
  tab: Tab;
  sub: string | undefined;
}

const MAX_HISTORY = 40;
let nav: NavState = { tab: 'home', sub: {}, sheets: [] };
/** Lugares anteriores (para el botón atrás de Android). */
let history: Place[] = [];
const here = (): Place => ({ tab: nav.tab, sub: nav.sub[nav.tab] });
const same = (a: Place, b: Place) => a.tab === b.tab && (a.sub ?? '') === (b.sub ?? '');
function remember() {
  const p = here();
  const last = history[history.length - 1];
  if (!last || !same(last, p)) history = [...history, p].slice(-MAX_HISTORY);
}
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const navStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get: () => nav,
  go(tab: Tab, sub?: string) {
    const next: Place = { tab, sub: sub ?? nav.sub[tab] };
    if (!same(next, here())) remember();
    nav = { ...nav, tab, sub: sub ? { ...nav.sub, [tab]: sub } : nav.sub, sheets: [] };
    emit();
    window.scrollTo({ top: 0 });
  },
  setSub(tab: Tab, sub: string) {
    if (tab === nav.tab && nav.sub[tab] !== sub) remember();
    nav = { ...nav, sub: { ...nav.sub, [tab]: sub } };
    emit();
  },
  /**
   * Botón atrás: cierra la hoja de arriba; si no hay, vuelve al lugar anterior;
   * si no hay historial, a Inicio. Devuelve false si ya no hay adónde volver.
   */
  back(): boolean {
    if (nav.sheets.length) {
      navStore.close();
      return true;
    }
    const prev = history[history.length - 1];
    if (prev) {
      history = history.slice(0, -1);
      nav = { ...nav, tab: prev.tab, sub: { ...nav.sub, [prev.tab]: prev.sub } };
      emit();
      window.scrollTo({ top: 0 });
      return true;
    }
    if (nav.tab !== 'home') {
      nav = { ...nav, tab: 'home', sheets: [] };
      emit();
      return true;
    }
    return false;
  },
  /** Vuelve a Inicio y olvida el historial (al abrir otra partida). */
  reset() {
    history = [];
    nav = { tab: 'home', sub: {}, sheets: [] };
    emit();
  },
  open(s: SheetSpec) {
    nav = { ...nav, sheets: [...nav.sheets, s] };
    emit();
  },
  close() {
    nav = { ...nav, sheets: nav.sheets.slice(0, -1) };
    emit();
  },
  closeAll() {
    nav = { ...nav, sheets: [] };
    emit();
  },
};

export function useNav(): NavState {
  return useSyncExternalStore(navStore.subscribe, navStore.get);
}
