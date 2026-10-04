import type { AccountId } from './ledger/accounts';
import { emptyLedger, LedgerState, post } from './ledger/ledger';
import type { Cents } from './money';
import { usd } from './money';
import { seedFromString } from './rng';
import { dateOf } from './time/calendar';
import type { SkillId } from '../content/skills';
import { SKILLS } from '../content/skills';
import type { EducationLevel, Field, Sector } from '../content/jobs';
import type { LifestyleId } from '../content/lifestyle';
import { BACKGROUND_BY_ID, BackgroundId, PlayStyle } from '../content/backgrounds';
import { CARD_SPREAD } from '../content/banks';
import { emptyYtd, TaxComputation, YearToDate } from './tax/incomeTax';
import { buildLifestyleItems } from './finance/budget';
import { refreshCreditScore } from './finance/credit';
import type { Company, MarketState, Listing, FormerCompany, IcLoan } from './business/types';
import { initMarkets } from './business/market';
import type { JurisdictionId } from '../content/jurisdictions';
import type { CyclePhase, EconEvent, MacroMonth } from './economy/economy';
import { newMacroV2 } from './economy/economy';
import type { Difficulty } from './economy/difficulty';
import type { StockMarketState, BondsState, FundsState, MogulState, ManagedState } from './invest/types';
import type { RealEstateState } from './realestate/types';
import type { ProsState } from './pros/types';
import type { LegalState } from './legal/types';
import { initWorldV3 } from './worldInit';
import type { PossessionsState } from './lifestyle/types';
import type { WorldLifeState } from './world/types';
import type { CardTier } from '../content/cards';
import { STARTER_OUTFIT } from '../content/shops';
import { initWorldLife } from './world/rivals';
import type { SagaState } from './saga/types';
import { initSaga } from './saga/index';
import { CHALLENGE_BY_ID } from './saga/challenges';

export const SAVE_VERSION = 6;

export type PaymentMethod = 'checking' | 'card' | 'cash';

export interface RecurringItem {
  key: string;
  name: string;
  account: AccountId;
  amount: Cents;
  day: number;
  essential: boolean;
  method: PaymentMethod;
}

export interface BudgetState {
  lifestyle: LifestyleId;
  items: RecurringItem[];
  /** Seguro médico privado contratado por el jugador. */
  privateInsurance: boolean;
}

export interface TermDeposit {
  id: number;
  principal: Cents;
  rate: number;
  termMonths: number;
  startDay: number;
  maturityDay: number;
}

export interface CardState {
  active: boolean;
  limit: Cents;
  /** Tasa anual variable (fracción). */
  apr: number;
  statementBalance: Cents;
  minPayment: Cents;
  /** Día de vencimiento del último resumen; -1 si no hay resumen pendiente. */
  dueDay: number;
  paidSinceStatement: Cents;
  /** true si el último resumen no se pagó completo (se pierde el período de gracia). */
  revolving: boolean;
  autopay: 'none' | 'min' | 'full';
  cycleBalanceDays: number;
  cycleStartDay: number;
  fullPayStreak: number;
  /** Nivel de la tarjeta (1.2). */
  tier: CardTier;
  /** Día en que se cobra el próximo costo anual. */
  feeDay: number;
  /** Reintegro acumulado en el ciclo (se acredita en el resumen). */
  rewardsPending: Cents;
  rewardsTotal: Cents;
  /** Compras en cuotas pendientes. */
  installments: CardInstallment[];
  /** Última solicitud de cambio de nivel (para no pedir todos los días). */
  lastTierRequest: number;
}

export interface CardInstallment {
  id: number;
  desc: string;
  principal: Cents;
  /** Capital que falta pasar a los resúmenes. */
  remaining: Cents;
  n: number;
  paidCount: number;
  /** Cuota fija (capital + interés). */
  payment: Cents;
  /** Tasa mensual (0 = sin interés). */
  rate: number;
  startDay: number;
}

export interface Loan {
  id: number;
  bankId: string;
  principal: Cents;
  balance: Cents;
  apr: number;
  termMonths: number;
  payment: Cents;
  startDay: number;
  nextDueDay: number;
  paymentsMade: number;
  missedConsecutive: number;
  missedTotal: number;
  interestPaid: Cents;
  status: 'active' | 'paid' | 'default';
}

export interface BankState {
  savingsBalanceDays: number;
  checkingBalanceDays: number;
  deposits: TermDeposit[];
  card: CardState;
  loans: Loan[];
  /** Aporte voluntario del empleado a jubilación (fracción del bruto). */
  pensionRate: number;
  /** Transferir automáticamente desde ahorro si la cuenta corriente no alcanza. */
  overdraftSweep: boolean;
  /** Rebajas de tasa negociadas por banco (válidas 30 días). */
  rateNegotiations: Record<string, { day: number; discount: number }>;
}

