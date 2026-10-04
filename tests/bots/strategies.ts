import { newGame, GameState } from '../../src/engine/state';
import { advanceDay } from '../../src/engine/simulation';
import { JOBS, JOB_BY_ID } from '../../src/content/jobs';
import { COURSES } from '../../src/content/courses';
import { apply, acceptOffer, checkRequirements, jobSalary, monthlyGrossIncome } from '../../src/engine/career/career';
import { enroll, courseRequirements, courseTotalCost, timesCompleted, tuition } from '../../src/engine/skills/education';
import { transfer } from '../../src/engine/finance/banking';
import { setAutopay } from '../../src/engine/finance/creditCard';
import { buyFund } from '../../src/engine/invest/funds';
import { buyProperty } from '../../src/engine/realestate/realestate';
import { foundCompany, setupCosts, sectorRequirement } from '../../src/engine/business/ownership';
import { generateCandidates, hire } from '../../src/engine/business/staff';
import { monthlyRecurring } from '../../src/engine/finance/budget';
import { computeMetrics } from '../../src/engine/reports/metrics';
import { buyItem } from '../../src/engine/lifestyle/shops';
import { SECTOR_BY_ID, BizSectorId } from '../../src/content/sectors';
import { usd, Cents } from '../../src/engine/money';
import { isLastDayOfMonth, dateOf } from '../../src/engine/time/calendar';
import type { BackgroundId, PlayStyle } from '../../src/content/backgrounds';
import { MORTGAGE_BANKS } from '../../src/content/realestate';

/**
 * BOTS DE BALANCE: juegan partidas completas con una estrategia razonable por
 * estilo y miden cuántos días tarda cada uno en llegar a cada etapa.
 * No hacen trampa: usan las mismas acciones que la interfaz.
 */
export type BotStyle = 'ejecutivo' | 'inversionista' | 'inmobiliario' | 'emprendedor';

export interface BotResult {
  style: BotStyle;
  background: BackgroundId;
  seed: string;
  stageDays: Record<number, number>;
  finalNetWorth: Cents;
  finalStage: number;
  arrearsEvents: number;
  bankruptcies: number;
  companies: number;
  properties: number;
  maxLiquidDip: Cents;
  /** Sueldo mensual promedio en los 3 primeros años (0 en los meses sin empleo). */
  salary3y: Cents;
  joblessMonths3y: number;
  /** Años-empresa con pérdida (riesgo empresarial). */
  lossYears: number;
  educationSpent: number;
  /** Cursos en curso a la vez, en promedio. */
  avgCourses: number;
}

const liquid = (s: GameState) => s.ledger.balances.checking + s.ledger.balances.savings + s.ledger.balances.cash_wallet;

function careerStep(s: GameState): void {
  // Aceptar la mejor oferta que pague más que el empleo actual.
  const offers = s.career.applications.filter((a) => a.status === 'offer').sort((a, b) => (b.offerSalary ?? 0) - (a.offerSalary ?? 0));
  const cur = s.career.job?.salary ?? 0;
  if (offers[0] && (offers[0].offerSalary ?? 0) > cur * 1.05) acceptOffer(s, offers[0].id);
  const pending = s.career.applications.filter((a) => a.status === 'pending').length;
  if (pending >= 3) return;
  const options = JOBS.filter((j) => checkRequirements(s, j).ok && jobSalary(s, j) > (s.career.job?.salary ?? 0) * 1.08 && s.career.job?.jobId !== j.id)
    .sort((a, b) => jobSalary(s, b) - jobSalary(s, a)).slice(0, 3 - pending);
  for (const j of options) apply(s, j.id);
}

/**
 * Estudia con un objetivo: el empleo mejor pago al que le faltan solo habilidades o
 * educación. Elige el curso que más XP da en lo que falta (o un título, si falta educación).
 */
