import type { Cents } from '../money';
import type { JurisdictionId } from '../../content/jurisdictions';
import type { StockSector } from '../invest/types';

/**
 * LA HISTORIA DE TU MAGNATE (1.4): clasificaciones de fortunas, metas de vida,
 * dilemas con plazo, crónica, celebraciones, primer mes guiado y desafíos.
 *
 * Todo vive en `state.saga`. Los sistemas nuevos usan su propio generador de azar
 * (`saga.rng`) para no alterar la economía: una partida con la misma semilla
 * produce la misma bolsa, los mismos empleos y los mismos eventos que antes.
 */

// ------------------------------------------------------------------ clasificaciones

/** De dónde viene la fortuna de un personaje (decide cómo se mueve mes a mes). */
export type FortuneSource = 'tecnologia' | 'finanzas' | 'inmuebles' | 'industria' | 'comercio' | 'energia' | 'salud' | 'herencia';

export interface Magnate {
  id: number;
  name: string;
  city: JurisdictionId;
  /** Edad el día 0 de la partida (la actual = esta + años transcurridos). */
  age: number;
  source: FortuneSource;
  /** Sector bursátil que sigue su fortuna (si corresponde). */
  sector?: StockSector;
  /** Patrimonio actual (centavos). */
  wealth: Cents;
  /** Puesto en su ciudad al último cierre de mes (para noticias de subas y bajas). */
  prevCityRank: number;
  /** Puesto en el cierre anterior a ese (para mostrar cuánto subió o bajó en el mes). */
  lastRank?: number;
  /** Mejor puesto en su ciudad. */
  bestCityRank: number;
  /** Cabeza visible de un grupo rival (su fortuna incluye el grupo). */
  rivalId?: string;
  /** Meses restantes de una ofensiva para superar al jugador (crece más rápido). */
  offensive?: number;
  /** Frase corta que lo describe (para la ficha). */
  bio: string;
}

export interface PlayerRankMark {
  day: number;
  city: number | null;
  global: number | null;
}

export interface RankingState {
  magnates: Magnate[];
  /** Precios de cierre del mes anterior por acción (para seguir al mercado real). */
  lastPrices: Record<string, number>;
  /** Índice de cada zona inmobiliaria el mes anterior. */
  lastZones: Record<string, number>;
  /** Puesto del jugador en su ciudad y en el mundo (null = fuera del top 100). */
  player: { city: number | null; global: number | null; bestCity: number | null; bestGlobal: number | null };
  /** Meses seguidos como número 1 de su ciudad. */
  reignMonths: number;
  /** Récord de meses seguidos como número 1. */
  bestReign: number;
  /** Historial mensual del puesto del jugador (últimos 10 años). */
  history: PlayerRankMark[];
  /** Hitos de clasificación ya anunciados (para no repetir celebraciones). */
  milestones: string[];
  /** Grupos rivales que el jugador ya superó. */
  overtaken: string[];
  /** Ciudad del jugador en el cierre anterior (para detectar mudanzas). */
  lastCity?: JurisdictionId;
}

// ------------------------------------------------------------------ crónica

export type ChronicleKind = 'inicio' | 'etapa' | 'logro' | 'meta' | 'dilema' | 'ranking' | 'empresa' | 'crisis' | 'anio' | 'desafio' | 'rival' | 'vida';

export interface ChronicleEntry {
  id: number;
  day: number;
  kind: ChronicleKind;
  /** Nombre de ícono de la interfaz (ver ui/icons). */
  icon: string;
  title: string;
  text: string;
  /** Patrimonio neto en ese momento (para la línea de tiempo). */
  netWorth?: Cents;
}

// ------------------------------------------------------------------ metas de vida

export interface GoalsState {
  /** Metas elegidas y en curso (máximo 3). */
  active: Array<{ id: string; since: number }>;
  /** Metas cumplidas: id → día. */
  completed: Record<string, number>;
  /** Metas abandonadas (se pueden volver a elegir). */
  dropped: string[];
}

// ------------------------------------------------------------------ dilemas

export interface DilemmaParams {
  [key: string]: number | string;
}

