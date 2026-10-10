import type { SkillId } from './skills';

export type Sector =
  | 'tecnologia'
  | 'finanzas'
  | 'ingenieria'
  | 'marketing'
  | 'administracion'
  | 'ventas'
  | 'industria'
  | 'consultoria'
  | 'logistica'
  | 'id';

export const SECTOR_NAMES: Record<Sector, string> = {
  tecnologia: 'Tecnología',
  finanzas: 'Finanzas',
  ingenieria: 'Ingeniería',
  marketing: 'Marketing',
  administracion: 'Administración',
  ventas: 'Ventas',
  industria: 'Industria',
  consultoria: 'Consultoría',
  logistica: 'Logística',
  id: 'Investigación y desarrollo',
};

export type EducationLevel = 'secundaria' | 'tecnico' | 'universitario' | 'posgrado';
export type Field = 'administracion' | 'finanzas' | 'ingenieria' | 'informatica' | 'marketing';

export const EDUCATION_RANK: Record<EducationLevel, number> = { secundaria: 0, tecnico: 1, universitario: 2, posgrado: 3 };
export const EDUCATION_NAMES: Record<EducationLevel, string> = {
  secundaria: 'Secundaria',
  tecnico: 'Técnico',
  universitario: 'Universitario',
  posgrado: 'Posgrado',
};
export const FIELD_NAMES: Record<Field, string> = {
  administracion: 'Administración',
  finanzas: 'Finanzas',
  ingenieria: 'Ingeniería',
  informatica: 'Informática',
  marketing: 'Marketing',
};

export interface JobDef {
  id: string;
  title: string;
  employer: string;
  sector: Sector;
  level: 1 | 2 | 3 | 4 | 5;
  /** Salario bruto mensual en USD a precios del año inicial (se indexa por inflación). */
  baseSalary: number;
  hoursPerWeek: number;
  /** Puntos de estrés que agrega por mes. */
  stress: number;
  requires: {
    education?: EducationLevel;
    fields?: Field[];
    expSectorMonths?: number;
    skills?: Partial<Record<SkillId, number>>;
  };
  /** Habilidades que determinan el desempeño. */
  keySkills: SkillId[];
  /** XP mensual que otorga el puesto. */
  skillXp: Partial<Record<SkillId, number>>;
  /** Bono anual objetivo como fracción del salario anual. */
  bonusTarget: number;
  /** Comisión mensual variable como fracción del salario base (ventas). */
  commission?: number;
  pensionMatch: number;
  healthInsurance: boolean;
  promotesTo?: string;
}

