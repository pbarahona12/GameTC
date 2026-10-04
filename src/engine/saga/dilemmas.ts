import type { GameState } from '../state';
import type { Company } from '../business/types';
import type { Dilemma, DilemmaParams, PendingOutcome } from './types';
import { chance, nextRandom, randInt, randRange, RngHolder } from '../rng';
import { clamp, Cents, roundCents, usd } from '../money';
import { ActionResult, FAIL, OK } from '../result';
import { addLog } from '../log';
import { fmtMoney, fmtPct } from '../format';
import { post } from '../ledger/ledger';
import { payExpense, spendable } from '../finance/payments';
import { balanceSheet } from '../reports/statements';
import { isOpen } from '../business/common';
import { coPost } from '../business/companyLedger';
import { SECTOR_BY_ID } from '../../content/sectors';
import { FIRST_NAMES, LAST_NAMES } from '../../content/cities';
import { chronicle } from './chronicle';
import { srng, rememberRival, playerCity, cityName } from './ranking';
import { newProperty } from '../realestate/realestate';
import { ZONES } from '../../content/realestate';
import { formatDate } from '../time/calendar';

/**
 * DILEMAS CON PLAZO (1.4): situaciones con 2–3 opciones, cada una con costos y
 * beneficios reales, que vencen en una fecha de juego. Si no decidís, se aplica
 * la opción por defecto (no decidir también es una decisión). Algunas tienen un
 * desenlace semanas o meses después.
 *
 * Todo efecto pasa por los sistemas que ya existen: el libro mayor, los
 * empleados, la carrera, los atributos, los rivales y el mercado inmobiliario.
 * El azar es el de la historia (saga.rng), no el de la economía.
 */
export const MAX_OPEN = 2;
const FIRST_DILEMMA_DAY = 40;

interface Opt {
  id: string;
  label: string;
  detail: (s: GameState, d: Dilemma) => string;
  /** Motivo por el que no se puede elegir ahora (null = disponible). */
  blocked?: (s: GameState, d: Dilemma) => string | null;
}

interface Template {
  id: string;
  icon: string;
  weight: number;
  /** Días mínimos entre dos apariciones. */
  cooldown: number;
  eligible: (s: GameState) => boolean;
  create: (s: GameState, g: RngHolder) => { params: DilemmaParams; days: number } | null;
  title: (s: GameState, d: Dilemma) => string;
  body: (s: GameState, d: Dilemma) => string;
  options: Opt[];
  /** Opción que se aplica si vence (nunca cuesta dinero). */
  fallback: string;
  /** Aplica la decisión y devuelve el texto del resultado. */
  apply: (s: GameState, d: Dilemma, choice: string, g: RngHolder) => string;
  /** Desenlace diferido (si `apply` lo programó). */
  resolve?: (s: GameState, o: PendingOutcome, g: RngHolder) => void;
}

// ------------------------------------------------------------------ utilidades

const pi = (s: GameState) => s.macro.priceIndex;
const num = (d: Dilemma | PendingOutcome, k: string) => Number(d.params[k] ?? 0);
const str = (d: Dilemma | PendingOutcome, k: string) => String(d.params[k] ?? '');
const money = (c: Cents) => fmtMoney(c, { decimals: false });
const attr = (s: GameState, k: 'stress' | 'health' | 'reputation' | 'network', delta: number) => {
  s.player.attributes[k] = clamp(s.player.attributes[k] + delta, 0, 100);
};
const myCompanies = (s: GameState) => s.companies.filter((c) => isOpen(c) && !c.npc && c.sector !== 'holding');
const companyOf = (s: GameState, d: Dilemma | PendingOutcome) => s.companies.find((c) => c.id === num(d, 'companyId') && isOpen(c));
const randomName = (g: RngHolder) => `${FIRST_NAMES[Math.floor(nextRandom(g) * FIRST_NAMES.length)]} ${LAST_NAMES[Math.floor(nextRandom(g) * LAST_NAMES.length)]}`;
const pick = <T>(g: RngHolder, xs: T[]): T => xs[Math.floor(nextRandom(g) * xs.length)];

function spend(s: GameState, amount: Cents, memo: string, account: 'other_expense' | 'leisure' | 'housing' = 'other_expense'): boolean {
  if (amount <= 0) return true;
  const r = payExpense(s, account, amount, { memo, tag: 'saga:dilema', method: 'checking', allowArrears: false });
  return r.ok;
}

function earn(s: GameState, amount: Cents, memo: string): void {
  if (amount <= 0) return;
  post(s.ledger, { day: s.day, memo, cf: 'operating', tag: 'saga:dilema', lines: [{ account: 'checking', debit: amount }, { account: 'other_income', credit: amount }] });
}

const cantPay = (amount: Cents) => (s: GameState) => (spendable(s) < amount ? `Necesitás ${money(amount)} disponibles` : null);

function schedule(s: GameState, d: Dilemma, choice: string, days: number, extra: DilemmaParams = {}): void {
  s.saga.dilemmas.pending.push({ id: s.meta.nextId++, dilemmaId: d.id, template: d.template, choice, params: { ...d.params, ...extra }, day: s.day + Math.max(1, Math.round(days)) });
}

function companyCost(co: Company, amount: Cents, memo: string, account: 'training' | 'admin' | 'wages', day: number): boolean {
  if (amount <= 0) return true;
  if (co.ledger.balances.cash < amount) return false;
  coPost(co.ledger, { day, memo, cf: 'operating', tag: 'saga:dilema', lines: [{ account, debit: amount }, { account: 'cash', credit: amount }] });
  return true;
}

/** Rival que opera en el sector de una empresa (o cualquiera). */
function rivalFor(s: GameState, sector: string, g: RngHolder) {
  const pool = s.world.rivals.filter((r) => r.sectors.includes(sector as never));
  return pool.length ? pick(g, pool) : undefined;
}

/** Usa el azar de la historia para funciones de la economía que consumen azar. */
function withSagaRng<T>(s: GameState, fn: () => T): T {
  const saved = s.rng;
  const g = srng(s);
  s.rng = g.rng;
  try {
    return fn();
  } finally {
    g.rng = s.rng;
    s.rng = saved;
  }
}

