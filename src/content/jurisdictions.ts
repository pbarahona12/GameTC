/**
 * Jurisdicciones fiscales FICTICIAS. Cada una tiene reglas propias con
 * ventajas y desventajas reales para el jugador. Todo está escrito como datos:
 * el motor fiscal (`tax/incomeTax.ts`) aplica estas reglas sin casos especiales.
 */
export interface Bracket {
  upTo: number | null; // USD anuales; null = sin tope
  rate: number;
}

export type JurisdictionId = 'valdoria' | 'isla_coral' | 'norvalia' | 'meridia';

export interface Jurisdiction {
  id: JurisdictionId;
  name: string;
  flag: string;
  summary: string;
  currency: string;
  incomeBrackets: Bracket[];
  socialSecurityRate: number;
  socialSecurityMonthlyCap: number;
  maxPensionDeductionRate: number;
  educationCreditRate: number;
  educationCreditMax: number;
  filingDeadline: { month: number; day: number };
  refundDate: { month: number; day: number };
  latePenaltyRate: number;
  lateMonthlyInterest: number;
  /** Ganancias de capital: tasa corta, tasa larga (tras `longAfterDays`), años de arrastre de pérdidas. */
  capitalGains: { shortRate: number; longRate: number; longAfterDays: number; lossCarryYears: number };
  /** Retención final sobre dividendos (acciones cotizadas y empresas propias con sede aquí). */
  dividendRate: number;
  /** Alquileres: tributan como renta ordinaria; ¿se deduce la depreciación del edificio y los intereses hipotecarios? */
  rental: { depreciationYears: number; mortgageInterestDeductible: boolean; lossOffsetsOrdinary: boolean };
  /** Impuesto de sociedades (SRL y corporaciones con sede aquí). */
  corporateRate: number;
  /** Impuesto inmobiliario anual sobre la tasación. */
  propertyTaxRate: number;
  /** Impuesto de transferencia que paga el comprador de un inmueble. */
  transferTaxRate: number;
  /** Hipotecas con recurso: si el remate no cubre la deuda, el resto se sigue debiendo. */
  mortgageRecourse: boolean;
  /** Intensidad de controles (auditorías y detección de ilícitos). */
  enforcement: number;
  /** Probabilidad anual base de auditoría fiscal a personas. */
  auditRate: number;
  /** Costo de vida relativo (multiplica gastos de vida). */
  costOfLiving: number;
  /** Costo de mudar la residencia fiscal (USD). */
  moveCost: number;
  /** Requisito de patrimonio para obtener la residencia (USD). */
  minNetWorth: number;
  /** Gasto administrativo mensual extra para empresas registradas aquí siendo residente de otro lugar. */
  foreignCompanyAdmin: number;
  notes: string[];
}

export const VALDORIA: Jurisdiction = {
  id: 'valdoria',
  name: 'República de Valdoria',
  flag: '🟦',
  summary: 'Sistema equilibrado: impuestos moderados y reglas simples.',
  currency: 'USD',
  incomeBrackets: [
    { upTo: 9600, rate: 0 },
    { upTo: 24000, rate: 0.1 },
    { upTo: 60000, rate: 0.2 },
    { upTo: 150000, rate: 0.3 },
    { upTo: null, rate: 0.37 },
  ],
  socialSecurityRate: 0.07,
  socialSecurityMonthlyCap: 12000,
  maxPensionDeductionRate: 0.15,
  educationCreditRate: 0.15,
  educationCreditMax: 600,
  filingDeadline: { month: 4, day: 30 },
  refundDate: { month: 5, day: 15 },
  latePenaltyRate: 0.05,
  lateMonthlyInterest: 0.01,
  capitalGains: { shortRate: 0.15, longRate: 0.15, longAfterDays: 365, lossCarryYears: 5 },
  dividendRate: 0.1,
  rental: { depreciationYears: 40, mortgageInterestDeductible: true, lossOffsetsOrdinary: true },
  corporateRate: 0.25,
  propertyTaxRate: 0.01,
  transferTaxRate: 0.03,
  mortgageRecourse: true,
  enforcement: 1,
  auditRate: 0.03,
  costOfLiving: 1,
  moveCost: 3000,
  minNetWorth: 0,
  foreignCompanyAdmin: 0,
  notes: [
    'Impuesto sobre la renta progresivo por tramos: cada tasa se aplica solo a la porción del ingreso dentro de su tramo.',
    'Los primeros $9,600 anuales están exentos (tramo al 0 %).',
    'Los intereses (ahorro, depósitos, bonos) tributan como renta ordinaria en la declaración anual.',
    'Los aportes del empleado al fondo de jubilación son deducibles hasta el 15 % del salario bruto.',
    'Crédito educativo: 15 % de lo gastado en educación, máximo $600 al año, no reembolsable.',
    'Ganancias de capital (acciones, bonos, fondos, Mogul, inmuebles): 15 % sobre la ganancia neta del año; las pérdidas se arrastran 5 años.',
    'Dividendos: retención final del 10 %.',
    'Alquileres: renta ordinaria. Se deducen gastos, impuesto inmobiliario, intereses hipotecarios y la depreciación del edificio (40 años). Una pérdida de alquiler reduce el resto de tus ingresos.',
    'Impuesto de sociedades 25 %. Impuesto inmobiliario 1 % anual de la tasación. Transferencia de inmuebles 3 %.',
    'Hipotecas con recurso: si un remate no cubre la deuda, seguís debiendo la diferencia.',
    'La declaración se presenta automáticamente el 31 de diciembre; el saldo a pagar vence el 30 de abril. Pagar tarde: multa del 5 % más 1 % mensual.',
  ],
};

