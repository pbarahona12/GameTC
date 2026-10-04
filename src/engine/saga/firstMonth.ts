import type { GameState } from '../state';
import type { AgendaTarget } from './agenda';
import { ActionResult, OK } from '../result';
import { BACKGROUND_BY_ID } from '../../content/backgrounds';

/**
 * TU PRIMER MES (1.4): reemplaza el "leé primero" por tres decisiones guiadas
 * con resultado inmediato. Cada paso se cumple por lo que pasa de verdad en la
 * partida (o al tocarlo, si es solo revisar algo). Nunca bloquea nada y se
 * puede ocultar.
 */
export interface FirstStep {
  id: string;
  title: string;
  body: string;
  action: string;
  target: AgendaTarget;
  done: boolean;
}

const hasApplied = (s: GameState) => s.career.applications.length > 0 || s.career.job !== null || s.career.history.length > 0;
const usedFirstSalary = (s: GameState) => s.ledger.balances.savings > 0 || s.bank.deposits.length > 0 || Object.keys(s.funds.holdings).length > 0 || s.stocks.trades.length > 0 || s.realEstate.properties.some((p) => p.owner.kind === 'personal') || s.companies.length > 0;
/** Un ingreso propio sin empleo también cuenta: una empresa o un inmueble alquilado. */
const hasIncome = (s: GameState) => s.career.job !== null || s.career.history.length > 0 || s.companies.length > 0 || s.realEstate.properties.some((p) => p.owner.kind === 'personal' && p.lease);

export function firstMonthSteps(s: GameState): FirstStep[] {
  const fm = s.saga.firstMonth;
  const marked = (id: string) => fm.done.includes(id);
  return [
    { id: 'gastos', title: 'Mirá cuánto te cuesta vivir', body: 'Tu estilo de vida fija tus gastos del mes. Con poco dinero, uno austero te da más tiempo para conseguir empleo.', action: 'Ver mis gastos', target: { kind: 'tab', tab: 'finance', sub: 'budget' }, done: marked('gastos') || s.budget.lifestyle !== BACKGROUND_BY_ID[s.player.background].lifestyle },
    { id: 'postular', title: 'Postulate a dos o tres empleos', body: 'En Carrera → Vacantes, elegí puestos cuyos requisitos cumplas. Cada postulación tarda unos días en responderse.', action: 'Ver vacantes', target: { kind: 'tab', tab: 'career', sub: 'board' }, done: marked('postular') || hasApplied(s) || s.companies.length > 0 },
    { id: 'tiempo', title: 'Poné el tiempo en marcha', body: 'Tocá ▶ arriba (o este botón). El juego se pausa solo cuando llega una oferta o algo importante.', action: 'Poner en marcha', target: { kind: 'tab', tab: 'home' }, done: marked('tiempo') || s.day >= 2 },
    { id: 'empleo', title: 'Aceptá tu primera oferta', body: 'Cuando llegue, tenés 7 días para aceptarla (o negociar el sueldo).', action: 'Ver ofertas', target: { kind: 'tab', tab: 'career', sub: 'job' }, done: marked('empleo') || hasIncome(s) },
    { id: 'cierre', title: 'Cerrá tu primer mes', body: 'El último día del mes ves cuánto entró, cuánto salió y cuánto te quedó.', action: 'Seguir', target: { kind: 'tab', tab: 'home' }, done: marked('cierre') || s.history.length > 0 },
    { id: 'decidir', title: 'Decidí qué hacer con lo que sobra', body: 'Guardalo en la cuenta de ahorro (fondo de emergencia), abrí un depósito o invertí en un fondo índice desde $50.', action: 'Ir a mis cuentas', target: { kind: 'tab', tab: 'finance', sub: 'accounts' }, done: marked('decidir') || usedFirstSalary(s) },
  ];
}

/** ¿Se muestra la guía? Hasta completarla o ocultarla (y nunca después del primer año). */
export function firstMonthActive(s: GameState): boolean {
  const fm = s.saga?.firstMonth;
  if (!fm || fm.dismissed || s.day > 365) return false;
  return firstMonthSteps(s).some((x) => !x.done);
}

export function markFirstStep(s: GameState, id: string): ActionResult {
  const fm = s.saga.firstMonth;
  if (!fm.done.includes(id)) fm.done.push(id);
  return OK();
}

export function dismissFirstMonth(s: GameState): ActionResult {
  s.saga.firstMonth.dismissed = true;
  return OK();
}