export interface Employment {
  jobId: string;
  salary: Cents;
  startDay: number;
  paidThroughDay: number;
  performance: number;
  nextReviewDay: number;
  lastRaisePct: number;
  monthsInRole: number;
  lowPerfMonths: number;
}

export interface Application {
  id: number;
  jobId: string;
  appliedDay: number;
  resolveDay: number;
  status: 'pending' | 'rejected' | 'offer' | 'accepted' | 'declined' | 'expired' | 'withdrawn';
  chance: number;
  offerSalary?: Cents;
  offerExpiresDay?: number;
  negotiated: boolean;
  message?: string;
}

export interface JobHistoryItem {
  jobId: string;
  startDay: number;
  endDay: number;
  finalSalary: Cents;
  reason: 'renuncia' | 'ascenso' | 'despido' | 'cambio';
}

export interface CareerState {
  job: Employment | null;
  experience: Partial<Record<Sector, number>>;
  applications: Application[];
  history: JobHistoryItem[];
  careerPoints: number;
  promotions: number;
}

export interface SkillProgress {
  level: number;
  xp: number;
}

export interface ActiveCourse {
  courseId: string;
  startDay: number;
  endDay: number;
  /** XP ya otorgada por habilidad (para repartir exacto y sin pérdidas). */
  granted: Partial<Record<SkillId, number>>;
}

export interface EducationState {
  level: EducationLevel;
  fields: Field[];
  certificates: string[];
  active: ActiveCourse[];
  completed: Array<{ courseId: string; day: number }>;
}

export interface Filing extends TaxComputation {
  /** Fracción de ingresos no salariales ocultada (0 = honesta). */
  underreport?: number;
  fileDay: number;
  dueDay: number;
  status: 'due' | 'paid' | 'refund_pending' | 'refunded' | 'nothing';
  outstanding: Cents;
  penalties: Cents;
  paidDay?: number;
}

export interface TaxState {
  jurisdiction: JurisdictionId;
  /** Nueva residencia fiscal aprobada (rige desde el 1 de enero). */
  pendingJurisdiction: JurisdictionId | null;
  ytd: YearToDate;
  filings: Filing[];
  /** Pérdidas de capital arrastrables por año de origen. */
  capitalLossCarry: Array<{ year: number; amount: Cents }>;
  /** Estrategia de declaración del año en curso (evasión ficticia; 0 = honesta). */
  underreport: number;
}

export interface MacroState {
  /** Inflación anual vigente (se actualiza cada mes). */
  inflation: number;
  policyRate: number;
  priceIndex: number;
  history: Array<{ year: number; inflation: number; policyRate: number }>;
  phase: CyclePhase;
  phaseMonths: number;
  gdpGrowth: number;
  unemployment: number;
  confidence: number;
  supplierCost: number;
  /** Inflación acumulada desde el 1 de enero (para indexar gastos anuales). */
  yearInflationAcc: number;
  events: EconEvent[];
  monthly: MacroMonth[];
  /** Solo para escenarios del asesor: fuerza una fase. */
  forced?: { phase?: CyclePhase; until?: number } | null;
}

export interface GameOptions {
  difficulty: Difficulty;
  /** Actividades ilegales ficticias habilitadas. */
  illegalEnabled: boolean;
  /** Modo tranquilo (Fácil): ya se usó el perdón del primer atraso. */
  graceUsed?: boolean;
}

export interface CreditState {
  score: number;
  onTimePayments: number;
  latePayments: number[];
  defaults: number;
  /** Veces que un gasto quedó impago (atraso). */
  arrearsEvents: number;
  inquiries: number[];
  firstAccountDay: number;
  history: Array<{ day: number; score: number }>;
}

export interface MonthlySnapshot {
  day: number;
  netWorth: Cents;
  liquid: Cents;
  assets: Cents;
  liabilities: Cents;
  income: Cents;
  expenses: Cents;
  cashIn: Cents;
  cashOut: Cents;
  creditScore: number;
  stage: number;
}

export type LogKind = 'income' | 'expense' | 'info' | 'warning' | 'success' | 'danger';
/**
 * Categoría explícita de un evento para la pausa automática (no se deduce del
 * ícono). Sin categoría, un evento de tipo 'danger' cuenta como 'peligro'.
 */
export type LogCategory = 'peligro' | 'ofertas' | 'logros' | 'legal' | 'inversiones' | 'decisiones';