// ------------------------------------------------------------------ plantillas

const TEMPLATES: Template[] = [
  {
    id: 'aumento', icon: 'pros', weight: 3, cooldown: 240,
    eligible: (s) => myCompanies(s).some((c) => c.employees.some((e) => e.skill >= 55 && s.day - e.hiredDay > 150)),
    create: (s, g) => {
      const cos = myCompanies(s).filter((c) => c.employees.some((e) => e.skill >= 55 && s.day - e.hiredDay > 150));
      const co = pick(g, cos);
      const e = [...co.employees].filter((x) => s.day - x.hiredDay > 150).sort((a, b) => b.skill - a.skill)[0];
      if (!e) return null;
      return { params: { companyId: co.id, employeeId: e.id, name: e.name, wage: e.wage, company: co.name }, days: 10 };
    },
    title: (_s, d) => `${str(d, 'name')} pide un aumento`,
    body: (_s, d) => `Tu mejor empleado en ${str(d, 'company')} (sueldo ${money(num(d, 'wage'))}/mes) dice que la competencia le ofrece más. Quiere un 15 % o lo va a pensar.`,
    options: [
      { id: 'dar', label: 'Darle el 15 %', detail: (_s, d) => `Sueldo ${money(roundCents(num(d, 'wage') * 1.15))}/mes. Se queda contento (moral +15).` },
      { id: 'mitad', label: 'Ofrecerle 7 %', detail: () => 'Más barato. Puede aceptar… o irse igual (cerca de 1 en 3).' },
      { id: 'no', label: 'No subirle', detail: () => 'Cuidás los costos, pero es probable que se vaya con un rival.' },
    ],
    fallback: 'no',
    apply: (s, d, choice, g) => {
      const co = companyOf(s, d);
      const e = co?.employees.find((x) => x.id === num(d, 'employeeId'));
      if (!co || !e) return 'Ya no trabaja en la empresa.';
      if (choice === 'dar') {
        e.wage = roundCents(e.wage * 1.15);
        e.morale = clamp(e.morale + 15, 0, 100);
        return `${e.name} se queda y está más motivado. Su sueldo ahora es ${money(e.wage)}/mes.`;
      }
      const leaveP = choice === 'mitad' ? 0.33 : 0.6;
      if (choice === 'mitad') e.wage = roundCents(e.wage * 1.07);
      if (chance(g, leaveP)) {
        co.employees = co.employees.filter((x) => x !== e);
        const r = rivalFor(s, co.sector, g);
        if (r) r.memory = [...(r.memory ?? []), { day: s.day, text: `Se llevó a ${e.name} de ${co.name}` }].slice(-12);
        return `${e.name} renunció y se fue a ${r ? r.name : 'la competencia'}.`;
      }
      e.morale = clamp(e.morale + (choice === 'mitad' ? 3 : -12), 0, 100);
      return choice === 'mitad' ? `${e.name} aceptó el 7 %. Sueldo: ${money(e.wage)}/mes.` : `${e.name} se queda, pero desmotivado (moral −12).`;
    },
  },
  {
    id: 'startup', icon: 'rocket', weight: 2, cooldown: 600,
    eligible: (s) => s.progression.stage >= 2 && spendable(s) >= usd(4000 * pi(s)),
    create: (s, g) => {
      const amount = roundCents(clamp(spendable(s) * randRange(g, 0.08, 0.18), usd(1500 * pi(s)), usd(80_000 * pi(s))) / 10000) * 10000;
      const idea = pick(g, ['una aplicación para reservar canchas', 'cosmética natural por suscripción', 'un software para clínicas veterinarias', 'comida saludable congelada', 'un mercado de ropa usada en línea', 'paneles solares para comercios']);
      return { params: { amount, friend: randomName(g), idea }, days: 14 };
    },
    title: (_s, d) => `${str(d, 'friend')} te ofrece entrar en su startup`,
    body: (_s, d) => `Está armando ${str(d, 'idea')} y busca ${money(num(d, 'amount'))}. Dice que puede multiplicarse… o no. Se contabiliza como gasto: si sale bien, lo cobrás.`,
    options: [
      { id: 'todo', label: 'Invertir todo', detail: (_s, d) => `Ponés ${money(num(d, 'amount'))}. En 1 o 2 años sabrás si valió la pena.`, blocked: (s, d) => cantPay(num(d, 'amount'))(s) },
      { id: 'mitad', label: 'Invertir la mitad', detail: (_s, d) => `Ponés ${money(roundCents(num(d, 'amount') / 2))}. Menos riesgo, menos premio.`, blocked: (s, d) => cantPay(roundCents(num(d, 'amount') / 2))(s) },
      { id: 'no', label: 'No invertir', detail: () => 'Tu amigo lo entiende… más o menos (contactos −2).' },
    ],
    fallback: 'no',
    apply: (s, d, choice, g) => {
      if (choice === 'no') {
        attr(s, 'network', -2);
        return 'Le dijiste que no. La relación quedó un poco fría.';
      }
      const amount = choice === 'todo' ? num(d, 'amount') : roundCents(num(d, 'amount') / 2);
      if (!spend(s, amount, `Inversión en la startup de ${str(d, 'friend')}`)) return 'No alcanzó el dinero: no se hizo la inversión.';
      attr(s, 'network', 2);
      schedule(s, d, choice, randInt(g, 240, 600), { invested: amount });
      return `Invertiste ${money(amount)}. Habrá noticias en uno o dos años.`;
    },
    resolve: (s, o, g) => {
      const inv = num(o, 'invested');
      const roll = nextRandom(g);
      let text: string;
      if (roll < 0.22) {
        const back = roundCents(inv * randRange(g, 3.5, 9));
        earn(s, back, `Venta de tu parte en la startup de ${str(o, 'friend')}`);
        text = `¡La startup de ${str(o, 'friend')} fue comprada! Cobrás ${money(back)} por tus ${money(inv)}.`;
        addLog(s, 'income', '🚀', text, back, 'logros');
      } else if (roll < 0.52) {
        const back = roundCents(inv * randRange(g, 0.35, 1.05));
        earn(s, back, `Recupero parcial de la startup de ${str(o, 'friend')}`);
        text = `La startup de ${str(o, 'friend')} vendió sus activos: recuperás ${money(back)} de ${money(inv)}.`;
        addLog(s, 'income', '🤝', text, back);
      } else {
        text = `La startup de ${str(o, 'friend')} cerró. Perdiste lo invertido (${money(inv)}).`;
        addLog(s, 'warning', '📉', text);
      }
      chronicle(s, 'dilema', 'rocket', 'El desenlace de la startup', text);
    },
  },
  {
    id: 'ascenso', icon: 'career', weight: 2, cooldown: 500,
    eligible: (s) => !!s.career.job && s.career.job.monthsInRole >= 6 && s.career.job.performance >= 55,
    create: (s, g) => ({ params: { salary: s.career.job!.salary, city: pick(g, ['la planta del norte', 'la sucursal de la costa', 'la oficina regional']) }, days: 12 }),
    title: () => 'Te ofrecen un ascenso… con mudanza',
    body: (_s, d) => `Tu jefe te propone dirigir ${str(d, 'city')}: más sueldo y más horas. La mudanza cuesta medio sueldo.`,
    options: [
      { id: 'aceptar', label: 'Aceptar', detail: (_s, d) => `Sueldo +16 % (${money(roundCents(num(d, 'salary') * 1.16))}/mes), estrés +10, mudanza ${money(roundCents(num(d, 'salary') / 2))}.`, blocked: (s, d) => cantPay(roundCents(num(d, 'salary') / 2))(s) },
      { id: 'rechazar', label: 'Rechazar', detail: () => 'Seguís como estás. Tu jefe toma nota (desempeño −3).' },
    ],
    fallback: 'rechazar',
    apply: (s, _d, choice) => {
      const job = s.career.job;
      if (!job) return 'Ya no tenés ese empleo.';
      if (choice === 'aceptar') {
        const cost = roundCents(job.salary / 2);
        if (!spend(s, cost, 'Mudanza por ascenso', 'housing')) return 'No alcanzó para la mudanza: el ascenso se lo dieron a otra persona.';
        job.salary = roundCents(job.salary * 1.16);
        attr(s, 'stress', 10);
        s.career.careerPoints += 150;
        s.career.promotions++;
        return `Aceptaste. Nuevo sueldo: ${money(job.salary)}/mes.`;
      }
      job.performance = clamp(job.performance - 3, 0, 100);
      return 'Rechazaste el ascenso.';
    },
  },
  {
    id: 'headhunter', icon: 'phone', weight: 2, cooldown: 360,
    eligible: (s) => !!s.career.job && s.career.job.monthsInRole >= 4,
    create: (_s, g) => ({ params: { firm: pick(g, ['Talento Andino', 'Búsquedas Ejecutivas Sur', 'Selecta Consultores']) }, days: 8 }),
    title: () => 'Una consultora quiere llevarte a otra empresa',
    body: (_s, d) => `${str(d, 'firm')} te ofrece un puesto similar con un 20 % más. Podés usar la oferta para negociar con tu jefe, aunque no siempre sale bien.`,
    options: [
      { id: 'negociar', label: 'Usarla para negociar', detail: () => 'Con buen desempeño, probable aumento del 10 %. Si sale mal, tu jefe se enoja.' },
      { id: 'ignorar', label: 'Ignorarla', detail: () => 'Nada cambia.' },
    ],
    fallback: 'ignorar',
    apply: (s, _d, choice, g) => {
      const job = s.career.job;
      if (!job || choice === 'ignorar') return 'La dejaste pasar.';
      const p = clamp(0.25 + job.performance / 120 + s.skills.negotiation.level / 200, 0.2, 0.9);
      if (chance(g, p)) {
        job.salary = roundCents(job.salary * 1.1);
        return `Tu jefe igualó parte de la oferta: +10 % (ahora ${money(job.salary)}/mes).`;
      }
      job.performance = clamp(job.performance - 10, 0, 100);
      attr(s, 'stress', 4);
      return 'A tu jefe no le gustó la presión: desempeño −10.';
    },
  },
  {
    id: 'donacion', icon: 'gift', weight: 2, cooldown: 300,
    eligible: (s) => balanceSheet(s).netWorth >= usd(40_000 * pi(s)),
    create: (s, g) => {
      const nw = balanceSheet(s).netWorth;
      const amount = roundCents(clamp(nw * 0.005, usd(500 * pi(s)), usd(3_000_000 * pi(s))) / 10000) * 10000;
      const cause = pick(g, ['un hospital de niños', 'becas para estudiantes sin recursos', 'reconstruir una escuela inundada', 'un comedor comunitario', 'investigación contra el cáncer']);
      return { params: { amount, cause }, days: 12 };
    },
    title: (_s, d) => `Te piden una donación para ${str(d, 'cause')}`,
    body: (s, d) => `Los organizadores esperan ${money(num(d, 'amount'))}. ${s.saga.ranking.player.city !== null ? `Sos de las fortunas de ${cityName(playerCity(s))}: la prensa va a mirar qué hacés.` : 'Es un gesto que la gente recuerda.'}`,
    options: [
      { id: 'donar', label: 'Donar lo que piden', detail: (_s, d) => `${money(num(d, 'amount'))}. Reputación +4, contactos +1.`, blocked: (s, d) => cantPay(num(d, 'amount'))(s) },
      { id: 'poco', label: 'Donar una parte', detail: (_s, d) => `${money(roundCents(num(d, 'amount') / 5))}. Reputación +1.`, blocked: (s, d) => cantPay(roundCents(num(d, 'amount') / 5))(s) },
      { id: 'no', label: 'No donar', detail: (s) => (s.saga.ranking.player.city !== null && s.saga.ranking.player.city <= 10 ? 'La prensa lo nota (reputación −2).' : 'Sin costo.') },
    ],
    fallback: 'no',
    apply: (s, d, choice) => {
      if (choice === 'no') {
        if (s.saga.ranking.player.city !== null && s.saga.ranking.player.city <= 10) attr(s, 'reputation', -2);
        return 'No donaste.';
      }
      const amount = choice === 'donar' ? num(d, 'amount') : roundCents(num(d, 'amount') / 5);
      if (!spend(s, amount, `Donación: ${str(d, 'cause')}`)) return 'No alcanzó el dinero para donar.';
      s.saga.stats.donated += amount;
      attr(s, 'reputation', choice === 'donar' ? 4 : 1);
      if (choice === 'donar') attr(s, 'network', 1);
      return `Donaste ${money(amount)} para ${str(d, 'cause')}.`;
    },
  },
  {
    id: 'prestamo_familiar', icon: 'deal', weight: 2, cooldown: 420,
    eligible: (s) => spendable(s) >= usd(2000 * pi(s)),
    create: (s, g) => {
      const amount = roundCents(clamp(spendable(s) * randRange(g, 0.04, 0.12), usd(400 * pi(s)), usd(25_000 * pi(s))) / 10000) * 10000;
      return { params: { amount, who: pick(g, ['Tu primo', 'Tu hermana', 'Un tío', 'Tu mejor amigo']), why: pick(g, ['para pagar una deuda con la tarjeta', 'para arreglar el techo de su casa', 'para no cerrar su pequeño negocio', 'por una operación']) }, days: 7 };
    },
    title: (_s, d) => `${str(d, 'who')} te pide dinero prestado`,
    body: (_s, d) => `Necesita ${money(num(d, 'amount'))} ${str(d, 'why')}. Promete devolverlo en unos meses.`,
    options: [
      { id: 'prestar', label: 'Prestarle', detail: (_s, d) => `${money(num(d, 'amount'))}. Lo más probable es que te lo devuelva… pero no es seguro.`, blocked: (s, d) => cantPay(num(d, 'amount'))(s) },
      { id: 'regalar', label: 'Regalárselo', detail: () => 'No esperás nada a cambio. Contactos +3, estrés −3.', blocked: (s, d) => cantPay(num(d, 'amount'))(s) },
      { id: 'no', label: 'Decir que no', detail: () => 'Te sentís mal (estrés +3, contactos −1).' },
    ],
    fallback: 'no',
    apply: (s, d, choice, g) => {
      const amount = num(d, 'amount');
      if (choice === 'no') {
        attr(s, 'stress', 3);
        attr(s, 'network', -1);
        return 'Le dijiste que no.';
      }
      if (!spend(s, amount, `${choice === 'prestar' ? 'Préstamo' : 'Regalo'} a ${str(d, 'who').toLowerCase()}`)) return 'No alcanzó el dinero.';
      if (choice === 'regalar') {
        attr(s, 'network', 3);
        attr(s, 'stress', -3);
        return `Le diste ${money(amount)}. Te lo agradeció mucho.`;
      }
      schedule(s, d, choice, randInt(g, 90, 300));
      return `Le prestaste ${money(amount)}.`;
    },
    resolve: (s, o, g) => {
      const amount = num(o, 'amount');
      if (chance(g, 0.68)) {
        earn(s, amount, `Devolución del préstamo a ${str(o, 'who').toLowerCase()}`);
        attr(s, 'network', 2);
        addLog(s, 'income', '🤝', `${str(o, 'who')} te devolvió los ${money(amount)} que le prestaste.`, amount);
      } else {
        attr(s, 'stress', 2);
        addLog(s, 'warning', '💸', `${str(o, 'who')} no puede devolverte los ${money(amount)}. Lo das por perdido.`);
      }
    },
  },
  {
    id: 'entrevista', icon: 'megaphone', weight: 2, cooldown: 300,
    eligible: (s) => s.progression.stage >= 5 || s.saga.ranking.player.city !== null,
    create: (_s, g) => ({ params: { outlet: pick(g, ['Revista Fortuna', 'Diario Económico de Valdoria', 'el programa «Negocios en Hora»']) }, days: 7 }),
    title: (_s, d) => `${str(d, 'outlet')} quiere entrevistarte`,
    body: (s) => `Te preguntarían cómo hiciste tu fortuna${s.legal.heat > 40 ? ' y quizás por algunos rumores sobre tus negocios' : ''}.`,
    options: [
      { id: 'aceptar', label: 'Dar la entrevista', detail: (s) => `Reputación +4, contactos +3, estrés +3.${s.legal.heat > 40 ? ' Con tanta sospecha encima, puede salir mal.' : ''}` },
      { id: 'rechazar', label: 'Rechazarla', detail: () => 'Sin cambios.' },
    ],
    fallback: 'rechazar',
    apply: (s, _d, choice, g) => {
      if (choice === 'rechazar') return 'Preferiste el perfil bajo.';
      attr(s, 'stress', 3);
      if (s.legal.heat > 40 && chance(g, 0.35)) {
        attr(s, 'reputation', -8);
        s.legal.heat = clamp(s.legal.heat + 5, 0, 100);
        return 'La entrevista salió mal: te preguntaron por tus negocios dudosos (reputación −8, sospecha +5).';
      }
      attr(s, 'reputation', 4);
      attr(s, 'network', 3);
      return 'La entrevista salió muy bien: reputación +4, contactos +3.';
    },
  },
  {
    id: 'gala', icon: 'sparkles', weight: 1, cooldown: 360,
    eligible: (s) => s.progression.stage >= 6,
    create: (s) => ({ params: { cost: roundCents(Math.max(usd(2000 * pi(s)), balanceSheet(s).netWorth * 0.0005) / 10000) * 10000 }, days: 10 }),
    title: () => 'Invitación a la gala anual de empresarios',
    body: (_s, d) => `La entrada y el traje cuestan ${money(num(d, 'cost'))}. Van inversores, banqueros y los dueños de los grupos rivales.`,
    options: [
      { id: 'ir', label: 'Ir', detail: () => 'Contactos +6, reputación +2, estrés +2. A veces sale algo más de ahí.', blocked: (s, d) => cantPay(num(d, 'cost'))(s) },
      { id: 'no', label: 'No ir', detail: () => 'Te ahorrás la noche.' },
    ],
    fallback: 'no',
    apply: (s, d, choice, g) => {
      if (choice === 'no') return 'No fuiste a la gala.';
      if (!spend(s, num(d, 'cost'), 'Gala anual de empresarios', 'leisure')) return 'No alcanzó el dinero.';
      attr(s, 'network', 6);
      attr(s, 'reputation', 2);
      attr(s, 'stress', 2);
      const r = s.world.rivals.length ? pick(g, s.world.rivals) : undefined;
      if (r && (r.attitude ?? 0) > 25 && chance(g, 0.5)) {
        rememberRival(s, r, -15, 'Charlaron en la gala y bajó la tensión');
        return `Fuiste a la gala. Charlaste con la gente de ${r.name} y la tensión bajó un poco.`;
      }
      return 'Fuiste a la gala: contactos +6, reputación +2.';
    },
  },
  {
    id: 'error_empleado', icon: 'alert', weight: 2, cooldown: 240,
    eligible: (s) => myCompanies(s).some((c) => c.employees.length >= 3),
    create: (s, g) => {
      const co = pick(g, myCompanies(s).filter((c) => c.employees.length >= 3));
      const e = pick(g, co.employees);
      const cost = roundCents(randRange(g, 600, 2500) * pi(s) * 100);
      return { params: { companyId: co.id, employeeId: e.id, name: e.name, company: co.name, cost }, days: 6 };
    },
    title: (_s, d) => `${str(d, 'name')} cometió un error caro en ${str(d, 'company')}`,
    body: () => 'Un pedido mal cargado hizo perder a un cliente. El equipo espera ver cómo reaccionás.',
    options: [
      { id: 'capacitar', label: 'Pagarle una capacitación', detail: (_s, d) => `La empresa paga ${money(num(d, 'cost'))}. Su habilidad sube y el equipo lo valora.`, blocked: (s, d) => ((companyOf(s, d)?.ledger.balances.cash ?? 0) < num(d, 'cost') ? 'La empresa no tiene caja suficiente' : null) },
      { id: 'perdonar', label: 'Dejarlo pasar', detail: () => 'Moral del equipo +4. Puede volver a pasar.' },
      { id: 'despedir', label: 'Despedirlo', detail: () => 'Mensaje firme, pero el resto del equipo se asusta (moral −6).' },
    ],
    fallback: 'perdonar',
    apply: (s, d, choice, g) => {
      const co = companyOf(s, d);
      const e = co?.employees.find((x) => x.id === num(d, 'employeeId'));
      if (!co || !e) return 'Ya no trabaja en la empresa.';
      if (choice === 'capacitar') {
        if (!companyCost(co, num(d, 'cost'), `Capacitación de ${e.name}`, 'training', s.day)) return 'La empresa no tenía caja: no se hizo.';
        e.skill = clamp(e.skill + 8, 0, 100);
        for (const x of co.employees) x.morale = clamp(x.morale + 3, 0, 100);
        return `${e.name} hizo la capacitación (habilidad +8).`;
      }
      if (choice === 'despedir') {
        co.employees = co.employees.filter((x) => x !== e);
        for (const x of co.employees) x.morale = clamp(x.morale - 6, 0, 100);
        return `Despediste a ${e.name}.`;
      }
      for (const x of co.employees) x.morale = clamp(x.morale + 4, 0, 100);
      if (chance(g, 0.25)) schedule(s, d, choice, randInt(g, 30, 90));
      return 'Lo dejaste pasar. El equipo lo agradece.';
    },
    resolve: (s, o) => {
      const co = s.companies.find((c) => c.id === num(o, 'companyId') && isOpen(c));
      if (!co) return;
      const cost = Math.min(num(o, 'cost'), co.ledger.balances.cash);
      if (companyCost(co, cost, `Nuevo error de ${str(o, 'name')}`, 'admin', s.day) && cost > 0) addLog(s, 'warning', '⚠️', `${str(o, 'name')} volvió a equivocarse en ${co.name}: costó ${money(cost)}.`, cost);
    },
  },
  {
    id: 'huelga', icon: 'siren', weight: 2, cooldown: 420,
    eligible: (s) => myCompanies(s).some((c) => c.employees.length >= 8),
    create: (s, g) => {
      const co = pick(g, myCompanies(s).filter((c) => c.employees.length >= 8));
      return { params: { companyId: co.id, company: co.name, payroll: co.employees.reduce((a, e) => a + e.wage, 0) }, days: 10 };
    },
    title: (_s, d) => `El personal de ${str(d, 'company')} pide un 8 % de aumento`,
    body: (_s, d) => `La nómina es de ${money(num(d, 'payroll'))}/mes. Si no hay acuerdo, amenazan con parar una semana.`,
    options: [
      { id: 'aceptar', label: 'Aceptar el 8 %', detail: (_s, d) => `Cuesta ${money(roundCents(num(d, 'payroll') * 0.08))} más por mes. Moral +10.` },
      { id: 'negociar', label: 'Ofrecer un 4 %', detail: () => 'Mitad de costo. Probable acuerdo; a veces paran igual.' },
      { id: 'rechazar', label: 'Rechazar', detail: () => 'Sin costo fijo, pero lo más probable es una semana sin ventas y moral −10.' },
    ],
    fallback: 'rechazar',
    apply: (s, d, choice, g) => {
      const co = companyOf(s, d);
      if (!co) return 'La empresa ya no opera.';
      const raise = choice === 'aceptar' ? 0.08 : choice === 'negociar' ? 0.04 : 0;
      for (const e of co.employees) {
        e.wage = roundCents(e.wage * (1 + raise));
        e.morale = clamp(e.morale + (choice === 'aceptar' ? 10 : choice === 'negociar' ? 2 : -10), 0, 100);
      }
      const strikeP = choice === 'aceptar' ? 0 : choice === 'negociar' ? 0.25 : 0.6;
      if (chance(g, strikeP)) {
        const days = randInt(g, 5, 8);
        co.suspendedUntil = Math.max(co.suspendedUntil ?? 0, s.day + days);
        return `Hubo paro: ${co.name} no vende durante ${days} días (los costos fijos siguen).`;
      }
      return raise ? `Acuerdo cerrado: +${fmtPct(raise, 0)} para todo el personal.` : 'No hubo paro esta vez, pero el clima quedó tenso.';
    },
  },
  {
    id: 'despidos_crisis', icon: 'trendDown', weight: 4, cooldown: 360,
    eligible: (s) => s.macro.phase === 'recesion' && myCompanies(s).some((c) => c.employees.length >= 4),
    create: (s, g) => {
      const co = pick(g, myCompanies(s).filter((c) => c.employees.length >= 4));
      return { params: { companyId: co.id, company: co.name, n: Math.max(1, Math.round(co.employees.length * 0.25)) }, days: 14 };
    },
    title: (_s, d) => `La recesión golpea a ${str(d, 'company')}`,
    body: (_s, d) => `Las ventas cayeron. Tu gerente propone despedir a ${num(d, 'n')} persona(s) para aguantar.`,
    options: [
      { id: 'recortar', label: 'Despedir', detail: (_s, d) => `Bajás la nómina (${num(d, 'n')} menos), pero el resto queda con miedo (moral −15).` },
      { id: 'mantener', label: 'No despedir a nadie', detail: () => 'Más costos durante la crisis, equipo leal (moral +10) y reputación +2.' },
    ],
    fallback: 'recortar',
    apply: (s, d, choice) => {
      const co = companyOf(s, d);
      if (!co) return 'La empresa ya no opera.';
      if (choice === 'recortar') {
        const out = [...co.employees].sort((a, b) => a.skill - b.skill).slice(0, num(d, 'n'));
        co.employees = co.employees.filter((e) => !out.includes(e));
        for (const e of co.employees) e.morale = clamp(e.morale - 15, 0, 100);
        return `Despediste a ${out.length} persona(s) en ${co.name}.`;
      }
      for (const e of co.employees) e.morale = clamp(e.morale + 10, 0, 100);
      attr(s, 'reputation', 2);
      chronicle(s, 'dilema', 'shield', 'Nadie se queda sin trabajo', `En plena recesión decidiste no despedir a nadie en ${co.name}.`);
      return 'Decidiste no despedir a nadie. El equipo lo va a recordar.';
    },
  },
  {
    id: 'tregua', icon: 'deal', weight: 3, cooldown: 720,
    eligible: (s) => s.world.rivals.some((r) => (r.attitude ?? 0) >= 35 && !r.truce && myCompanies(s).some((c) => r.sectors.includes(c.sector))),
    create: (s, g) => {
      const pool = s.world.rivals.filter((r) => (r.attitude ?? 0) >= 35 && !r.truce && myCompanies(s).some((c) => r.sectors.includes(c.sector)));
      const r = pick(g, pool);
      const co = myCompanies(s).find((c) => r.sectors.includes(c.sector))!;
      return { params: { rivalId: r.id, rival: r.name, sector: co.sector, sectorName: SECTOR_BY_ID[co.sector].name }, days: 12 };
    },
    title: (_s, d) => `${str(d, 'rival')} propone una tregua`,
    body: (_s, d) => `Te ofrecen dejar de atacarte por dos años si no abrís ni comprás empresas nuevas en ${str(d, 'sectorName').toLowerCase()}. Si rompés el pacto, no lo van a olvidar.`,
    options: [
      { id: 'aceptar', label: 'Aceptar la tregua', detail: () => 'Dos años sin competidores nuevos, exclusividades ni intentos de llevarse a tu gente de parte de ellos.' },
      { id: 'rechazar', label: 'Rechazarla', detail: () => 'Seguís libre, pero el grupo se enoja más.' },
    ],
    fallback: 'rechazar',
    apply: (s, d, choice) => {
      const r = s.world.rivals.find((x) => x.id === str(d, 'rivalId'));
      if (!r) return 'El grupo ya no existe.';
      if (choice === 'aceptar') {
        r.truce = { sector: str(d, 'sector') as never, from: s.day, until: s.day + 730 };
        rememberRival(s, r, -40, 'Firmaron una tregua');
        chronicle(s, 'rival', 'deal', `Tregua con ${r.name}`, `Hasta el ${formatDate(s.day + 730)}: ellos no te atacan y vos no entrás con empresas nuevas en ${str(d, 'sectorName').toLowerCase()}.`);
        return `Tregua firmada con ${r.name} hasta el ${formatDate(s.day + 730)}.`;
      }
      rememberRival(s, r, 10, 'Rechazaste su tregua');
      return `Rechazaste la tregua. ${r.name} no lo tomó bien.`;
    },
  },
  {
    id: 'remate', icon: 'realestate', weight: 2, cooldown: 300,
    eligible: (s) => spendable(s) >= usd(15_000 * pi(s)),
    create: (s, g) => {
      const budget = spendable(s);
      const z = pick(g, ZONES);
      const p = withSagaRng(s, () => newProperty(s, z.id, chance(g, 0.5) ? 'vivienda' : 'local'));
      const ask = roundCents((p.appraisal * randRange(g, 0.7, 0.8)) / 10000) * 10000;
      if (ask > budget * 1.6 || ask <= 0) return null;
      const listingId = s.meta.nextId++;
      s.realEstate.listings.push({ id: listingId, property: p, askPrice: ask, expiresDay: s.day + 12, negotiated: true, note: `Remate judicial: se vende por debajo de la tasación (${money(p.appraisal)}). Puede tener defectos ocultos: conviene inspeccionarlo.` });
      return { params: { listingId, name: p.name, ask, appraisal: p.appraisal, zone: z.name }, days: 11 };
    },
    title: (_s, d) => `Remate judicial: ${str(d, 'name')}`,
    body: (_s, d) => `En ${str(d, 'zone')}. Base ${money(num(d, 'ask'))}, tasación ${money(num(d, 'appraisal'))}. Hay que decidir rápido: el remate cierra en pocos días y los rivales también miran.`,
    options: [
      { id: 'ver', label: 'Lo voy a mirar', detail: () => 'Queda en tu agenda: comprálo desde Invertir → Inmuebles antes de que cierre.' },
      { id: 'pasar', label: 'Pasar', detail: () => 'No te interesa.' },
    ],
    fallback: 'pasar',
    apply: (s, d, choice) => {
      if (choice === 'pasar') {
        s.realEstate.listings = s.realEstate.listings.filter((l) => l.id !== num(d, 'listingId'));
        return 'Dejaste pasar el remate.';
      }
      return `El remate de ${str(d, 'name')} está en Invertir → Inmuebles hasta el ${formatDate(s.day + 10)}.`;
    },
  },
  {
    id: 'gran_oportunidad', icon: 'telescope', weight: 2, cooldown: 420,
    eligible: (s) => s.progression.stage >= 7 && spendable(s) >= usd(400_000 * pi(s)),
    create: (s, g) => {
      const amount = roundCents(clamp(spendable(s) * randRange(g, 0.15, 0.3), usd(250_000 * pi(s)), usd(500_000_000 * pi(s))) / 1_000_000) * 1_000_000;
      const what = pick(g, ['una cadena hotelera extranjera que sale de la región', 'la concesión del nuevo puerto seco', 'el 20 % de una minera en problemas', 'una red de clínicas que se reestructura', 'los derechos de una autopista de peaje']);
      const r = s.world.rivals.length ? pick(g, s.world.rivals) : undefined;
      return { params: { amount, what, rival: r?.name ?? '', rivalId: r?.id ?? '' }, days: 15 };
    },
    title: (_s, d) => `Gran oportunidad: ${str(d, 'what')}`,
    body: (_s, d) => `Hace falta poner ${money(num(d, 'amount'))} ahora. Puede rendir mucho en dos o tres años… o salir mal.${str(d, 'rival') ? ` ${str(d, 'rival')} también está mirando.` : ''}`,
    options: [
      { id: 'entrar', label: 'Entrar con todo', detail: (_s, d) => `Ponés ${money(num(d, 'amount'))}. Se contabiliza como gasto hasta el desenlace. Si no entrás vos, entra el rival.`, blocked: (s, d) => cantPay(num(d, 'amount'))(s) },
      { id: 'socio', label: 'Entrar con un socio', detail: (_s, d) => `Ponés ${money(roundCents(num(d, 'amount') / 2))} y compartís la mitad del resultado.`, blocked: (s, d) => cantPay(roundCents(num(d, 'amount') / 2))(s) },
      { id: 'pasar', label: 'Dejarla pasar', detail: () => 'Sin riesgo. Si hay un rival interesado, se queda con ella.' },
    ],
    fallback: 'pasar',
    apply: (s, d, choice, g) => {
      const r = s.world.rivals.find((x) => x.id === str(d, 'rivalId'));
      if (choice === 'pasar') {
        if (r) {
          r.capital -= roundCents(num(d, 'amount') / 4);
          r.assetsValue = (r.assetsValue ?? 0) + roundCents(num(d, 'amount') / 4);
          r.moves.push({ day: s.day, text: `Se quedó con ${str(d, 'what')}` });
        }
        return r ? `${r.name} se quedó con la oportunidad.` : 'La dejaste pasar.';
      }
      const amount = choice === 'entrar' ? num(d, 'amount') : roundCents(num(d, 'amount') / 2);
      if (!spend(s, amount, `Inversión: ${str(d, 'what')}`)) return 'No alcanzó el dinero.';
      if (r) rememberRival(s, r, 8, `Le ganaste ${str(d, 'what')}`);
      schedule(s, d, choice, randInt(g, 540, 1080), { invested: amount });
      return `Entraste con ${money(amount)}. El resultado se sabrá en dos o tres años.`;
    },
    resolve: (s, o, g) => {
      const inv = num(o, 'invested');
      // Valor esperado positivo (≈ +35 %), con una cola de pérdida real.
      const roll = nextRandom(g);
      const mult = roll < 0.18 ? randRange(g, 0, 0.4) : roll < 0.45 ? randRange(g, 0.8, 1.2) : roll < 0.85 ? randRange(g, 1.4, 2.0) : randRange(g, 2.2, 3.5);
      const back = roundCents(inv * mult);
      earn(s, back, `Desenlace: ${str(o, 'what')}`);
      const text = mult >= 1 ? `${str(o, 'what')}: recuperás ${money(back)} por los ${money(inv)} que pusiste (×${mult.toFixed(1)}).` : `${str(o, 'what')} salió mal: recuperás solo ${money(back)} de ${money(inv)}.`;
      addLog(s, mult >= 1 ? 'income' : 'warning', mult >= 1 ? '🔭' : '📉', text, back, 'logros');
      chronicle(s, 'dilema', 'telescope', mult >= 1 ? 'La gran apuesta salió bien' : 'La gran apuesta salió mal', text);
    },
  },
  {
    id: 'herencia_tio', icon: 'key', weight: 1, cooldown: 99999,
    eligible: (s) => s.day > 365 * 2,
    create: (s, g) => ({ params: { value: roundCents(usd(randRange(g, 8000, 30000) * pi(s)) / 10000) * 10000, what: pick(g, ['su viejo taller mecánico', 'un local en el pueblo', 'una colección de herramientas y un galpón']) }, days: 20 }),
    title: () => 'Tu tío abuelo te dejó una herencia',
    body: (_s, d) => `Te deja ${str(d, 'what')}, que vale unos ${money(num(d, 'value'))}. La familia opina que deberías donarlo al pueblo.`,
    options: [
      { id: 'vender', label: 'Venderlo', detail: (_s, d) => `Cobrás ${money(num(d, 'value'))}.` },
      { id: 'donar', label: 'Donarlo al pueblo', detail: () => 'Reputación +4, contactos +2. Cuenta para la meta de filántropo.' },
    ],
    fallback: 'vender',
    apply: (s, d, choice) => {
      const v = num(d, 'value');
      if (choice === 'vender') {
        earn(s, v, `Venta de la herencia (${str(d, 'what')})`);
        return `Vendiste la herencia por ${money(v)}.`;
      }
      s.saga.stats.donated += v;
      attr(s, 'reputation', 4);
      attr(s, 'network', 2);
      chronicle(s, 'vida', 'gift', 'Una herencia para el pueblo', `Donaste ${str(d, 'what')} (unos ${money(v)}).`);
      return 'Donaste la herencia al pueblo. Te lo agradecen.';
    },
  },
];