export const ISLA_CORAL: Jurisdiction = {
  id: 'isla_coral',
  name: 'Principado de Isla Coral',
  flag: '🏝️',
  summary: 'Paraíso fiscal: casi sin impuestos, pero vivir allí es caro y la residencia exige patrimonio.',
  currency: 'USD',
  incomeBrackets: [
    { upTo: 30000, rate: 0 },
    { upTo: null, rate: 0.05 },
  ],
  socialSecurityRate: 0.04,
  socialSecurityMonthlyCap: 8000,
  maxPensionDeductionRate: 0,
  educationCreditRate: 0,
  educationCreditMax: 0,
  filingDeadline: { month: 6, day: 30 },
  refundDate: { month: 7, day: 15 },
  latePenaltyRate: 0.1,
  lateMonthlyInterest: 0.015,
  capitalGains: { shortRate: 0, longRate: 0, longAfterDays: 0, lossCarryYears: 0 },
  dividendRate: 0,
  rental: { depreciationYears: 0, mortgageInterestDeductible: false, lossOffsetsOrdinary: false },
  corporateRate: 0.1,
  propertyTaxRate: 0.004,
  transferTaxRate: 0.07,
  mortgageRecourse: false,
  enforcement: 0.6,
  auditRate: 0.01,
  costOfLiving: 1.4,
  moveCost: 15000,
  minNetWorth: 150000,
  foreignCompanyAdmin: 400,
  notes: [
    'Renta personal: 0 % hasta $30,000 y 5 % sobre el excedente. Sin deducciones ni créditos.',
    'Sin impuesto a las ganancias de capital ni a los dividendos.',
    'Impuesto de sociedades 10 %. Una empresa registrada aquí siendo residente en otro país paga $400 mensuales de administración (agente residente).',
    'Impuesto inmobiliario bajo (0.4 %), pero la transferencia de inmuebles cuesta 7 %.',
    'Hipotecas sin recurso: si el remate no cubre la deuda, el banco asume la pérdida.',
    'Costo de vida 40 % más alto. Residencia por inversión: patrimonio neto mínimo de $150,000 y $15,000 de trámites.',
    'Controles fiscales laxos (auditorías poco frecuentes), aunque los ilícitos igual pueden detectarse.',
  ],
};