function studyStep(s: GameState, budgetShare: number): void {
  if (s.education.active.length >= 2) return;
  const cash = liquid(s);
  const target = JOBS.filter((j) => !checkRequirements(s, j).ok && jobSalary(s, j) > (s.career.job?.salary ?? 0) * 1.2)
    .sort((a, b) => jobSalary(s, b) - jobSalary(s, a))[0];
  const missing: Record<string, number> = {};
  if (target) for (const [k, v] of Object.entries(target.requires.skills ?? {})) {
    const have = s.skills[k as keyof typeof s.skills].level;
    if (have < (v as number)) missing[k] = (v as number) - have;
  }
  const cands = COURSES.filter((c) => !s.education.active.some((a) => a.courseId === c.id) && timesCompleted(s, c.id) === 0 && courseRequirements(s, c).every((r) => r.met))
    .map((c) => ({ c, cost: c.monthlyTuition ? tuition(s, c) * 6 : courseTotalCost(s, c), score: Object.entries(c.xp).reduce((a, [k, x]) => a + (missing[k] ? (x as number) : 0), 0) + (c.kind === 'titulo' && target?.requires.education ? 5000 : 0) }))
    .filter((x) => x.cost <= cash * budgetShare)
    .sort((a, b) => b.score - a.score || a.cost - b.cost);
  if (cands[0]) enroll(s, cands[0].c.id);
}

function savingsStep(s: GameState, targetMonths: number): Cents {
  const monthly = monthlyRecurring(s);
  const keep = Math.round(monthly * 1.3);
  const excess = s.ledger.balances.checking - keep;
  if (excess > 0 && s.ledger.balances.savings < monthly * targetMonths) transfer(s, 'checking', 'savings', Math.min(excess, monthly * targetMonths - s.ledger.balances.savings));
  // Lo que sobra por encima de la reserva, disponible para invertir.
  return Math.max(0, liquid(s) - keep - monthly * targetMonths);
}

function fromSavingsToChecking(s: GameState, need: Cents): void {
  if (s.ledger.balances.checking < need) transfer(s, 'savings', 'checking', Math.min(s.ledger.balances.savings, need - s.ledger.balances.checking));
}

function investStep(s: GameState, free: Cents): void {
  if (free < usd(300)) return;
  fromSavingsToChecking(s, free);
  buyFund(s, 'F-IDX', Math.min(free, s.ledger.balances.checking));
}

function propertyStep(s: GameState, free: Cents): void {
  const income = monthlyGrossIncome(s);
  const listings = [...s.realEstate.listings].filter((l) => l.property.type !== 'terreno').sort((a, b) => a.askPrice - b.askPrice);
  for (const l of listings) {
    const rent = l.property.lease?.rent ?? l.property.askingRent;
    const yieldGross = (rent * 12) / l.askPrice;
    if (yieldGross < 0.055) continue;
    const closing = Math.round(l.askPrice * 0.05);
    if (free >= l.askPrice + closing) {
      fromSavingsToChecking(s, l.askPrice + closing);
      if (buyProperty(s, l.id, { owner: { kind: 'personal' } }).ok) return;
    }
    // Hipoteca del 70 % si alcanza el anticipo y la cuota es razonable.
    const down = Math.round(l.askPrice * 0.3) + closing;
    if (free >= down && income > 0 && s.credit.score >= 620) {
      fromSavingsToChecking(s, down);
      for (const b of MORTGAGE_BANKS.filter((x) => !x.forCompanies)) {
        const r = buyProperty(s, l.id, { owner: { kind: 'personal' }, financing: { bankId: b.id, amount: Math.round(l.askPrice * 0.7), years: 20, rateType: 'fija' } });
        if (r.ok) return;
      }
    }
  }
}

function businessStep(s: GameState, free: Cents): void {
  if (s.companies.some((c) => c.status === 'active' || c.status === 'insolvent')) {
    for (const co of s.companies) {
      if (co.status !== 'active' || co.employees.some((e) => e.role === 'gerente')) continue;
      if (co.ledger.balances.cash < usd(6000)) continue;
      const c = generateCandidates(s, co, 'gerente').sort((a, b) => b.skill - a.skill)[0];
      if (c && hire(s, co, c.id, true).ok) co.delegation = { ...co.delegation, autoReorder: true, autoPricing: true, autoStaffing: true };
    }
    return;
  }
  if (s.formerCompanies.length >= 3) return;
  const sectors: BizSectorId[] = ['consultora', 'cafeteria', 'minimarket', 'saas', 'muebles'];
  for (const id of sectors) {
    const sec = SECTOR_BY_ID[id];
    const req = sectorRequirement(s, sec);
    if (req && !req.met) continue;
    const costs = setupCosts(s, id, 'srl');
    const capital = Math.max(costs.total + (costs.firstMonthFixed + costs.firstMonthPayroll) * 6, costs.recommended);
    if (free >= capital) {
      fromSavingsToChecking(s, capital);
      const r = foundCompany(s, { sector: id, name: `Bot ${id}`, legalForm: 'srl', capital });
      if (r.ok) return;
    }
  }
}

