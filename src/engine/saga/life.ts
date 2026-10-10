import type { GameState } from '../state';
import type { LifeState, Child } from './types';
import type { JurisdictionId } from '../../content/jurisdictions';
import type { BackgroundId } from '../../content/backgrounds';
import type { SkillId } from '../../content/skills';
import { chance, nextRandom, randInt, RngHolder, seedFromString } from '../rng';
import { clamp, Cents, roundCents, usd } from '../money';
import { ActionResult, FAIL, OK } from '../result';
import { addLog } from '../log';
import { fmtMoney, fmtPct } from '../format';
import { post } from '../ledger/ledger';
import { balanceSheet } from '../reports/statements';
import { payExpense, canPayFromChecking, spendable } from '../finance/payments';
import { quitJob } from '../career/career';
import { FIRST_NAMES, LAST_NAMES } from '../../content/cities';
import { SKILL_BY_ID } from '../../content/skills';
import { chronicle, celebrate } from './chronicle';
import { srng } from './ranking';

/**
 * EDAD, VIDA Y LEGADO (1.4): el personaje envejece (a 1×, un año dura 12 minutos
 * reales), puede formar una familia, jubilarse y pasarle la posta a un heredero.
 * Es el "volver a empezar" que respeta lo construido: la fortuna, las empresas y
 * los inmuebles siguen; cambia quién los dirige, con sus propias habilidades, y
 * se paga el impuesto a la herencia de tu residencia fiscal.
 *
 * Con la edad la salud pesa más; desde los 68 años hay un riesgo real de morir
 * (más si la salud es mala). Si pasa, la sucesión es automática.
 */
export const START_AGE: Record<BackgroundId, number> = { egresado: 18, tecnico: 21, autodidacta: 19, herencia: 23 };
export const RETIRE_AGE = 60;
/** Impuesto a la herencia por residencia fiscal y mínimo exento (USD a precios iniciales). */
export const ESTATE_TAX: Record<JurisdictionId, number> = { valdoria: 0.1, isla_coral: 0, norvalia: 0.25, meridia: 0.15 };
export const ESTATE_EXEMPT_USD = 500_000;
export const CHILD_COST_USD = 220;
/** Patrimonio mínimo para crear una fundación (USD a precios iniciales). */
export const FOUNDATION_MIN_USD = 500_000;

export function life(state: GameState): LifeState {
  const s = state.saga;
  s.life ??= { birthDay: -Math.round((START_AGE[state.player.background] ?? 20) * 365.25), generation: 1, partner: null, children: [], retired: false, foundation: null, ancestors: [] };
  return s.life;
}

export function ageOf(state: GameState, birthDay = life(state).birthDay): number {
  return (state.day - birthDay) / 365.25;
}

export function childAge(state: GameState, c: Child): number {
  return (state.day - c.born) / 365.25;
}

/** Cuánto baja el objetivo de salud por la edad (se usa en los atributos mensuales). */
export function ageHealthPenalty(state: GameState): number {
  if (!state.saga) return 0;
  const a = ageOf(state);
  return a <= 50 ? 0 : (a - 50) * 0.6;
}

/** Reputación que suma tu fundación (hasta +15): se recuerda lo que donaste. */
export function foundationReputation(state: GameState): number {
  const f = state.saga?.life?.foundation;
  if (!f) return 0;
  return clamp((f.given / usd(1_000_000 * state.macro.priceIndex)) * 3, 0, 15);
}

/** Apellido de la familia. Si el jugador puso solo un nombre ("Adriana"), no se usa como
 *  apellido ("Sebastián Adriana"): se elige uno fijo a partir del nombre. */
function lastName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length > 1) return parts[parts.length - 1];
  return LAST_NAMES[(seedFromString(parts[0] || 'familia') >>> 0) % LAST_NAMES.length];
}

function pickFirst(g: RngHolder): string {
  return FIRST_NAMES[Math.floor(nextRandom(g) * FIRST_NAMES.length)];
}

