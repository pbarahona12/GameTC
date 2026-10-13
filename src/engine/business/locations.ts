import type { Company } from './types';
import type { JurisdictionId } from '../../content/jurisdictions';

/**
 * LOCALES Y MERCADOS POR CIUDAD (1.6, auditoría E2 y D1).
 *
 * Hasta la 1.5 cada rubro tenía un único mercado para todo el mundo: una empresa
 * no podía crecer más allá de esa demanda (el «techo» de la auditoría). Ahora cada
 * ciudad tiene su propio mercado por rubro, de tamaño proporcional a su población y
 * su consumo:
 *  - El local principal de toda empresa está en Valdoria, la capital: su mercado es
 *    exactamente el de antes (las partidas guardadas no cambian).
 *  - Una sucursal abre la empresa al mercado de otra ciudad, o suma presencia en una
 *    ciudad donde ya está.
 * En cada ciudad la empresa compite contra los mismos rivales y contra tus otras
 * empresas del rubro que estén ahí (canibalización). Varios locales en la misma
 * ciudad captan más clientes, con rendimientos decrecientes (presencia = n^0,6).
 * Este archivo es puro (solo cuentas): las acciones están en branches.ts.
 */
export interface Branch {
  id: number;
  city: JurisdictionId;
  /** Día en que se decidió abrir. */
  openedDay: number;
  /** Día en que empieza a vender (tras la instalación). */
  openDay: number;
  /** Depósito en garantía del local (se recupera al cerrarlo). */
  deposit: number;
}

/** Ciudad del local principal (el mercado histórico del juego). */
export const HOME_CITY: JurisdictionId = 'valdoria';

/** Tamaño del mercado de cada ciudad frente al de la capital. */
export const CITY_MARKET: Record<JurisdictionId, number> = { valdoria: 1, norvalia: 0.8, meridia: 0.65, isla_coral: 0.3 };

export const CITY_ORDER: JurisdictionId[] = ['valdoria', 'norvalia', 'meridia', 'isla_coral'];

/** Sucursales como máximo por ciudad y en total (sin contar el local principal). */
export const MAX_PER_CITY = 3;
export const MAX_BRANCHES = 8;

/** Captación de clientes según la cantidad de locales en una ciudad (rendimientos decrecientes). */
export function presence(n: number): number {
  return n <= 0 ? 0 : Math.pow(n, 0.6);
}

/** Locales que venden ese día, por ciudad (el principal cuenta siempre). */
export function locales(co: Company, day: number): Partial<Record<JurisdictionId, number>> {
  const out: Partial<Record<JurisdictionId, number>> = { [HOME_CITY]: 1 };
  for (const b of co.branches ?? []) if (b.openDay <= day) out[b.city] = (out[b.city] ?? 0) + 1;
  return out;
}

/** Locales que pagan alquiler (los que están abiertos o instalándose). */
export function rentedLocales(co: Company): number {
  return 1 + (co.branches?.length ?? 0);
}

/** Suma de los mercados de las ciudades donde la empresa vende (1 = solo la capital). */
export function addressableWeight(co: Company, day: number): number {
  return (Object.keys(locales(co, day)) as JurisdictionId[]).reduce((s, c) => s + CITY_MARKET[c], 0);
}

/** Ciudades distintas donde la empresa tiene al menos un local abierto. */
export function citiesOf(co: Company, day: number): JurisdictionId[] {
  return Object.keys(locales(co, day)) as JurisdictionId[];
}