export interface LogItem {
  id: number;
  day: number;
  kind: LogKind;
  icon: string;
  text: string;
  amount?: Cents;
  /** Empresa relacionada (si el evento es empresarial). */
  company?: number;
  /** Categoría para la pausa automática (ver LogCategory). */
  cat?: LogCategory;
}

export interface Attributes {
  stress: number;
  health: number;
  reputation: number;
  network: number;
}

export interface PlayerState {
  name: string;
  background: BackgroundId;
  style: PlayStyle;
  color: string;
  attributes: Attributes;
}

export interface ProgressionState {
  stage: number;
  achievements: Record<string, number>;
}

export interface TutorialState {
  dismissed: boolean;
  completed: string[];
}

export interface MetaState {
  createdAtReal: number;
  lastRealTime: number;
  nextId: number;
  /** Proyección del asesor: sin eventos aleatorios, sin logs visibles. */
  projection: boolean;
  /** Registro de práctica por actividad: último día y XP otorgada ese día (anti-grinding). */
  practice: Record<string, { day: number; count: number }>;
  seenTerms: string[];
  /** Secciones recomendadas para más adelante que el jugador decidió abrir igual (1.2). */
  gatesOpened?: string[];
  /** Recompensas por anuncios usadas hoy (día real) y análisis preciso pendiente (1.3). */
  ads?: import('./rewards').AdRewardsState;
}

export interface GameState {
  version: number;
  seed: number;
  rng: number;
  day: number;
  player: PlayerState;
  ledger: LedgerState;
  bank: BankState;
  budget: BudgetState;
  career: CareerState;
  skills: Record<SkillId, SkillProgress>;
  education: EducationState;
  tax: TaxState;
  macro: MacroState;
  credit: CreditState;
  progression: ProgressionState;
  history: MonthlySnapshot[];
  log: LogItem[];
  tutorial: TutorialState;
  meta: MetaState;
  companies: Company[];
  markets: Record<string, MarketState>;
  listings: Listing[];
  formerCompanies: FormerCompany[];
  options: GameOptions;
  icLoans: IcLoan[];
  stocks: StockMarketState;
  bonds: BondsState;
  funds: FundsState;
  mogul: MogulState;
  managed: ManagedState;
  realEstate: RealEstateState;
  pros: ProsState;
  legal: LegalState;
  /** Ropa, vehículos, tecnología, hogar y lujo (1.2). */
  possessions: PossessionsState;
  /** Noticias, rivales y competencia (1.2). */
  world: WorldLifeState;
  /** La historia del magnate: clasificaciones, metas, dilemas, crónica y desafíos (1.4). */
  saga: SagaState;
}

export interface NewGameOptions {
  difficulty?: Difficulty;
  illegalEnabled?: boolean;
  name: string;
  background: BackgroundId;
  style: PlayStyle;
  seed?: string;
  color?: string;
  nowReal?: number;
  /** Apariencia elegida al crear el personaje (1.2). */
  look?: Partial<import('./lifestyle/types').Look>;
  /** Desafío con semilla (1.4): fija origen, estilo y semilla. */
  challenge?: string;
}

export const INITIAL_POLICY_RATE = 0.05;
export const INITIAL_INFLATION = 0.03;