export const TEMPLATE_BY_ID: Record<string, Template> = Object.fromEntries(TEMPLATES.map((t) => [t.id, t]));

export function emptyDilemmas(): GameState['saga']['dilemmas'] {
  return { open: [], past: [], pending: [], nextDay: FIRST_DILEMMA_DAY, lastByTemplate: {} };
}

// ------------------------------------------------------------------ vista

export interface DilemmaView {
  id: number;
  icon: string;
  title: string;
  body: string;
  deadline: number;
  options: Array<{ id: string; label: string; detail: string; blocked: string | null; fallback: boolean }>;
}

export function dilemmaView(s: GameState, d: Dilemma): DilemmaView | null {
  const t = TEMPLATE_BY_ID[d.template];
  if (!t) return null;
  return {
    id: d.id, icon: t.icon, title: t.title(s, d), body: t.body(s, d), deadline: d.deadline,
    options: t.options.map((o) => ({ id: o.id, label: o.label, detail: o.detail(s, d), blocked: o.blocked?.(s, d) ?? null, fallback: o.id === t.fallback })),
  };
}

// ------------------------------------------------------------------ acciones y ciclo

function finish(s: GameState, d: Dilemma, choice: string, expired: boolean): string {
  const t = TEMPLATE_BY_ID[d.template];
  const outcome = t.apply(s, d, choice, srng(s));
  d.status = expired ? 'vencido' : 'resuelto';
  d.choice = choice;
  d.outcome = expired ? `No decidiste a tiempo. ${outcome}` : outcome;
  const dl = s.saga.dilemmas;
  dl.open = dl.open.filter((x) => x !== d);
  dl.past.push(d);
  if (dl.past.length > 40) dl.past.splice(0, dl.past.length - 40);
  if (!expired) s.saga.stats.decisions++;
  const label = t.options.find((o) => o.id === choice)?.label ?? choice;
  chronicle(s, 'dilema', t.icon, t.title(s, d), `${expired ? 'Sin respuesta' : `Decidiste: ${label.toLowerCase()}`}. ${outcome}`);
  return d.outcome;
}

