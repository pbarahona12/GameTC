import type { GameState } from '../state';
import { clamp } from '../money';
import { nextRandom, type RngHolder } from '../rng';
import { FIRST_NAMES, LAST_NAMES } from '../../content/cities';

/**
 * ELENCO QUE VUELVE (1.6, auditoría F3 y D11).
 *
 * Las personas de los dilemas dejan de ser nombres sueltos: el amigo de la
 * startup, la periodista que te entrevistó, el gerente que despediste o el socio
 * que entró en tu empresa quedan en tu elenco con un vínculo (−100 a 100) y la
 * memoria de lo que hiciste con ellas. Los próximos dilemas eligen primero a
 * alguien del elenco, y quien tiene un vínculo fuerte vuelve: a devolverte el
 * favor o a cobrarse lo que le hiciste.
 */

export type CastRole = 'amigo' | 'familiar' | 'mentoreado' | 'periodista' | 'empleado' | 'gerente' | 'socio' | 'contacto';

export interface CastMemory {
  day: number;
  text: string;
  delta: number;
}

export interface CastMember {
  id: number;
  name: string;
  role: CastRole;
  /** Cómo lo conociste («tu amigo de la startup», «periodista del Diario Económico»). */
  label: string;
  /** −100 (te odia) a 100 (haría cualquier cosa por vos). */
  bond: number;
  since: number;
  lastSeen: number;
  memories: CastMemory[];
  /** Grupo rival para el que trabaja ahora (si se fue con la competencia). */
  employer?: string;
  /** Último regreso (dilema de reencuentro). */
  returned?: number;
}

export const CAST_MAX = 15;
/** Vínculo a partir del cual alguien vuelve (a favor o en contra). */
export const RETURN_BOND = 30;
/** Tiempo mínimo sin verse para que el reencuentro tenga sentido. */
export const RETURN_GAP = 150;
/** Una misma persona vuelve como mucho una vez cada año y medio. */
export const RETURN_COOLDOWN = 540;

export const ROLE_NAMES: Record<CastRole, string> = {
  amigo: 'Amistad', familiar: 'Familia', mentoreado: 'Aprendiz', periodista: 'Prensa', empleado: 'Equipo', gerente: 'Gerencia', socio: 'Socio', contacto: 'Contacto',
};

export function castOf(s: GameState): CastMember[] {
  if (!s.saga.cast) s.saga.cast = [];
  return s.saga.cast;
}

export const castById = (s: GameState, id: number) => castOf(s).find((c) => c.id === id);

const randomName = (g: RngHolder) => `${FIRST_NAMES[Math.floor(nextRandom(g) * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(nextRandom(g) * LAST_NAMES.length)]}`;

/**
 * Persona para un dilema: primero alguien del elenco con ese papel (si lo hay y no
 * apareció hace muy poco), si no, alguien nuevo que se suma al elenco.
 * `name` fuerza a una persona concreta (por ejemplo, un empleado real).
 */
export function castFor(s: GameState, role: CastRole, g: RngHolder, label: string, name?: string): CastMember {
  const cast = castOf(s);
  const known = name
    ? cast.find((c) => c.name === name)
    : cast.filter((c) => c.role === role && s.day - c.lastSeen > 60).sort((a, b) => Math.abs(b.bond) - Math.abs(a.bond))[0];
  // Con nombre dado, siempre la misma persona; si no, a veces aparece alguien nuevo.
  if (known && (name || nextRandom(g) < 0.7)) {
    known.lastSeen = s.day;
    return known;
  }
  const m: CastMember = { id: s.meta.nextId++, name: name ?? randomName(g), role, label, bond: 0, since: s.day, lastSeen: s.day, memories: [] };
  cast.push(m);
  if (cast.length > CAST_MAX) {
    // Se olvida a quien menos huella dejó.
    const drop = [...cast].filter((c) => c !== m).sort((a, b) => Math.abs(a.bond) - Math.abs(b.bond) || a.lastSeen - b.lastSeen)[0];
    s.saga.cast = cast.filter((c) => c !== drop);
  }
  return m;
}

/** Lo que hiciste con alguien: mueve el vínculo y queda en su memoria. */
export function remember(s: GameState, id: number | undefined, delta: number, text: string): void {
  if (id === undefined) return;
  const m = castById(s, id);
  if (!m) return;
  m.bond = clamp(m.bond + delta, -100, 100);
  m.lastSeen = s.day;
  m.memories = [...m.memories, { day: s.day, text, delta }].slice(-6);
}

export function bondLabel(bond: number): { label: string; tone: 'gain' | 'loss' | 'neutral' } {
  if (bond >= 60) return { label: 'Incondicional', tone: 'gain' };
  if (bond >= RETURN_BOND) return { label: 'Te aprecia', tone: 'gain' };
  if (bond > -RETURN_BOND) return { label: 'Cordial', tone: 'neutral' };
  if (bond > -60) return { label: 'Resentido', tone: 'loss' };
  return { label: 'Enemigo', tone: 'loss' };
}

/** Quién puede volver ahora (vínculo fuerte, tiempo sin verse y sin regreso reciente). */
export function returning(s: GameState): CastMember[] {
  return castOf(s).filter((c) => Math.abs(c.bond) >= RETURN_BOND && s.day - c.lastSeen >= RETURN_GAP && s.day - (c.returned ?? -99999) >= RETURN_COOLDOWN);
}