export function newGame(input: NewGameOptions): GameState {
  const ch = input.challenge ? CHALLENGE_BY_ID[input.challenge] : undefined;
  const opts: NewGameOptions = ch ? { ...input, background: ch.background, style: ch.style, seed: ch.seed } : input;
  const bg = BACKGROUND_BY_ID[opts.background];
  const seed = seedFromString(opts.seed ?? `${opts.name}-${opts.nowReal ?? 0}`);
  const skills = {} as Record<SkillId, SkillProgress>;
  for (const s of SKILLS) skills[s.id] = { level: 1, xp: 0 };
  for (const [k, v] of Object.entries(bg.skills)) skills[k as SkillId].level = v as number;

  const state: GameState = {
    version: SAVE_VERSION,
    seed,
    rng: seed,
    day: 0,
    player: {
      name: opts.name.trim() || 'Jugador',
      background: bg.id,
      style: opts.style,
      color: opts.color ?? '#d9a441',
      attributes: { stress: 25, health: 80, reputation: 10, network: 5 },
    },
    ledger: emptyLedger(),
    bank: {
      savingsBalanceDays: 0,
      checkingBalanceDays: 0,
      deposits: [],
      card: {
        active: true,
        limit: usd(bg.cardLimit),
        apr: INITIAL_POLICY_RATE + CARD_SPREAD / 100,
        statementBalance: 0,
        minPayment: 0,
        dueDay: -1,
        paidSinceStatement: 0,
        revolving: false,
        autopay: 'none',
        cycleBalanceDays: 0,
        cycleStartDay: 0,
        fullPayStreak: 0,
        tier: 'clasica',
        feeDay: 365,
        rewardsPending: 0,
        rewardsTotal: 0,
        installments: [],
        lastTierRequest: -999,
      },
      loans: [],
      pensionRate: 0.05,
      overdraftSweep: true,
      rateNegotiations: {},
    },
    budget: { lifestyle: bg.lifestyle, items: [], privateInsurance: false },
    career: { job: null, experience: { ...bg.experience }, applications: [], history: [], careerPoints: 0, promotions: 0 },
    skills,
    education: { level: bg.education, fields: [...bg.fields], certificates: [], active: [], completed: [] },
    tax: { jurisdiction: 'valdoria', pendingJurisdiction: null, ytd: emptyYtd(dateOf(0).y), filings: [], capitalLossCarry: [], underreport: 0 },
    macro: { inflation: INITIAL_INFLATION, policyRate: INITIAL_POLICY_RATE, priceIndex: 1, history: [], ...newMacroV2(), forced: null },
    credit: { score: 0, onTimePayments: 0, latePayments: [], defaults: 0, arrearsEvents: 0, inquiries: [], firstAccountDay: 0, history: [] },
    progression: { stage: 1, achievements: {} },
    history: [],
    log: [],
    tutorial: { dismissed: false, completed: [] },
    meta: { createdAtReal: opts.nowReal ?? 0, lastRealTime: opts.nowReal ?? 0, nextId: 1, projection: false, practice: {}, seenTerms: [] },
    companies: [],
    markets: {},
    listings: [],
    formerCompanies: [],
    options: { difficulty: opts.difficulty ?? 'normal', illegalEnabled: opts.illegalEnabled ?? true },
    icLoans: [],
    stocks: { stocks: [], index: { level: 1000, base: 0, history: [] }, orders: [], holdings: {}, trades: [], dividendsReceived: 0 },
    bonds: { issues: [], holdings: {}, couponsReceived: 0 },
    funds: { funds: [], holdings: {}, distributionsReceived: 0 },
    mogul: { assets: [], holdings: {}, distributionsReceived: 0 },
    managed: { mandates: [], holdings: {} },
    realEstate: { zones: [], properties: [], mortgages: [], listings: [] },
    pros: { market: [], hires: [], audits: [], lastRefresh: -1 },
    legal: { heat: 0, acts: [], cases: [], fines: [], prison: null, criminalRecord: 0, ventures: [], log: [], lastTaxAudit: 0, contracts: [], inspections: [] },
    possessions: newPossessions(seed, opts.look),
    world: { news: [], rivals: [], intents: [], supplierShocks: [], poach: [], lastRead: 0 },
    saga: undefined as unknown as SagaState,
  };
  state.markets = initMarkets(state);
  initWorldV3(state);
  initWorldLife(state);

  // Suerte: rasgo fijo entre 30 y 70.
  state.skills.luck.level = 30 + Math.floor(((seed >>> 0) % 4001) / 100);

  state.budget.items = buildLifestyleItems(bg.lifestyle, 1);

  // Asiento de apertura: el dinero inicial proviene del patrimonio inicial.
  post(state.ledger, {
    day: 0,
    memo: 'Saldo de apertura',
    cf: 'internal',
    tag: 'opening',
    lines: [
      { account: 'cash_wallet', debit: usd(bg.startingCash) },
      { account: 'checking', debit: usd(bg.startingChecking) },
      { account: 'opening_equity', credit: usd(bg.startingCash + bg.startingChecking) },
    ],
  });
  refreshCreditScore(state);
  // El día 0 también cuenta para los saldos promedio del mes.
  state.bank.checkingBalanceDays = state.ledger.balances.checking;
  state.bank.savingsBalanceDays = state.ledger.balances.savings;
  initSaga(state, ch?.id);
  return state;
}

/** Guardarropa inicial: ropa básica usada puesta y apariencia elegida por la semilla. */
export function newPossessions(seed: number, look?: Partial<import('./lifestyle/types').Look>): PossessionsState {
  const items = STARTER_OUTFIT.map((x, i) => ({ uid: -(i + 1), itemId: x.id, boughtDay: 0, price: 0, carrying: 0, condition: x.condition }));
  return {
    items,
    outfit: { torso: -1, piernas: -2, calzado: -3 },
    look: { skin: (seed >>> 3) % 5, hair: (['corto', 'largo', 'rulos', 'recogido'] as const)[(seed >>> 7) % 4], hairColor: (seed >>> 11) % 4, ...(look ?? {}) },
    spent: 0,
  };
}

export function nextId(state: GameState): number {
  return state.meta.nextId++;
}
