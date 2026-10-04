import type { JurisdictionId } from './jurisdictions';
import type { FortuneSource } from '../engine/saga/types';
import type { StockSector } from '../engine/invest/types';

/**
 * CIUDADES DEL MUNDO DEL JUEGO: la ciudad principal de cada jurisdicción.
 * Tu ciudad es la de tu residencia fiscal: mudarte cambia en qué lista competís.
 *
 * La distribución de fortunas de cada ciudad sigue una ley de potencias (pocas
 * fortunas enormes y muchas medianas), como en las listas reales: el puesto 1
 * y el puesto 100 (a precios iniciales) fijan la curva.
 */
export interface CityDef {
  id: JurisdictionId;
  name: string;
  /** Adultos de la ciudad (para estimar tu puesto fuera del top 100). */
  adults: number;
  /** Fortuna del número 1 y del número 100 al empezar (USD a precios iniciales). */
  top1: number;
  top100: number;
  /** De dónde suelen venir las fortunas de la ciudad (pesos relativos). */
  sources: Partial<Record<FortuneSource, number>>;
  blurb: string;
}

export const CITIES: CityDef[] = [
  { id: 'valdoria', name: 'Valdoria', adults: 2_100_000, top1: 3_200_000_000, top100: 4_000_000,
    sources: { industria: 3, comercio: 3, inmuebles: 3, finanzas: 2, tecnologia: 1, herencia: 2, salud: 1 },
    blurb: 'La capital: fortunas industriales, comercios y bienes raíces.' },
  { id: 'isla_coral', name: 'Costa Esmeralda', adults: 160_000, top1: 5_500_000_000, top100: 9_000_000,
    sources: { finanzas: 4, herencia: 4, inmuebles: 3, energia: 1 },
    blurb: 'Pocos habitantes y mucho dinero: fondos, herederos y residencias de lujo.' },
  { id: 'norvalia', name: 'Distrito Real', adults: 1_400_000, top1: 4_200_000_000, top100: 7_000_000,
    sources: { herencia: 3, industria: 3, energia: 2, salud: 2, finanzas: 2 },
    blurb: 'Dinastías industriales y energéticas en un mercado maduro.' },
  { id: 'meridia', name: 'Puerto Nuevo', adults: 900_000, top1: 1_600_000_000, top100: 2_500_000,
    sources: { tecnologia: 4, comercio: 3, energia: 2, inmuebles: 2 },
    blurb: 'Ciudad joven: fortunas nuevas de tecnología, comercio y puertos.' },
];

export const CITY_BY_ID = Object.fromEntries(CITIES.map((c) => [c.id, c])) as Record<JurisdictionId, CityDef>;

export const SOURCE_INFO: Record<FortuneSource, { label: string; sector?: StockSector; icon: string }> = {
  tecnologia: { label: 'Tecnología', sector: 'tecnologia', icon: 'tech' },
  finanzas: { label: 'Finanzas e inversiones', sector: 'banca', icon: 'invest' },
  inmuebles: { label: 'Bienes raíces', sector: 'inmobiliaria', icon: 'realestate' },
  industria: { label: 'Industria', sector: 'industria', icon: 'business' },
  comercio: { label: 'Comercio y consumo', sector: 'consumo', icon: 'store' },
  energia: { label: 'Energía', sector: 'energia', icon: 'bolt' },
  salud: { label: 'Salud', sector: 'salud', icon: 'shield' },
  herencia: { label: 'Herencia familiar', icon: 'crown' },
};

/** Nombres ficticios para las fortunas del mundo (cualquier parecido es casual). */
export const FIRST_NAMES = [
  'Adrián', 'Agustina', 'Alba', 'Alejandro', 'Amparo', 'Andrés', 'Antonella', 'Aurora', 'Benjamín', 'Bruno', 'Camila', 'Carmen', 'Catalina', 'Cecilia',
  'Clara', 'Cristóbal', 'Daniela', 'Diego', 'Elena', 'Emilia', 'Emilio', 'Esteban', 'Federico', 'Fernanda', 'Gabriel', 'Gonzalo', 'Graciela', 'Héctor',
  'Inés', 'Ignacio', 'Irene', 'Isabel', 'Javier', 'Jimena', 'Joaquín', 'Julia', 'Julián', 'Laura', 'Leandro', 'Lorena', 'Lucas', 'Lucía', 'Manuel',
  'Mara', 'Marcela', 'Mariano', 'Martina', 'Mateo', 'Matilde', 'Mercedes', 'Miguel', 'Natalia', 'Nicolás', 'Olivia', 'Pablo', 'Paula', 'Pedro', 'Ramiro',
  'Raquel', 'Renata', 'Ricardo', 'Rocío', 'Rodrigo', 'Rosario', 'Santiago', 'Sara', 'Sebastián', 'Silvia', 'Simón', 'Sofía', 'Teresa', 'Tomás', 'Valentina',
  'Valeria', 'Vicente', 'Victoria', 'Ximena', 'Yolanda',
];

