import { announceMacroEvent } from '../world/rivals';
import type { GameState } from '../state';
import { clamp } from '../money';
import { dateOf } from '../time/calendar';
import { addLog } from '../log';
import { fmtPct } from '../format';
import { chance, randInt, randRange, nextRandom } from '../rng';
import { CARD_SPREAD } from '../../content/banks';
import { difficultyOf } from './difficulty';

/**
 * ECONOMÍA DINÁMICA (Fase 4). Se actualiza el día 1 de cada mes.
 *
 * - Ciclo económico con 5 fases. Cada fase tiene una duración mínima y máxima;
 *   pasada la mínima, cada mes hay una probabilidad creciente de cambiar.
 * - PIB, desempleo, confianza del consumidor y costos de proveedores tienden
 *   a los valores objetivo de la fase (con inercia y ruido).
 * - Inflación mensual: tiende a 3 % + presión de demanda + costos de insumos.
 *   El índice de precios se actualiza cada mes con esa inflación.
 * - El banco central revisa la tasa cada trimestre (regla de Taylor, máx. ±0,75 pp).
 * - Eventos aleatorios temporales afectan sectores, costos, bolsa, inmuebles y crédito.
 *
 * Todo lo que depende de la economía lee estas variables con las funciones
 * exportadas al final (no hay efectos "ocultos").
 */
export type CyclePhase = 'expansion' | 'auge' | 'desaceleracion' | 'recesion' | 'recuperacion';

export interface EconEffects {
  /** Multiplicador de demanda por sector empresarial o 'all'. */
  demand?: Record<string, number>;
  /** Multiplicador de costos de proveedores. */
  supplierCost?: number;
  /** Deriva anual adicional de la bolsa (fracción) y multiplicador de volatilidad. */
  stockDrift?: number;
  stockVol?: number;
  /** Sectores bursátiles afectados (deriva anual adicional). */
  stockSectors?: Record<string, number>;
  /** Deriva anual adicional de precios inmobiliarios. */
  housing?: number;
  /** Puntos porcentuales de desempleo adicionales. */
  unemployment?: number;
  /** Puntos porcentuales de inflación anual adicionales. */
  inflation?: number;
  /** Diferencial de crédito adicional (fracción, p. ej. 0.02 = +2 pp). */
  spread?: number;
  /** Aumento de vacancia inmobiliaria (fracción). */
  vacancy?: number;
}

export interface EconEvent {
  id: number;
  kind: string;
  name: string;
  icon: string;
  description: string;
  startDay: number;
  endDay: number;
  effects: EconEffects;
}

export interface MacroMonth {
  day: number;
  phase: CyclePhase;
  gdp: number;
  unemployment: number;
  inflation: number;
  policyRate: number;
  confidence: number;
  supplierCost: number;
}

export const PHASES: Record<CyclePhase, { name: string; icon: string; gdp: number; unemployment: number; confidence: number; min: number; max: number; description: string }> = {
  expansion: { name: 'Expansión', icon: '📈', gdp: 0.028, unemployment: 0.047, confidence: 1.04, min: 14, max: 42, description: 'Crecimiento estable: empleo sólido y demanda firme.' },
  auge: { name: 'Auge', icon: '🚀', gdp: 0.045, unemployment: 0.038, confidence: 1.12, min: 5, max: 16, description: 'Economía recalentada: mucha demanda, presión inflacionaria y activos caros.' },
  desaceleracion: { name: 'Desaceleración', icon: '🌥️', gdp: 0.008, unemployment: 0.055, confidence: 0.97, min: 4, max: 12, description: 'El crecimiento se frena: las ventas se enfrían y las empresas contratan menos.' },
  recesion: { name: 'Recesión', icon: '🌧️', gdp: -0.022, unemployment: 0.085, confidence: 0.84, min: 6, max: 18, description: 'La producción cae: más desempleo, menos consumo, más impagos y activos más baratos.' },
  recuperacion: { name: 'Recuperación', icon: '🌤️', gdp: 0.032, unemployment: 0.068, confidence: 0.95, min: 5, max: 14, description: 'La economía vuelve a crecer desde un nivel bajo; el empleo mejora con retraso.' },
};

