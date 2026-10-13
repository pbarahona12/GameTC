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
  /**
   * Facilidad de entrar (1 = normal): multiplica la probabilidad de oferta. Los
   * puestos estables y con seguro atraen más postulantes; ventas siempre contrata.
   */
  hiringEase?: number;
  /** En una línea, qué tiene de distinto este puesto (se muestra en Vacantes). */
  pitch?: string;
  /**
   * Puestos de dirección en empresas que cotizan (1.6): en cada evaluación anual se
   * entregan acciones de la empleadora por `pct` del sueldo anual (según desempeño).
   */
  equity?: { stockId: string; pct: number };
}

export const JOBS: JobDef[] = [
  // VENTAS
  { id: 'ventas_asistente', title: 'Asistente de ventas', employer: 'Tiendas Mirador', sector: 'ventas', level: 1, baseSalary: 800, hoursPerWeek: 44, stress: 5,
    requires: {}, keySkills: ['negotiation', 'social'], skillXp: { negotiation: 500, social: 400 }, bonusTarget: 0, commission: 0.4, pensionMatch: 0, healthInsurance: false, promotesTo: 'ventas_ejecutivo',
    hiringEase: 1.25, pitch: 'Sueldo fijo bajo y comisión alta: si vendés bien ganás más que en cualquier otro inicial. Aprendés a negociar.' },
  { id: 'ventas_ejecutivo', title: 'Ejecutivo de ventas', employer: 'Distribuidora Solaz', sector: 'ventas', level: 2, baseSalary: 1700, hoursPerWeek: 45, stress: 6,
    requires: { expSectorMonths: 12, skills: { negotiation: 10 } }, keySkills: ['negotiation', 'social'], skillXp: { negotiation: 500, social: 400 }, bonusTarget: 0.04, commission: 0.1, pensionMatch: 0.03, healthInsurance: true, promotesTo: 'ventas_gerente' },
  { id: 'ventas_gerente', title: 'Gerente de ventas', employer: 'Distribuidora Solaz', sector: 'ventas', level: 4, baseSalary: 4200, hoursPerWeek: 48, stress: 8,
    requires: { education: 'tecnico', expSectorMonths: 36, skills: { negotiation: 30, management: 20 } }, keySkills: ['negotiation', 'management'], skillXp: { negotiation: 500, management: 500 }, bonusTarget: 0.12, commission: 0.05, pensionMatch: 0.05, healthInsurance: true, promotesTo: 'dir_comercial' },
  // LOGÍSTICA
  { id: 'log_operario', title: 'Auxiliar de bodega', employer: 'Almacenes Ruta Norte', sector: 'logistica', level: 1, baseSalary: 1000, hoursPerWeek: 45, stress: 5,
    requires: {}, keySkills: ['discipline', 'management'], skillXp: { management: 450, discipline: 300 }, bonusTarget: 0, pensionMatch: 0, healthInsurance: false, promotesTo: 'log_coordinador',
    pitch: 'Sin seguro, pero aprendés a dirigir gente (la habilidad clave para tener empresas) y el ascenso llega en un año.' },
  { id: 'log_coordinador', title: 'Coordinador logístico', employer: 'Almacenes Ruta Norte', sector: 'logistica', level: 2, baseSalary: 1900, hoursPerWeek: 45, stress: 6,
    requires: { expSectorMonths: 12, skills: { management: 8 } }, keySkills: ['management', 'discipline'], skillXp: { management: 500, discipline: 200 }, bonusTarget: 0.05, pensionMatch: 0.03, healthInsurance: true, promotesTo: 'log_jefe' },
  { id: 'log_jefe', title: 'Jefe de operaciones logísticas', employer: 'TransAltiplano', sector: 'logistica', level: 4, baseSalary: 3900, hoursPerWeek: 48, stress: 8,
    requires: { education: 'tecnico', expSectorMonths: 48, skills: { management: 25 } }, keySkills: ['management', 'risk'], skillXp: { management: 600, risk: 300 }, bonusTarget: 0.1, pensionMatch: 0.05, healthInsurance: true, promotesTo: 'dir_operaciones' },
  // ADMINISTRACIÓN
  { id: 'adm_recepcion', title: 'Recepcionista administrativo', employer: 'Grupo Ceibal', sector: 'administracion', level: 1, baseSalary: 950, hoursPerWeek: 40, stress: 2,
    requires: {}, keySkills: ['social', 'discipline'], skillXp: { social: 300, accounting: 250 }, bonusTarget: 0, pensionMatch: 0.03, healthInsurance: true, promotesTo: 'adm_asistente',
    hiringEase: 0.8, pitch: 'El más tranquilo: 40 horas, seguro médico y poco estrés, a cambio del sueldo más bajo. Muchos lo quieren.' },
  { id: 'adm_asistente', title: 'Asistente administrativo', employer: 'Grupo Ceibal', sector: 'administracion', level: 2, baseSalary: 1500, hoursPerWeek: 40, stress: 4,
    requires: { expSectorMonths: 12, skills: { accounting: 5 } }, keySkills: ['accounting', 'management'], skillXp: { accounting: 400, management: 250 }, bonusTarget: 0.03, pensionMatch: 0.03, healthInsurance: true, promotesTo: 'adm_coordinador' },
  { id: 'adm_coordinador', title: 'Coordinador administrativo', employer: 'Grupo Ceibal', sector: 'administracion', level: 3, baseSalary: 2600, hoursPerWeek: 42, stress: 5,
    requires: { education: 'universitario', fields: ['administracion', 'finanzas'], skills: { management: 15 } }, keySkills: ['management', 'accounting'], skillXp: { management: 500, accounting: 300 }, bonusTarget: 0.06, pensionMatch: 0.05, healthInsurance: true, promotesTo: 'adm_gerente' },
  // FINANZAS
  { id: 'fin_cajero', title: 'Cajero bancario', employer: 'Banco Austral', sector: 'finanzas', level: 1, baseSalary: 1150, hoursPerWeek: 40, stress: 4,
    requires: { skills: { finEdu: 5 } }, keySkills: ['finEdu', 'social'], skillXp: { finEdu: 300, accounting: 200, social: 150 }, bonusTarget: 0, pensionMatch: 0.03, healthInsurance: true, promotesTo: 'fin_analista_jr' },
  { id: 'fin_analista_jr', title: 'Analista financiero junior', employer: 'Banco Austral', sector: 'finanzas', level: 2, baseSalary: 2300, hoursPerWeek: 45, stress: 6,
    requires: { education: 'universitario', fields: ['finanzas', 'administracion'], skills: { accounting: 15, finEdu: 15 } }, keySkills: ['accounting', 'finEdu'], skillXp: { accounting: 500, finEdu: 450, stocks: 200 }, bonusTarget: 0.06, pensionMatch: 0.04, healthInsurance: true, promotesTo: 'fin_analista' },
  { id: 'fin_analista', title: 'Analista financiero', employer: 'Capital Andino', sector: 'finanzas', level: 3, baseSalary: 3800, hoursPerWeek: 46, stress: 7,
    requires: { education: 'universitario', expSectorMonths: 24, skills: { accounting: 30, finEdu: 30 } }, keySkills: ['accounting', 'finEdu', 'risk'], skillXp: { accounting: 500, finEdu: 500, risk: 300, stocks: 300 }, bonusTarget: 0.1, pensionMatch: 0.05, healthInsurance: true, promotesTo: 'fin_gerente' },
  { id: 'fin_gerente', title: 'Gerente financiero', employer: 'Capital Andino', sector: 'finanzas', level: 5, baseSalary: 8500, hoursPerWeek: 50, stress: 9,
    requires: { education: 'posgrado', expSectorMonths: 60, skills: { accounting: 50, management: 35, finEdu: 50 } }, keySkills: ['finEdu', 'management', 'risk'], skillXp: { management: 500, finEdu: 400, risk: 400 }, bonusTarget: 0.2, pensionMatch: 0.06, healthInsurance: true, promotesTo: 'dir_finanzas' },
  // TECNOLOGÍA
  { id: 'tec_soporte', title: 'Técnico de soporte', employer: 'NubeClara', sector: 'tecnologia', level: 1, baseSalary: 1300, hoursPerWeek: 42, stress: 4,
    requires: { skills: { cybersecurity: 8 } }, keySkills: ['cybersecurity', 'social'], skillXp: { cybersecurity: 450, social: 150 }, bonusTarget: 0, pensionMatch: 0.03, healthInsurance: true, promotesTo: 'tec_dev_jr' },
  { id: 'tec_dev_jr', title: 'Desarrollador junior', employer: 'NubeClara', sector: 'tecnologia', level: 2, baseSalary: 2400, hoursPerWeek: 42, stress: 5,
    requires: { skills: { cybersecurity: 20 }, expSectorMonths: 6 }, keySkills: ['cybersecurity', 'discipline'], skillXp: { cybersecurity: 650 }, bonusTarget: 0.05, pensionMatch: 0.04, healthInsurance: true, promotesTo: 'tec_dev' },
  { id: 'tec_dev', title: 'Desarrollador de software', employer: 'Códice Labs', sector: 'tecnologia', level: 3, baseSalary: 4200, hoursPerWeek: 44, stress: 6,
    requires: { expSectorMonths: 24, skills: { cybersecurity: 30 } }, keySkills: ['cybersecurity', 'discipline'], skillXp: { cybersecurity: 700, management: 150, law: 100 }, bonusTarget: 0.08, pensionMatch: 0.05, healthInsurance: true, promotesTo: 'tec_ciso' },
  { id: 'tec_ciso', title: 'Director de ciberseguridad', employer: 'Códice Labs', sector: 'tecnologia', level: 5, baseSalary: 11000, hoursPerWeek: 50, stress: 9,
    requires: { expSectorMonths: 72, skills: { cybersecurity: 65, management: 35, law: 20 } }, keySkills: ['cybersecurity', 'management', 'law'], skillXp: { cybersecurity: 400, management: 500, law: 300 }, bonusTarget: 0.2, pensionMatch: 0.06, healthInsurance: true, promotesTo: 'dir_tecnologia' },
  // MARKETING
  { id: 'mkt_community', title: 'Community manager', employer: 'Agencia Faro', sector: 'marketing', level: 1, baseSalary: 1200, hoursPerWeek: 40, stress: 4,
    requires: { skills: { marketing: 5 } }, keySkills: ['marketing', 'social'], skillXp: { marketing: 450, social: 200 }, bonusTarget: 0, pensionMatch: 0, healthInsurance: false, promotesTo: 'mkt_analista' },
  { id: 'mkt_analista', title: 'Analista de marketing', employer: 'Agencia Faro', sector: 'marketing', level: 2, baseSalary: 2100, hoursPerWeek: 42, stress: 5,
    requires: { education: 'universitario', fields: ['marketing', 'administracion'], skills: { marketing: 20 } }, keySkills: ['marketing', 'accounting'], skillXp: { marketing: 600, accounting: 150 }, bonusTarget: 0.05, pensionMatch: 0.03, healthInsurance: true, promotesTo: 'mkt_gerente' },
  { id: 'mkt_gerente', title: 'Gerente de marketing', employer: 'Grupo Ceibal', sector: 'marketing', level: 4, baseSalary: 5200, hoursPerWeek: 46, stress: 7,
    requires: { expSectorMonths: 48, skills: { marketing: 45, management: 25 } }, keySkills: ['marketing', 'management'], skillXp: { marketing: 500, management: 500 }, bonusTarget: 0.12, pensionMatch: 0.05, healthInsurance: true, promotesTo: 'dir_marketing' },
  // INGENIERÍA
  { id: 'ing_tecnico', title: 'Técnico de mantenimiento', employer: 'Energía Volcán', sector: 'ingenieria', level: 1, baseSalary: 1400, hoursPerWeek: 44, stress: 5,
    requires: { education: 'tecnico', fields: ['ingenieria'] }, keySkills: ['discipline', 'risk'], skillXp: { risk: 250, discipline: 250 }, bonusTarget: 0.02, pensionMatch: 0.03, healthInsurance: true, promotesTo: 'ing_ingeniero' },
  { id: 'ing_ingeniero', title: 'Ingeniero de proyectos', employer: 'Energía Volcán', sector: 'ingenieria', level: 3, baseSalary: 3600, hoursPerWeek: 45, stress: 6,
    requires: { education: 'universitario', fields: ['ingenieria'], skills: { management: 10 } }, keySkills: ['management', 'risk'], skillXp: { management: 450, risk: 400 }, bonusTarget: 0.08, pensionMatch: 0.05, healthInsurance: true, promotesTo: 'ing_gerente' },
  // INDUSTRIA
  { id: 'ind_operario', title: 'Operario de producción', employer: 'Textiles Arrecife', sector: 'industria', level: 1, baseSalary: 1250, hoursPerWeek: 46, stress: 7,
    requires: {}, keySkills: ['discipline'], skillXp: { discipline: 350, management: 100 }, bonusTarget: 0, pensionMatch: 0, healthInsurance: true, promotesTo: 'ind_supervisor',
    hiringEase: 1.1, pitch: 'El mejor sueldo fijo sin requisitos, con seguro médico, pero 46 horas y bastante estrés.' },
  { id: 'ind_supervisor', title: 'Supervisor de planta', employer: 'Textiles Arrecife', sector: 'industria', level: 3, baseSalary: 2400, hoursPerWeek: 46, stress: 7,
    requires: { expSectorMonths: 24, skills: { management: 15 } }, keySkills: ['management', 'discipline'], skillXp: { management: 550, risk: 150 }, bonusTarget: 0.06, pensionMatch: 0.03, healthInsurance: true, promotesTo: 'ind_jefe' },
  // CONSULTORÍA
  { id: 'con_junior', title: 'Consultor junior', employer: 'Meridiano Consulting', sector: 'consultoria', level: 2, baseSalary: 2600, hoursPerWeek: 48, stress: 7,
    requires: { education: 'universitario', skills: { social: 15, accounting: 10 } }, keySkills: ['social', 'accounting', 'management'], skillXp: { social: 350, accounting: 300, management: 300 }, bonusTarget: 0.08, pensionMatch: 0.04, healthInsurance: true, promotesTo: 'con_senior' },
  { id: 'con_senior', title: 'Consultor senior', employer: 'Meridiano Consulting', sector: 'consultoria', level: 4, baseSalary: 5600, hoursPerWeek: 50, stress: 8,
    requires: { education: 'universitario', expSectorMonths: 36, skills: { social: 35, management: 30, negotiation: 25 } }, keySkills: ['social', 'management', 'negotiation'], skillXp: { management: 450, negotiation: 400, social: 300 }, bonusTarget: 0.14, pensionMatch: 0.05, healthInsurance: true, promotesTo: 'con_socio' },
  { id: 'con_socio', title: 'Socio de consultoría', employer: 'Meridiano Consulting', sector: 'consultoria', level: 5, baseSalary: 12000, hoursPerWeek: 52, stress: 9,
    requires: { education: 'posgrado', expSectorMonths: 84, skills: { social: 55, management: 50, negotiation: 50 } }, keySkills: ['negotiation', 'management', 'social'], skillXp: { negotiation: 500, management: 400 }, bonusTarget: 0.25, pensionMatch: 0.06, healthInsurance: true, promotesTo: 'dir_general' },
  // I+D
  { id: 'id_asistente', title: 'Asistente de investigación', employer: 'Instituto Quetzal', sector: 'id', level: 2, baseSalary: 1900, hoursPerWeek: 40, stress: 4,
    requires: { education: 'universitario', fields: ['ingenieria', 'informatica'] }, keySkills: ['discipline', 'cybersecurity'], skillXp: { discipline: 300, cybersecurity: 300, risk: 150 }, bonusTarget: 0.03, pensionMatch: 0.05, healthInsurance: true, promotesTo: 'id_investigador' },
  { id: 'id_investigador', title: 'Investigador principal', employer: 'Instituto Quetzal', sector: 'id', level: 4, baseSalary: 4800, hoursPerWeek: 44, stress: 6,
    requires: { education: 'posgrado', expSectorMonths: 24 }, keySkills: ['discipline', 'management'], skillXp: { discipline: 300, management: 350, risk: 250 }, bonusTarget: 0.08, pensionMatch: 0.06, healthInsurance: true, promotesTo: 'dir_cientifico' },
  // DIRECCIÓN (1.6): puestos en empresas que cotizan; parte del pago es en acciones de la empleadora.
  { id: 'dir_comercial', title: 'Director comercial', employer: 'Mercantil del Sur', sector: 'ventas', level: 5, baseSalary: 7600, hoursPerWeek: 52, stress: 9,
    requires: { education: 'tecnico', expSectorMonths: 72, skills: { negotiation: 50, management: 40 } }, keySkills: ['negotiation', 'management'], skillXp: { negotiation: 400, management: 500 }, bonusTarget: 0.15, commission: 0.03, pensionMatch: 0.06, healthInsurance: true,
    equity: { stockId: 'MRKT', pct: 0.35 }, pitch: 'Dirigís las ventas de una empresa que cotiza: cada año cobrás acciones de Mercantil del Sur además del sueldo.' },
  { id: 'dir_operaciones', title: 'Director de operaciones', employer: 'Aceros del Valle', sector: 'logistica', level: 5, baseSalary: 7200, hoursPerWeek: 52, stress: 9,
    requires: { education: 'tecnico', expSectorMonths: 72, skills: { management: 45, risk: 25 } }, keySkills: ['management', 'risk', 'discipline'], skillXp: { management: 500, risk: 300 }, bonusTarget: 0.15, pensionMatch: 0.06, healthInsurance: true,
    equity: { stockId: 'ACRV', pct: 0.35 }, pitch: 'Plantas y logística de una siderúrgica que cotiza: parte del pago en acciones (muy cíclicas).' },
  { id: 'dir_marketing', title: 'Director de marketing', employer: 'Tostadores Unidos', sector: 'marketing', level: 5, baseSalary: 8400, hoursPerWeek: 50, stress: 9,
    requires: { education: 'universitario', expSectorMonths: 60, skills: { marketing: 55, management: 40 } }, keySkills: ['marketing', 'management', 'social'], skillXp: { marketing: 400, management: 450 }, bonusTarget: 0.15, pensionMatch: 0.06, healthInsurance: true,
    equity: { stockId: 'TOST', pct: 0.4 }, pitch: 'Las marcas de Tostadores Unidos: sueldo alto y acciones de la empresa cada año.' },
  { id: 'dir_finanzas', title: 'Director financiero (CFO)', employer: 'Banco de Valoria', sector: 'finanzas', level: 5, baseSalary: 10500, hoursPerWeek: 54, stress: 10,
    requires: { education: 'posgrado', expSectorMonths: 96, skills: { accounting: 60, management: 50, finEdu: 60 } }, keySkills: ['finEdu', 'management', 'risk'], skillXp: { management: 500, finEdu: 400, risk: 400 }, bonusTarget: 0.25, pensionMatch: 0.07, healthInsurance: true,
    equity: { stockId: 'BVAL', pct: 0.5 }, pitch: 'Las finanzas del banco más grande del país: la mitad del sueldo anual extra en acciones del banco.' },
  { id: 'dir_tecnologia', title: 'Director de tecnología (CTO)', employer: 'Nébula Software', sector: 'tecnologia', level: 5, baseSalary: 13000, hoursPerWeek: 54, stress: 10,
    requires: { expSectorMonths: 96, skills: { cybersecurity: 70, management: 50, law: 25 } }, keySkills: ['cybersecurity', 'management', 'law'], skillXp: { cybersecurity: 300, management: 500, law: 300 }, bonusTarget: 0.2, pensionMatch: 0.07, healthInsurance: true,
    equity: { stockId: 'NBLA', pct: 0.6 }, pitch: 'Toda la tecnología de una empresa que crece rápido: buena parte del pago en sus acciones (volátiles).' },
  { id: 'dir_general', title: 'Director general (CEO)', employer: 'Telvaria', sector: 'consultoria', level: 5, baseSalary: 15000, hoursPerWeek: 58, stress: 10,
    requires: { education: 'posgrado', expSectorMonths: 108, skills: { social: 60, management: 60, negotiation: 60 } }, keySkills: ['management', 'negotiation', 'social'], skillXp: { management: 600, negotiation: 400 }, bonusTarget: 0.3, pensionMatch: 0.07, healthInsurance: true,
    equity: { stockId: 'TELV', pct: 0.7 }, pitch: 'Dirigís una empresa que cotiza: el puesto mejor pago del país, con acciones por el 70 % del sueldo anual.' },
  { id: 'dir_cientifico', title: 'Director científico', employer: 'Vitalis Farma', sector: 'id', level: 5, baseSalary: 8200, hoursPerWeek: 48, stress: 8,
    requires: { education: 'posgrado', expSectorMonths: 60, skills: { management: 35, risk: 25 } }, keySkills: ['discipline', 'management', 'risk'], skillXp: { management: 400, risk: 300, discipline: 200 }, bonusTarget: 0.12, pensionMatch: 0.07, healthInsurance: true,
    equity: { stockId: 'VITL', pct: 0.4 }, pitch: 'Los laboratorios de Vitalis Farma: sueldo y acciones del laboratorio cada año.' },
  // Carreras que antes terminaban en el nivel 3 (1.6): gerencia y dirección.
  { id: 'ing_gerente', title: 'Gerente de ingeniería', employer: 'Energía Volcán', sector: 'ingenieria', level: 4, baseSalary: 5000, hoursPerWeek: 48, stress: 7,
    requires: { education: 'universitario', expSectorMonths: 48, skills: { management: 35, risk: 30 } }, keySkills: ['management', 'risk'], skillXp: { management: 500, risk: 400 }, bonusTarget: 0.12, pensionMatch: 0.05, healthInsurance: true, promotesTo: 'dir_ingenieria' },
  { id: 'ind_jefe', title: 'Jefe de planta', employer: 'Textiles Arrecife', sector: 'industria', level: 4, baseSalary: 4300, hoursPerWeek: 48, stress: 8,
    requires: { education: 'tecnico', expSectorMonths: 48, skills: { management: 35 } }, keySkills: ['management', 'discipline'], skillXp: { management: 550, discipline: 200 }, bonusTarget: 0.1, pensionMatch: 0.05, healthInsurance: true, promotesTo: 'dir_industrial' },
  { id: 'adm_gerente', title: 'Gerente de administración', employer: 'Grupo Ceibal', sector: 'administracion', level: 4, baseSalary: 4400, hoursPerWeek: 45, stress: 6,
    requires: { education: 'universitario', expSectorMonths: 48, skills: { accounting: 40, management: 30 } }, keySkills: ['accounting', 'management'], skillXp: { accounting: 400, management: 500 }, bonusTarget: 0.1, pensionMatch: 0.05, healthInsurance: true, promotesTo: 'dir_administracion' },
  { id: 'dir_ingenieria', title: 'Director de ingeniería', employer: 'Solaria Renovables', sector: 'ingenieria', level: 5, baseSalary: 8000, hoursPerWeek: 50, stress: 9,
    requires: { education: 'universitario', expSectorMonths: 84, skills: { management: 50, risk: 45 } }, keySkills: ['management', 'risk'], skillXp: { management: 500, risk: 400 }, bonusTarget: 0.15, pensionMatch: 0.06, healthInsurance: true,
    equity: { stockId: 'SOLR', pct: 0.4 }, pitch: 'Los parques solares y eólicos de Solaria: sueldo de dirección y acciones de la empresa cada año.' },
  { id: 'dir_industrial', title: 'Director industrial', employer: 'Maderas del Norte', sector: 'industria', level: 5, baseSalary: 7200, hoursPerWeek: 50, stress: 9,
    requires: { education: 'tecnico', expSectorMonths: 84, skills: { management: 50, discipline: 40 } }, keySkills: ['management', 'discipline'], skillXp: { management: 500, discipline: 200 }, bonusTarget: 0.15, pensionMatch: 0.06, healthInsurance: true,
    equity: { stockId: 'MADN', pct: 0.35 }, pitch: 'Todas las plantas de Maderas del Norte: parte del pago en acciones (siguen a la construcción).' },
  { id: 'dir_administracion', title: 'Director de administración y finanzas', employer: 'Clínicas Aurora', sector: 'administracion', level: 5, baseSalary: 7600, hoursPerWeek: 48, stress: 8,
    requires: { education: 'universitario', expSectorMonths: 84, skills: { accounting: 50, management: 45 } }, keySkills: ['accounting', 'management'], skillXp: { accounting: 300, management: 500 }, bonusTarget: 0.15, pensionMatch: 0.06, healthInsurance: true,
    equity: { stockId: 'AURA', pct: 0.35 }, pitch: 'La administración de una red de clínicas que cotiza: sueldo y acciones cada año.' },
];

export const JOB_BY_ID: Record<string, JobDef> = Object.fromEntries(JOBS.map((j) => [j.id, j]));
