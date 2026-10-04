/**
 * Plan de cuentas personal (Fase 1).
 *
 * - Activo y Gasto: saldo de naturaleza deudora (aumentan con el Debe).
 * - Pasivo, Patrimonio e Ingreso: naturaleza acreedora (aumentan con el Haber).
 *
 * `noNegative`: el saldo nunca puede quedar por debajo de cero. Es la regla que
 * impide gastar dinero que no existe (no hay descubiertos implícitos).
 */
export type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface AccountDef {
  id: AccountId;
  name: string;
  type: AccountType;
  /** Efectivo o equivalente de disponibilidad inmediata. */
  cashEquivalent?: boolean;
  noNegative?: boolean;
  /** Término del glosario que explica la cuenta. */
  term?: string;
  /** Para agrupar gastos en el presupuesto e informes. */
  group?: 'living' | 'financial' | 'tax' | 'education' | 'other' | 'property' | 'legal';
  /** Ingreso que no es flujo de caja (revalorizaciones). */
  nonCash?: boolean;
}

export const ACCOUNTS = {
  // ACTIVOS
  cash_wallet: { name: 'Efectivo', type: 'asset', cashEquivalent: true, noNegative: true, term: 'efectivo' },
  checking: { name: 'Cuenta corriente', type: 'asset', cashEquivalent: true, noNegative: true, term: 'cuenta_corriente' },
  savings: { name: 'Cuenta de ahorro', type: 'asset', cashEquivalent: true, noNegative: true, term: 'cuenta_ahorro' },
  term_deposits: { name: 'Depósitos a plazo', type: 'asset', noNegative: true, term: 'deposito_plazo' },
  pension: { name: 'Fondo de jubilación', type: 'asset', noNegative: true, term: 'jubilacion' },
  tax_receivable: { name: 'Devolución de impuestos por cobrar', type: 'asset', noNegative: true, term: 'retencion' },
  business_equity: { name: 'Participaciones en empresas', type: 'asset', noNegative: true, term: 'metodo_participacion' },
  stocks: { name: 'Acciones (valor de mercado)', type: 'asset', noNegative: true, term: 'accion' },
  bonds: { name: 'Bonos (valor de mercado)', type: 'asset', noNegative: true, term: 'bono' },
  funds: { name: 'Fondos de inversión', type: 'asset', noNegative: true, term: 'fondo_inversion' },
  mogul: { name: 'Participaciones Mogul Exchange', type: 'asset', noNegative: true, term: 'mogul_exchange' },
  managed: { name: 'Cartera con gestor', type: 'asset', noNegative: true, term: 'gestor_inversiones' },
  real_estate: { name: 'Inmuebles (tasación)', type: 'asset', noNegative: true, term: 'inmueble' },
  undeclared_cash: { name: 'Efectivo no declarado', type: 'asset', noNegative: true, term: 'efectivo_no_declarado' },
  personal_assets: { name: 'Bienes personales (vehículos, tecnología, hogar, lujo)', type: 'asset', noNegative: true, term: 'bienes_personales' },
  // PASIVOS
  credit_card: { name: 'Tarjeta de crédito', type: 'liability', noNegative: true, term: 'tarjeta_credito' },
  personal_loans: { name: 'Préstamos personales', type: 'liability', noNegative: true, term: 'prestamo' },
  taxes_payable: { name: 'Impuestos por pagar', type: 'liability', noNegative: true, term: 'declaracion_fiscal' },
  arrears: { name: 'Pagos vencidos (atrasos)', type: 'liability', noNegative: true, term: 'mora' },
  mortgages: { name: 'Hipotecas', type: 'liability', noNegative: true, term: 'hipoteca' },
  fines_payable: { name: 'Multas y sanciones por pagar', type: 'liability', noNegative: true, term: 'multa' },
  card_installments: { name: 'Cuotas de tarjeta a vencer', type: 'liability', noNegative: true, term: 'cuotas_tarjeta' },
  // PATRIMONIO
  opening_equity: { name: 'Patrimonio inicial', type: 'equity', term: 'patrimonio_neto' },
  // INGRESOS
  salary_income: { name: 'Salario bruto', type: 'income', term: 'salario_bruto' },
  bonus_income: { name: 'Bonos y comisiones', type: 'income', term: 'salario_bruto' },
  benefits_income: { name: 'Aporte del empleador a jubilación', type: 'income', term: 'jubilacion' },
  interest_income: { name: 'Intereses ganados', type: 'income', term: 'interes_compuesto' },
  other_income: { name: 'Otros ingresos', type: 'income' },
  business_results: { name: 'Resultado de empresas propias', type: 'income', term: 'metodo_participacion' },
  dividend_income: { name: 'Dividendos y distribuciones', type: 'income', term: 'dividendos' },
  bond_interest: { name: 'Cupones de bonos', type: 'income', term: 'cupon' },
  rental_income: { name: 'Alquileres cobrados', type: 'income', term: 'alquiler' },
  realized_gains: { name: 'Ganancias de capital realizadas', type: 'income', term: 'ganancia_capital' },
  unrealized_gains: { name: 'Revalorización no realizada', type: 'income', term: 'ganancia_no_realizada', nonCash: true },
  illicit_income: { name: 'Ingresos no declarados (ficticio)', type: 'income', term: 'efectivo_no_declarado' },
  card_rewards: { name: 'Reintegros de tarjeta', type: 'income', term: 'reintegro_tarjeta' },
  // GASTOS DE VIDA
  housing: { name: 'Vivienda', type: 'expense', group: 'living' },
  food: { name: 'Alimentación', type: 'expense', group: 'living' },
  transport: { name: 'Transporte', type: 'expense', group: 'living' },
  utilities: { name: 'Servicios y teléfono', type: 'expense', group: 'living' },
  leisure: { name: 'Ocio y estilo de vida', type: 'expense', group: 'living' },
  health: { name: 'Salud', type: 'expense', group: 'living' },
  shopping: { name: 'Ropa y compras personales', type: 'expense', group: 'living', term: 'imagen_personal' },
  education: { name: 'Educación', type: 'expense', group: 'education' },
  // GASTOS FINANCIEROS
  interest_expense: { name: 'Intereses pagados', type: 'expense', group: 'financial', term: 'interes' },
  bank_fees: { name: 'Comisiones bancarias', type: 'expense', group: 'financial', term: 'comision' },
  loan_fees: { name: 'Comisiones de apertura', type: 'expense', group: 'financial', term: 'comision' },
  late_fees: { name: 'Recargos por mora', type: 'expense', group: 'financial', term: 'mora' },
  // IMPUESTOS
  income_tax: { name: 'Impuesto sobre la renta', type: 'expense', group: 'tax', term: 'impuesto_progresivo' },
  social_security: { name: 'Seguridad social', type: 'expense', group: 'tax', term: 'seguridad_social' },
  tax_penalties: { name: 'Multas fiscales', type: 'expense', group: 'tax' },
  dividend_tax: { name: 'Impuesto sobre dividendos', type: 'expense', group: 'tax', term: 'dividendos' },
  capital_gains_tax: { name: 'Impuesto a la ganancia de capital', type: 'expense', group: 'tax', term: 'ganancia_capital' },
  acquisition_costs: { name: 'Costos de compraventa (empresas e inmuebles)', type: 'expense', group: 'other', term: 'costo_adquisicion' },
  brokerage_fees: { name: 'Comisiones de inversión', type: 'expense', group: 'financial', term: 'comision_corretaje' },
  property_expenses: { name: 'Mantenimiento y administración de inmuebles', type: 'expense', group: 'property', term: 'gastos_inmueble' },
  property_tax: { name: 'Impuesto inmobiliario', type: 'expense', group: 'tax', term: 'impuesto_inmobiliario' },
  inheritance_tax: { name: 'Impuesto a la herencia', type: 'expense', group: 'tax', term: 'legado' },
  professional_fees: { name: 'Honorarios profesionales', type: 'expense', group: 'other', term: 'profesionales' },
  legal_costs: { name: 'Costos legales y judiciales', type: 'expense', group: 'legal', term: 'defensa_legal' },
  fines: { name: 'Multas y sanciones', type: 'expense', group: 'legal', term: 'multa' },
  illicit_costs: { name: 'Pagos no documentados (ficticio)', type: 'expense', group: 'legal', term: 'soborno' },
  seizures: { name: 'Decomisos y embargos', type: 'expense', group: 'legal', term: 'embargo' },
  goods_depreciation: { name: 'Depreciación de bienes personales', type: 'expense', group: 'other', term: 'bienes_personales' },
  other_expense: { name: 'Otros gastos', type: 'expense', group: 'other' },
} as const satisfies Record<string, Omit<AccountDef, 'id'>>;

export type AccountId = keyof typeof ACCOUNTS;

export const ACCOUNT_IDS = Object.keys(ACCOUNTS) as AccountId[];

export function accountDef(id: AccountId): AccountDef {
  return { id, ...(ACCOUNTS[id] as Omit<AccountDef, 'id'>) };
}

export const CASH_ACCOUNTS: AccountId[] = ACCOUNT_IDS.filter((id) => accountDef(id).cashEquivalent);
export const EXPENSE_ACCOUNTS: AccountId[] = ACCOUNT_IDS.filter((id) => ACCOUNTS[id].type === 'expense');
export const INCOME_ACCOUNTS: AccountId[] = ACCOUNT_IDS.filter((id) => ACCOUNTS[id].type === 'income');
export const ASSET_ACCOUNTS: AccountId[] = ACCOUNT_IDS.filter((id) => ACCOUNTS[id].type === 'asset');
export const LIABILITY_ACCOUNTS: AccountId[] = ACCOUNT_IDS.filter((id) => ACCOUNTS[id].type === 'liability');