export function decide(s: GameState, id: number, choice: string): ActionResult {
  const d = s.saga.dilemmas.open.find((x) => x.id === id);
  if (!d) return FAIL('Esa decisión ya no está pendiente.');
  const t = TEMPLATE_BY_ID[d.template];
  const opt = t?.options.find((o) => o.id === choice);
  if (!t || !opt) return FAIL('Opción inválida.');
  const blocked = opt.blocked?.(s, d);
  if (blocked) return FAIL(blocked);
  const text = finish(s, d, choice, false);
  return OK(text);
}

/** Ciclo diario: vencimientos, desenlaces y (a veces) un dilema nuevo. */
export function dilemmasDay(s: GameState): void {
  const dl = s.saga.dilemmas;
  for (const d of [...dl.open]) {
    if (d.deadline >= s.day) continue;
    const t = TEMPLATE_BY_ID[d.template];
    if (!t) {
      dl.open = dl.open.filter((x) => x !== d);
      continue;
    }
    const text = finish(s, d, t.fallback, true);
    addLog(s, 'info', '⌛', `Venció una decisión: ${t.title(s, d)}. ${text}`);
  }
  const due = dl.pending.filter((o) => o.day <= s.day);
  if (due.length) {
    dl.pending = dl.pending.filter((o) => o.day > s.day);
    for (const o of due) TEMPLATE_BY_ID[o.template]?.resolve?.(s, o, srng(s));
  }
  if (s.legal.prison || s.day < dl.nextDay || dl.open.length >= MAX_OPEN) return;
  const g = srng(s);
  // Un dilema cada 5–10 semanas (en promedio); los primeros meses son más tranquilos.
  dl.nextDay = s.day + randInt(g, 35, 75);
  const pool = TEMPLATES.filter((t) => {
    if ((dl.lastByTemplate[t.id] ?? -99999) + t.cooldown > s.day) return false;
    if (dl.open.some((d) => d.template === t.id)) return false;
    try {
      return t.eligible(s);
    } catch {
      return false;
    }
  });
  if (!pool.length) return;
  const total = pool.reduce((a, t) => a + t.weight, 0);
  let x = nextRandom(g) * total;
  let t = pool[0];
  for (const c of pool) {
    x -= c.weight;
    if (x <= 0) {
      t = c;
      break;
    }
  }
  const made = t.create(s, g);
  if (!made) return;
  const d: Dilemma = { id: s.meta.nextId++, template: t.id, day: s.day, deadline: s.day + made.days, params: made.params, status: 'abierto' };
  dl.open.push(d);
  dl.lastByTemplate[t.id] = s.day;
  addLog(s, 'info', '🤔', `Decisión pendiente: ${t.title(s, d)}. Tenés hasta el ${formatDate(d.deadline)}.`, undefined, 'decisiones');
}

/** Pactos rotos: abrir o comprar una empresa en el sector de una tregua vigente. */
export function checkTruces(s: GameState): void {
  for (const r of s.world.rivals) {
    const t = r.truce;
    if (!t) continue;
    if (t.until < s.day) {
      r.truce = null;
      continue;
    }
    const broke = s.companies.some((c) => !c.npc && c.sector === t.sector && Math.max(c.foundedDay, c.acquiredDay ?? -1) > t.from);
    if (!broke) continue;
    r.truce = null;
    rememberRival(s, r, 60, 'Rompiste la tregua');
    attr(s, 'reputation', -5);
    addLog(s, 'danger', '⚔️', `Rompiste la tregua con ${r.name} al entrar en ${SECTOR_BY_ID[t.sector].name}. Te van a atacar con todo (reputación −5).`, undefined, 'ofertas');
    chronicle(s, 'rival', 'rivals', `Rompiste la tregua con ${r.name}`, 'Volvieron las hostilidades.');
  }
}