const NEXT: Record<CyclePhase, Array<[CyclePhase, number]>> = {
  expansion: [['auge', 0.35], ['desaceleracion', 0.65]],
  auge: [['desaceleracion', 1]],
  desaceleracion: [['recesion', 0.5], ['expansion', 0.5]],
  recesion: [['recuperacion', 1]],
  recuperacion: [['expansion', 1]],
};

/** Consumo sensible al ciclo por sector empresarial (1 = promedio). */
export const SECTOR_CYCLICALITY: Record<string, number> = {
  cafeteria: 1.2, minimarket: 0.4, muebles: 1.7, saas: 0.8, consultora: 1.0, holding: 0,
};

interface EventDef {
  kind: string;
  name: string;
  icon: string;
  weight: number;
  months: [number, number];
  description: string;
  effects: EconEffects;
  phases?: CyclePhase[];
}

export const EVENT_CATALOG: EventDef[] = [
  { kind: 'petroleo', name: 'Shock del petróleo', icon: '🛢️', weight: 3, months: [3, 8], description: 'El precio de la energía se dispara: suben los costos de proveedores y la inflación; las acciones de energía ganan y el resto cae.',
    effects: { supplierCost: 1.12, inflation: 0.015, stockDrift: -0.08, stockSectors: { energia: 0.35, industria: -0.15, consumo: -0.1 }, demand: { all: 0.97 } } },
  { kind: 'tecnologia', name: 'Auge tecnológico', icon: '💻', weight: 3, months: [4, 12], description: 'Inversores y empresas apuestan por la tecnología: suben las acciones tecnológicas y la demanda de software.',
    effects: { stockSectors: { tecnologia: 0.4, telecom: 0.15 }, demand: { saas: 1.2, consultora: 1.05 } } },
  { kind: 'crisis_bancaria', name: 'Crisis bancaria', icon: '🏦', weight: 1.5, months: [3, 9], description: 'Un banco importante tiene problemas: el crédito se encarece y la bolsa cae con fuerza.',
    effects: { spread: 0.025, stockDrift: -0.3, stockVol: 1.8, stockSectors: { banca: -0.4 }, demand: { all: 0.94 }, unemployment: 0.01, housing: -0.08 }, phases: ['desaceleracion', 'recesion', 'auge'] },
  { kind: 'burbuja', name: 'Euforia inmobiliaria', icon: '🏗️', weight: 2, months: [6, 14], description: 'Los precios de las viviendas suben rápido por crédito barato y especulación.',
    effects: { housing: 0.12, stockSectors: { inmobiliaria: 0.2 } }, phases: ['expansion', 'auge'] },
  { kind: 'correccion', name: 'Corrección inmobiliaria', icon: '🏚️', weight: 2, months: [6, 12], description: 'Los precios de los inmuebles caen y aumenta la vacancia.',
    effects: { housing: -0.12, vacancy: 0.04, stockSectors: { inmobiliaria: -0.25, banca: -0.1 } }, phases: ['desaceleracion', 'recesion'] },
  { kind: 'huelga', name: 'Huelga de transporte', icon: '🚚', weight: 2, months: [1, 2], description: 'Los fletes se encarecen y algunos insumos escasean temporalmente.',
    effects: { supplierCost: 1.08, demand: { minimarket: 0.95, cafeteria: 0.95 } } },
  { kind: 'consumo', name: 'Ola de consumo', icon: '🛍️', weight: 2.5, months: [2, 6], description: 'Los hogares gastan más: suben las ventas minoristas y gastronómicas.',
    effects: { demand: { cafeteria: 1.15, minimarket: 1.05, muebles: 1.12 }, stockSectors: { consumo: 0.15 } }, phases: ['expansion', 'auge', 'recuperacion'] },
  { kind: 'sanitaria', name: 'Nueva regulación sanitaria', icon: '🧪', weight: 1.5, months: [4, 10], description: 'Normas de higiene más estrictas: los locales gastronómicos tienen costos adicionales.',
    effects: { demand: { cafeteria: 0.95 }, supplierCost: 1.03, stockSectors: { salud: 0.1 } } },
  { kind: 'panico', name: 'Pánico bursátil', icon: '📉', weight: 1.5, months: [1, 3], description: 'Ventas masivas en la bolsa sin una causa económica clara: alta volatilidad.',
    effects: { stockDrift: -0.6, stockVol: 2.5 } },
  { kind: 'rally', name: 'Rally bursátil', icon: '🎢', weight: 1.5, months: [2, 5], description: 'Optimismo generalizado en los mercados financieros.',
    effects: { stockDrift: 0.35, stockVol: 0.9 }, phases: ['expansion', 'auge', 'recuperacion'] },
  { kind: 'cosecha', name: 'Mala cosecha', icon: '🌾', weight: 2, months: [3, 7], description: 'Los alimentos suben de precio: se encarecen los insumos de cafeterías y minimercados.',
    effects: { supplierCost: 1.06, inflation: 0.008, demand: { minimarket: 1.02 } } },
  { kind: 'exportaciones', name: 'Boom exportador', icon: '🚢', weight: 1.5, months: [4, 10], description: 'La demanda externa impulsa la industria y el empleo.',
    effects: { stockSectors: { industria: 0.25 }, unemployment: -0.005, demand: { muebles: 1.1, consultora: 1.05 } } },
];

