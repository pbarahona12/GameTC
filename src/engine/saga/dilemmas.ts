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
import { ageOf, life, retire, succession, designatedHeir, RETIRE_AGE } from './life';
import { buyBackShares, marketCap } from './corporate';
import { setPrivateInsurance, insuranceCost, monthlyRecurring } from '../finance/budget';
import { valuation } from '../business/reports';
import { companyShareEstimate } from '../business/market';
import { fire } from '../business/staff';
import { revalue } from '../business/ownership';
import { LEGAL_FORM_BY_ID } from '../../content/sectors';
import { isAlly, nemesisOf, warsIn, registerWarDilemma } from './rivalry';
import type { RivalGroup } from '../world/types';

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
  /** Puede aparecer aunque falte para el próximo dilema (ayuda en una urgencia). */
  urgent?: boolean;
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

function companyCost(co: Company, amount: Cents, memo: string, account: 'training' | 'admin' | 'wages' | 'marketing' | 'professional_fees', day: number): boolean {
  if (amount <= 0) return true;
  if (co.ledger.balances.cash < amount) return false;
  coPost(co.ledger, { day, memo, cf: 'operating', tag: 'saga:dilema', lines: [{ account, debit: amount }, { account: 'cash', credit: amount }] });
  return true;
}

/** Rival que opera en el sector de una empresa (o cualquiera). */
function rivalFor(s: GameState, sector: string, g: RngHolder) {
  const pool = s.world.rivals.filter((r) => !r.acquired && r.sectors.includes(sector as never));
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
    id: 'changa', icon: 'career', weight: 5, cooldown: 120, urgent: true,
    eligible: (s) => !s.career.job && s.day >= 10 && s.day < 730 && spendable(s) < monthlyRecurring(s, true) * 1.2,
    create: (s, g) => ({ params: { pay: roundCents(usd(randRange(g, 520, 760) * pi(s)) / 100) * 100, who: randomName(g), what: pick(g, ['atender un puesto en la feria', 'ayudar en una mudanza grande', 'cubrir turnos en un depósito', 'repartir volantes y pedidos']) }, days: 5 }),
    title: () => 'Un trabajo temporal mientras buscás empleo',
    body: (_s, d) => `${str(d, 'who')} necesita a alguien para ${str(d, 'what')} durante tres semanas. Pagan ${money(num(d, 'pay'))} al terminar. Podés seguir postulándote igual.`,
    options: [
      { id: 'aceptar', label: 'Aceptar', detail: (_s, d) => `Cobrás ${money(num(d, 'pay'))} en 3 semanas. Estrés +5.` },
      { id: 'familia', label: 'Pedirle ayuda a tu familia', detail: (s) => `Te dan ${money(usd(300 * pi(s)))} (y te lo recuerdan en cada almuerzo). Estrés +3.` },
      { id: 'no', label: 'No, me enfoco en buscar empleo', detail: () => 'Sin ingresos extra.' },
    ],
    fallback: 'no',
    apply: (s, d, choice, g) => {
      if (choice === 'no') return 'Seguís buscando empleo.';
      if (choice === 'familia') {
        earn(s, usd(300 * pi(s)), 'Ayuda de tu familia');
        attr(s, 'stress', 3);
        return `Tu familia te ayudó con ${money(usd(300 * pi(s)))}.`;
      }
      attr(s, 'stress', 5);
      schedule(s, d, choice, 21 + randInt(g, 0, 2));
      return `Empezás mañana. Cobrás ${money(num(d, 'pay'))} en tres semanas.`;
    },
    resolve: (s, o) => {
      earn(s, num(o, 'pay'), `Trabajo temporal: ${str(o, 'what')}`);
      addLog(s, 'income', '💵', `Cobraste ${money(num(o, 'pay'))} por el trabajo temporal.`, num(o, 'pay'));
    },
  },
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
      const live = s.world.rivals.filter((x) => !x.acquired);
      const r = live.length ? pick(g, live) : undefined;
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
      { id: 'despedir', label: 'Despedirlo', detail: () => 'Mensaje firme: la empresa paga su indemnización y el resto del equipo se asusta (moral −6).' },
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
        const r = fire(s, co, e.id, true);
        for (const x of co.employees) x.morale = clamp(x.morale - 6, 0, 100);
        return r.ok ? `Despediste a ${e.name} (con su indemnización).` : r.error;
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
      { id: 'recortar', label: 'Despedir', detail: (_s, d) => `Bajás la nómina (${num(d, 'n')} menos) pagando sus indemnizaciones, pero el resto queda con miedo (moral −15).` },
      { id: 'mantener', label: 'No despedir a nadie', detail: () => 'Más costos durante la crisis, equipo leal (moral +10) y reputación +2.' },
    ],
    fallback: 'mantener',
    apply: (s, d, choice) => {
      const co = companyOf(s, d);
      if (!co) return 'La empresa ya no opera.';
      if (choice === 'recortar') {
        const out = [...co.employees].sort((a, b) => a.skill - b.skill).slice(0, num(d, 'n'));
        let fired = 0;
        for (const e of out) if (fire(s, co, e.id, true).ok) fired++;
        for (const e of co.employees) e.morale = clamp(e.morale - 15, 0, 100);
        return `Despediste a ${fired} persona(s) en ${co.name} (con sus indemnizaciones).`;
      }
      for (const e of co.employees) e.morale = clamp(e.morale + 10, 0, 100);
      attr(s, 'reputation', 2);
      chronicle(s, 'dilema', 'shield', 'Nadie se queda sin trabajo', `En plena recesión decidiste no despedir a nadie en ${co.name}.`);
      return 'Decidiste no despedir a nadie. El equipo lo va a recordar.';
    },
  },
  {
    id: 'tregua', icon: 'deal', weight: 3, cooldown: 720,
    eligible: (s) => s.world.rivals.some((r) => !r.acquired && (r.attitude ?? 0) >= 35 && !r.truce && myCompanies(s).some((c) => r.sectors.includes(c.sector))),
    create: (s, g) => {
      const pool = s.world.rivals.filter((r) => !r.acquired && (r.attitude ?? 0) >= 35 && !r.truce && myCompanies(s).some((c) => r.sectors.includes(c.sector)));
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
      { id: 'ver', label: 'Lo voy a mirar', detail: () => 'Queda en tu agenda: compralo desde Invertir → Inmuebles antes de que cierre.' },
      { id: 'pasar', label: 'Pasar', detail: () => 'No te interesa.' },
    ],
    fallback: 'pasar',
    apply: (s, d, choice) => {
      if (choice === 'pasar') {
        s.realEstate.listings = s.realEstate.listings.filter((l) => l.id !== num(d, 'listingId'));
        return 'Dejaste pasar el remate.';
      }
      const l = s.realEstate.listings.find((x) => x.id === num(d, 'listingId'));
      return l ? `El remate de ${str(d, 'name')} está en Invertir → Inmuebles hasta el ${formatDate(l.expiresDay)}.` : 'El remate ya cerró.';
    },
  },
  {
    id: 'gran_oportunidad', icon: 'telescope', weight: 2, cooldown: 420,
    eligible: (s) => s.progression.stage >= 7 && spendable(s) >= usd(400_000 * pi(s)),
    create: (s, g) => {
      const amount = roundCents(clamp(spendable(s) * randRange(g, 0.15, 0.3), usd(250_000 * pi(s)), usd(500_000_000 * pi(s))) / 1_000_000) * 1_000_000;
      const what = pick(g, ['una cadena hotelera extranjera que sale de la región', 'la concesión del nuevo puerto seco', 'el 20 % de una minera en problemas', 'una red de clínicas que se reestructura', 'los derechos de una autopista de peaje']);
      const live = s.world.rivals.filter((x) => !x.acquired);
      const r = live.length ? pick(g, live) : undefined;
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
    id: 'familia', icon: 'sparkles', weight: 3, cooldown: 1100,
    eligible: (s) => !life(s).partner && ageOf(s) >= 26 && ageOf(s) <= 42,
    create: (s, g) => ({ params: { partner: `${FIRST_NAMES[Math.floor(nextRandom(g) * FIRST_NAMES.length)]}`, cost: roundCents(usd(randRange(g, 3000, 9000) * pi(s)) / 10000) * 10000 }, days: 20 }),
    title: (_s, d) => `¿Formar una familia con ${str(d, 'partner')}?`,
    body: (_s, d) => `Llevan años juntos y ${str(d, 'partner')} quiere casarse. La boda cuesta unos ${money(num(d, 'cost'))}. Con los años pueden llegar hijos: cuestan, y también podrían heredar tu fortuna.`,
    options: [
      { id: 'casarse', label: 'Casarse', detail: (_s, d) => `Boda ${money(num(d, 'cost'))}. Estrés −6, contactos +3. Pueden llegar hijos.`, blocked: (s, d) => cantPay(num(d, 'cost'))(s) },
      { id: 'convivir', label: 'Convivir sin boda', detail: () => 'Sin gasto. Pueden llegar hijos igual.' },
      { id: 'no', label: 'Seguir solo', detail: () => 'Te enfocás en tu carrera y tus negocios.' },
    ],
    fallback: 'no',
    apply: (s, d, choice) => {
      const l = life(s);
      if (choice === 'no') return 'Seguís solo, enfocado en lo tuyo.';
      if (choice === 'casarse') {
        if (!spend(s, num(d, 'cost'), 'Boda', 'leisure')) return 'No alcanzó el dinero para la boda.';
        attr(s, 'stress', -6);
        attr(s, 'network', 3);
      }
      l.partner = str(d, 'partner');
      chronicle(s, 'vida', 'sparkles', choice === 'casarse' ? `Te casaste con ${l.partner}` : `Te fuiste a vivir con ${l.partner}`, 'Empieza tu familia.');
      return choice === 'casarse' ? `Te casaste con ${l.partner}.` : `Ahora vivís con ${l.partner}.`;
    },
  },
  {
    id: 'retiro', icon: 'sun', weight: 4, cooldown: 1095,
    eligible: (s) => ageOf(s) >= RETIRE_AGE + 3 && !life(s).retired,
    create: (s) => ({ params: { age: Math.floor(ageOf(s)), heir: designatedHeir(s)?.name ?? '' }, days: 30 }),
    title: (_s, d) => `Tenés ${num(d, 'age')} años: ¿es hora de pensar en el retiro?`,
    body: (s, d) => `${s.player.attributes.health < 60 ? 'Tu salud ya no es la de antes. ' : 'Muchos a tu edad empiezan a pensar en el retiro. '}Podés jubilarte (seguís dueño de todo), pasarle la posta a ${str(d, 'heir')} o seguir como siempre.`,
    options: [
      { id: 'jubilarse', label: 'Jubilarme', detail: () => 'Dejás el empleo (si tenés) y bajás el estrés. Tus negocios siguen. Sin empleo, tu reputación tiende a bajar.' },
      { id: 'posta', label: 'Pasar la posta', detail: (_s, d) => `${str(d, 'heir')} toma el control de la fortuna familiar. Se paga el impuesto a la herencia.` },
      { id: 'seguir', label: 'Seguir como siempre', detail: () => 'Desde los 50 la salud tiende a bajar y desde los 68 hay riesgo de fallecer.' },
    ],
    fallback: 'seguir',
    apply: (s, _d, choice) => {
      if (choice === 'jubilarse') {
        const r = retire(s);
        return r.ok ? r.message ?? 'Te jubilaste.' : r.error;
      }
      if (choice === 'posta') {
        const r = succession(s, designatedHeir(s).id, 'retiro');
        return r.ok ? r.message ?? 'Pasaste la posta.' : r.error;
      }
      return 'Seguís al frente de todo.';
    },
  },
  {
    id: 'vacaciones', icon: 'sun', weight: 2, cooldown: 300,
    eligible: (s) => s.player.attributes.stress >= 62 && spendable(s) >= usd(1500 * pi(s)),
    create: (s, g) => ({ params: { cost: roundCents(clamp(spendable(s) * 0.05, usd(800 * pi(s)), usd(60_000 * pi(s))) / 10000) * 10000, where: pick(g, ['la costa de Isla Coral', 'las montañas de Norvalia', 'un crucero por el sur']) }, days: 10 }),
    title: () => 'Estás agotado: ¿te tomás unas vacaciones?',
    body: (s, d) => `Tu estrés está en ${Math.round(s.player.attributes.stress)}/100. Dos semanas en ${str(d, 'where')} cuestan ${money(num(d, 'cost'))}.`,
    options: [
      { id: 'ir', label: 'Irme de vacaciones', detail: () => 'Estrés −20, salud +4.', blocked: (s, d) => cantPay(num(d, 'cost'))(s) },
      { id: 'seguir', label: 'Seguir trabajando', detail: () => 'Sin gasto, pero el estrés alto daña tu salud y tu desempeño.' },
    ],
    fallback: 'seguir',
    apply: (s, d, choice) => {
      if (choice === 'seguir') {
        attr(s, 'health', -2);
        return 'Seguiste trabajando. El cansancio se nota (salud −2).';
      }
      if (!spend(s, num(d, 'cost'), `Vacaciones en ${str(d, 'where')}`, 'leisure')) return 'No alcanzó el dinero.';
      attr(s, 'stress', -20);
      attr(s, 'health', 4);
      return `Volviste renovado de ${str(d, 'where')}.`;
    },
  },
  {
    id: 'seguro', icon: 'shield', weight: 1, cooldown: 900,
    eligible: (s) => !s.budget.privateInsurance && (s.player.attributes.health < 65 || ageOf(s) >= 45),
    create: () => ({ params: {}, days: 14 }),
    title: () => 'Un asesor te ofrece un seguro médico privado',
    body: (s) => `Cuesta ${money(insuranceCost(s))} por mes. Con tu ${ageOf(s) >= 45 ? 'edad' : 'salud actual'}, un imprevisto médico sin seguro puede salir caro.`,
    options: [
      { id: 'contratar', label: 'Contratarlo', detail: (s) => `${money(insuranceCost(s))}/mes. Cubre la mayor parte de los imprevistos médicos.` },
      { id: 'no', label: 'No por ahora', detail: () => 'Te ahorrás la cuota y asumís el riesgo.' },
    ],
    fallback: 'no',
    apply: (s, _d, choice) => {
      if (choice === 'no') return 'No contrataste el seguro.';
      const r = setPrivateInsurance(s, true);
      return r.ok ? 'Contrataste el seguro médico privado.' : r.error;
    },
  },
  {
    id: 'patrocinio', icon: 'megaphone', weight: 2, cooldown: 360,
    eligible: (s) => myCompanies(s).some((c) => c.ledger.balances.cash >= usd(5000 * pi(s))),
    create: (s, g) => {
      const co = pick(g, myCompanies(s).filter((c) => c.ledger.balances.cash >= usd(5000 * pi(s))));
      return { params: { companyId: co.id, company: co.name, cost: roundCents(clamp(co.ledger.balances.cash * 0.08, usd(1500 * pi(s)), usd(200_000 * pi(s))) / 10000) * 10000, team: pick(g, ['el club de fútbol del barrio', 'la maratón de la ciudad', 'el festival de música']) }, days: 12 };
    },
    title: (_s, d) => `${str(d, 'team')} busca un patrocinador`,
    body: (_s, d) => `Poner el nombre de ${str(d, 'company')} cuesta ${money(num(d, 'cost'))} (lo paga la empresa). Mucha gente lo va a ver.`,
    options: [
      { id: 'patrocinar', label: 'Patrocinar', detail: () => 'La empresa gana conocimiento de marca (+10) y reputación (+4).', blocked: (s, d) => ((companyOf(s, d)?.ledger.balances.cash ?? 0) < num(d, 'cost') ? 'La empresa no tiene caja suficiente' : null) },
      { id: 'no', label: 'No', detail: () => 'La empresa se ahorra el gasto.' },
    ],
    fallback: 'no',
    apply: (s, d, choice) => {
      const co = companyOf(s, d);
      if (!co || choice === 'no') return 'No patrocinaste.';
      if (!companyCost(co, num(d, 'cost'), `Patrocinio: ${str(d, 'team')}`, 'admin', s.day)) return 'La empresa no tenía caja.';
      co.awareness = clamp(co.awareness + 10, 0, 100);
      co.reputation = clamp(co.reputation + 4, 0, 100);
      return `${co.name} patrocina ${str(d, 'team')}: más gente la conoce.`;
    },
  },
  {
    id: 'premio', icon: 'medal', weight: 1, cooldown: 500,
    eligible: (s) => myCompanies(s).some((c) => c.history.length >= 6 && c.quality >= 55),
    create: (s, g) => {
      const co = pick(g, myCompanies(s).filter((c) => c.history.length >= 6 && c.quality >= 55));
      return { params: { companyId: co.id, company: co.name, fee: roundCents(usd(randRange(g, 800, 3000) * pi(s)) / 10000) * 10000 }, days: 10 };
    },
    title: (_s, d) => `${str(d, 'company')} está nominada a «Empresa del año»`,
    body: (_s, d) => `La inscripción y la presentación cuestan ${money(num(d, 'fee'))}. Si gana, es publicidad gratis por meses.`,
    options: [
      { id: 'participar', label: 'Participar', detail: (s, d) => `Chance de ganar según la calidad (${Math.round(companyOf(s, d)?.quality ?? 0)}) y la reputación de la empresa.`, blocked: (s, d) => ((companyOf(s, d)?.ledger.balances.cash ?? 0) < num(d, 'fee') ? 'La empresa no tiene caja suficiente' : null) },
      { id: 'no', label: 'No participar', detail: () => 'Sin gasto.' },
    ],
    fallback: 'no',
    apply: (s, d, choice, g) => {
      const co = companyOf(s, d);
      if (!co || choice === 'no') return 'No participaste.';
      if (!companyCost(co, num(d, 'fee'), 'Inscripción al premio «Empresa del año»', 'admin', s.day)) return 'La empresa no tenía caja.';
      const p = clamp((co.quality - 40) / 80 + (co.reputation - 40) / 150, 0.1, 0.75);
      if (chance(g, p)) {
        co.awareness = clamp(co.awareness + 15, 0, 100);
        co.reputation = clamp(co.reputation + 8, 0, 100);
        attr(s, 'reputation', 3);
        chronicle(s, 'empresa', 'medal', `${co.name}: Empresa del año`, 'Ganó el premio: más clientes la conocen y la eligen.');
        return `¡${co.name} ganó «Empresa del año»!`;
      }
      return `${co.name} no ganó esta vez, pero quedó entre las finalistas.`;
    },
  },
  {
    id: 'mentor', icon: 'education', weight: 1, cooldown: 700,
    eligible: (s) => s.progression.stage >= 6,
    create: (_s, g) => ({ params: { who: randomName(g) }, days: 14 }),
    title: (_s, d) => `${str(d, 'who')} te pide que seas su mentor`,
    body: () => 'Alguien que recién empieza a emprender admira tu historia y quiere aprender de vos. Te llevaría algunas horas por semana.',
    options: [
      { id: 'aceptar', label: 'Aceptar', detail: () => 'Estrés +3, contactos +5, reputación +2. Quizás algún día te ofrezca entrar en su empresa.' },
      { id: 'no', label: 'No tengo tiempo', detail: () => 'Sin cambios.' },
    ],
    fallback: 'no',
    apply: (s, _d, choice) => {
      if (choice === 'no') return 'Le dijiste que no tenías tiempo.';
      attr(s, 'stress', 3);
      attr(s, 'network', 5);
      attr(s, 'reputation', 2);
      s.saga.dilemmas.lastByTemplate.startup = -99999;
      return 'Ahora sos su mentor.';
    },
  },
  {
    id: 'escandalo', icon: 'news', weight: 3, cooldown: 500,
    eligible: (s) => s.saga.ranking.player.city !== null && s.saga.ranking.player.city <= 10,
    create: (_s, g) => ({ params: { outlet: pick(g, ['El Observador', 'Diario Libre de Valdoria', 'un periodista independiente']) } , days: 12 }),
    title: (_s, d) => `${str(d, 'outlet')} investiga tu fortuna`,
    body: (s) => `Estar entre las 10 fortunas de ${cityName(playerCity(s))} trae preguntas: de dónde salió tu dinero y cuántos impuestos pagás.`,
    options: [
      { id: 'transparencia', label: 'Abrir tus cuentas', detail: (s) => `Una auditoría externa cuesta ${money(usd(25_000 * pi(s)))}. ${s.legal.acts.some((a) => a.status === 'oculto') ? 'Puede salir a la luz algo que hiciste.' : 'Reputación +4.'}`, blocked: (s) => cantPay(usd(25_000 * pi(s)))(s) },
      { id: 'abogados', label: 'Responder con abogados', detail: (s) => `${money(usd(10_000 * pi(s)))}. La nota sale igual, más suave.`, blocked: (s) => cantPay(usd(10_000 * pi(s)))(s) },
      { id: 'ignorar', label: 'No responder', detail: () => 'La nota sale como la escriban.' },
    ],
    fallback: 'ignorar',
    apply: (s, _d, choice) => {
      const dirty = s.legal.acts.some((a) => a.status === 'oculto');
      if (choice === 'transparencia') {
        if (!spend(s, usd(25_000 * pi(s)), 'Auditoría externa de tu patrimonio')) return 'No alcanzó el dinero.';
        if (dirty) {
          s.legal.heat = clamp(s.legal.heat + 15, 0, 100);
          attr(s, 'reputation', -6);
          return 'La auditoría encontró irregularidades: la nota fue durísima (reputación −6, sospecha +15).';
        }
        attr(s, 'reputation', 4);
        return 'La auditoría confirmó que todo está en regla: la nota te dejó bien parado (reputación +4).';
      }
      if (choice === 'abogados') {
        if (!spend(s, usd(10_000 * pi(s)), 'Abogados por la nota periodística')) return 'No alcanzó el dinero.';
        attr(s, 'reputation', dirty ? -2 : 0);
        return 'La nota salió más suave.';
      }
      attr(s, 'reputation', dirty ? -6 : -1);
      if (dirty) s.legal.heat = clamp(s.legal.heat + 8, 0, 100);
      return dirty ? 'La nota insinúa negocios turbios (reputación −6, sospecha +8).' : 'La nota no encontró nada, pero tu silencio no cayó bien (reputación −1).';
    },
  },
  {
    id: 'opa_hostil', icon: 'rivals', weight: 4, cooldown: 600,
    eligible: (s) => myCompanies(s).some((c) => c.listed && !c.parentId && c.ownership < 0.9) && s.world.rivals.some((r) => !r.acquired && (r.attitude ?? 0) >= 25),
    create: (s, g) => {
      const co = pick(g, myCompanies(s).filter((c) => c.listed && !c.parentId && c.ownership < 0.9));
      const r = pick(g, s.world.rivals.filter((x) => !x.acquired && (x.attitude ?? 0) >= 25));
      return { params: { companyId: co.id, company: co.name, rivalId: r.id, rival: r.name, cost: roundCents(marketCap(s, co) * Math.min(0.1, 1 - co.ownership) * 1.15) }, days: 14 };
    },
    title: (_s, d) => `${str(d, 'rival')} compra acciones de ${str(d, 'company')}`,
    body: () => `Ya tiene una parte de las acciones que cotizan y quiere más: busca un lugar en el directorio y, si puede, quedarse con la empresa.`,
    options: [
      { id: 'recomprar', label: 'Recomprar acciones', detail: (_s, d) => `Cuesta ${money(num(d, 'cost'))}. Subís tu participación y los dejás afuera.`, blocked: (s, d) => cantPay(num(d, 'cost'))(s) },
      { id: 'directorio', label: 'Darles un asiento', detail: () => 'Baja la tensión con el grupo, pero los inversores lo ven como debilidad (reputación −2).' },
      { id: 'ignorar', label: 'Esperar', detail: () => 'Puede que desistan… o que te hagan una oferta por toda la empresa.' },
    ],
    fallback: 'ignorar',
    apply: (s, d, choice, g) => {
      const co = companyOf(s, d);
      const r = s.world.rivals.find((x) => x.id === str(d, 'rivalId'));
      if (!co || !r) return 'La situación cambió.';
      if (choice === 'recomprar') {
        const res = buyBackShares(s, co, 0.1);
        if (res.ok) rememberRival(s, r, 10, `Le cerraste la puerta en ${co.name}`);
        return res.ok ? res.message ?? 'Recompraste acciones.' : res.error;
      }
      if (choice === 'directorio') {
        rememberRival(s, r, -35, `Le diste un asiento en el directorio de ${co.name}`);
        attr(s, 'reputation', -2);
        return `${r.name} entra al directorio de ${co.name}. La tensión baja.`;
      }
      if (chance(g, 0.5)) return `${r.name} desistió por ahora.`;
      const price = roundCents(valuation(s, co).value * randRange(g, 1.15, 1.35));
      co.saleOffer = { price, expires: s.day + 15, from: r.name };
      rememberRival(s, r, 10, `Ofertó por toda ${co.name}`);
      return `${r.name} ofrece ${money(price)} por toda ${co.name}. La oferta está en Negocios (vence en 15 días).`;
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

  // ---------------------------------------------------------------- 1.4 · desafíos que crecen con la fortuna
  {
    id: 'guerra_precios', icon: 'rivals', weight: 0, cooldown: 0,
    // Solo la abre una guerra de precios real (rivalry.ts), no el sorteo.
    eligible: () => false,
    create: () => null,
    title: (_s, d) => `${str(d, 'rival')} te declaró una guerra de precios`,
    body: (_s, d) => `Bajó sus precios en ${str(d, 'sectorName').toLowerCase()} hasta el ${formatDate(num(d, 'until'))} para quitarle clientes a ${str(d, 'company')}. ¿Cómo respondés?`,
    options: [
      { id: 'igualar', label: 'Bajar tus precios 10 %', detail: () => 'Retenés clientes, pero ganás menos por venta. Podés volver a subirlos cuando termine.' },
      { id: 'diferenciar', label: 'Diferenciarte', detail: (s) => `Campaña y mejoras por ${money(usd(6000 * pi(s)))} de la caja de la empresa: calidad +6 y más gente que te conoce.`, blocked: (s, d) => { const co = companyOf(s, d); return co && co.ledger.balances.cash < usd(6000 * pi(s)) ? 'La empresa no tiene esa caja.' : null; } },
      { id: 'aguantar', label: 'Aguantar sin cambiar nada', detail: () => 'Sin costo hoy; vas a perder parte de las ventas mientras dure.' },
    ],
    fallback: 'aguantar',
    apply: (s, d, choice) => {
      const co = companyOf(s, d);
      if (!co) return 'La empresa ya no opera.';
      if (choice === 'igualar') {
        for (const p of co.products) p.price = roundCents(p.price * 0.9);
        return `${co.name} bajó sus precios 10 %. Revisalos cuando termine la guerra (${formatDate(num(d, 'until'))}).`;
      }
      if (choice === 'diferenciar') {
        if (!companyCost(co, usd(6000 * pi(s)), 'Campaña de diferenciación ante una guerra de precios', 'marketing', s.day)) return 'La empresa no tenía la caja.';
        co.quality = clamp(co.quality + 6, 0, 100);
        co.awareness = clamp(co.awareness + 8, 0, 100);
        return `${co.name} apuesta por la calidad: +6 de calidad y más conocida.`;
      }
      return 'Aguantás sin cambios.';
    },
  },
  {
    id: 'alianza', icon: 'deal', weight: 2, cooldown: 900,
    eligible: (s) => {
      const act = s.world.rivals.filter((r) => !r.acquired);
      return s.progression.stage >= 6 && act.some((r) => (r.attitude ?? 0) <= 15 && !isAlly(s, r)) && act.some((r) => (r.attitude ?? 0) >= 40);
    },
    create: (s, g) => {
      const act = s.world.rivals.filter((r) => !r.acquired);
      const enemy = nemesisOf(s) ?? [...act].sort((a, b) => (b.attitude ?? 0) - (a.attitude ?? 0))[0];
      const pool = act.filter((r) => r !== enemy && (r.attitude ?? 0) <= 15 && !isAlly(s, r));
      if (!pool.length || !enemy) return null;
      const r = pick(g, pool);
      return { params: { rivalId: r.id, rival: r.name, enemyId: enemy.id, enemy: enemy.name }, days: 14 };
    },
    title: (_s, d) => `${str(d, 'rival')} te propone una alianza`,
    body: (_s, d) => `Quieren unir fuerzas contra ${str(d, 'enemy')}: durante tres años no te atacan ni compiten por tus empleados. ${str(d, 'enemy')} se va a enterar.`,
    options: [
      { id: 'aceptar', label: 'Aliarte', detail: (_s, d) => `${str(d, 'rival')} deja de atacarte por 3 años. El rencor de ${str(d, 'enemy')} sube.` },
      { id: 'rechazar', label: 'Seguir solo', detail: () => 'Nada cambia.' },
    ],
    fallback: 'rechazar',
    apply: (s, d, choice) => {
      const r = s.world.rivals.find((x) => x.id === str(d, 'rivalId'));
      const e = s.world.rivals.find((x) => x.id === str(d, 'enemyId'));
      if (!r || r.acquired) return 'El grupo ya no existe.';
      if (choice !== 'aceptar') return 'Seguís compitiendo con todos.';
      r.ally = { from: s.day, until: s.day + 1095, against: e?.id ?? null };
      rememberRival(s, r, -30, 'Se aliaron');
      if (e) rememberRival(s, e, 15, `Te aliaste con ${r.name}`);
      chronicle(s, 'rival', 'deal', `Alianza con ${r.name}`, `Hasta el ${formatDate(s.day + 1095)}, contra ${str(d, 'enemy')}.`);
      return `Alianza firmada con ${r.name} hasta el ${formatDate(s.day + 1095)}.`;
    },
  },
  {
    id: 'posicion_dominante', icon: 'legal', weight: 3, cooldown: 1080,
    eligible: (s) => s.progression.stage >= 6 && myCompanies(s).some((c) => c.history.length >= 6 && companyShareEstimate(c) >= 0.3),
    create: (s, g) => {
      const co = pick(g, myCompanies(s).filter((c) => c.history.length >= 6 && companyShareEstimate(c) >= 0.3));
      const revenue = co.history.slice(-12).reduce((a, h) => a + h.revenue, 0);
      return { params: { companyId: co.id, company: co.name, share: Math.round(companyShareEstimate(co) * 100), revenue }, days: 15 };
    },
    title: (_s, d) => `Investigación por posición dominante: ${str(d, 'company')}`,
    body: (_s, d) => `La Comisión de Defensa de la Competencia cree que ${str(d, 'company')} controla cerca del ${num(d, 'share')} % de su mercado y que eso perjudica a los clientes. Ventas de los últimos 12 meses: ${money(num(d, 'revenue'))}.`,
    options: [
      { id: 'compromiso', label: 'Comprometerte a bajar precios', detail: () => 'Bajás 5 % los precios: menos margen, caso cerrado y reputación +3.' },
      { id: 'acuerdo', label: 'Pagar un acuerdo', detail: (_s, d) => `Multa negociada del 2 % de las ventas anuales (${money(roundCents(num(d, 'revenue') * 0.02))}) sin admitir culpa.`, blocked: (s, d) => { const co = companyOf(s, d); return co && co.ledger.balances.cash < roundCents(num(d, 'revenue') * 0.02) ? 'La empresa no tiene esa caja.' : null; } },
      { id: 'defender', label: 'Defenderte en el proceso', detail: (s) => `Abogados por ${money(usd(15_000 * pi(s)))}. 55 % de ganar; si perdés, multa del 6 % de las ventas anuales.`, blocked: (s, d) => { const co = companyOf(s, d); return co && co.ledger.balances.cash < usd(15_000 * pi(s)) ? 'La empresa no tiene caja para los abogados.' : null; } },
    ],
    fallback: 'compromiso',
    apply: (s, d, choice, g) => {
      const co = companyOf(s, d);
      if (!co) return 'La empresa ya no opera.';
      if (choice === 'compromiso') {
        for (const p of co.products) p.price = roundCents(p.price * 0.95);
        attr(s, 'reputation', 3);
        return `${co.name} bajó sus precios 5 %. La Comisión cerró el caso.`;
      }
      if (choice === 'acuerdo') {
        companyFine(s, co, roundCents(num(d, 'revenue') * 0.02), 'Acuerdo con Defensa de la Competencia');
        return 'Acuerdo cerrado: caso terminado sin admitir culpa.';
      }
      companyCost(co, usd(15_000 * pi(s)), 'Abogados: investigación por posición dominante', 'professional_fees', s.day);
      schedule(s, d, 'defender', 60 + randInt(g, 0, 30));
      return 'Empieza el proceso. La resolución llega en 2 o 3 meses.';
    },
    resolve: (s, o, g) => {
      const co = companyOf(s, o);
      if (!co) return;
      if (chance(g, 0.55)) {
        attr(s, 'reputation', 2);
        addLog(s, 'success', '⚖️', `Ganaste el caso por posición dominante de ${co.name}.`, undefined, 'logros');
        chronicle(s, 'dilema', 'legal', `Ganaste el caso de ${co.name}`, 'La Comisión no probó el abuso de posición dominante.');
        return;
      }
      const fine = roundCents(num(o, 'revenue') * 0.06);
      companyFine(s, co, fine, 'Multa por abuso de posición dominante');
      attr(s, 'reputation', -4);
      addLog(s, 'danger', '⚖️', `Perdiste el caso: ${co.name} paga una multa de ${money(fine)} (reputación −4).`, -fine);
      chronicle(s, 'dilema', 'legal', `Multa a ${co.name}`, `Abuso de posición dominante: ${money(fine)}.`);
    },
  },
  {
    id: 'auditoria_fiscal', icon: 'tax', weight: 3, cooldown: 900,
    eligible: (s) => s.progression.stage >= 5 && s.tax.filings.length >= 2,
    create: (s) => ({ params: { year: s.tax.filings[s.tax.filings.length - 1].year, cost: usd(3500 * pi(s)) }, days: 12 }),
    title: (_s, d) => `La agencia tributaria revisa tu declaración de ${num(d, 'year')}`,
    body: () => 'Es una auditoría de rutina, pero piden comprobantes de ingresos, gastos deducidos e inversiones.',
    options: [
      { id: 'contador', label: 'Que la prepare un contador', detail: (_s, d) => `${money(num(d, 'cost'))}. Casi seguro sale todo en orden.`, blocked: (s, d) => cantPay(num(d, 'cost'))(s) },
      { id: 'solo', label: 'Preparar todo vos', detail: (s) => `Gratis. Con tu educación financiera (${s.skills.finEdu.level}/100) puede haber errores que se multan.` },
    ],
    fallback: 'solo',
    apply: (s, d, choice) => {
      if (choice === 'contador' && !spend(s, num(d, 'cost'), 'Contador: auditoría fiscal')) return 'No alcanzó el dinero.';
      schedule(s, d, choice, 45);
      return 'Entregaste la documentación. El resultado llega en unas 6 semanas.';
    },
    resolve: (s, o, g) => {
const hidden = s.legal.acts.filter((a) => (a.kind === 'evasion' || a.kind === 'evasion_empresa') && a.status === 'oculto');
      const errorP = o.choice === 'contador' ? 0.05 : clamp(0.45 - s.skills.finEdu.level / 200, 0.1, 0.45);
      // Si hubo evasión real, la auditoría deja pruebas: el caso puede abrirse por el sistema legal.
      for (const a of hidden) a.evidence = clamp(a.evidence + 30, 0, 100);
      if (hidden.length) addLog(s, 'danger', '🧾', 'La auditoría encontró inconsistencias en tus ingresos declarados: las pruebas en tu contra aumentaron.', undefined, 'ofertas');
      if (!chance(g, errorP)) {
        if (!hidden.length) addLog(s, 'success', '🧾', 'Auditoría fiscal terminada: todo en orden.');
        return;
      }
      const fine = roundCents(usd(1200 * pi(s)) * (1 + s.progression.stage / 6));
      post(s.ledger, { day: s.day, memo: 'Auditoría fiscal: ajuste y multa', cf: 'internal', tag: 'saga:dilema', lines: [{ account: 'fines', debit: fine }, { account: 'fines_payable', credit: fine }] });
      s.legal.fines.push({ id: s.meta.nextId++, caseId: null, label: 'Auditoría fiscal', balance: fine, original: fine, dueDay: s.day + 30, installment: null, garnishing: false });
      addLog(s, 'danger', '🧾', `La auditoría encontró errores en tu declaración: multa de ${money(fine)} (pagala en Legal).`, -fine, 'ofertas');
    },
  },
  {
    id: 'franquicia', icon: 'store', weight: 2, cooldown: 1080,
    eligible: (s) => s.progression.stage >= 6 && myCompanies(s).some((c) => (c.sector === 'cafeteria' || c.sector === 'minimarket') && c.history.length >= 12 && c.reputation >= 60 && c.history.slice(-6).reduce((a, h) => a + h.netIncome, 0) > 0),
    create: (s, g) => {
      const co = pick(g, myCompanies(s).filter((c) => (c.sector === 'cafeteria' || c.sector === 'minimarket') && c.history.length >= 12 && c.reputation >= 60 && c.history.slice(-6).reduce((a, h) => a + h.netIncome, 0) > 0));
      const profit6 = Math.max(0, co.history.slice(-6).reduce((a, h) => a + h.netIncome, 0));
      return { params: { companyId: co.id, company: co.name, fee: roundCents(Math.max(usd(20_000 * pi(s)), profit6) / 100) * 100, chain: pick(g, ['Grupo Andino', 'Lumen Retail', 'Casa Boreal', 'Nordhaven Foods']) }, days: 14 };
    },
    title: (_s, d) => `${str(d, 'chain')} quiere franquiciar ${str(d, 'company')} en el exterior`,
    body: (_s, d) => `Pagan ${money(num(d, 'fee'))} por la licencia de tu marca y tus recetas fuera del país. Si manejan mal los locales, la marca sufre también acá.`,
    options: [
      { id: 'licencia', label: 'Vender la licencia', detail: (_s, d) => `Cobrás ${money(num(d, 'fee'))} ahora. 30 % de riesgo de que la marca pierda reputación en un año.` },
      { id: 'rechazar', label: 'Cuidar la marca', detail: () => 'Nada cambia. Podés expandirte vos abriendo en otra jurisdicción.' },
    ],
    fallback: 'rechazar',
    apply: (s, d, choice) => {
      if (choice !== 'licencia') return 'Preferiste cuidar tu marca.';
      const co = companyOf(s, d);
      if (!co) return 'La empresa ya no opera.';
      coPost(co.ledger, { day: s.day, memo: `Licencia de marca a ${str(d, 'chain')}`, cf: 'operating', tag: 'saga:dilema', lines: [{ account: 'cash', debit: num(d, 'fee') }, { account: 'other_income', credit: num(d, 'fee') }] });
      schedule(s, d, choice, 300);
      chronicle(s, 'empresa', 'store', `${co.name} llega al exterior`, `${str(d, 'chain')} pagó ${money(num(d, 'fee'))} por la licencia.`);
      return `${co.name} cobró ${money(num(d, 'fee'))} por la licencia.`;
    },
    resolve: (s, o, g) => {
      const co = companyOf(s, o);
      if (!co || !chance(g, 0.3)) return;
      co.reputation = clamp(co.reputation - 10, 0, 100);
      addLog(s, 'warning', '🌐', `Los locales de ${str(o, 'chain')} tuvieron problemas: la reputación de ${co.name} baja 10.`);
    },
  },
  {
    id: 'socio_capital', icon: 'invest', weight: 2, cooldown: 900,
    eligible: (s) => myCompanies(s).some((c) => LEGAL_FORM_BY_ID[c.legalForm].limitedLiability && !c.parentId && !c.listed && c.history.length >= 12 && c.ownership >= 0.9 && valuation(s, c).value > usd(150_000 * pi(s))),
    create: (s, g) => {
      const co = pick(g, myCompanies(s).filter((c) => LEGAL_FORM_BY_ID[c.legalForm].limitedLiability && !c.parentId && !c.listed && c.history.length >= 12 && c.ownership >= 0.9 && valuation(s, c).value > usd(150_000 * pi(s))));
      const v = valuation(s, co).value;
      const pct = 0.2;
      const k = randRange(g, 0.9, 1.15);
      return { params: { companyId: co.id, company: co.name, investor: randomName(g), money: roundCents((v * k * pct) / (1 - pct) / 100) * 100, k: Math.round(k * 100) }, days: 14 };
    },
    title: (_s, d) => `${str(d, 'investor')} quiere entrar como socio en ${str(d, 'company')}`,
    body: (_s, d) => `Pone ${money(num(d, 'money'))} en la caja de la empresa a cambio del 20 % (valúa la empresa ${num(d, 'k') >= 100 ? `${num(d, 'k') - 100} % por encima` : `${100 - num(d, 'k')} % por debajo`} de tu valoración). Capital para crecer sin deuda, a cambio de compartir las ganancias para siempre.`,
    options: [
      { id: 'aceptar', label: 'Aceptar el 20 %', detail: (_s, d) => `Entran ${money(num(d, 'money'))} a la caja. Tu participación baja un 20 %.` },
      { id: 'contraoferta', label: 'Ofrecer solo el 15 %', detail: () => 'Por el mismo dinero. Puede aceptar (50 %) o irse.' },
      { id: 'rechazar', label: 'Rechazar', detail: () => 'La empresa sigue siendo toda tuya.' },
    ],
    fallback: 'rechazar',
    apply: (s, d, choice, g) => {
      const co = companyOf(s, d);
      if (!co) return 'La empresa ya no opera.';
      if (choice === 'rechazar') return 'Rechazaste al socio.';
      const pct = choice === 'aceptar' ? 0.2 : 0.15;
      if (choice === 'contraoferta' && !chance(g, 0.5)) return `${str(d, 'investor')} no aceptó la contraoferta y se fue.`;
      coPost(co.ledger, { day: s.day, memo: `Aporte de capital de ${str(d, 'investor')} (${fmtPct(pct, 0)})`, cf: 'financing', tag: 'capital:partner', lines: [{ account: 'cash', debit: num(d, 'money') }, { account: 'capital', credit: num(d, 'money') }] });
      co.ownership = co.ownership * (1 - pct);
      co.capitalRaised = (co.capitalRaised ?? 0) + num(d, 'money');
      revalue(s, co);
      chronicle(s, 'empresa', 'invest', `Nuevo socio en ${co.name}`, `${str(d, 'investor')} aportó ${money(num(d, 'money'))} por el ${fmtPct(pct, 0)}.`);
      return `${str(d, 'investor')} aportó ${money(num(d, 'money'))} por el ${fmtPct(pct, 0)} de ${co.name}.`;
    },
  },
  {
    id: 'horas_extra', icon: 'career', weight: 4, cooldown: 400,
    eligible: (s) => !!s.career.job && s.day >= 60 && s.career.job.performance < 85,
    create: (_s, g) => ({ params: { project: pick(g, ['el cierre del trimestre', 'un cliente nuevo muy exigente', 'la mudanza de oficinas', 'una auditoría interna']) }, days: 6 }),
    title: () => 'Tu jefe te pide horas extra (sin pago)',
    body: (_s, d) => `Hace falta gente para ${str(d, 'project')} durante dos meses. No se pagan, pero «se van a tener en cuenta en la evaluación».`,
    options: [
      { id: 'aceptar', label: 'Aceptar', detail: () => 'Desempeño +12 (más chances de ascenso en tu evaluación). Estrés +10, salud −3.' },
      { id: 'parcial', label: 'Solo algunas tardes', detail: () => 'Desempeño +5. Estrés +4.' },
      { id: 'no', label: 'No, tu horario es tu horario', detail: () => 'Desempeño −3. Tu vida, intacta.' },
    ],
    fallback: 'no',
    apply: (s, _d, choice) => {
      const job = s.career.job;
      if (!job) return 'Ya no tenés ese empleo.';
      const perf = choice === 'aceptar' ? 12 : choice === 'parcial' ? 5 : -3;
      job.performance = clamp(job.performance + perf, 0, 100);
      if (choice === 'aceptar') { attr(s, 'stress', 10); attr(s, 'health', -3); }
      if (choice === 'parcial') attr(s, 'stress', 4);
      return `Desempeño ${perf >= 0 ? '+' : ''}${perf} (ahora ${Math.round(job.performance)}/100).`;
    },
  },
  {
    id: 'gerente_escandalo', icon: 'news', weight: 2, cooldown: 900,
    eligible: (s) => myCompanies(s).some((c) => c.employees.some((e) => e.role === 'gerente')),
    create: (s, g) => {
      const co = pick(g, myCompanies(s).filter((c) => c.employees.some((e) => e.role === 'gerente')));
      const m = co.employees.find((e) => e.role === 'gerente')!;
      return { params: { companyId: co.id, company: co.name, employeeId: m.id, manager: m.name, what: pick(g, ['maltratar a un proveedor en público', 'usar la tarjeta de la empresa para gastos personales', 'un comentario ofensivo en redes']) }, days: 8 };
    },
    title: (_s, d) => `Escándalo: el gerente de ${str(d, 'company')}`,
    body: (_s, d) => `Un video muestra a ${str(d, 'manager')} ${str(d, 'what')}. La prensa pregunta qué vas a hacer.`,
    options: [
      { id: 'despedir', label: 'Despedirlo', detail: () => 'La empresa se queda sin gerente (y paga la indemnización). Reputación de la empresa protegida.' },
      { id: 'disculpa', label: 'Disculpa pública y capacitación', detail: (s) => `${money(usd(2500 * pi(s)))} de la empresa. Reputación de la empresa −4.` , blocked: (s, d) => { const co = companyOf(s, d); return co && co.ledger.balances.cash < usd(2500 * pi(s)) ? 'La empresa no tiene esa caja.' : null; } },
      { id: 'ignorar', label: 'No decir nada', detail: () => 'Reputación de la empresa −10 y tuya −3.' },
    ],
    fallback: 'ignorar',
    apply: (s, d, choice) => {
      const co = companyOf(s, d);
      if (!co) return 'La empresa ya no opera.';
      if (choice === 'despedir') {
        const e = co.employees.find((x) => x.id === num(d, 'employeeId'));
        if (e) fire(s, co, e.id, true);
        return `${str(d, 'manager')} ya no trabaja en ${co.name}. Contratá otro gerente si querés seguir delegando.`;
      }
      if (choice === 'disculpa') {
        companyCost(co, usd(2500 * pi(s)), 'Capacitación y comunicación tras un escándalo', 'training', s.day);
        co.reputation = clamp(co.reputation - 4, 0, 100);
        return 'Disculpa pública: la nota pierde fuerza.';
      }
      co.reputation = clamp(co.reputation - 10, 0, 100);
      attr(s, 'reputation', -3);
      return 'El silencio se nota: reputación de la empresa −10 y tuya −3.';
    },
  },
  {
    id: 'competidor_cierra', icon: 'store', weight: 2, cooldown: 600,
    eligible: (s) => myCompanies(s).some((c) => (s.markets[c.sector]?.competitors.filter((x) => x.active).length ?? 0) >= 3),
    create: (s, g) => {
      const co = pick(g, myCompanies(s).filter((c) => (s.markets[c.sector]?.competitors.filter((x) => x.active).length ?? 0) >= 3));
      const comps = s.markets[co.sector].competitors.filter((x) => x.active && !s.world.rivals.some((r) => x.name.includes(r.name.split(' ').pop() ?? '¬')));
      if (!comps.length) return null;
      const c = pick(g, comps);
      return { params: { companyId: co.id, company: co.name, competitorId: c.id, competitor: c.name, price: usd(randRange(g, 8000, 20000) * pi(s)) }, days: 10 };
    },
    title: (_s, d) => `${str(d, 'competitor')} cierra y vende su cartera de clientes`,
    body: (_s, d) => `El dueño se jubila. Ofrece a ${str(d, 'company')} su base de clientes y su marca por ${money(num(d, 'price'))}. Si no la comprás, puede quedársela un grupo rival.`,
    options: [
      { id: 'comprar', label: 'Comprar la cartera', detail: (_s, d) => `${money(num(d, 'price'))} de la caja de la empresa: el competidor desaparece y te conocen más.`, blocked: (s, d) => { const co = companyOf(s, d); return co && co.ledger.balances.cash < num(d, 'price') ? 'La empresa no tiene esa caja.' : null; } },
      { id: 'no', label: 'Dejar pasar', detail: () => 'El local cierra o lo toma otro.' },
    ],
    fallback: 'no',
    apply: (s, d, choice, g) => {
      const co = companyOf(s, d);
      const m = co ? s.markets[co.sector] : undefined;
      const c = m?.competitors.find((x) => x.id === num(d, 'competitorId'));
      if (!co || !m || !c) return 'Ya no es posible.';
      if (choice === 'comprar') {
        if (!companyCost(co, num(d, 'price'), `Compra de la cartera de ${c.name}`, 'marketing', s.day)) return 'La empresa no tenía la caja.';
        c.active = false;
        co.awareness = clamp(co.awareness + 15, 0, 100);
        return `${c.name} cerró y sus clientes ahora conocen ${co.name}.`;
      }
      if (chance(g, 0.5)) {
        c.active = false;
        return `${c.name} cerró.`;
      }
      return `Otro inversor se quedó con ${c.name}; sigue compitiendo.`;
    },
  },
  {
    id: 'ciberataque', icon: 'shield', weight: 2, cooldown: 720,
    eligible: (s) => myCompanies(s).some((c) => c.sector === 'saas' || c.sector === 'consultora'),
    create: (s, g) => {
      const co = pick(g, myCompanies(s).filter((c) => c.sector === 'saas' || c.sector === 'consultora'));
      return { params: { companyId: co.id, company: co.name, cost: usd(randRange(g, 4000, 9000) * pi(s)) }, days: 7 };
    },
    title: (_s, d) => `${str(d, 'company')}: una auditoría encontró una falla de seguridad`,
    body: () => 'Todavía no la aprovechó nadie. Arreglarla bien lleva dinero y una semana de trabajo.',
    options: [
      { id: 'arreglar', label: 'Arreglarla ya', detail: (_s, d) => `${money(num(d, 'cost'))} de la caja de la empresa. Riesgo cero.`, blocked: (s, d) => { const co = companyOf(s, d); return co && co.ledger.balances.cash < num(d, 'cost') ? 'La empresa no tiene esa caja.' : null; } },
      { id: 'despues', label: 'Dejarlo para más adelante', detail: () => '35 % de riesgo de un ataque en los próximos meses: días sin vender y reputación −12.' },
    ],
    fallback: 'despues',
    apply: (s, d, choice, g) => {
      const co = companyOf(s, d);
      if (!co) return 'La empresa ya no opera.';
      if (choice === 'arreglar') {
        companyCost(co, num(d, 'cost'), 'Corrección de una falla de seguridad', 'professional_fees', s.day);
        return 'Falla corregida.';
      }
      if (chance(g, 0.35)) schedule(s, d, choice, randInt(g, 30, 120));
      return 'Quedó pendiente.';
    },
    resolve: (s, o) => {
      const co = companyOf(s, o);
      if (!co) return;
      co.suspendedUntil = Math.max(co.suspendedUntil ?? 0, s.day + 5);
      co.reputation = clamp(co.reputation - 12, 0, 100);
      addLog(s, 'danger', '🛡️', `Atacaron ${co.name} por la falla que quedó sin corregir: 5 días sin servicio y reputación −12.`);
      chronicle(s, 'empresa', 'shield', `Ciberataque a ${co.name}`, 'La falla de seguridad que quedó pendiente se aprovechó.');
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
  if (s.legal.prison || dl.open.length >= MAX_OPEN) return;
  if (s.day < dl.nextDay) {
    // Urgencias (por ejemplo, un trabajo temporal si te quedás sin dinero): no esperan turno.
    const urgent = TEMPLATES.find((t) => t.urgent && (dl.lastByTemplate[t.id] ?? -99999) + t.cooldown <= s.day && !dl.open.some((d) => d.template === t.id) && t.eligible(s));
    if (!urgent) return;
    const made = urgent.create(s, srng(s));
    if (!made) return;
    const d: Dilemma = { id: s.meta.nextId++, template: urgent.id, day: s.day, deadline: s.day + made.days, params: made.params, status: 'abierto' };
    dl.open.push(d);
    dl.lastByTemplate[urgent.id] = s.day;
    addLog(s, 'info', '🤔', `Decisión pendiente: ${urgent.title(s, d)}. Tenés hasta el ${formatDate(d.deadline)}.`, undefined, 'decisiones');
    return;
  }
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

/** Multa a una empresa: lo que no alcanza la caja queda como deuda vencida. */
function companyFine(s: GameState, co: Company, amount: Cents, memo: string): void {
  if (amount <= 0) return;
  const paid = Math.min(amount, co.ledger.balances.cash);
  const lines = [{ account: 'fines' as const, debit: amount }, { account: 'cash' as const, credit: paid }];
  if (amount > paid) lines.push({ account: 'arrears' as const, credit: amount - paid } as never);
  coPost(co.ledger, { day: s.day, memo, cf: 'operating', tag: 'saga:dilema', lines });
}

/** Abre un dilema puntual (lo usan otros sistemas: por ejemplo, una guerra de precios real). */
export function openDilemma(s: GameState, templateId: string, params: DilemmaParams, days: number): Dilemma | null {
  const t = TEMPLATE_BY_ID[templateId];
  const dl = s.saga.dilemmas;
  if (!t || s.legal.prison || dl.open.some((d) => d.template === templateId)) return null;
  const d: Dilemma = { id: s.meta.nextId++, template: t.id, day: s.day, deadline: s.day + days, params, status: 'abierto' };
  dl.open.push(d);
  dl.lastByTemplate[t.id] = s.day;
  addLog(s, 'info', '🤔', `Decisión pendiente: ${t.title(s, d)}. Tenés hasta el ${formatDate(d.deadline)}.`, undefined, 'decisiones');
  return d;
}

registerWarDilemma((s: GameState, r: RivalGroup, companyId: number) => {
  const co = s.companies.find((c) => c.id === companyId);
  const war = co ? warsIn(s, co.sector)[0] : undefined;
  if (!co || !war) return;
  openDilemma(s, 'guerra_precios', { rivalId: r.id, rival: r.name, companyId: co.id, company: co.name, sector: co.sector, sectorName: SECTOR_BY_ID[co.sector].name, until: war.until }, 10);
});

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
