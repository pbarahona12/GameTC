import { usd } from '../money';
import { fmtMoney } from '../format';
import type { GameState } from '../state';
import { addLog } from '../log';
import { computeMetrics, Metrics } from '../reports/metrics';
import { rewardMissions } from './tutorial';
import { sectionsFromStage } from './unlocks';
import { onStage, onAchievement, sagaProgress } from '../saga/index';

/**
 * Etapas de magnate. Ninguna exige una ruta concreta: cada criterio puede
 * cumplirse con empleo, inversiones, empresas o propiedades. La etapa alcanzada nunca retrocede; los criterios actuales
 * se muestran para que el jugador vea si mantiene su posición.
 */
export interface Criterion {
  label: string;
  met: boolean;
  /** Criterio que depende de sistemas de una fase futura. */
  future?: string;
}

export interface StageDef {
  n: number;
  name: string;
  description: string;
  criteria: (s: GameState, m: Metrics) => Criterion[];
}

/**
 * Umbral de patrimonio de una etapa, a precios de HOY (1.4): las etapas se miden en
 * dinero real, no nominal. Con inflación, $1,000,000 dentro de 40 años valen mucho
 * menos que hoy, y la etapa 12 no debería abaratarse justo cuando el interés
 * compuesto hace todo el trabajo. Se redondea para que el número se lea fácil.
 */
export function stageThreshold(s: GameState, v: number): number {
  const raw = v * (s.macro?.priceIndex ?? 1);
  const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(raw)) - 1));
  return usd(Math.round(raw / mag) * mag);
}
const nw = (s: GameState, m: Metrics, v: number): Criterion => {
  const t = stageThreshold(s, v);
  return { label: `Patrimonio neto ≥ ${fmtMoney(t, { decimals: false })}${(s.macro?.priceIndex ?? 1) > 1.01 ? ' (a precios de hoy)' : ''}`, met: m.netWorth >= t };
};

export const STAGES: StageDef[] = [
  { n: 1, name: 'Supervivencia financiera', description: 'Recursos limitados. El objetivo es no quedarte sin efectivo.', criteria: () => [] },
  {
    n: 2, name: 'Ingreso estable', description: 'Tus ingresos recurrentes cubren tus gastos esenciales.',
    criteria: (_s, m) => [{ label: 'Ingreso neto recurrente ≥ gastos esenciales', met: m.expectedNetPay + m.passiveMonthly >= m.essentialMonthly && m.essentialMonthly > 0 }],
  },
  {
    n: 3, name: 'Primeros ahorros', description: 'Un colchón para imprevistos y cero atrasos.',
    criteria: (s, m) => [
      { label: 'Fondo de emergencia ≥ 1 mes de gastos esenciales', met: m.emergencyMonths >= 1 },
      { label: 'Sin pagos vencidos', met: s.ledger.balances.arrears === 0 },
    ],
  },
  {
    n: 4, name: 'Primeras inversiones', description: 'Tu dinero empieza a trabajar para vos.',
    criteria: (s, m) => [
      { label: 'Tener inversiones activas (depósitos, fondos, acciones, inmuebles o empresas)', met: m.investments > 0 || m.realEstate > 0 || s.ledger.balances.business_equity > 0 || s.progression.achievements['first_deposit_matured'] !== undefined },
      nw(s, m, 10_000),
    ],
  },
  {
    n: 5, name: 'Patrimonio sólido', description: 'Base financiera sana para emprender o invertir en grande.',
    criteria: (s, m) => [nw(s, m, 50_000), { label: 'Fondo de emergencia ≥ 3 meses', met: m.emergencyMonths >= 3 }, { label: 'Puntaje crediticio ≥ 670', met: s.credit.score >= 670 }],
  },
  {
    n: 6, name: 'Empresario emergente', description: 'Ingresos más allá del salario.',
    criteria: (s, m) => [nw(s, m, 150_000), { label: 'Ingresos pasivos (intereses, alquileres, dividendos o ganancias de tus empresas) ≥ 20 % de tus gastos', met: m.passiveMonthly >= m.recurringMonthly * 0.2 }, { label: 'Deuda / activos < 50 %', met: m.debtToAssets < 0.5 }],
  },
  { n: 7, name: 'Magnate regional', description: 'Un patrimonio que ya mueve tu región.', criteria: (s, m) => [nw(s, m, 1_000_000), { label: 'Al menos una empresa propia con ganancias en los últimos 3 meses', met: s.companies.some((c) => c.status === 'active' && c.history.length >= 3 && c.history.slice(-3).reduce((a, h) => a + h.netIncome, 0) > 0) }] },
  { n: 8, name: 'Empresario nacional', description: 'Tu nombre se conoce en todo el país.', criteria: (s, m) => [nw(s, m, 10_000_000), { label: 'Reputación ≥ 60', met: s.player.attributes.reputation >= 60 }] },
  { n: 9, name: 'Grupo empresarial', description: 'Varias empresas bajo tu control.', criteria: (s, m) => [nw(s, m, 50_000_000), { label: '3 empresas activas o más', met: s.companies.filter((c) => c.status === 'active').length >= 3 }] },
  { n: 10, name: 'Corporación internacional', description: 'Operaciones en varias jurisdicciones.', criteria: (s, m) => [nw(s, m, 250_000_000), { label: 'Empresas o inmuebles en 2 jurisdicciones', met: jurisdictionsPresent(s) >= 2 }] },
  { n: 11, name: 'Conglomerado global', description: 'Diversificado en múltiples sectores.', criteria: (s, m) => [nw(s, m, 1_000_000_000), { label: 'Empresas en 5 sectores distintos', met: new Set(s.companies.filter((c) => c.status === 'active').map((c) => c.sector)).size >= 5 }] },
  { n: 12, name: 'Imperio económico', description: 'La cima: una de las fortunas más grandes del mundo.', criteria: (s, m) => [nw(s, m, 10_000_000_000), { label: 'Top 10 del ranking global de fortunas', met: (s.saga?.ranking.player.bestGlobal ?? 999) <= 10 }] },
];