export function newMacroV2() {
  return {
    phase: 'expansion' as CyclePhase,
    phaseMonths: 6,
    gdpGrowth: 0.026,
    unemployment: 0.05,
    confidence: 1.0,
    supplierCost: 1.0,
    yearInflationAcc: 0,
    events: [] as EconEvent[],
    monthly: [] as MacroMonth[],
  };
}

/** Efectos combinados de todos los eventos activos. */
export function activeEffects(state: GameState): EconEffects[] {
  return state.macro.events.filter((e) => e.startDay <= state.day && e.endDay >= state.day).map((e) => e.effects);
}

function pickPhase(state: GameState, from: CyclePhase): CyclePhase {
  const opts = NEXT[from];
  const diff = difficultyOf(state);
  // La dificultad cambia la probabilidad de caer en recesión.
  const weights = opts.map(([p, w]) => [p, p === 'recesion' ? w * diff.recession : w] as [CyclePhase, number]);
  const total = weights.reduce((s, [, w]) => s + w, 0);
  let r = nextRandom(state) * total;
  for (const [p, w] of weights) {
    r -= w;
    if (r <= 0) return p;
  }
  return weights[weights.length - 1][0];
}

/** Paso mensual de la economía. Se llama el día 1 de cada mes. */
export function monthlyMacro(state: GameState): void {
  const m = state.macro;
  const g = dateOf(state.day);
  const diff = difficultyOf(state);
  const forced = m.forced && (m.forced.until ?? Infinity) >= state.day ? m.forced : null;

  // 1. Fase del ciclo
  m.phaseMonths++;
  const def = PHASES[m.phase];
  if (forced?.phase && forced.phase !== m.phase) {
    m.phase = forced.phase;
    m.phaseMonths = 0;
  } else if (!forced && m.phaseMonths >= def.min) {
    const hazard = 1 / Math.max(1, def.max - m.phaseMonths + 1);
    if (m.phaseMonths >= def.max || chance(state, hazard)) {
      const prev = m.phase;
      m.phase = pickPhase(state, m.phase);
      m.phaseMonths = 0;
      const p = PHASES[m.phase];
      addLog(state, m.phase === 'recesion' ? 'danger' : m.phase === 'desaceleracion' ? 'warning' : 'info', p.icon,
        `La economía pasa de ${PHASES[prev].name.toLowerCase()} a ${p.name.toLowerCase()}: ${p.description}`);
    }
  }
  const phase = PHASES[m.phase];
  const fx = activeEffects(state);
  const sumFx = (k: keyof EconEffects) => fx.reduce((s, e) => s + ((e[k] as number | undefined) ?? 0), 0);
  const prodFx = (k: 'supplierCost') => fx.reduce((s, e) => s * (e[k] ?? 1), 1);

  // 2. Variables reales (inercia + ruido)
  const noise = (a: number) => randRange(state, -a, a) * diff.volatility;
  m.gdpGrowth = round4(m.gdpGrowth + (phase.gdp - m.gdpGrowth) * 0.35 + noise(0.004));
  const uTarget = phase.unemployment + sumFx('unemployment');
  m.unemployment = round4(clamp(m.unemployment + (uTarget - m.unemployment) * 0.2 + noise(0.002), 0.02, 0.2));
  m.confidence = round4(clamp(m.confidence + (phase.confidence - m.confidence) * 0.25 + noise(0.01), 0.6, 1.3));
  const scTarget = prodFx('supplierCost');
  m.supplierCost = round4(clamp(m.supplierCost + (scTarget - m.supplierCost) * 0.4 + noise(0.004), 0.8, 1.4));

  // 3. Inflación (anualizada) y precios
  const inflTarget = 0.03 + 0.4 * (m.gdpGrowth - 0.025) + 0.5 * (m.supplierCost - 1) + sumFx('inflation');
  m.inflation = round4(clamp(m.inflation + (inflTarget - m.inflation) * 0.12 + noise(0.0015), -0.01, 0.15));
  const monthlyInfl = Math.pow(1 + m.inflation, 1 / 12) - 1;
  m.priceIndex = m.priceIndex * (1 + monthlyInfl);
  m.yearInflationAcc = (1 + m.yearInflationAcc) * (1 + monthlyInfl) - 1;

  // 4. Banco central (enero, abril, julio, octubre)
  if (g.m % 3 === 1) {
    const taylor = 0.02 + m.inflation + 0.5 * (m.inflation - 0.02) + 0.5 * (m.gdpGrowth - 0.025);
    const target = clamp(taylor, 0.0025, 0.15);
    const step = clamp(target - m.policyRate, -0.0075, 0.0075);
    const next = Math.round((m.policyRate + step) * 4000) / 4000;
    if (Math.abs(next - m.policyRate) >= 0.0025) {
      const up = next > m.policyRate;
      m.policyRate = next;
      state.bank.card.apr = m.policyRate + CARD_SPREAD / 100;
      addLog(state, up ? 'warning' : 'info', '🏛️', `El banco central ${up ? 'subió' : 'bajó'} la tasa de política a ${fmtPct(m.policyRate, 2)}. Afecta tarjetas, ahorro, préstamos nuevos, hipotecas variables, bonos y bolsa.`);
    }
  }

  // 5. Eventos
  // Las eras se guardan (pocas): así la próxima no repite la anterior ni se saltea la pausa entre eras.
  m.events = m.events.filter((e) => e.endDay >= state.day - 400 || e.kind.startsWith('era_'));
  if (!forced && !state.meta.projection && chance(state, 0.07 * diff.events)) {
    const active = new Set(m.events.filter((e) => e.endDay >= state.day).map((e) => e.kind)); // incluye los programados
    const pool = EVENT_CATALOG.filter((e) => !active.has(e.kind) && (!e.phases || e.phases.includes(m.phase)));
    if (pool.length) {
      const total = pool.reduce((s, e) => s + e.weight, 0);
      let r = nextRandom(state) * total;
      let pick = pool[0];
      for (const e of pool) {
        r -= e.weight;
        if (r <= 0) {
          pick = e;
          break;
        }
      }
      const months = randInt(state, pick.months[0], pick.months[1]);
      // Los eventos se programan con anticipación (1.2): las noticias a veces los anticipan,
      // así que leer y analizar da ventaja. El aviso llega el día que empiezan (world/rivals.ts).
      const lead = state.world ? randInt(state, 20, 50) : 0;
      const ev: EconEvent = { id: state.meta.nextId++, kind: pick.kind, name: pick.name, icon: pick.icon, description: pick.description, startDay: state.day + lead, endDay: state.day + lead + months * 30, effects: pick.effects };
      m.events.push(ev);
      if (lead > 0) announceMacroEvent(state, ev);
      else addLog(state, 'warning', pick.icon, `${pick.name}: ${pick.description} (duración estimada: ${months} meses)`);
    }
  }

  m.monthly.push({ day: state.day, phase: m.phase, gdp: m.gdpGrowth, unemployment: m.unemployment, inflation: m.inflation, policyRate: m.policyRate, confidence: m.confidence, supplierCost: m.supplierCost });
  if (m.monthly.length > 360) m.monthly.shift();
}