export const LAST_NAMES = [
  'Aguirre', 'Alcorta', 'Almada', 'Arriaga', 'Balcarce', 'Beltrán', 'Benavídez', 'Bermúdez', 'Cabrera', 'Calvo', 'Campos', 'Cárdenas', 'Castañeda', 'Cifuentes',
  'Contreras', 'Corvalán', 'Delgado', 'Echeverría', 'Escobar', 'Esquivel', 'Figueroa', 'Galván', 'Garay', 'Gálvez', 'Guzmán', 'Herrera', 'Ibáñez', 'Iturbe',
  'Lagos', 'Lamas', 'Larrea', 'Ledesma', 'Linares', 'Lozano', 'Maldonado', 'Mansilla', 'Marín', 'Medina', 'Mendoza', 'Miranda', 'Molina', 'Montenegro',
  'Morales', 'Navarro', 'Núñez', 'Ocampo', 'Olmedo', 'Ortega', 'Otero', 'Pacheco', 'Paredes', 'Peralta', 'Pizarro', 'Quiroga', 'Ramírez', 'Rivas',
  'Robledo', 'Roldán', 'Salinas', 'Sandoval', 'Santillán', 'Sepúlveda', 'Soler', 'Sosa', 'Tapia', 'Toledo', 'Urquiza', 'Valdés', 'Varela', 'Vega',
  'Velázquez', 'Villalba', 'Zamora', 'Zárate', 'Zubiría',
];

export const BIOS: Record<FortuneSource, string[]> = {
  tecnologia: ['Fundó una plataforma de pagos que hoy usa medio país.', 'Vendió su empresa de software y reinvirtió todo en nuevas tecnológicas.', 'Dueña de una cadena de centros de datos.', 'Creó una aplicación de reparto y la llevó a otros países.'],
  finanzas: ['Maneja un fondo de inversión con fama de no perder nunca.', 'Banquero de tercera generación.', 'Hizo su fortuna comprando empresas en crisis.', 'Fundó una corredora de bolsa que creció sin pausa.'],
  inmuebles: ['Tiene cientos de departamentos en alquiler.', 'Desarrolló los barrios cerrados más caros de la costa.', 'Compró terrenos baratos hace décadas y esperó.', 'Dueño de torres de oficinas en el centro.'],
  industria: ['Fábricas de alimentos que exportan a toda la región.', 'Heredó un taller y lo convirtió en una siderúrgica.', 'Productor de autopartes con plantas en tres países.', 'Una cementera familiar que creció con cada obra pública.'],
  comercio: ['Cadena de supermercados de barrio que no para de abrir locales.', 'Importador de electrodomésticos con tiendas en todas las ciudades.', 'Dueña de la mayor red de farmacias.', 'Empezó con un puesto en el mercado y hoy tiene centros comerciales.'],
  energia: ['Concesiones de gas y una red de estaciones de servicio.', 'Pionero de los parques solares del sur.', 'Dueño de una empresa de transporte de combustible.', 'Invirtió en represas cuando nadie lo hacía.'],
  salud: ['Red de clínicas privadas con fama de excelencia.', 'Laboratorio farmacéutico familiar.', 'Fabricante de equipos médicos.', 'Fundó una cadena de laboratorios de análisis.'],
  herencia: ['Heredó la fortuna de una dinastía agroexportadora.', 'La tercera generación de una familia de banqueros.', 'Vive de las rentas de un imperio familiar diversificado.', 'Administra el patrimonio de una familia centenaria.'],
};