/** Jurisdicciones donde tenés empresas activas o inmuebles (propios o de tus empresas). */
export function jurisdictionsPresent(s: GameState): number {
  const set = new Set<string>();
  for (const c of s.companies) if (c.status === 'active' || c.status === 'insolvent') set.add(c.jurisdiction ?? 'valdoria');
  for (const p of s.realEstate?.properties ?? []) if (p.owner.kind !== 'mogul') set.add(p.jurisdiction);
  return set.size;
}

export interface AchievementDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  check?: (s: GameState, m: Metrics) => boolean;
}

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'first_job', name: 'Primer sueldo', description: 'Conseguí tu primer empleo.', icon: '💼', check: (s) => s.career.job !== null || s.career.history.length > 0 },
  { id: 'first_savings', name: 'Hormiguita', description: 'Tené dinero en la cuenta de ahorro.', icon: '🐜', check: (s) => s.ledger.balances.savings > 0 },
  { id: 'emergency_3', name: 'Paracaídas', description: 'Fondo de emergencia de 3 meses.', icon: '🪂', check: (_s, m) => m.emergencyMonths >= 3 },
  { id: 'emergency_6', name: 'Búnker', description: 'Fondo de emergencia de 6 meses.', icon: '🛡️', check: (_s, m) => m.emergencyMonths >= 6 },
  { id: 'first_deposit', name: 'Paciencia', description: 'Abrí tu primer depósito a plazo.', icon: '🔒', check: (s) => s.bank.deposits.length > 0 },
  { id: 'first_deposit_matured', name: 'Cosecha', description: 'Cobrá un depósito a su vencimiento.', icon: '🌾' },
  { id: 'card_streak_6', name: 'Cero intereses', description: 'Pagá el resumen completo de la tarjeta 6 veces seguidas.', icon: '💳', check: (s) => s.bank.card.fullPayStreak >= 6 },
  { id: 'debt_free', name: 'Libre de deudas', description: 'Terminá de pagar un préstamo.', icon: '🕊️', check: (s) => s.bank.loans.some((l) => l.status === 'paid') },
  { id: 'score_750', name: 'Buen pagador', description: 'Alcanzá un puntaje crediticio de 750.', icon: '⭐', check: (s) => s.credit.score >= 750 },
  { id: 'score_800', name: 'Crédito de oro', description: 'Alcanzá un puntaje crediticio de 800.', icon: '🏅', check: (s) => s.credit.score >= 800 },
  { id: 'promotion', name: 'Escalera', description: 'Conseguí un ascenso.', icon: '🚀', check: (s) => s.career.promotions > 0 },
  { id: 'first_course', name: 'Aprendiz', description: 'Completá tu primer curso o libro.', icon: '📚', check: (s) => s.education.completed.length > 0 },
  { id: 'degree', name: 'Graduado', description: 'Obtené un título universitario.', icon: '🎓', check: (s) => s.education.level === 'universitario' || s.education.level === 'posgrado' },
  { id: 'nw_10k', name: 'Cinco cifras', description: 'Patrimonio neto de $10,000.', icon: '💰', check: (_s, m) => m.netWorth >= usd(10_000) },
  { id: 'nw_100k', name: 'Seis cifras', description: 'Patrimonio neto de $100,000.', icon: '💎', check: (_s, m) => m.netWorth >= usd(100_000) },
  { id: 'nw_1m', name: 'Millonario', description: 'Patrimonio neto de $1,000,000.', icon: '👑', check: (_s, m) => m.netWorth >= usd(1_000_000) },
  { id: 'clean_year', name: 'Año impecable', description: 'Completá un año sin ningún atraso ni mora.', icon: '📆', check: (s) => s.day >= 365 && s.credit.latePayments.length === 0 && s.credit.arrearsEvents === 0 },
  { id: 'first_company', name: 'Emprendedor', description: 'Fundá o comprá tu primera empresa.', icon: '🏭', check: (s) => s.companies.length > 0 || s.formerCompanies.length > 0 },
  { id: 'first_profit', name: 'Números negros', description: 'Una empresa tuya cierra un mes con ganancia.', icon: '📗', check: (s) => s.companies.some((c) => c.history.some((h) => h.netIncome > 0 && h.day > (c.acquiredDay ?? c.foundedDay))) },
  { id: 'first_dividend', name: 'Dueño que cobra', description: 'Cobrá un dividendo o retiro de una empresa.', icon: '💰', check: (s) => s.companies.some((c) => c.receivedByOwner > 0) || s.formerCompanies.some((f) => f.result > 0) },
  { id: 'ten_employees', name: 'Generador de empleo', description: 'Tené 10 empleados entre todas tus empresas.', icon: '👥', check: (s) => s.companies.reduce((a, c) => a + c.employees.length, 0) >= 10 },
  { id: 'profitable_exit', name: 'Salida exitosa', description: 'Vendé una empresa ganando más de lo que invertiste.', icon: '🤝', check: (s) => s.formerCompanies.some((f) => f.outcome === 'vendida' && f.result > 0) },
  { id: 'skill_25', name: 'Especialista', description: 'Llevá una habilidad a nivel 25.', icon: '🧠', check: (s) => Object.entries(s.skills).some(([k, v]) => k !== 'luck' && v.level >= 25) },
  // 1.4 · metas, decisiones y clasificaciones
  { id: 'first_goal', name: 'Tenía un plan', description: 'Cumplí tu primera meta de vida.', icon: '🎯', check: (s) => Object.keys(s.saga?.goals.completed ?? {}).length >= 1 },
  { id: 'three_goals', name: 'Vida plena', description: 'Cumplí tres metas de vida.', icon: '🌟', check: (s) => Object.keys(s.saga?.goals.completed ?? {}).length >= 3 },
  { id: 'decisions_10', name: 'Sin miedo a decidir', description: 'Tomá 10 decisiones antes de que venzan.', icon: '🤔', check: (s) => (s.saga?.stats.decisions ?? 0) >= 10 },
  { id: 'rank_city_100', name: 'En la lista', description: 'Entrá en el top 100 de las fortunas de tu ciudad.', icon: '📋', check: (s) => s.saga?.ranking.player.bestCity !== null && s.saga?.ranking.player.bestCity !== undefined },
  { id: 'rank_city_10', name: 'Élite local', description: 'Entrá en el top 10 de tu ciudad.', icon: '🥇', check: (s) => (s.saga?.ranking.player.bestCity ?? 999) <= 10 },
  { id: 'rank_city_1', name: 'Dueño de la ciudad', description: 'Sé la persona más rica de tu ciudad.', icon: '👑', check: (s) => (s.saga?.ranking.player.bestCity ?? 999) <= 1 },
  { id: 'rank_reign_12', name: 'Corona defendida', description: 'Mantené el primer puesto de tu ciudad 12 meses seguidos.', icon: '🛡️', check: (s) => (s.saga?.ranking.bestReign ?? 0) >= 12 },
  { id: 'rank_global_100', name: 'Fortuna mundial', description: 'Entrá en el top 100 del ranking global.', icon: '🌎', check: (s) => s.saga?.ranking.player.bestGlobal !== null && s.saga?.ranking.player.bestGlobal !== undefined },
  { id: 'rank_global_1', name: 'La persona más rica del mundo', description: 'Superá a todas las fortunas de las cuatro ciudades.', icon: '🏆', check: (s) => (s.saga?.ranking.player.bestGlobal ?? 999) <= 1 },
  { id: 'rival_beaten', name: 'David contra Goliat', description: 'Superá en patrimonio al dueño de un grupo rival.', icon: '⚔️', check: (s) => (s.saga?.ranking.overtaken.length ?? 0) >= 1 },
  { id: 'crisis_survivor', name: 'Contra viento y marea', description: 'Terminá una recesión con más patrimonio que al empezar.', icon: '⛈️', check: (s) => (s.saga?.stats.crisesSurvived ?? 0) >= 1 },
];

