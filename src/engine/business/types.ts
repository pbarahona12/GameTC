import type { Cents } from '../money';
import type { BizSectorId, LegalForm } from '../../content/sectors';
import type { CoLedger } from './companyLedger';
import type { JurisdictionId } from '../../content/jurisdictions';

/** Lote de inventario (FIFO). Las cantidades pueden ser fraccionarias (kg, litros). */
export interface Lot {
  item: string;
  qty: number;
  /** Costo unitario de compra en centavos (referencia). */
  unitCost: Cents;
  /** Valor contable restante del lote en centavos. Σ valores = cuenta Inventario. */
  value: Cents;
  expires: number | null;
  quality: number;
}

export interface PurchaseOrder {
  id: number;
  supplierId: string;
  item: string;
  qty: number;
  unitCost: Cents;
  total: Cents;
  orderDay: number;
  eta: number;
  prepaid: boolean;
  delayed: boolean;
}

export interface Payable {
  id: number;
  supplierId: string;
  amount: Cents;
  dueDay: number;
}

export interface Receivable {
  id: number;
  amount: Cents;
  dueDay: number;
}

export interface Arrear {
  id: number;
  kind: 'proveedor' | 'sueldos' | 'alquiler' | 'impuestos' | 'prestamo' | 'otros';
  amount: Cents;
  since: number;
  label: string;
}

export interface Employee {
  id: number;
  name: string;
  role: string;
  wage: Cents;
  skill: number;
  morale: number;
  hiredDay: number;
  absentUntil: number;
  trainingUntil: number;
}

export interface Candidate {
  id: number;
  name: string;
  role: string;
  skill: number;
  wage: Cents;
}

export interface FixedAsset {
  id: number;
  equipId: string;
  cost: Cents;
  bookValue: Cents;
  boughtDay: number;
  condition: number;
  brokenUntil: number;
}

export type Channel = 'digital' | 'redes' | 'tradicional' | 'patrocinio' | 'contenido' | 'promocion' | 'fidelizacion';

export type Audience = 'general' | 'jovenes' | 'empresas';

export interface Campaign {
  id: number;
  channel: Channel;
  audience: Audience;
  reach: number;
  dailyBudget: Cents;
  startDay: number;
  endDay: number;
  spent: Cents;
  awarenessGained: number;
}

export interface ProductState {
  id: string;
  price: Cents;
  active: boolean;
  /** Plan de producción diario (manufactura). */
  plan: number;
  /** Stock de producto terminado (manufactura). */
  finished: Lot[];
}

export interface ReorderRule {
  item: string;
  enabled: boolean;
  supplierId: string;
  reorderPoint: number;
  orderQty: number;
}

export interface DayStats {
  day: number;
  demand: Record<string, number>;
  sold: Record<string, number>;
  lost: Record<string, number>;
  used: Record<string, number>;
  revenue: Cents;
  capacityUsed: number;
  capacity: number;
  serviceUsed: number;
  serviceCapacity: number;
  lostReason: string;
}

export interface CoForecast {
  day: number;
  months: number;
  skill: number;
  survival: number;
  /** Por mes: [p10, p50, p90] en centavos. */
  revenue: Array<[number, number, number]>;
  net: Array<[number, number, number]>;
  /** Meses ya comparados. */
  checked: number;
}

export interface CoSnapshot {
  day: number;
  revenue: Cents;
  grossProfit: Cents;
  netIncome: Cents;
  cash: Cents;
  equity: Cents;
  inventory: Cents;
  employees: number;
  share: number;
  quality: number;
  reputation: number;
  awareness: number;
  subscribers?: number;
}

export interface CoLoan {
  id: number;
  bankId: string;
  principal: Cents;
  balance: Cents;
  apr: number;
  termMonths: number;
  payment: Cents;
  nextDueDay: number;
  paymentsMade: number;
  missed: number;
  guaranteed: boolean;
  /** Bono corporativo (1.4): solo intereses cada mes y el capital entero al vencer. */
  bullet?: boolean;
}

export interface Delegation {
  autoReorder: boolean;
  autoPricing: boolean;
  autoStaffing: boolean;
  targetMarkup: number;
}

export interface DividendPolicy {
  frequency: 'none' | 'monthly' | 'quarterly' | 'annual';
  payout: number;
  /** Reserva de caja mínima que no se reparte (días de gastos fijos). */
  reserveDays: number;
}

export type CompanyStatus = 'active' | 'insolvent' | 'bankrupt' | 'sold' | 'closed';

export interface Research {
  day: number;
  validUntil: number;
}

