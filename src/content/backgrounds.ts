import type { EducationLevel, Field, Sector } from './jobs';
import type { LifestyleId } from './lifestyle';
import type { SkillId } from './skills';

export type BackgroundId = 'egresado' | 'tecnico' | 'autodidacta' | 'herencia';

export interface BackgroundDef {
  id: BackgroundId;
  name: string;
  summary: string;
  startingCash: number; // USD en efectivo
  startingChecking: number; // USD en cuenta corriente
  education: EducationLevel;
  fields: Field[];
  experience: Partial<Record<Sector, number>>;
  skills: Partial<Record<SkillId, number>>;
  lifestyle: LifestyleId;
  cardLimit: number;
  pros: string;
  cons: string;
}

export const BACKGROUNDS: BackgroundDef[] = [
  {
    id: 'egresado', name: 'Recién egresado', summary: 'Terminaste la secundaria y tenés algunos ahorros de trabajos de verano.',
    startingCash: 200, startingChecking: 1800, education: 'secundaria', fields: [], experience: {},
    skills: { social: 3, discipline: 3, finEdu: 2 }, lifestyle: 'modesto', cardLimit: 500,
    pros: 'Perfil equilibrado, sin deudas.', cons: 'Poco colchón: unos 2 meses de gastos.',
  },
  {
    id: 'tecnico', name: 'Vendedor con experiencia', summary: 'Llevás un año vendiendo en tiendas y cursaste un técnico en administración.',
    startingCash: 150, startingChecking: 2350, education: 'tecnico', fields: ['administracion'], experience: { ventas: 12 },
    skills: { negotiation: 11, social: 10, accounting: 5, management: 3 }, lifestyle: 'modesto', cardLimit: 800,
    pros: 'Accedés antes a puestos de ventas mejor pagados.', cons: 'Las habilidades técnicas y financieras están poco desarrolladas.',
  },
  {
    id: 'autodidacta', name: 'Autodidacta tecnológico', summary: 'Aprendiste a programar solo, de noche, con tutoriales gratuitos.',
    startingCash: 100, startingChecking: 1400, education: 'secundaria', fields: [], experience: {},
    skills: { cybersecurity: 12, discipline: 8, finEdu: 3 }, lifestyle: 'austero', cardLimit: 400,
    pros: 'Podés postularte a soporte técnico desde el primer día.', cons: 'Muy poco dinero y estilo de vida austero que genera estrés.',
  },
  {
    id: 'herencia', name: 'Pequeña herencia', summary: 'Recibiste una herencia modesta de una tía. Sin experiencia laboral.',
    startingCash: 500, startingChecking: 14500, education: 'secundaria', fields: [], experience: {},
    skills: { finEdu: 4 }, lifestyle: 'modesto', cardLimit: 1000,
    pros: 'Capital para invertir o formarte desde el principio.', cons: 'Sin experiencia laboral. Con más dinero tienta pagar estudios caros, varios a la vez: las cuotas siguen aunque pierdas el empleo, y el capital se va rápido sin un plan.',
  },
];

export const BACKGROUND_BY_ID: Record<BackgroundId, BackgroundDef> = Object.fromEntries(BACKGROUNDS.map((b) => [b.id, b])) as Record<BackgroundId, BackgroundDef>;

export type PlayStyle = 'libre' | 'emprendedor' | 'inversionista' | 'inmobiliario' | 'ejecutivo' | 'industrial' | 'financiero' | 'tecnologico';

export const PLAY_STYLES: Array<{ id: PlayStyle; name: string; hint: string }> = [
  { id: 'libre', name: 'Libre', hint: 'Sin ruta sugerida. Combiná lo que quieras.' },
  { id: 'ejecutivo', name: 'Ejecutivo', hint: 'Crecer profesionalmente: estudiar, ascender y negociar salarios.' },
  { id: 'inversionista', name: 'Inversionista', hint: 'Ahorrar, invertir y dejar que el interés compuesto trabaje.' },
  { id: 'emprendedor', name: 'Emprendedor', hint: 'Juntar capital para fundar empresas.' },
  { id: 'inmobiliario', name: 'Inmobiliario', hint: 'Juntar capital y crédito para comprar propiedades.' },
  { id: 'industrial', name: 'Industrial', hint: 'Experiencia en industria y logística para cadenas de producción.' },
  { id: 'financiero', name: 'Magnate financiero', hint: 'Dominar crédito, apalancamiento e inversiones.' },
  { id: 'tecnologico', name: 'Tecnológico', hint: 'Formarte en tecnología para fundar empresas de software.' },
];
