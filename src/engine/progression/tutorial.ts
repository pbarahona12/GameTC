import type { GameState } from '../state';
import type { SkillId } from '../../content/skills';
import { addXp } from '../skills/skills';
import { addLog } from '../log';
import { SKILL_BY_ID } from '../../content/skills';
import { imageScore } from '../lifestyle/effects';
import { ITEM_BY_ID } from '../../content/shops';
import type { ShopCategory } from '../../content/shops';

/**
 * MISIONES (guía de inicio ampliada en 1.2).
 * Cada misión se completa por el ESTADO real de la partida (no por pulsar
 * "siguiente"), puede omitirse y nunca bloquea nada. Están agrupadas en
 * capítulos que acompañan las etapas de progreso. Al cumplirlas se gana un poco
 * de experiencia en la habilidad relacionada (aprender haciendo).
 */
export type MissionTab = 'home' | 'career' | 'finance' | 'business' | 'reports' | 'invest' | 'more';

export interface TutorialStep {
  id: string;
  title: string;
  body: string;
  tab: MissionTab;
  sub?: string;
  done: (s: GameState) => boolean;
  /** Capítulo (ver CHAPTERS). */
  chapter: number;
  reward?: { skill: SkillId; xp: number };
  future?: string;
}

export const CHAPTERS: Array<{ n: number; name: string; stage: number; icon: string }> = [
  { n: 1, name: 'Primeros pasos', stage: 1, icon: '🌱' },
  { n: 2, name: 'Tu dinero trabaja', stage: 2, icon: '📈' },
  { n: 3, name: 'Inmuebles', stage: 3, icon: '🏠' },
  { n: 4, name: 'Tu primera empresa', stage: 3, icon: '🏭' },
  { n: 5, name: 'Crédito, impuestos y estilo', stage: 4, icon: '💳' },
  { n: 6, name: 'Grupo empresarial', stage: 6, icon: '🏛️' },
];

const hasTrade = (s: GameState, market: string) => s.stocks.trades.some((t) => t.market === market);
const seen = (s: GameState, term: string) => s.meta.seenTerms.includes(term);
/** ¿Compró (no la ropa inicial) algo de esta categoría de tienda? */
const bought = (s: GameState, category: ShopCategory) => (s.possessions?.items ?? []).some((o) => o.uid > 0 && ITEM_BY_ID[o.itemId]?.category === category);
/** Inmuebles tuyos o de tus empresas (no los de Mogul Exchange). */
const ownProperties = (s: GameState) => s.realEstate.properties.filter((p) => p.owner.kind === 'personal' || p.owner.kind === 'company');