export interface Company {
  id: number;
  name: string;
  color: string;
  sector: BizSectorId;
  legalForm: LegalForm;
  foundedDay: number;
  acquiredDay: number | null;
  status: CompanyStatus;
  /** Participación del jugador (0–1). */
  ownership: number;
  /** Valor contable de la participación en el balance personal. */
  carrying: Cents;
  /** Plusvalía pagada al comprar (precio − patrimonio adquirido). */
  goodwill: Cents;
  ledger: CoLedger;
  products: ProductState[];
  inventory: Lot[];
  orders: PurchaseOrder[];
  payables: Payable[];
  receivables: Receivable[];
  arrears: Arrear[];
  rules: ReorderRule[];
  blockedSuppliers: string[];
  employees: Employee[];
  candidates: Candidate[];
  assets: FixedAsset[];
  maintenance: 'none' | 'basic' | 'preventive';
  campaigns: Campaign[];
  awareness: number;
  reputation: number;
  quality: number;
  materialQuality: number;
  rdBonus: number;
  subscribers: number;
  delegation: Delegation;
  /** Lo que decidió el gerente delegado en su última revisión semanal (1.3). */
  managerReport?: { day: number; items: string[] };
  dividendPolicy: DividendPolicy;
  stats: DayStats[];
  history: CoSnapshot[];
  loans: CoLoan[];
  lossCarry: Array<{ year: number; amount: Cents }>;
  insolventSince: number | null;
  research: Research | null;
  capitalRaised: Cents;
  lastWeeklyDay: number;
  /** Día en que abre al público (tras el período de instalación). */
  openDay: number;
  /** Empresa simulada para el mercado de compraventa (sin notificaciones). */
  npc: boolean;
  /** Proyección hecha antes de fundarla o comprarla (para comparar con la realidad). */
  forecast?: CoForecast | null;
  /** Dinero aportado y recibido por el jugador (para medir su resultado). */
  investedByOwner: Cents;
  receivedByOwner: Cents;
  saleOffer: { price: Cents; expires: number; from?: string } | null;
  /** Cotiza en la bolsa (1.4): salió a bolsa ese día con ese símbolo; historial de valor de mercado. */
  listed?: { day: number; ticker: string; floatPct: number; ipoValue: Cents; indexAtIpo: number; caps: Array<{ d: number; v: Cents }> } | null;
  taxFilings: CoTaxFiling[];
  /** Jurisdicción donde está registrada (impuesto de sociedades y dividendos). */
  jurisdiction: JurisdictionId;
  /** Empresa matriz (holding) si es subsidiaria. */
  parentId: number | null;
  /** Políticas de grupo (solo holdings). */
  group: GroupPolicy | null;
  /** Licencia suspendida por sanción judicial: no opera hasta ese día. */
  suspendedUntil: number | null;
  /** Irregularidades (ficticias) activas: libros inflados y ventas no declaradas. */
  irregular: { inflatedBooks: number; underreport: number };
  /** Honorario de gestión mensual que paga a la matriz (fracción de ventas). */
  managementFee: number;
  /** Desfalco de un empleado en curso (se descubre con contador o auditoría). */
  embezzlement: { monthly: Cents; since: number; total: Cents } | null;
}

export interface GroupPolicy {
  /** Porcentaje de las ganancias mensuales que las subsidiarias giran a la matriz como dividendos. */
  upstreamPayout: number;
  /** Centralizar caja: excedentes por encima de la reserva se prestan a la matriz. */
  cashPooling: boolean;
  /** Aplicar la delegación del gerente a todas las subsidiarias. */
  centralDelegation: boolean;
}

/** Préstamo entre empresas del jugador (intragrupo). */
export interface IcLoan {
  id: number;
  lenderId: number;
  borrowerId: number;
  principal: Cents;
  balance: Cents;
  rate: number;
  startDay: number;
  /** Vencimiento (se puede devolver antes). */
  dueDay: number;
  status: 'activo' | 'pagado' | 'incobrable';
}

export interface CoTaxFiling {
  year: number;
  /** Beneficio no declarado (evasión empresarial ficticia). */
  hidden?: Cents;
  profit: Cents;
  carryUsed: Cents;
  taxable: Cents;
  tax: Cents;
  dueDay: number;
  outstanding: Cents;
  passThrough: boolean;
  /** No se pudo pagar al vencer: pasó a deudas vencidas con multa. */
  late?: boolean;
}

export interface CompetitorState {
  id: number;
  name: string;
  priceMult: number;
  quality: number;
  reputation: number;
  awareness: number;
  active: boolean;
  enteredDay: number;
}

export interface MarketState {
  sector: BizSectorId;
  index: number;
  competitors: CompetitorState[];
}

export interface Listing {
  id: number;
  company: Company;
  askPrice: Cents;
  expiresDay: number;
  reason: string;
  negotiated: boolean;
  /** Contingencia oculta (juicios, deudas) que solo detecta un abogado. */
  hiddenLiability?: Cents;
}

export interface FormerCompany {
  id: number;
  name: string;
  sector: BizSectorId;
  endDay: number;
  outcome: 'vendida' | 'liquidada' | 'quiebra' | 'fusionada';
  result: Cents;
}
