import type { Cents } from '../money';
import type { BizSectorId } from '../../content/sectors';

export type NewsKind = 'rumor' | 'anticipo' | 'oficial' | 'hecho';
export type NewsTopic = 'economia' | 'bolsa' | 'empresas' | 'inmuebles' | 'proveedores' | 'empleo' | 'fortunas';
export type NewsStatus = 'abierta' | 'cumplida' | 'desmentida' | 'hecho';

/**
 * Noticia. `truth` y `reliability` son la verdad oculta del juego: la interfaz
 * nunca los muestra. El jugador ve la confiabilidad TÍPICA de la fuente y, si la
 * analiza, una estimación cuya precisión depende de su habilidad.
 */
export interface NewsItem {
  id: number;
  day: number;
  kind: NewsKind;
  topic: NewsTopic;
  icon: string;
  title: string;
  body: string;
  source: string;
  /** Confiabilidad típica de ese tipo de fuente (visible). */
  sourceTypical: number;
  /** Probabilidad real de que la noticia sea cierta (oculta). */
  reliability: number;
  /** ¿Es cierta? (oculto hasta que se resuelve). */
  truth: boolean;
  resolveDay: number | null;
  status: NewsStatus;
  ref?: { stockId?: string; sector?: BizSectorId; listingId?: number; propertyListingId?: number; rivalId?: string; eventKind?: string; companyId?: number; direction?: 1 | -1 };
  analysis?: { day: number; estimate: number; clue: 'respalda' | 'contradice' | null; skill: number };
}

export interface RivalMove {
  day: number;
  text: string;
  price?: Cents;
}

export interface RivalGroup {
  id: string;
  name: string;
  icon: string;
  style: 'agresivo' | 'paciente' | 'oportunista';
  description: string;
  sectors: BizSectorId[];
  /** Capital disponible (estimado públicamente con ±20 %). */
  capital: Cents;
  moves: RivalMove[];
  /** Empresas y competidores que controla. */
  holdings: string[];
  /** Valor estimado de lo que compró o abrió (1.4; se mueve con el mercado). */
  assetsValue?: Cents;
  /**
   * Memoria del grupo hacia vos (1.4): 0 = indiferente, 100 = te declaró la guerra.
   * Sube si le ganás compras, lo superás en la clasificación o competís en sus
   * sectores; baja sola con el tiempo. Cuanto más alta, más movimientos en tu contra.
   */
  attitude?: number;
  /** Ciudad de la familia o los dueños (1.4). */
  city?: import('../../content/jurisdictions').JurisdictionId;
  /** Lo último que pasó entre ustedes (para la ficha del rival). */
  memory?: Array<{ day: number; text: string }>;
  /** Tregua pactada en un dilema: no te ataca y vos no entrás en ese sector (1.4). */
  truce?: { sector: BizSectorId; from: number; until: number } | null;
}

export type IntentKind = 'comprar_empresa' | 'comprar_inmueble' | 'abrir_competidor' | 'exclusividad';

export interface RivalIntent {
  id: number;
  rivalId: string;
  kind: IntentKind;
  executeDay: number;
  newsId: number | null;
  listingId?: number;
  propertyListingId?: number;
  sector?: BizSectorId;
  supplierId?: string;
  /** Empresa o inmueble que querían comprar (1.4: para saber si se lo ganaste vos). */
  companyId?: number;
  propertyId?: number;
}

export interface SupplierShock {
  id: number;
  rivalId: string;
  sector: BizSectorId;
  supplierId: string;
  mult: number;
  fromDay: number;
  untilDay: number;
}

export interface PoachOffer {
  id: number;
  companyId: number;
  employeeId: number;
  employeeName: string;
  rivalId: string;
  wage: Cents;
  expires: number;
  status: 'abierta' | 'igualada' | 'se_fue' | 'se_quedo';
}

export interface WorldLifeState {
  news: NewsItem[];
  rivals: RivalGroup[];
  intents: RivalIntent[];
  supplierShocks: SupplierShock[];
  poach: PoachOffer[];
  /** Id de la última noticia vista (para el contador de no leídas). */
  lastRead: number;
  /** Generador propio del mundo (no altera el azar del resto de la economía). */
  rng?: number;
}