function round4(x: number): number {
  return Math.round(x * 10000) / 10000;
}

// ------------------------------------------------------------ Lecturas para otros sistemas

/** Multiplicador de demanda del consumidor para un sector empresarial. */
export function consumerDemand(state: GameState, sector: string): number {
  const cyc = SECTOR_CYCLICALITY[sector] ?? 1;
  let mult = Math.pow(state.macro.confidence, cyc);
  for (const e of activeEffects(state)) {
    if (e.demand) mult *= (e.demand[sector] ?? 1) * (e.demand.all ?? 1);
  }
  return clamp(mult, 0.4, 1.6);
}

/** Multiplicador de costo de insumos de proveedores. */
export function supplierCostIndex(state: GameState): number {
  return state.macro.supplierCost;
}

/** Facilidad para conseguir empleo (1 = normal). */
export function jobMarketFactor(state: GameState): number {
  return clamp(1 - (state.macro.unemployment - 0.05) * 4, 0.6, 1.2);
}

/** Riesgo mensual de despido por recorte según desempleo y desempeño. */
export function layoffRisk(state: GameState, performance: number): number {
  const excess = Math.max(0, state.macro.unemployment - 0.058);
  return clamp(excess * 0.3 * (1.6 - performance / 100), 0, 0.05);
}

