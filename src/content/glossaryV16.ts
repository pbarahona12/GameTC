import type { GlossaryEntry } from './glossary';

/** Versión 1.6: escala, medio de la partida y estilos parejos (fase 2 de la auditoría). */
export const GLOSSARY_V16: GlossaryEntry[] = [
  { id: 'sucursales', term: 'Sucursales y mercados por ciudad', category: 'Empresas',
    short: 'Locales extra de una misma empresa, en la capital o en otras ciudades. Cada ciudad tiene su propio mercado.',
    purpose: 'Crecer más allá del mercado de una sola ciudad: de un local a una cadena.',
    how: 'El local principal de toda empresa está en Valdoria. Abrir una sucursal cuesta licencia, depósito, equipos y la selección del personal inicial, tarda 14 días y exige un gerente y 3 meses de historia. Cada local paga alquiler y servicios todos los meses. En otra ciudad, la sucursal abre ese mercado (Distrito Real 80 %, Puerto Nuevo 65 %, Costa Esmeralda 30 % del tamaño de la capital); en la misma ciudad suma presencia con rendimientos decrecientes (2 locales captan ≈ 1,5 veces lo que uno, 3 locales ≈ 1,9 veces). Tus empresas del mismo rubro en la misma ciudad se quitan clientes entre sí.',
    example: 'Una cafetería que vende 120 cafés por día en Valdoria abre en Distrito Real: con la misma calidad y precio, vende allá unos 95 más, pero paga otro alquiler y más sueldos.',
    impact: 'Más ventas, más valor de la empresa y más presencia para las etapas altas; también más costos fijos.',
    risks: 'Expandir una empresa que pierde plata multiplica las pérdidas. Si los locales no tienen personal suficiente, se pierden ventas por capacidad.' },
  { id: 'fortuna_estimada', term: 'Fortuna estimada', category: 'Mercado y competencia',
    short: 'Cómo te miden las listas: tu patrimonio, pero con tus empresas a lo que valdrían si las vendieras.',
    purpose: 'Que la lista reaccione a lo que construís: una empresa muy rentable vale mucho más que su capital en libros.',
    how: 'Al cierre de cada mes se valúa cada empresa tuya (ganancias × múltiplo del rubro, valor de activos o ingresos recurrentes, lo que dé más) por tu participación, y se compara con su valor contable. La diferencia se suma (o se resta) a tu patrimonio solo para las listas: tu balance no cambia.',
    formula: 'Fortuna estimada = patrimonio neto + Σ (valoración × tu participación − valor contable)',
    example: 'Tu consultora tiene $200 mil en libros, pero gana $150 mil por año: con un múltiplo de 4 vale unos $600 mil. En la lista figurás con $400 mil más que tu patrimonio contable.',
    impact: 'Subís en la lista con ganancias recurrentes, no solo con caja.' },
];