export const TUTORIAL: TutorialStep[] = [
  // 1 · Primeros pasos
  { id: 'income', chapter: 1, title: 'Conseguí tu primer empleo', body: 'En Carrera → Vacantes, postulate a puestos cuyos requisitos cumplas. Postularte a varios a la vez aumenta tus chances. Vestirte mejor también ayuda.', tab: 'career', sub: 'board', done: (s) => s.career.job !== null || s.career.history.length > 0, reward: { skill: 'social', xp: 150 } },
  { id: 'cash', chapter: 1, title: 'Ordená tus cuentas', body: 'En Finanzas → Cuentas, mové dinero entre efectivo, cuenta corriente y ahorro. La cuenta corriente paga tus gastos; el ahorro genera intereses.', tab: 'finance', sub: 'accounts', done: (s) => s.ledger.entries.some((e) => e.tag === 'transfer') || s.ledger.balances.savings > 0, reward: { skill: 'finEdu', xp: 100 } },
  { id: 'save', chapter: 1, title: 'Armá un fondo de emergencia', body: 'Juntá en la cuenta de ahorro (o en depósitos a plazo) al menos un mes de gastos esenciales, sin pagos vencidos. Es lo que te salva si perdés el empleo.', tab: 'finance', sub: 'accounts', done: (s) => s.progression.stage >= 3, reward: { skill: 'discipline', xp: 200 } },
  { id: 'card', chapter: 1, title: 'Pagá el resumen completo de la tarjeta', body: 'Usá la tarjeta para un gasto y, cuando llegue el resumen, pagalo completo en Finanzas → Tarjeta. Así no pagás intereses y tu puntaje sube.', tab: 'finance', sub: 'card', done: (s) => s.bank.card.fullPayStreak >= 1, reward: { skill: 'finEdu', xp: 150 } },
  { id: 'networth', chapter: 1, title: 'Entendé tu patrimonio neto', body: 'Tocá el ⓘ junto a "Patrimonio neto" en Inicio. Es lo que tenés menos lo que debés: la medida real de tu riqueza.', tab: 'home', done: (s) => seen(s, 'patrimonio_neto'), reward: { skill: 'finEdu', xp: 100 } },
  { id: 'dress', chapter: 1, title: 'Vestite para progresar', body: 'En Tiendas comprá una prenda mejor que la ropa gastada con la que empezás. Tu imagen cambia cómo te tratan en entrevistas, negociaciones y tiendas.', tab: 'more', sub: 'shops', done: (s) => bought(s, 'ropa'), reward: { skill: 'social', xp: 100 } },
  // 2 · Tu dinero trabaja
  { id: 'invest', chapter: 2, title: 'Abrí un depósito a plazo', body: 'En Finanzas → Inversión. Rinde más que el ahorro a cambio de inmovilizar el dinero unos meses.', tab: 'finance', sub: 'invest', done: (s) => s.bank.deposits.length > 0 || s.progression.achievements.first_deposit_matured !== undefined, reward: { skill: 'finEdu', xp: 150 } },
  { id: 'fund', chapter: 2, title: 'Invertí en un fondo índice', body: 'En Invertir → Fondos, poné desde $50 en el Fondo Índice: compra toda la bolsa de una vez. Es la forma más simple de empezar.', tab: 'invest', sub: 'funds', done: (s) => Object.keys(s.funds.holdings).length > 0 || hasTrade(s, 'fondos'), reward: { skill: 'stocks', xp: 150 } },
  { id: 'stock', chapter: 2, title: 'Comprá tu primera acción', body: 'En Invertir → Bolsa elegí una empresa, mirá su análisis y comprá unas pocas acciones. Después la ves en "Mis inversiones" para vender con un toque.', tab: 'invest', sub: 'lite', done: (s) => hasTrade(s, 'bolsa'), reward: { skill: 'stocks', xp: 200 } },
  { id: 'news', chapter: 2, title: 'Analizá una noticia', body: 'En Más → Noticias (o en el menú ⋯ de arriba), tocá "Analizar" en un rumor. Con más habilidad estimás mejor si es cierto: anticiparte a los hechos es una ventaja real (nunca una garantía).', tab: 'more', sub: 'news', done: (s) => (s.world?.news ?? []).some((n) => n.analysis), reward: { skill: 'prediction', xp: 200 } },
  { id: 'liquidity', chapter: 2, title: 'Consultá al Asesor', body: 'Abrí el Asesor desde el menú ⋯ de arriba a la derecha. Calcula con tus datos cuántos meses de efectivo te quedan y qué conviene hacer.', tab: 'home', done: (s) => seen(s, 'asesor'), reward: { skill: 'finEdu', xp: 100 } },
  { id: 'economy', chapter: 2, title: 'Mirá cómo está la economía', body: 'En Más → Economía ves la fase del ciclo, la inflación y las tasas. Todo eso mueve tus ventas, tu empleo, la bolsa y los inmuebles.', tab: 'more', sub: 'economy', done: (s) => seen(s, 'ciclo_economico'), reward: { skill: 'prediction', xp: 100 } },
  // 3 · Inmuebles
  { id: 'property', chapter: 3, title: 'Comprá tu primer inmueble', body: 'En Invertir → Inmuebles hay cocheras y estudios desde unos pocos miles. Mirá el rendimiento del alquiler frente al precio antes de comprar.', tab: 'invest', sub: 'realestate', done: (s) => ownProperties(s).length > 0, reward: { skill: 'realEstate', xp: 250 } },
  { id: 'rent', chapter: 3, title: 'Cobrá tu primer alquiler', body: 'Publicá tu inmueble en alquiler (o comprá uno con inquilino). El alquiler entra el día 1 de cada mes.', tab: 'invest', sub: 'realestate', done: (s) => ownProperties(s).some((p) => p.totals.rent > 0), reward: { skill: 'realEstate', xp: 250 } },
  // 4 · Tu primera empresa
  { id: 'forecast', chapter: 4, title: 'Proyectá un negocio antes de abrirlo', body: 'En Negocios → Fundar empresa elegí un sector y tocá "Proyectar": el juego simula varios futuros posibles. Con práctica tus proyecciones son más precisas.', tab: 'business', sub: 'found', done: (s) => Object.keys(s.meta.practice).some((k) => k.startsWith('forecast:')), reward: { skill: 'forecasting', xp: 150 } },
  { id: 'company', chapter: 4, title: 'Fundá o comprá una empresa', body: 'En Negocios elegí sector y forma legal. No necesitás empleo previo: solo capital suficiente (la consultora es la opción más barata).', tab: 'business', done: (s) => s.companies.some((c) => c.sector !== 'holding') || s.formerCompanies.length > 0, reward: { skill: 'management', xp: 250 } },
  { id: 'inventory', chapter: 4, title: 'Comprá inventario', body: 'En tu empresa → Inventario, hacé un pedido o ajustá las reglas de reposición. Mirá los días de cobertura y el riesgo de faltante.', tab: 'business', done: (s) => s.meta.practice.purchase_order !== undefined, reward: { skill: 'management', xp: 100 } },
  { id: 'staff', chapter: 4, title: 'Administrá empleados', body: 'En tu empresa → Personal, contratá, capacitá o ajustá salarios. Si la competencia tienta a tu mejor empleado, podés igualar la oferta.', tab: 'business', done: (s) => s.meta.practice.hire !== undefined || s.meta.practice.train !== undefined, reward: { skill: 'management', xp: 100 } },
  { id: 'profit', chapter: 4, title: 'Leé tu estado de resultados', body: 'Abrí Más → Informes financieros → Resultados: la diferencia entre ingresos, resultado antes de impuestos y resultado neto.', tab: 'reports', sub: 'is', done: (s) => seen(s, 'estado_resultados'), reward: { skill: 'accounting', xp: 150 } },
  // 5 · Crédito, impuestos y estilo
  { id: 'taxes', chapter: 5, title: 'Revisá tus impuestos', body: 'En Más → Impuestos ves lo que vas a pagar este año, tus deducciones y cómo cambia en otras jurisdicciones.', tab: 'more', sub: 'tax', done: (s) => seen(s, 'impuesto_progresivo') || seen(s, 'declaracion_fiscal'), reward: { skill: 'accounting', xp: 150 } },
  { id: 'gold', chapter: 5, title: 'Pedí una tarjeta Oro', body: 'Con buen puntaje e ingresos, en Finanzas → Tarjeta podés pedir una tarjeta de mayor nivel: más límite, reintegros y cuotas sin interés.', tab: 'finance', sub: 'card', done: (s) => (s.bank.card.tier ?? 'clasica') !== 'clasica', reward: { skill: 'finEdu', xp: 250 } },
  { id: 'vehicle', chapter: 5, title: 'Comprá un vehículo', body: 'En Más → Tiendas → Vehículos. Reemplaza el transporte público, baja el estrés y suma imagen, pero se deprecia y tiene costos mensuales.', tab: 'more', sub: 'shops', done: (s) => bought(s, 'vehiculos'), reward: { skill: 'negotiation', xp: 150 } },
  { id: 'image40', chapter: 5, title: 'Llegá a imagen 40', body: 'Ropa de mejor calidad, un reloj o un buen auto. Con imagen 40 te atienden bien en tiendas premium y rendís mejor en entrevistas de nivel alto.', tab: 'more', sub: 'wardrobe', done: (s) => imageScore(s) >= 40, reward: { skill: 'social', xp: 250 } },
  // 6 · Grupo empresarial
  { id: 'gestor', chapter: 6, title: 'Conocé a los gestores de inversiones', body: 'En Invertir → Gestor podés contratar a un profesional que invierta por vos. Compará experiencia, reputación y comisiones.', tab: 'invest', sub: 'gestor', done: (s) => s.pros.hires.some((h) => h.pro.kind === 'gestor') || seen(s, 'gestor_inversiones'), reward: { skill: 'risk', xp: 150 } },
  { id: 'rivals', chapter: 6, title: 'Conocé a tus rivales', body: 'En Más → Competencia ves qué compran los grupos rivales, sus ofertas por tus empresas y sus movimientos.', tab: 'more', sub: 'rivals', done: (s) => seen(s, 'grupos_rivales'), reward: { skill: 'management', xp: 150 } },
  { id: 'holding', chapter: 6, title: 'Creá una holding con una subsidiaria', body: 'Una holding sin subsidiarias solo cuesta dinero. Creala cuando tengas una SRL o corporación para transferirle.', tab: 'business', done: (s) => s.companies.some((c) => c.parentId !== null), reward: { skill: 'management', xp: 300 } },
];