/** Diferencial de crédito adicional por la economía (fracción). */
export function creditSpread(state: GameState): number {
  const base = state.macro.phase === 'recesion' ? 0.01 : state.macro.phase === 'desaceleracion' ? 0.004 : 0;
  return base + activeEffects(state).reduce((s, e) => s + (e.spread ?? 0), 0);
}

/** Puntos adicionales de puntaje que exigen los bancos en malas épocas. */
export function creditTightness(state: GameState): number {
  const phase = state.macro.phase === 'recesion' ? 30 : state.macro.phase === 'desaceleracion' ? 10 : 0;
  return phase + difficultyOf(state).credit;
}

/** Deriva anual del mercado de acciones según el ciclo, las tasas y los eventos. */
export function stockMarketDrift(state: GameState): { drift: number; vol: number } {
  const m = state.macro;
  const byPhase: Record<CyclePhase, number> = { expansion: 0.08, auge: 0.12, desaceleracion: -0.02, recesion: -0.12, recuperacion: 0.16 };
  let drift = byPhase[m.phase] - (m.policyRate - 0.05) * 1.5;
  let vol = m.phase === 'recesion' ? 1.5 : m.phase === 'desaceleracion' ? 1.2 : m.phase === 'auge' ? 1.1 : 1;
  for (const e of activeEffects(state)) {
    drift += e.stockDrift ?? 0;
    vol *= e.stockVol ?? 1;
  }
  return { drift, vol: vol * difficultyOf(state).volatility };
}

export function stockSectorDrift(state: GameState, sector: string): number {
  return activeEffects(state).reduce((s, e) => s + (e.stockSectors?.[sector] ?? 0), 0);
}

/** Deriva anual de los precios inmobiliarios. */
export function housingDrift(state: GameState): number {
  const m = state.macro;
  const byPhase: Record<CyclePhase, number> = { expansion: 0.04, auge: 0.07, desaceleracion: 0.01, recesion: -0.05, recuperacion: 0.03 };
  return byPhase[m.phase] + m.inflation * 0.5 - (m.policyRate - 0.05) * 1.2 + activeEffects(state).reduce((s, e) => s + (e.housing ?? 0), 0);
}

/** Vacancia adicional del mercado inmobiliario. */
export function vacancyPressure(state: GameState): number {
  const m = state.macro;
  const base = m.phase === 'recesion' ? 0.05 : m.phase === 'desaceleracion' ? 0.02 : m.phase === 'auge' ? -0.02 : 0;
  return base + activeEffects(state).reduce((s, e) => s + (e.vacancy ?? 0), 0);
}

export function phaseInfo(state: GameState) {
  return PHASES[state.macro.phase];
}