export interface Dilemma {
  id: number;
  template: string;
  day: number;
  /** Último día para decidir; si vence, se aplica la opción por defecto. */
  deadline: number;
  params: DilemmaParams;
  status: 'abierto' | 'resuelto' | 'vencido';
  choice?: string;
  /** Resultado visible después de decidir (y del desenlace, si lo hay). */
  outcome?: string;
}

/** Consecuencia que llega semanas después de una decisión. */
export interface PendingOutcome {
  id: number;
  dilemmaId: number;
  template: string;
  choice: string;
  params: DilemmaParams;
  day: number;
}

export interface DilemmasState {
  open: Dilemma[];
  /** Decisiones tomadas (las últimas 40, para la crónica y para no repetir). */
  past: Dilemma[];
  pending: PendingOutcome[];
  /** Día a partir del cual puede aparecer el próximo dilema. */
  nextDay: number;
  /** Última vez que apareció cada plantilla. */
  lastByTemplate: Record<string, number>;
}

// ------------------------------------------------------------------ celebraciones

export interface Celebration {
  id: number;
  day: number;
  /** Tamaño del festejo: un aviso breve o una pantalla. */
  size: 'small' | 'big';
  icon: string;
  title: string;
  text: string;
}

// ------------------------------------------------------------------ primer mes y desafíos

export interface FirstMonthState {
  /** Pasos del primer mes guiado ya hechos. */
  done: string[];
  dismissed: boolean;
  /** Ya cerró el resumen del primer mes. */
  summarySeen?: boolean;
}

export interface ChallengeRun {
  id: string;
  /** Día en que se cumplió el objetivo (o null si sigue en curso). */
  completedDay: number | null;
  failed: boolean;
  /** Patrimonio al terminar (para comparar). */
  finalNetWorth?: Cents;
  /** Código para comparar resultados con otras personas. */
  code?: string;
  /** Medalla por eficiencia (1.4). */
  medal?: 'oro' | 'plata' | 'bronce' | null;
}

export interface SagaStats {
  /** Dinero donado en dilemas (centavos nominales). */
  donated: Cents;
  /** Recesiones o crisis atravesadas sin perder patrimonio. */
  crisesSurvived: number;
  /** Patrimonio al empezar cada evento económico en curso (id de evento → patrimonio). */
  crisisStart: Record<string, Cents>;
  /** Dilemas resueltos por el jugador (no vencidos). */
  decisions: number;
}

// ------------------------------------------------------------------ vida y legado

export interface Child {
  id: number;
  name: string;
  /** Día de nacimiento (días de juego; negativo si nació antes de empezar). */
  born: number;
}

export interface Ancestor {
  name: string;
  born: number;
  until: number;
  netWorth: Cents;
  cause: 'retiro' | 'fallecimiento';
}

export interface LifeState {
  /** Día de nacimiento del personaje actual (negativo: nació antes del día 0). */
  birthDay: number;
  /** Generación de la dinastía (1 = el fundador). */
  generation: number;
  partner: string | null;
  children: Child[];
  retired: boolean;
  /** Fundación propia: nombre y total aportado (ya no es tuyo: se donó). */
  foundation: { name: string; given: Cents; since: number } | null;
  ancestors: Ancestor[];
  /** Fallecimiento por edad activado (por defecto sí; se puede apagar en Tu vida y legado). */
  mortal?: boolean;
  /** Heredero elegido (si fallecés, hereda él; si ya no está disponible, el hijo adulto mayor o un sobrino). */
  heirId?: number | 'sobrino' | null;
}

export interface SagaState {
  rng: number;
  ranking: RankingState;
  goals: GoalsState;
  dilemmas: DilemmasState;
  chronicle: ChronicleEntry[];
  celebrations: Celebration[];
  firstMonth: FirstMonthState;
  challenge: ChallengeRun | null;
  stats: SagaStats;
  /** Edad, familia, retiro, sucesión y fundación (1.4). */
  life?: LifeState;
  /** Acuerdos de proveedor interno entre tus empresas (1.4). */
  deals?: import('./integration').Deal[];
  /** Némesis, guerras de precios y coaliciones (1.4). */
  rivalry?: import('./rivalry').RivalryState;
  /** Equipo directivo contratado (1.4): coordina muchas empresas. */
  exec?: { hired: boolean; since: number } | null;
}