/** Logros que merecen una pantalla de festejo (el resto, un aviso breve). */
const BIG_ACHIEVEMENTS = new Set(['first_job', 'nw_100k', 'nw_1m', 'first_company', 'profitable_exit', 'rank_city_1', 'rank_global_1', 'three_goals']);

export function evaluateStage(state: GameState, m = computeMetrics(state)): { current: number; details: Array<{ stage: StageDef; criteria: Criterion[]; met: boolean }> } {
  const details = STAGES.map((st) => {
    const criteria = st.criteria(state, m);
    return { stage: st, criteria, met: criteria.every((c) => c.met) };
  });
  let current = 1;
  for (const d of details) if (d.met) current = Math.max(current, d.stage.n);
  return { current, details };
}

export function stageName(n: number): string {
  return STAGES[n - 1]?.name ?? '';
}

/** Actualiza etapa y logros. Llamado tras cada acción y al cierre de cada mes. */
export function updateProgression(state: GameState): void {
  if (state.meta.projection) return;
  const m = computeMetrics(state);
  const { current } = evaluateStage(state, m);
  if (current > state.progression.stage) {
    state.progression.stage = current;
    const st = STAGES[current - 1];
    const recommended = sectionsFromStage(current).map((g) => g.name);
    addLog(state, 'success', '🏆', `Nueva etapa: ${st.name}.${recommended.length ? ` Desde ahora se recomienda: ${recommended.join(', ')}.` : ''}`, undefined, 'logros');
    onStage(state, current, st.name, recommended, st.description);
  }
  rewardMissions(state);
  sagaProgress(state, m);
  for (const a of ACHIEVEMENTS) {
    if (state.progression.achievements[a.id] !== undefined || !a.check) continue;
    if (a.check(state, m)) {
      state.progression.achievements[a.id] = state.day;
      addLog(state, 'success', a.icon, `Logro desbloqueado: ${a.name}.`, undefined, 'logros');
      onAchievement(state, a.name, a.description, BIG_ACHIEVEMENTS.has(a.id));
    }
  }
}

export function professionalLevel(state: GameState): { level: number; progress: number } {
  const pts = state.career.careerPoints;
  const level = Math.min(50, 1 + Math.floor(Math.sqrt(pts / 40)));
  const cur = Math.pow(level - 1, 2) * 40;
  const next = Math.pow(level, 2) * 40;
  return { level, progress: (pts - cur) / (next - cur) };
}
