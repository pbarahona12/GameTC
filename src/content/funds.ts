/** Fondos de inversión FICTICIOS. */
export type FundKind = 'indice' | 'sector' | 'dividendos' | 'bonos' | 'monetario' | 'inmobiliario';

export interface FundDef {
  id: string;
  name: string;
  kind: FundKind;
  /** Comisión anual de administración (se descuenta del valor diariamente). */
  fee: number;
  /** Comisión de entrada (fracción del monto invertido). */
  entryFee: number;
  risk: number;
  /** Reparte rendimientos trimestralmente (si no, los reinvierte). */
  distributes: boolean;
  /** Acciones que componen el fondo (sector/dividendos). */
  holdings?: string[];
  description: string;
  howItWorks: string;
  risks: string;
}

export const FUND_DEFS: FundDef[] = [
  { id: 'F-IDX', name: 'Fondo Índice Valoria', kind: 'indice', fee: 0.002, entryFee: 0, risk: 4, distributes: false,
    description: 'Replica el índice de la bolsa: compra todas las acciones en proporción a su tamaño.',
    howItWorks: 'Su valor sigue al índice día a día y reinvierte los dividendos. Comisión anual muy baja (0.2 %).',
    risks: 'Cae junto con toda la bolsa en recesiones o pánicos. Diversificado, pero no protegido.' },
  { id: 'F-TEC', name: 'Fondo Tecnología', kind: 'sector', fee: 0.008, entryFee: 0, risk: 5, distributes: false, holdings: ['NBLA', 'CIRQ', 'ONDA', 'TELV'],
    description: 'Concentra acciones tecnológicas y de telecomunicaciones.',
    howItWorks: 'Promedio de sus acciones (pesos iguales). Comisión anual 0.8 %.',
    risks: 'Muy volátil y sensible a las tasas de interés: puede caer mucho más que el índice.' },
  { id: 'F-DIV', name: 'Fondo Dividendos', kind: 'dividendos', fee: 0.005, entryFee: 0, risk: 3, distributes: true, holdings: ['TELV', 'PLZA', 'PTRS', 'MRKT', 'BVAL'],
    description: 'Empresas maduras que reparten dividendos altos.',
    howItWorks: 'Cobra los dividendos de sus acciones y los reparte cada trimestre. Comisión 0.5 %.',
    risks: 'Crece poco; sus empresas pueden recortar dividendos en crisis.' },
  { id: 'F-BON', name: 'Fondo de Bonos Soberanos', kind: 'bonos', fee: 0.003, entryFee: 0, risk: 2, distributes: true,
    description: 'Cartera de bonos de gobiernos con buena calificación.',
    howItWorks: 'Cobra cupones y los reparte cada trimestre. Su valor cae cuando suben las tasas y sube cuando bajan.',
    risks: 'Riesgo de tasa de interés; bajo riesgo de impago.' },
  { id: 'F-MON', name: 'Fondo Monetario', kind: 'monetario', fee: 0.004, entryFee: 0, risk: 1, distributes: false,
    description: 'Invierte en depósitos y letras a muy corto plazo.',
    howItWorks: 'Crece todos los días al ritmo de la tasa de política menos 0.6 puntos (su comisión de 0.4 % y los costos de las letras). Se puede retirar en cualquier momento.',
    risks: 'Casi sin riesgo, pero su rendimiento puede quedar por debajo de la inflación.' },
  { id: 'F-REIT', name: 'Fondo Inmobiliario (REIT)', kind: 'inmobiliario', fee: 0.007, entryFee: 0.01, risk: 3, distributes: true,
    description: 'Invierte en edificios alquilados de varias zonas.',
    howItWorks: 'Reparte los alquileres cada trimestre y su valor sigue los precios inmobiliarios. Comisión de entrada 1 % y anual 0.7 %.',
    risks: 'Cae con los precios de los inmuebles. El reparto es fijo (alrededor del 5 % anual de su valor), aunque suba la vacancia.' },
];

export const FUND_BY_ID: Record<string, FundDef> = Object.fromEntries(FUND_DEFS.map((f) => [f.id, f]));