/** Probabilidad de morir este mes (0 antes de los 68). */
export function monthlyDeathRisk(state: GameState): number {
  const a = ageOf(state);
  if (a < 68 || life(state).mortal === false) return 0;
  const health = state.player.attributes.health;
  const annual = 0.01 * Math.pow(1.12, a - 68) * (1 + Math.max(0, 60 - health) / 30);
  return clamp(annual / 12, 0, 0.5);
}

export interface Heir {
  id: number | 'sobrino';
  name: string;
  age: number;
  relation: string;
}

/** Quién puede heredar: hijos adultos (el mayor primero) o, si no hay, un sobrino. */
export function heirs(state: GameState): Heir[] {
  const l = life(state);
  const out: Heir[] = l.children.filter((c) => childAge(state, c) >= 18).sort((a, b) => a.born - b.born).map((c) => ({ id: c.id, name: c.name, age: Math.floor(childAge(state, c)), relation: 'hijo/a' }));
  if (!out.length) {
    const g = { rng: seedFromString(`${state.seed}|sobrino|${l.generation}`) };
    out.push({ id: 'sobrino', name: `${pickFirst(g)} ${lastName(state.player.name)}`, age: 26, relation: 'sobrino/a' });
  }
  return out;
}

export interface HeirProfile {
  skills: Record<SkillId, number>;
  /** Habilidades en las que se destaca y en las que flojea (para elegir con información). */
  strengths: SkillId[];
  weaknesses: SkillId[];
}

/**
 * Habilidades de un heredero: algo heredó (25 % de las tuyas) más su propia
 * historia. Es determinista por heredero, así que lo que ves al elegir es lo
 * que recibe en la sucesión.
 */