export const JOBS: JobDef[] = [
  // VENTAS
  { id: 'ventas_asistente', title: 'Asistente de ventas', employer: 'Tiendas Mirador', sector: 'ventas', level: 1, baseSalary: 1100, hoursPerWeek: 44, stress: 4,
    requires: {}, keySkills: ['negotiation', 'social'], skillXp: { negotiation: 350, social: 350 }, bonusTarget: 0, commission: 0.06, pensionMatch: 0, healthInsurance: false, promotesTo: 'ventas_ejecutivo' },
  { id: 'ventas_ejecutivo', title: 'Ejecutivo de ventas', employer: 'Distribuidora Solaz', sector: 'ventas', level: 2, baseSalary: 1700, hoursPerWeek: 45, stress: 6,
    requires: { expSectorMonths: 12, skills: { negotiation: 10 } }, keySkills: ['negotiation', 'social'], skillXp: { negotiation: 500, social: 400 }, bonusTarget: 0.04, commission: 0.1, pensionMatch: 0.03, healthInsurance: true, promotesTo: 'ventas_gerente' },
  { id: 'ventas_gerente', title: 'Gerente de ventas', employer: 'Distribuidora Solaz', sector: 'ventas', level: 4, baseSalary: 4200, hoursPerWeek: 48, stress: 8,
    requires: { education: 'tecnico', expSectorMonths: 36, skills: { negotiation: 30, management: 20 } }, keySkills: ['negotiation', 'management'], skillXp: { negotiation: 500, management: 500 }, bonusTarget: 0.12, commission: 0.05, pensionMatch: 0.05, healthInsurance: true },
  // LOGÍSTICA
  { id: 'log_operario', title: 'Auxiliar de bodega', employer: 'Almacenes Ruta Norte', sector: 'logistica', level: 1, baseSalary: 1050, hoursPerWeek: 45, stress: 5,
    requires: {}, keySkills: ['discipline', 'management'], skillXp: { management: 200, discipline: 300 }, bonusTarget: 0, pensionMatch: 0, healthInsurance: false, promotesTo: 'log_coordinador' },
  { id: 'log_coordinador', title: 'Coordinador logístico', employer: 'Almacenes Ruta Norte', sector: 'logistica', level: 2, baseSalary: 1900, hoursPerWeek: 45, stress: 6,
    requires: { expSectorMonths: 18, skills: { management: 8 } }, keySkills: ['management', 'discipline'], skillXp: { management: 500, discipline: 200 }, bonusTarget: 0.05, pensionMatch: 0.03, healthInsurance: true, promotesTo: 'log_jefe' },
  { id: 'log_jefe', title: 'Jefe de operaciones logísticas', employer: 'TransAltiplano', sector: 'logistica', level: 4, baseSalary: 3900, hoursPerWeek: 48, stress: 8,
    requires: { education: 'tecnico', expSectorMonths: 48, skills: { management: 25 } }, keySkills: ['management', 'risk'], skillXp: { management: 600, risk: 300 }, bonusTarget: 0.1, pensionMatch: 0.05, healthInsurance: true },
  // ADMINISTRACIÓN
  { id: 'adm_recepcion', title: 'Recepcionista administrativo', employer: 'Grupo Ceibal', sector: 'administracion', level: 1, baseSalary: 1000, hoursPerWeek: 40, stress: 3,
    requires: {}, keySkills: ['social', 'discipline'], skillXp: { social: 300, accounting: 150 }, bonusTarget: 0, pensionMatch: 0, healthInsurance: false, promotesTo: 'adm_asistente' },
  { id: 'adm_asistente', title: 'Asistente administrativo', employer: 'Grupo Ceibal', sector: 'administracion', level: 2, baseSalary: 1500, hoursPerWeek: 40, stress: 4,
    requires: { expSectorMonths: 12, skills: { accounting: 5 } }, keySkills: ['accounting', 'management'], skillXp: { accounting: 400, management: 250 }, bonusTarget: 0.03, pensionMatch: 0.03, healthInsurance: true, promotesTo: 'adm_coordinador' },
  { id: 'adm_coordinador', title: 'Coordinador administrativo', employer: 'Grupo Ceibal', sector: 'administracion', level: 3, baseSalary: 2600, hoursPerWeek: 42, stress: 5,
    requires: { education: 'universitario', fields: ['administracion', 'finanzas'], skills: { management: 15 } }, keySkills: ['management', 'accounting'], skillXp: { management: 500, accounting: 300 }, bonusTarget: 0.06, pensionMatch: 0.05, healthInsurance: true },
  // FINANZAS
  { id: 'fin_cajero', title: 'Cajero bancario', employer: 'Banco Austral', sector: 'finanzas', level: 1, baseSalary: 1150, hoursPerWeek: 40, stress: 4,
    requires: { skills: { finEdu: 5 } }, keySkills: ['finEdu', 'social'], skillXp: { finEdu: 300, accounting: 200, social: 150 }, bonusTarget: 0, pensionMatch: 0.03, healthInsurance: true, promotesTo: 'fin_analista_jr' },
  { id: 'fin_analista_jr', title: 'Analista financiero junior', employer: 'Banco Austral', sector: 'finanzas', level: 2, baseSalary: 2300, hoursPerWeek: 45, stress: 6,
    requires: { education: 'universitario', fields: ['finanzas', 'administracion'], skills: { accounting: 15, finEdu: 15 } }, keySkills: ['accounting', 'finEdu'], skillXp: { accounting: 500, finEdu: 450, stocks: 200 }, bonusTarget: 0.06, pensionMatch: 0.04, healthInsurance: true, promotesTo: 'fin_analista' },
  { id: 'fin_analista', title: 'Analista financiero', employer: 'Capital Andino', sector: 'finanzas', level: 3, baseSalary: 3800, hoursPerWeek: 46, stress: 7,
    requires: { education: 'universitario', expSectorMonths: 24, skills: { accounting: 30, finEdu: 30 } }, keySkills: ['accounting', 'finEdu', 'risk'], skillXp: { accounting: 500, finEdu: 500, risk: 300, stocks: 300 }, bonusTarget: 0.1, pensionMatch: 0.05, healthInsurance: true, promotesTo: 'fin_gerente' },
  { id: 'fin_gerente', title: 'Gerente financiero', employer: 'Capital Andino', sector: 'finanzas', level: 5, baseSalary: 8500, hoursPerWeek: 50, stress: 9,
    requires: { education: 'posgrado', expSectorMonths: 60, skills: { accounting: 50, management: 35, finEdu: 50 } }, keySkills: ['finEdu', 'management', 'risk'], skillXp: { management: 500, finEdu: 400, risk: 400 }, bonusTarget: 0.2, pensionMatch: 0.06, healthInsurance: true },
  // TECNOLOGÍA
  { id: 'tec_soporte', title: 'Técnico de soporte', employer: 'NubeClara', sector: 'tecnologia', level: 1, baseSalary: 1300, hoursPerWeek: 42, stress: 4,
    requires: { skills: { cybersecurity: 8 } }, keySkills: ['cybersecurity', 'social'], skillXp: { cybersecurity: 450, social: 150 }, bonusTarget: 0, pensionMatch: 0.03, healthInsurance: true, promotesTo: 'tec_dev_jr' },
  { id: 'tec_dev_jr', title: 'Desarrollador junior', employer: 'NubeClara', sector: 'tecnologia', level: 2, baseSalary: 2400, hoursPerWeek: 42, stress: 5,
    requires: { skills: { cybersecurity: 20 }, expSectorMonths: 6 }, keySkills: ['cybersecurity', 'discipline'], skillXp: { cybersecurity: 650 }, bonusTarget: 0.05, pensionMatch: 0.04, healthInsurance: true, promotesTo: 'tec_dev' },
  { id: 'tec_dev', title: 'Desarrollador de software', employer: 'Códice Labs', sector: 'tecnologia', level: 3, baseSalary: 4200, hoursPerWeek: 44, stress: 6,
    requires: { expSectorMonths: 24, skills: { cybersecurity: 30 } }, keySkills: ['cybersecurity', 'discipline'], skillXp: { cybersecurity: 700, management: 150, law: 100 }, bonusTarget: 0.08, pensionMatch: 0.05, healthInsurance: true, promotesTo: 'tec_ciso' },
  { id: 'tec_ciso', title: 'Director de ciberseguridad', employer: 'Códice Labs', sector: 'tecnologia', level: 5, baseSalary: 11000, hoursPerWeek: 50, stress: 9,
    requires: { expSectorMonths: 72, skills: { cybersecurity: 65, management: 35, law: 20 } }, keySkills: ['cybersecurity', 'management', 'law'], skillXp: { cybersecurity: 400, management: 500, law: 300 }, bonusTarget: 0.2, pensionMatch: 0.06, healthInsurance: true },
  // MARKETING
  { id: 'mkt_community', title: 'Community manager', employer: 'Agencia Faro', sector: 'marketing', level: 1, baseSalary: 1200, hoursPerWeek: 40, stress: 4,
    requires: { skills: { marketing: 5 } }, keySkills: ['marketing', 'social'], skillXp: { marketing: 450, social: 200 }, bonusTarget: 0, pensionMatch: 0, healthInsurance: false, promotesTo: 'mkt_analista' },
  { id: 'mkt_analista', title: 'Analista de marketing', employer: 'Agencia Faro', sector: 'marketing', level: 2, baseSalary: 2100, hoursPerWeek: 42, stress: 5,
    requires: { education: 'universitario', fields: ['marketing', 'administracion'], skills: { marketing: 20 } }, keySkills: ['marketing', 'accounting'], skillXp: { marketing: 600, accounting: 150 }, bonusTarget: 0.05, pensionMatch: 0.03, healthInsurance: true, promotesTo: 'mkt_gerente' },
  { id: 'mkt_gerente', title: 'Gerente de marketing', employer: 'Grupo Ceibal', sector: 'marketing', level: 4, baseSalary: 5200, hoursPerWeek: 46, stress: 7,
    requires: { expSectorMonths: 48, skills: { marketing: 45, management: 25 } }, keySkills: ['marketing', 'management'], skillXp: { marketing: 500, management: 500 }, bonusTarget: 0.12, pensionMatch: 0.05, healthInsurance: true },
  // INGENIERÍA
  { id: 'ing_tecnico', title: 'Técnico de mantenimiento', employer: 'Energía Volcán', sector: 'ingenieria', level: 1, baseSalary: 1400, hoursPerWeek: 44, stress: 5,
    requires: { education: 'tecnico', fields: ['ingenieria'] }, keySkills: ['discipline', 'risk'], skillXp: { risk: 250, discipline: 250 }, bonusTarget: 0.02, pensionMatch: 0.03, healthInsurance: true, promotesTo: 'ing_ingeniero' },
  { id: 'ing_ingeniero', title: 'Ingeniero de proyectos', employer: 'Energía Volcán', sector: 'ingenieria', level: 3, baseSalary: 3600, hoursPerWeek: 45, stress: 6,
    requires: { education: 'universitario', fields: ['ingenieria'], skills: { management: 10 } }, keySkills: ['management', 'risk'], skillXp: { management: 450, risk: 400 }, bonusTarget: 0.08, pensionMatch: 0.05, healthInsurance: true },
  // INDUSTRIA
  { id: 'ind_operario', title: 'Operario de producción', employer: 'Textiles Arrecife', sector: 'industria', level: 1, baseSalary: 1150, hoursPerWeek: 46, stress: 6,
    requires: {}, keySkills: ['discipline'], skillXp: { discipline: 350, management: 100 }, bonusTarget: 0, pensionMatch: 0, healthInsurance: true, promotesTo: 'ind_supervisor' },
  { id: 'ind_supervisor', title: 'Supervisor de planta', employer: 'Textiles Arrecife', sector: 'industria', level: 3, baseSalary: 2400, hoursPerWeek: 46, stress: 7,
    requires: { expSectorMonths: 24, skills: { management: 15 } }, keySkills: ['management', 'discipline'], skillXp: { management: 550, risk: 150 }, bonusTarget: 0.06, pensionMatch: 0.03, healthInsurance: true },
  // CONSULTORÍA
  { id: 'con_junior', title: 'Consultor junior', employer: 'Meridiano Consulting', sector: 'consultoria', level: 2, baseSalary: 2600, hoursPerWeek: 48, stress: 7,
    requires: { education: 'universitario', skills: { social: 15, accounting: 10 } }, keySkills: ['social', 'accounting', 'management'], skillXp: { social: 350, accounting: 300, management: 300 }, bonusTarget: 0.08, pensionMatch: 0.04, healthInsurance: true, promotesTo: 'con_senior' },
  { id: 'con_senior', title: 'Consultor senior', employer: 'Meridiano Consulting', sector: 'consultoria', level: 4, baseSalary: 5600, hoursPerWeek: 50, stress: 8,
    requires: { education: 'universitario', expSectorMonths: 36, skills: { social: 35, management: 30, negotiation: 25 } }, keySkills: ['social', 'management', 'negotiation'], skillXp: { management: 450, negotiation: 400, social: 300 }, bonusTarget: 0.14, pensionMatch: 0.05, healthInsurance: true, promotesTo: 'con_socio' },
  { id: 'con_socio', title: 'Socio de consultoría', employer: 'Meridiano Consulting', sector: 'consultoria', level: 5, baseSalary: 12000, hoursPerWeek: 52, stress: 9,
    requires: { education: 'posgrado', expSectorMonths: 84, skills: { social: 55, management: 50, negotiation: 50 } }, keySkills: ['negotiation', 'management', 'social'], skillXp: { negotiation: 500, management: 400 }, bonusTarget: 0.25, pensionMatch: 0.06, healthInsurance: true },
  // I+D
  { id: 'id_asistente', title: 'Asistente de investigación', employer: 'Instituto Quetzal', sector: 'id', level: 2, baseSalary: 1900, hoursPerWeek: 40, stress: 4,
    requires: { education: 'universitario', fields: ['ingenieria', 'informatica'] }, keySkills: ['discipline', 'cybersecurity'], skillXp: { discipline: 300, cybersecurity: 300, risk: 150 }, bonusTarget: 0.03, pensionMatch: 0.05, healthInsurance: true, promotesTo: 'id_investigador' },
  { id: 'id_investigador', title: 'Investigador principal', employer: 'Instituto Quetzal', sector: 'id', level: 4, baseSalary: 4800, hoursPerWeek: 44, stress: 6,
    requires: { education: 'posgrado', expSectorMonths: 24 }, keySkills: ['discipline', 'management'], skillXp: { discipline: 300, management: 350, risk: 250 }, bonusTarget: 0.08, pensionMatch: 0.06, healthInsurance: true },
];

export const JOB_BY_ID: Record<string, JobDef> = Object.fromEntries(JOBS.map((j) => [j.id, j]));