export interface BotOptions {
  /** Jugador nuevo que explora antes de postularse (1.4): no busca empleo hasta este día. */
  waitDays?: number;
  /** Días de juego para medir atrasos tempranos. */
  earlyWindow?: number;
  /** Se llama en cada cierre de mes (para medir). */
  onMonth?: (s: GameState) => void;
}

export function runBot(style: BotStyle, background: BackgroundId, seed: string, years: number, opts: BotOptions = {}): BotResult & { earlyArrears: number } {
  const s = newGame({ name: 'Bot', background, style: style as PlayStyle, seed, nowReal: 1 });
  setAutopay(s, 'full');
  const stageDays: Record<number, number> = {};
  let minLiquid = liquid(s);
  let dressed = false;
  let earlyArrears = 0;
  let salary3y = 0;
  let joblessMonths3y = 0;
  let lossYears = 0;
  let courseMonths = 0;
  let months = 0;
  const end = years * 365;
  while (s.day < end) {
    advanceDay(s);
    if (s.progression.stage && stageDays[s.progression.stage] === undefined) {
      for (let k = 2; k <= s.progression.stage; k++) if (stageDays[k] === undefined) stageDays[k] = s.day;
    }
    minLiquid = Math.min(minLiquid, liquid(s));
    if (s.day % 7 === 0 && s.day >= (opts.waitDays ?? 0)) careerStep(s);
    if (s.day === (opts.earlyWindow ?? 90)) earlyArrears = s.credit.arrearsEvents;
    if (!isLastDayOfMonth(s.day)) continue;
    opts.onMonth?.(s);
    months++;
    courseMonths += s.education.active.length;
    if (s.day < 365 * 3) {
      salary3y += s.career.job?.salary ?? 0;
      if (!s.career.job) joblessMonths3y++;
    }
    if (dateOf(s.day).m === 12) for (const co of s.companies) if (co.history.length >= 12 && co.history.slice(-12).reduce((a, h) => a + h.netIncome, 0) < 0) lossYears++;
    if (!dressed && liquid(s) > usd(1500)) {
      dressed = buyItem(s, 'camisa_oxford', 'debito').ok && buyItem(s, 'chino', 'debito').ok;
    }
    if (style === 'ejecutivo') {
      studyStep(s, 0.35);
      const free = savingsStep(s, 4);
      investStep(s, Math.round(free * 0.5));
    } else if (style === 'inversionista') {
      studyStep(s, 0.1);
      const free = savingsStep(s, 3);
      investStep(s, free);
    } else if (style === 'inmobiliario') {
      studyStep(s, 0.1);
      const free = savingsStep(s, 3);
      propertyStep(s, free);
    } else {
      studyStep(s, 0.1);
      const free = savingsStep(s, 3);
      businessStep(s, free);
    }
  }
  const m = computeMetrics(s);
  if (process.env.URT_BOT_LOG) console.log(s.log.filter((l) => l.kind === 'danger').slice(0, 40).map((l) => `${l.day} ${l.text}`).join('\n'));
  return {
    style, background, seed, stageDays, finalNetWorth: m.netWorth, finalStage: s.progression.stage,
    arrearsEvents: s.credit.arrearsEvents, bankruptcies: s.formerCompanies.filter((f) => f.outcome === 'quiebra').length,
    companies: s.companies.length + s.formerCompanies.length, properties: s.realEstate.properties.filter((p) => p.owner.kind === 'personal').length,
    maxLiquidDip: minLiquid, earlyArrears, salary3y: Math.round(salary3y / 36), joblessMonths3y, lossYears,
    educationSpent: s.education.completed?.length ?? 0,
    avgCourses: months ? courseMonths / months : 0,
  };
}

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

export { JOB_BY_ID };