export function heirProfile(state: GameState, heirId: number | 'sobrino'): HeirProfile {
  const l = life(state);
  const g = { rng: seedFromString(`${state.seed}|heredero|${l.generation}|${heirId}`) };
  const ids = (Object.keys(state.skills) as SkillId[]).filter((k) => k !== 'luck');
  const skills = {} as Record<SkillId, number>;
  for (const k of ids) skills[k] = clamp(Math.round(state.skills[k].level * 0.25 + randInt(g, 1, 12)), 1, 100);
  // Un talento (y a veces dos) y una debilidad marcada.
  const talents = randInt(g, 1, 2);
  const shuffled = [...ids];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(nextRandom(g) * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const strengths = shuffled.slice(0, talents);
  const weaknesses = shuffled.slice(talents, talents + 1);
  for (const k of strengths) skills[k] = clamp(skills[k] + randInt(g, 20, 35), 1, 100);
  for (const k of weaknesses) skills[k] = clamp(Math.round(skills[k] * 0.4), 1, 100);
  skills.luck = randInt(g, 30, 70);
  return { skills, strengths, weaknesses };
}

export const skillName = (k: SkillId) => SKILL_BY_ID[k]?.name ?? k;

/** Heredero designado (si sigue disponible) o el que corresponde por defecto. */
export function designatedHeir(state: GameState): Heir {
  const hs = heirs(state);
  const id = life(state).heirId;
  return hs.find((h) => h.id === id) ?? hs[0];
}

export function setHeir(state: GameState, heirId: number | 'sobrino'): ActionResult {
  const h = heirs(state).find((x) => x.id === heirId);
  if (!h) return FAIL('Ese heredero no está disponible.');
  life(state).heirId = heirId;
  return OK(`${h.name} es tu heredero: si fallecés, toma el control de todo.`);
}

/** Impuesto a la herencia estimado si la sucesión fuera hoy. */
export function estateTax(state: GameState): { rate: number; exempt: Cents; base: Cents; tax: Cents } {
  const rate = ESTATE_TAX[state.tax.jurisdiction] ?? 0.1;
  const exempt = usd(ESTATE_EXEMPT_USD * state.macro.priceIndex);
  const base = Math.max(0, balanceSheet(state).netWorth - exempt);
  return { rate, exempt, base, tax: roundCents(base * rate) };
}

export function setMortality(state: GameState, on: boolean): ActionResult {
  life(state).mortal = on;
  return OK(on ? 'El fallecimiento por edad está activado: desde los 68 años hay un riesgo real.' : 'Fallecimiento por edad desactivado: tu personaje envejece, pero solo pasa la posta cuando vos decidís.');
}

export function retire(state: GameState): ActionResult {
  const l = life(state);
  if (l.retired) return FAIL('Ya estás jubilado.');
  if (ageOf(state) < RETIRE_AGE) return FAIL(`Podés jubilarte desde los ${RETIRE_AGE} años.`);
  if (state.career.job) quitJob(state);
  l.retired = true;
  state.player.attributes.stress = clamp(state.player.attributes.stress - 15, 0, 100);
  chronicle(state, 'vida', 'sun', 'Te jubilaste', `A los ${Math.floor(ageOf(state))} años dejaste de trabajar en relación de dependencia. Tus empresas e inversiones siguen.`);
  return OK('Te jubilaste. Tus empresas, inmuebles e inversiones siguen como siempre.');
}

/**
 * Pasa la posta: el heredero toma el control de todo. La fortuna no cambia de
 * manos en el libro mayor (sigue siendo de la familia); se paga el impuesto a
 * la herencia (al contado si alcanza; si no, en 24 cuotas).
 */
export function succession(state: GameState, heirId: number | 'sobrino', cause: 'retiro' | 'fallecimiento'): ActionResult {
  const l = life(state);
  if (cause === 'retiro' && ageOf(state) < RETIRE_AGE) return FAIL(`Podés pasar la posta desde los ${RETIRE_AGE} años.`);
  const heir = heirs(state).find((h) => h.id === heirId);
  if (!heir) return FAIL('Ese heredero no está disponible.');
  const before = balanceSheet(state).netWorth;
  const prevName = state.player.name;
  const prevAge = Math.floor(ageOf(state));
  // 1 · Impuesto a la herencia.
  const t = estateTax(state);
  let taxNote = t.rate === 0 ? `En ${state.tax.jurisdiction === 'isla_coral' ? 'Isla Coral' : 'tu residencia'} no hay impuesto a la herencia.` : 'No hubo impuesto: el patrimonio está por debajo del mínimo exento.';
  if (t.tax > 0) {
    post(state.ledger, { day: state.day, memo: 'Impuesto a la herencia', cf: 'internal', tag: 'saga:estate_tax', lines: [{ account: 'inheritance_tax', debit: t.tax }, { account: 'fines_payable', credit: t.tax }] });
    const fine = { id: state.meta.nextId++, caseId: null, label: 'Impuesto a la herencia', balance: t.tax, original: t.tax, dueDay: state.day + 30, installment: Math.max(1, roundCents(t.tax / 24)) as Cents | null, garnishing: false };
    if (canPayFromChecking(state, t.tax)) {
      post(state.ledger, { day: state.day, memo: 'Pago del impuesto a la herencia', cf: 'operating', tag: 'legal:fine_payment', lines: [{ account: 'fines_payable', debit: t.tax }, { account: 'checking', credit: t.tax }] });
      taxNote = `Impuesto a la herencia: ${fmtMoney(t.tax, { decimals: false })} (${fmtPct(t.rate, 0)} sobre lo que supera ${fmtMoney(t.exempt, { decimals: false })}), pagado al contado.`;
    } else {
      state.legal.fines.push(fine);
      taxNote = `Impuesto a la herencia: ${fmtMoney(t.tax, { decimals: false })} en 24 cuotas de ${fmtMoney(fine.installment!, { decimals: false })} (no alcanzaba el efectivo).`;
    }
  }
  // 2 · Quien se va.
  if (state.career.job) quitJob(state);
  state.career.applications = state.career.applications.filter((a) => a.status !== 'pending' && a.status !== 'offer');
  state.education.active = [];
  l.ancestors.push({ name: prevName, born: l.birthDay, until: state.day, netWorth: before, cause });
  // 3 · Quien llega: sus propias habilidades (algo heredó), su edad, su nombre.
  const child = typeof heirId === 'number' ? l.children.find((c) => c.id === heirId) : undefined;
  state.player.name = heir.name;
  const profile = heirProfile(state, heirId);
  for (const k of Object.keys(state.skills) as SkillId[]) state.skills[k] = { level: profile.skills[k] ?? state.skills[k].level, xp: 0 };
  state.education.level = child && before > usd(1_000_000 * state.macro.priceIndex) ? 'universitario' : child ? 'secundaria' : 'tecnico';
  state.career.experience = {};
  const a = state.player.attributes;
  state.player.attributes = { stress: 25, health: 85, reputation: clamp(Math.round(a.reputation * 0.5 + 10), 0, 100), network: clamp(Math.round(a.network * 0.5), 0, 100) };
  const siblings = l.children.filter((c) => c !== child).length;
  state.saga.life = { birthDay: child ? child.born : state.day - Math.round(heir.age * 365.25), generation: l.generation + 1, partner: null, children: [], retired: false, foundation: l.foundation, ancestors: l.ancestors, mortal: l.mortal, heirId: null };
  // 4 · Historia.
  const how = cause === 'fallecimiento' ? `${prevName} murió a los ${prevAge} años.` : `${prevName} se retiró a los ${prevAge} años.`;
  const text = `${how} ${heir.name} (${heir.relation}, ${heir.age} años) toma el control de la fortuna familiar (${fmtMoney(before, { decimals: false })}). ${taxNote}${siblings ? ` Sus ${siblings} hermano(s) siguen con sus vidas.` : ''}`;
  chronicle(state, 'vida', cause === 'fallecimiento' ? 'history' : 'crown', `Generación ${l.generation + 1}: ${heir.name}`, text);
  if (cause === 'fallecimiento') celebrate(state, 'big', 'history', `${prevName} murió a los ${prevAge} años`, `${text} Desde ahora jugás con ${heir.name}.`);
  else celebrate(state, 'big', 'crown', `Empieza la generación ${l.generation + 1}`, text);
  addLog(state, cause === 'fallecimiento' ? 'danger' : 'success', '🏛️', text, undefined, 'logros');
  return OK(`${heir.name} ahora dirige la fortuna familiar.`);
}

export function createFoundation(state: GameState, name: string): ActionResult {
  const l = life(state);
  if (l.foundation) return FAIL('Ya tenés una fundación.');
  const n = name.trim();
  if (n.length < 3) return FAIL('Poné un nombre de al menos 3 letras.');
  if (balanceSheet(state).netWorth < usd(FOUNDATION_MIN_USD * state.macro.priceIndex)) return FAIL(`Para crear una fundación hace falta un patrimonio de ${fmtMoney(usd(FOUNDATION_MIN_USD * state.macro.priceIndex), { decimals: false })}.`);
  l.foundation = { name: n, given: 0, since: state.day };
  chronicle(state, 'vida', 'gift', `Nace la ${n}`, 'Tu fundación financia becas, salud e investigación en el mundo del juego.');
  return OK(`Creaste la ${n}. Lo que le aportes es una donación: ya no es tuyo, pero construye tu reputación y tu legado.`);
}

export function donateToFoundation(state: GameState, amount: Cents): ActionResult {
  const l = life(state);
  if (!l.foundation) return FAIL('Primero creá tu fundación.');
  if (!(amount > 0)) return FAIL('Ingresá un monto.');
  if (spendable(state) < amount) return FAIL(`Tenés ${fmtMoney(spendable(state))} disponibles.`);
  const r = payExpense(state, 'other_expense', amount, { memo: `Aporte a la ${l.foundation.name}`, tag: 'saga:foundation', method: 'checking', allowArrears: false });
  if (!r.ok) return FAIL('No alcanzó el dinero.');
  l.foundation.given += amount;
  state.saga.stats.donated += amount;
  return OK(`Aportaste ${fmtMoney(amount)} a la ${l.foundation.name}. Total donado: ${fmtMoney(l.foundation.given)}.`);
}

/** Lo que conviene saber en cada cumpleaños clave (también queda en la crónica). */
const BIRTHDAY_NOTES: Record<number, string> = {
  50: 'Desde ahora la salud tiende a bajar un poco cada año: cuidala (estrés, estilo de vida, seguro).',
  60: `Ya podés jubilarte o pasarle la posta a tu heredero (Más → Tu vida y legado).`,
  65: 'Faltan 3 años para que la edad traiga un riesgo real de fallecer. Es buen momento para planificar la sucesión.',
  68: 'Desde hoy hay un riesgo real de fallecer por edad, mayor con mala salud. Si pasa, hereda tu hijo/a adulto mayor (o un sobrino). Revisá Más → Tu vida y legado.',
  75: 'El riesgo de fallecer por edad sigue creciendo cada año.',
};

/** Cierre de mes: nacimientos, gastos de los hijos, cumpleaños redondos y riesgo de muerte. */
export function lifeMonth(state: GameState): void {
  if (state.meta.projection || !state.saga) return;
  const l = life(state);
  const g = srng(state);
  const age = ageOf(state);
  // Hijos (con pareja, hasta 3, entre los 22 y los 45 años).
  if (l.partner && l.children.length < 3 && age >= 22 && age <= 45 && chance(g, 0.025)) {
    const c: Child = { id: state.meta.nextId++, name: `${pickFirst(g)} ${lastName(state.player.name)}`, born: state.day };
    l.children.push(c);
    chronicle(state, 'vida', 'sparkles', `Nació ${c.name.split(' ')[0]}`, `${state.player.name} y ${l.partner} tienen ${l.children.length === 1 ? 'su primer hijo' : `${l.children.length} hijos`}.`);
    celebrate(state, 'big', 'sparkles', `Nació ${c.name.split(' ')[0]}`, 'Tu familia crece. Los hijos cuestan, y también pueden heredar tu fortuna algún día.');
  }
  const minors = l.children.filter((c) => childAge(state, c) < 22).length;
  if (minors > 0) {
    const cost = usd(CHILD_COST_USD * minors * state.macro.priceIndex);
    payExpense(state, 'food', cost, { memo: `Gastos de ${minors === 1 ? 'tu hijo' : `tus ${minors} hijos`} (crianza y escuela)`, tag: 'saga:children', method: 'checking' });
  }
  // Cumpleaños: un aviso cada año y avisos claros antes de que la edad pese.
  const prevAge = ageOf(state) - 1 / 12;
  const turned = Math.floor(age) > Math.floor(prevAge) ? Math.floor(age) : null;
  if (turned !== null) {
    const note = BIRTHDAY_NOTES[turned];
    if (note) {
      addLog(state, turned >= 60 ? 'warning' : 'info', '🎂', `${state.player.name} cumplió ${turned} años. ${note}`, undefined, turned >= 65 ? 'peligro' : undefined);
      chronicle(state, 'vida', 'calendar', `${state.player.name} cumple ${turned}`, note);
    } else {
      addLog(state, 'info', '🎂', `${state.player.name} cumplió ${turned} años.`);
      if (turned % 10 === 0) chronicle(state, 'vida', 'calendar', `${state.player.name} cumple ${turned}`, 'Un año más.');
    }
  }
  // Riesgo de muerte.
  const p = monthlyDeathRisk(state);
  if (p > 0 && chance(g, p)) {
    succession(state, designatedHeir(state).id, 'fallecimiento');
  }
}