/**
 * ¿Misión cumplida? Una vez registrada en `tutorial.completed` queda cumplida
 * para siempre (aunque después, por ejemplo, baje tu imagen). Las que ya se
 * cumplen pero todavía no se registraron también cuentan.
 */
export function isMissionDone(s: GameState, t: TutorialStep): boolean {
  return s.tutorial.completed.includes(t.id) || t.done(s);
}

/** Misiones cumplidas sobre el total (sin contar las marcadas como futuras). */
export function missionProgress(s: GameState): { done: number; total: number } {
  const list = TUTORIAL.filter((t) => !t.future);
  return { done: list.filter((t) => isMissionDone(s, t)).length, total: list.length };
}

/**
 * Próxima misión sugerida: la primera sin hacer de los capítulos acordes a tu etapa
 * (si terminaste los de tu etapa, sigue con el siguiente capítulo).
 */
export function nextMission(s: GameState): TutorialStep | undefined {
  const stage = s.progression.stage;
  const open = TUTORIAL.filter((t) => !t.future && !isMissionDone(s, t));
  const fit = open.filter((t) => CHAPTERS[t.chapter - 1].stage <= stage);
  return fit[0] ?? open[0];
}

/** Otorga la recompensa de las misiones recién cumplidas (una sola vez). */
export function rewardMissions(s: GameState): void {
  if (s.meta.projection) return;
  for (const t of TUTORIAL) {
    if (t.future || s.tutorial.completed.includes(t.id) || !t.done(s)) continue;
    s.tutorial.completed.push(t.id);
    if (t.reward) {
      addXp(s, t.reward.skill, t.reward.xp);
      addLog(s, 'success', '🎯', `Misión cumplida: ${t.title} (+${t.reward.xp} XP en ${SKILL_BY_ID[t.reward.skill].name}).`);
    } else addLog(s, 'success', '🎯', `Misión cumplida: ${t.title}.`);
  }
}
