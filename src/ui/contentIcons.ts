import type { IconName } from './icons';
import type { BizSectorId } from '../content/sectors';
import type { ShopCategory } from '../content/shops';
import type { SkillId } from '../content/skills';
import type { CyclePhase } from '../engine/economy/economy';
import type { NewsTopic } from '../engine/world/types';
import type { ProKind } from '../engine/pros/types';
import type { IllegalKind } from '../engine/legal/types';
import type { LogItem } from '../engine/state';
import type { PropertyType } from '../engine/realestate/types';
import type { InvestClass } from '../engine/invest/portfolio';
import type { MogulAsset } from '../engine/invest/types';

/**
 * Íconos de los CONTENIDOS del juego en la interfaz. Los datos del motor traen
 * emojis (sirven en textos y exportaciones), pero la interfaz usa un único sistema
 * de íconos de línea. Cada tabla es exhaustiva por tipo: si se agrega un sector,
 * una fase o una habilidad, TypeScript obliga a elegirle ícono.
 */
export const SECTOR_ICON: Record<BizSectorId, IconName> = {
  cafeteria: 'coffee', minimarket: 'cart', muebles: 'homegoods', saas: 'tech', consultora: 'calculator', holding: 'network',
};

export const STORE_CATEGORY_ICON: Record<ShopCategory, IconName> = {
  ropa: 'wardrobe', vehiculos: 'car', tecnologia: 'tech', hogar: 'homegoods', lujo: 'luxury',
};

export const PHASE_ICON: Record<CyclePhase, IconName> = {
  expansion: 'trendUp', auge: 'rocket', desaceleracion: 'cloudSun', recesion: 'rain', recuperacion: 'sun',
};

export const NEWS_TOPIC_ICON: Record<NewsTopic, IconName> = {
  economia: 'economy', bolsa: 'stocks', empresas: 'business', inmuebles: 'realestate', proveedores: 'package', empleo: 'career', fortunas: 'crown',
};

export const SKILL_ICON: Record<SkillId, IconName> = {
  finEdu: 'glossary', stocks: 'stocks', prediction: 'telescope', negotiation: 'deal', accounting: 'calculator', management: 'business',
  marketing: 'megaphone', realEstate: 'realestate', law: 'legal', cybersecurity: 'shield', luck: 'clover', social: 'chat',
  discipline: 'clock', risk: 'missions', forecasting: 'sparkles',
};

export const PRO_ICON: Record<ProKind, IconName> = {
  contador: 'calculator', asesor: 'invest', abogado: 'legal', auditor: 'search', gestor: 'gestor', gerente: 'career',
};

export const ILLEGAL_ICON: Record<IllegalKind, IconName> = {
  soborno: 'cash', evasion: 'tax', evasion_empresa: 'business', fraude: 'bonds', clandestino: 'eye', lavado: 'refresh',
};

export const PROPERTY_ICON: Record<PropertyType, IconName> = {
  vivienda: 'home', local: 'store', oficina: 'realestate', terreno: 'trees', cochera: 'parking',
};

export const INVEST_CLASS_ICON: Record<InvestClass, IconName> = {
  stocks: 'stocks', bonds: 'bonds', funds: 'funds', mogul: 'puzzle', managed: 'gestor',
};

export const MOGUL_KIND_ICON: Record<MogulAsset['kind'], IconName> = { empresa: 'business', inmueble: 'realestate', regalias: 'music' };

/** Capítulos de misiones (1 a 6). */
export const CHAPTER_ICON: readonly IconName[] = ['education', 'invest', 'realestate', 'business', 'card', 'network'];

/** Ícono de un evento del registro según su tipo y categoría (no según su emoji). */
export function logIcon(l: Pick<LogItem, 'kind' | 'cat' | 'company'>): IconName {
  if (l.cat === 'legal') return 'legal';
  if (l.cat === 'logros') return 'medal';
  if (l.cat === 'ofertas') return 'mail';
  if (l.cat === 'inversiones') return 'trendDown';
  switch (l.kind) {
    case 'income': return 'coins';
    case 'expense': return 'wallet';
    case 'danger': return 'siren';
    case 'warning': return 'alert';
    case 'success': return 'check';
    default: return l.company !== undefined ? 'business' : 'info';
  }
}

/** Iniciales para los "logos" de grupos rivales y otras marcas. */
export function monogram(name: string): string {
  const words = name.replace(/^(Grupo|Inversiones|Corporación|Familia)\s+/i, '').split(/\s+/).filter(Boolean);
  return (words[0]?.[0] ?? '?').toUpperCase() + (words[1]?.[0] ?? '').toUpperCase();
}