export const NORVALIA: Jurisdiction = {
  id: 'norvalia',
  name: 'Reino de Norvalia',
  flag: '🟥',
  summary: 'Impuestos altos con deducciones y créditos generosos; controles estrictos.',
  currency: 'USD',
  incomeBrackets: [
    { upTo: 12000, rate: 0 },
    { upTo: 40000, rate: 0.15 },
    { upTo: 90000, rate: 0.28 },
    { upTo: 180000, rate: 0.38 },
    { upTo: null, rate: 0.45 },
  ],
  socialSecurityRate: 0.09,
  socialSecurityMonthlyCap: 15000,
  maxPensionDeductionRate: 0.2,
  educationCreditRate: 0.3,
  educationCreditMax: 1500,
  filingDeadline: { month: 3, day: 31 },
  refundDate: { month: 4, day: 30 },
  latePenaltyRate: 0.05,
  lateMonthlyInterest: 0.01,
  capitalGains: { shortRate: 0.3, longRate: 0.15, longAfterDays: 365, lossCarryYears: 10 },
  dividendRate: 0.2,
  rental: { depreciationYears: 33, mortgageInterestDeductible: true, lossOffsetsOrdinary: true },
  corporateRate: 0.28,
  propertyTaxRate: 0.013,
  transferTaxRate: 0.02,
  mortgageRecourse: true,
  enforcement: 1.4,
  auditRate: 0.06,
  costOfLiving: 1.15,
  moveCost: 6000,
  minNetWorth: 0,
  foreignCompanyAdmin: 150,
  notes: [
    'Renta progresiva hasta 45 %. Primeros $12,000 exentos.',
    'Jubilación: aportes deducibles hasta el 20 % del salario. Crédito educativo del 30 % (máximo $1,500).',
    'Ganancias de capital: 30 % si vendés antes de un año, 15 % después. Pérdidas arrastrables 10 años.',
    'Dividendos: retención del 20 %.',
    'Alquileres: depreciación en 33 años e intereses hipotecarios deducibles; las pérdidas compensan otros ingresos.',
    'Impuesto de sociedades 28 %. Inmobiliario 1.3 %. Transferencia 2 %.',
    'Controles estrictos: más auditorías y mayor probabilidad de detectar irregularidades.',
  ],
};

export const MERIDIA: Jurisdiction = {
  id: 'meridia',
  name: 'Federación de Meridia',
  flag: '🟩',
  summary: 'Favorece la inversión a largo plazo y a las empresas; impuesto inmobiliario alto.',
  currency: 'USD',
  incomeBrackets: [
    { upTo: 11000, rate: 0 },
    { upTo: 45000, rate: 0.12 },
    { upTo: 100000, rate: 0.22 },
    { upTo: 200000, rate: 0.32 },
    { upTo: null, rate: 0.37 },
  ],
  socialSecurityRate: 0.062,
  socialSecurityMonthlyCap: 13000,
  maxPensionDeductionRate: 0.15,
  educationCreditRate: 0.2,
  educationCreditMax: 1000,
  filingDeadline: { month: 4, day: 15 },
  refundDate: { month: 5, day: 1 },
  latePenaltyRate: 0.05,
  lateMonthlyInterest: 0.0075,
  capitalGains: { shortRate: 0.22, longRate: 0.1, longAfterDays: 365, lossCarryYears: 99 },
  dividendRate: 0.15,
  rental: { depreciationYears: 27.5, mortgageInterestDeductible: true, lossOffsetsOrdinary: false },
  corporateRate: 0.21,
  propertyTaxRate: 0.018,
  transferTaxRate: 0.01,
  mortgageRecourse: true,
  enforcement: 1.1,
  auditRate: 0.04,
  costOfLiving: 1.1,
  moveCost: 5000,
  minNetWorth: 0,
  foreignCompanyAdmin: 120,
  notes: [
    'Renta progresiva de 12 % a 37 %. Primeros $11,000 exentos.',
    'Ganancias de capital: 22 % a corto plazo y solo 10 % si mantenés la inversión más de un año. Pérdidas arrastrables sin límite.',
    'Dividendos: 15 %. Impuesto de sociedades 21 % (el más bajo entre los países con controles normales).',
    'Alquileres: depreciación rápida (27.5 años) e intereses deducibles, pero las pérdidas de alquiler NO compensan otros ingresos.',
    'Impuesto inmobiliario alto: 1.8 % anual. Transferencia solo 1 %.',
    'Crédito educativo 20 % (máximo $1,000).',
  ],
};

export const JURISDICTIONS: Jurisdiction[] = [VALDORIA, ISLA_CORAL, NORVALIA, MERIDIA];
export const JURISDICTION_BY_ID: Record<JurisdictionId, Jurisdiction> = Object.fromEntries(JURISDICTIONS.map((j) => [j.id, j])) as Record<JurisdictionId, Jurisdiction>;

export function jurisdictionById(id: string | undefined): Jurisdiction {
  return JURISDICTION_BY_ID[(id ?? 'valdoria') as JurisdictionId] ?? VALDORIA;
}
