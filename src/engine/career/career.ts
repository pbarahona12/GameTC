import { imageJobBonus, imageNegotiationBonus } from '../lifestyle/effects';
import { JOB_BY_ID, JobDef, SECTOR_NAMES, EDUCATION_RANK, EDUCATION_NAMES, FIELD_NAMES } from '../../content/jobs';
import { SKILL_BY_ID } from '../../content/skills';
import { post } from '../ledger/ledger';
import { Cents, clamp, roundCents, usd } from '../money';
import type { Application, GameState } from '../state';
import { nextId } from '../state';
import { addMonths, formatDate, dateOf, dayOf, daysInMonth } from '../time/calendar';
import { addLog } from '../log';
import { ActionResult, FAIL, OK } from '../result';
import { fmtMoney, fmtPct } from '../format';
import { chance, randInt, randRange } from '../rng';
import { addXp, luckBias, practice } from '../skills/skills';
import { payroll, progressiveTax } from '../tax/incomeTax';
import { jobMarketFactor, layoffRisk } from '../economy/economy';
import { residence } from '../tax/taxEngine';
import { garnish } from '../finance/loans';
import { studyHoursPerWeek } from '../skills/education';

export const MAX_PENDING_APPLICATIONS = 5;
export const OFFER_VALID_DAYS = 7;

export function jobSalary(state: GameState, job: JobDef): Cents {
  return usd(Math.round(job.baseSalary * state.macro.priceIndex / 10) * 10);
}

/** Ingreso bruto mensual fijo (base conservadora que usan los bancos). */
export function monthlyGrossIncome(state: GameState): Cents {
  return state.career.job ? state.career.job.salary : 0;
}

export interface RequirementCheck {
  ok: boolean;
  items: Array<{ label: string; met: boolean }>;
}

export function checkRequirements(state: GameState, job: JobDef): RequirementCheck {
  const items: RequirementCheck['items'] = [];
  const r = job.requires;
  if (r.education) {
    const met = EDUCATION_RANK[state.education.level] >= EDUCATION_RANK[r.education];
    items.push({ label: `Educación: ${EDUCATION_NAMES[r.education]} o superior`, met });
  }
  if (r.fields?.length) {
    const met = r.fields.some((f) => state.education.fields.includes(f));
    items.push({ label: `Título en ${r.fields.map((f) => FIELD_NAMES[f]).join(' o ')}`, met });
  }
  if (r.expSectorMonths) {
    // El mes en curso cuenta si ya llevás 15 días trabajados en ese sector (así un ascenso a los 12 meses no falla por la fecha de ingreso).
    const have = (state.career.experience[job.sector] ?? 0) + (currentMonthCounts(state, job.sector) ? 1 : 0);
    items.push({ label: `${r.expSectorMonths} meses de experiencia en ${SECTOR_NAMES[job.sector]} (tenés ${have})`, met: have >= r.expSectorMonths });
  }
  for (const [sk, lvl] of Object.entries(r.skills ?? {})) {
    const have = state.skills[sk as keyof typeof state.skills].level;
    items.push({ label: `${SKILL_BY_ID[sk as keyof typeof SKILL_BY_ID].name} nivel ${lvl} (tenés ${have})`, met: have >= (lvl as number) });
  }
  return { ok: items.every((i) => i.met), items };
}

/** ¿El mes en curso ya suma un mes de experiencia en ese sector (15 días o más trabajados)? */
function currentMonthCounts(state: GameState, sector: string): boolean {
  const e = state.career.job;
  if (!e || JOB_BY_ID[e.jobId].sector !== sector) return false;
  const g = dateOf(state.day);
  const since = Math.max(e.employedSince ?? e.startDay, dayOf(g.y, g.m, 1));
  return state.day - since + 1 >= 15;
}

/** Probabilidad de recibir oferta. Transparente: cada factor está documentado. */
export function applicationChance(state: GameState, job: JobDef): number {
  const a = state.player.attributes;
  let p = 0.35;
  p += state.skills.social.level * 0.004;
  p += a.reputation * 0.002 + a.network * 0.002;
  let excess = 0;
  for (const [sk, lvl] of Object.entries(job.requires.skills ?? {})) excess += Math.max(0, state.skills[sk as keyof typeof state.skills].level - (lvl as number));
  p += Math.min(20, excess) * 0.005;
  const exp = state.career.experience[job.sector] ?? 0;
  p += Math.min(0.1, Math.max(0, exp - (job.requires.expSectorMonths ?? 0)) * 0.003);
  p += luckBias(state);
  // 1.2: tu imagen en la entrevista (±6 puntos según lo que se espera para el nivel del puesto).
  p += imageJobBonus(state, job.level);
  // Mercado laboral: con desempleo alto hay más competencia por cada puesto.
  p *= jobMarketFactor(state);
  if (state.legal?.criminalRecord) p *= 0.6;
  return clamp(p, 0.05, 0.92);
}

export function apply(state: GameState, jobId: string): ActionResult {
  const job = JOB_BY_ID[jobId];
  if (!job) return FAIL('Empleo inexistente.');
  if (state.legal?.prison) return FAIL('Desde prisión no podés postularte a empleos.');
  if (state.career.job?.jobId === jobId) return FAIL('Ya trabajás en ese puesto.');
  const apps = state.career.applications;
  if (apps.some((a) => a.jobId === jobId && (a.status === 'pending' || a.status === 'offer'))) return FAIL('Ya tenés una postulación activa para este puesto.');
  const recentReject = apps.find((a) => a.jobId === jobId && a.status === 'rejected' && state.day - a.resolveDay < 30);
  if (recentReject) return FAIL('Te rechazaron hace menos de 30 días en este puesto. Esperá antes de volver a postularte.');
  if (apps.filter((a) => a.status === 'pending').length >= MAX_PENDING_APPLICATIONS) return FAIL(`Máximo ${MAX_PENDING_APPLICATIONS} postulaciones en curso a la vez.`);
  const req = checkRequirements(state, job);
  if (!req.ok) return FAIL('No cumplís los requisitos: ' + req.items.filter((i) => !i.met).map((i) => i.label).join('; '));
  const app: Application = {
    id: nextId(state), jobId, appliedDay: state.day, resolveDay: state.day + randInt(state, 3, 10), status: 'pending',
    chance: applicationChance(state, job), negotiated: false,
  };
  apps.push(app);
  practice(state, 'apply', 'social', 40);
  addLog(state, 'info', '📨', `Te postulaste a ${job.title} en ${job.employer}. Respuesta en unos días.`);
  return OK('Postulación enviada.');
}

const REJECTIONS = [
  'Eligieron a una persona con más experiencia.',
  'El puesto se cubrió con una promoción interna.',
  'La entrevista no convenció al equipo.',
  'Congelaron la contratación por presupuesto.',
];

export function processApplications(state: GameState): void {
  for (const a of state.career.applications) {
    const job = JOB_BY_ID[a.jobId];
    if (a.status === 'pending' && a.resolveDay <= state.day) {
      if (chance(state, a.chance)) {
        a.status = 'offer';
        a.offerSalary = roundCents(jobSalary(state, job) * (1 + randRange(state, -0.03, 0.05)) / 1000) * 1000;
        a.offerExpiresDay = state.day + OFFER_VALID_DAYS;
        addLog(state, 'success', '📩', `¡Oferta de ${job.employer} para ${job.title}! ${fmtMoney(a.offerSalary)} brutos al mes. Tenés ${OFFER_VALID_DAYS} días para responder.`, undefined, 'ofertas');
      } else {
        a.status = 'rejected';
        a.message = REJECTIONS[randInt(state, 0, REJECTIONS.length - 1)];
        // Sin empleo y sin otras postulaciones abiertas, hay que actuar: se avisa (y pausa) como una oferta.
        const stuck = !state.career.job && !state.career.applications.some((x) => x !== a && (x.status === 'pending' || x.status === 'offer'));
        addLog(state, 'warning', '📭', `${job.employer} rechazó tu postulación a ${job.title}. ${a.message}${stuck ? ' No te quedan postulaciones abiertas: postulate a otros puestos en Carrera → Vacantes.' : ''}`, undefined, stuck ? 'ofertas' : undefined);
      }
    } else if (a.status === 'offer' && a.offerExpiresDay !== undefined && a.offerExpiresDay < state.day) {
      a.status = 'expired';
      addLog(state, 'warning', '⌛', `Venció la oferta de ${job.employer}.`);
    }
  }
  // Mantener el historial acotado.
  if (state.career.applications.length > 60) {
    state.career.applications = state.career.applications.filter((a, i, arr) => a.status === 'pending' || a.status === 'offer' || i >= arr.length - 40);
  }
}

export function negotiationChance(state: GameState, pct: number): number {
  return clamp(0.55 + state.skills.negotiation.level * 0.005 + state.skills.social.level * 0.002 - pct * 2.5 + imageNegotiationBonus(state), 0.05, 0.9);
}

export function negotiateOffer(state: GameState, appId: number, pct: number): ActionResult {
  const a = state.career.applications.find((x) => x.id === appId);
  if (!a || a.status !== 'offer' || a.offerSalary === undefined) return FAIL('Oferta no disponible.');
  if (a.negotiated) return FAIL('Ya negociaste esta oferta.');
  if (![0.05, 0.1, 0.15, 0.2].includes(pct)) return FAIL('Porcentaje no válido.');
  a.negotiated = true;
  const p = negotiationChance(state, pct);
  practice(state, 'negotiate_salary', 'negotiation', Math.round(200 * (1 + pct * 5)));
  if (chance(state, p)) {
    a.offerSalary = roundCents(a.offerSalary * (1 + pct) / 1000) * 1000;
    return OK(`¡Aceptaron! Nuevo salario ofrecido: ${fmtMoney(a.offerSalary)}.`);
  }
  if (pct >= 0.15 && chance(state, 0.3)) {
    a.status = 'withdrawn';
    addLog(state, 'danger', '🚪', `${JOB_BY_ID[a.jobId].employer} retiró la oferta tras tu contrapropuesta.`);
    return FAIL('La empresa consideró excesivo el pedido y retiró la oferta.');
  }
  return FAIL(`No aceptaron el aumento (probabilidad estimada ${Math.round(p * 100)} %). La oferta original sigue en pie.`);
}

/** Por qué no podés postularte hoy a un puesto (null = podés). */
export function applyBlocker(state: GameState, job: JobDef): string | null {
  const apps = state.career.applications;
  const recentReject = apps.find((a) => a.jobId === job.id && a.status === 'rejected' && state.day - a.resolveDay < 30);
  if (recentReject) return `Podés volver a postularte el ${formatDate(recentReject.resolveDay + 30)}`;
  if (apps.filter((a) => a.status === 'pending').length >= MAX_PENDING_APPLICATIONS) return `Máximo ${MAX_PENDING_APPLICATIONS} postulaciones en curso`;
  return null;
}

/** Pérdida del empleo al ingresar a prisión (sin indemnización). */
export function endEmploymentForPrison(state: GameState): void {
  if (!state.career.job) return;
  const job = JOB_BY_ID[state.career.job.jobId];
  endEmployment(state, 'despido');
  state.career.applications = state.career.applications.filter((a) => a.status !== 'pending' && a.status !== 'offer');
  addLog(state, 'danger', '📦', `Perdiste tu empleo de ${job.title} al ingresar a prisión.`);
}

function endEmployment(state: GameState, reason: 'renuncia' | 'ascenso' | 'despido' | 'cambio'): void {
  const e = state.career.job;
  if (!e) return;
  paySalaryThrough(state, state.day);
  state.career.history.push({ jobId: e.jobId, startDay: e.startDay, endDay: state.day, finalSalary: e.salary, reason });
  state.career.job = null;
}

export function acceptOffer(state: GameState, appId: number): ActionResult {
  const a = state.career.applications.find((x) => x.id === appId);
  if (!a || a.status !== 'offer' || a.offerSalary === undefined) return FAIL('Oferta no disponible.');
  if (state.legal?.prison) return FAIL('Desde prisión no podés aceptar un empleo.');
  const job = JOB_BY_ID[a.jobId];
  const hadInsurance = state.career.job ? JOB_BY_ID[state.career.job.jobId].healthInsurance : false;
  if (state.career.job) endEmployment(state, 'cambio');
  a.status = 'accepted';
  state.career.job = {
    jobId: job.id, salary: a.offerSalary, startDay: state.day, paidThroughDay: state.day - 1, performance: 50,
    nextReviewDay: addMonths(state.day, 12), lastRaisePct: 0, monthsInRole: 0, lowPerfMonths: 0,
  };
  for (const other of state.career.applications) if (other.status === 'offer' && other.jobId === job.id && other.id !== a.id) other.status = 'declined';
  if (job.healthInsurance && state.budget.privateInsurance) {
    state.budget.privateInsurance = false;
    addLog(state, 'info', '🩺', 'Tu nuevo empleo incluye seguro médico: se canceló el seguro privado.');
  }
  if (hadInsurance && !job.healthInsurance && !state.budget.privateInsurance) addLog(state, 'warning', '🩺', 'Tu nuevo empleo no incluye seguro médico: quedaste sin cobertura. Podés contratar un seguro privado en Finanzas → Presupuesto.');
  addLog(state, 'success', '💼', `Empezaste a trabajar como ${job.title} en ${job.employer}.`);
  return OK(`¡Contratado! Salario bruto: ${fmtMoney(a.offerSalary)}/mes.`);
}

export function declineOffer(state: GameState, appId: number): ActionResult {
  const a = state.career.applications.find((x) => x.id === appId);
  if (!a || a.status !== 'offer') return FAIL('Oferta no disponible.');
  a.status = 'declined';
  return OK('Oferta rechazada.');
}

export function quitJob(state: GameState): ActionResult {
  const e = state.career.job;
  if (!e) return FAIL('No tenés empleo.');
  const job = JOB_BY_ID[e.jobId];
  endEmployment(state, 'renuncia');
  addLog(state, 'warning', '🚪', `Renunciaste a ${job.title}. Se pagaron los días trabajados del mes.`);
  return OK('Renuncia registrada.');
}

/** Registra una nómina (base + variable) con retenciones, aportes y aporte patronal. */
function postPayroll(state: GameState, base: Cents, variable: Cents, memo: string, marginalWithholding = false): Cents {
  const e = state.career.job!;
  const job = JOB_BY_ID[e.jobId];
  const gross = base + variable;
  if (gross <= 0) return 0;
  const pr = payroll(residence(state), gross, state.bank.pensionRate);
  let withheld = pr.incomeTaxWithheld;
  if (marginalWithholding) {
    // Pagos extraordinarios: retención por el impuesto marginal que agregan sobre el sueldo anual.
    const annual = payroll(residence(state), e.salary, state.bank.pensionRate).taxableMonthly * 12;
    withheld = progressiveTax(residence(state), annual + pr.taxableMonthly).tax - progressiveTax(residence(state), annual).tax;
  }
  const net = gross - pr.pensionEmployee - pr.socialSecurity - withheld;
  const match = roundCents(gross * Math.min(state.bank.pensionRate, job.pensionMatch));
  post(state.ledger, {
    day: state.day,
    memo,
    cf: 'operating',
    tag: 'payroll',
    lines: [
      { account: 'checking', debit: net },
      { account: 'income_tax', debit: withheld },
      { account: 'social_security', debit: pr.socialSecurity },
      { account: 'pension', debit: pr.pensionEmployee },
      { account: 'salary_income', credit: base },
      { account: 'bonus_income', credit: variable },
    ],
  });
  if (match > 0) {
    post(state.ledger, {
      day: state.day,
      memo: `${memo}: aporte del empleador a jubilación`,
      cf: 'internal',
      tag: 'payroll:match',
      lines: [
        { account: 'pension', debit: match },
        { account: 'benefits_income', credit: match },
      ],
    });
  }
  const y = state.tax.ytd;
  y.wages += base;
  y.bonuses += variable;
  y.pensionEmployee += pr.pensionEmployee;
  y.socialSecurity += pr.socialSecurity;
  y.withheld += withheld;
  addLog(state, 'income', '💵', `${memo}: bruto ${fmtMoney(gross)}, neto ${fmtMoney(net)}.`, net);
  const g = garnish(state, net);
  if (g > 0) addLog(state, 'danger', '⚖️', 'Embargo salarial aplicado a un préstamo en impago.', g, 'peligro');
  return net;
}

/** Paga el salario devengado desde el último pago hasta `toDay` (inclusive), prorrateado por días. */
export function paySalaryThrough(state: GameState, toDay: number): void {
  const e = state.career.job;
  if (!e) return;
  const days = toDay - e.paidThroughDay;
  if (days <= 0) return;
  const g = dateOf(toDay);
  const dim = daysInMonth(g.y, g.m);
  const job = JOB_BY_ID[e.jobId];
  // Prorrateo telescópico: pagar hasta el día N del mes menos lo ya pagado ese mes.
  // Así la suma de pagos parciales de un mes coincide exactamente con el sueldo mensual.
  const monthStart = dayOf(g.y, g.m, 1);
  const fromIdx = e.paidThroughDay >= monthStart ? e.paidThroughDay - monthStart + 1 : 0;
  const toIdx = toDay - monthStart + 1;
  const base = roundCents((e.salary * toIdx) / dim) - roundCents((e.salary * fromIdx) / dim);
  const commission = job.commission ? roundCents(base * job.commission * (e.performance / 50)) : 0;
  e.paidThroughDay = toDay;
  postPayroll(state, base, commission, days >= dim ? `Salario de ${job.title}` : `Salario proporcional (${days} días)`);
}

/** Desempeño objetivo según habilidades, experiencia, disciplina, estrés y salud. */
export function performanceTarget(state: GameState): number {
  const e = state.career.job;
  if (!e) return 0;
  const job = JOB_BY_ID[e.jobId];
  let skillScore = 0;
  for (const sk of job.keySkills) {
    const req = job.requires.skills?.[sk] ?? job.level * 5;
    skillScore += clamp(state.skills[sk].level - req, -20, 30);
  }
  skillScore = (skillScore / job.keySkills.length) * 0.8;
  const a = state.player.attributes;
  const exp = Math.min(60, state.career.experience[job.sector] ?? 0) * 0.2;
  const overload = Math.max(0, job.hoursPerWeek + studyHoursPerWeek(state) - 60) * 0.5;
  return clamp(50 + skillScore + exp + state.skills.discipline.level * 0.1 - Math.max(0, a.stress - 60) * 0.6 - Math.max(0, 50 - a.health) * 0.4 - overload, 0, 100);
}

/** Cierre de mes laboral. Se llama el último día de cada mes. */
export function monthEndCareer(state: GameState): void {
  const e = state.career.job;
  if (!e) return;
  const job = JOB_BY_ID[e.jobId];
  const g = dateOf(state.day);
  const dim = daysInMonth(g.y, g.m);
  // Un ascenso no corta la antigüedad: se cuenta desde que entraste a la empresa.
  const worked = Math.min(dim, state.day - Math.max(e.employedSince ?? e.startDay, state.day - dim + 1) + 1);
  paySalaryThrough(state, state.day);
  // Desempeño
  const target = performanceTarget(state);
  e.performance = clamp(Math.round(e.performance + (target - e.performance) * 0.3 + randRange(state, -3, 3)), 0, 100);
  // Experiencia y XP proporcionales a los días trabajados
  const frac = worked / dim;
  if (worked >= 15) state.career.experience[job.sector] = (state.career.experience[job.sector] ?? 0) + 1;
  e.monthsInRole++;
  for (const [sk, xp] of Object.entries(job.skillXp)) addXp(state, sk as keyof typeof state.skills, (xp as number) * frac);
  state.career.careerPoints += Math.round(job.level * 10 * (e.performance / 50) * frac);
  // Bajo desempeño sostenido
  e.lowPerfMonths = e.performance < 30 ? e.lowPerfMonths + 1 : 0;
  if (e.lowPerfMonths === 2) addLog(state, 'warning', '📉', `Tu jefe te advirtió por bajo desempeño (${e.performance}/100). Un mes más así y podrías perder el empleo.`, undefined, 'peligro');
  if (e.lowPerfMonths >= 3) {
    dismiss(state);
    return;
  }
  // Recortes de personal en épocas de desempleo alto (protege el buen desempeño).
  if (!state.meta.projection && chance(state, layoffRisk(state, e.performance))) layoff(state);
}

function layoff(state: GameState): void {
  const e = state.career.job!;
  const job = JOB_BY_ID[e.jobId];
  const years = Math.max(0.5, (state.day - e.startDay) / 365);
  const severance = roundCents(e.salary * Math.min(6, years));
  postPayroll(state, 0, severance, 'Indemnización por recorte de personal', true);
  endEmployment(state, 'despido');
  state.player.attributes.stress = Math.min(100, state.player.attributes.stress + 10);
  addLog(state, 'danger', '📉', `${job.employer} hizo un recorte de personal por la situación económica y tu puesto de ${job.title} fue eliminado. Recibiste ${fmtMoney(severance)} de indemnización.`, undefined, 'peligro');
}

function dismiss(state: GameState): void {
  const e = state.career.job!;
  const job = JOB_BY_ID[e.jobId];
  const severance = e.salary;
  // Indemnización: un salario, tributa como ingreso extraordinario.
  postPayroll(state, 0, severance, 'Indemnización por despido', true);
  endEmployment(state, 'despido');
  state.player.attributes.reputation = Math.max(0, state.player.attributes.reputation - 5);
  state.player.attributes.stress = Math.min(100, state.player.attributes.stress + 12);
  addLog(state, 'danger', '📦', `Te despidieron de ${job.title} por bajo desempeño sostenido. Recibiste un mes de indemnización.`);
}

export function reviewRaisePct(perf: number): number {
  if (perf >= 85) return 0.06;
  if (perf >= 70) return 0.04;
  if (perf >= 55) return 0.025;
  if (perf >= 40) return 0.01;
  return 0;
}

/** Aumento de la evaluación anual: por desempeño, ajustado por el ciclo y la inflación. */
export function projectedRaisePct(state: GameState, perf: number): number {
  const cycle = state.macro.phase === 'recesion' ? -0.015 : state.macro.phase === 'auge' ? 0.01 : 0;
  return Math.max(0, reviewRaisePct(perf) + cycle + Math.max(0, state.macro.inflation - 0.03) * 0.5);
}

/** Evaluación anual: aumento, bono y posible ascenso. */
export function processReview(state: GameState): void {
  const e = state.career.job;
  if (!e || e.nextReviewDay !== state.day) return;
  const job = JOB_BY_ID[e.jobId];
  const perf = e.performance;
  paySalaryThrough(state, state.day);
  const bonusFactor = clamp((perf - 30) / 40, 0, 1.5);
  const bonus = roundCents(e.salary * 12 * job.bonusTarget * bonusFactor);
  if (bonus > 0) postPayroll(state, 0, bonus, 'Bono anual por desempeño', true);
  const next = job.promotesTo ? JOB_BY_ID[job.promotesTo] : null;
  if (next && perf >= 70) {
    const reqs = checkRequirements(state, next);
    if (reqs.ok) {
      const newSalary = Math.max(roundCents(e.salary * 1.08), jobSalary(state, next));
      state.career.history.push({ jobId: job.id, startDay: e.startDay, endDay: state.day, finalSalary: e.salary, reason: 'ascenso' });
      e.employedSince = e.employedSince ?? e.startDay;
      e.jobId = next.id;
      e.salary = newSalary;
      e.startDay = state.day;
      e.monthsInRole = 0;
      e.lastRaisePct = 0;
      e.nextReviewDay = addMonths(state.day, 12);
      state.career.promotions++;
      state.player.attributes.reputation = Math.min(100, state.player.attributes.reputation + 3);
      addLog(state, 'success', '🚀', `¡Ascenso! Ahora sos ${next.title}. Nuevo salario: ${fmtMoney(newSalary)}.`, undefined, 'logros');
      return;
    }
    addLog(state, 'info', '🪜', `Tu desempeño alcanza para ascender a ${next.title}, pero te faltan requisitos: ${reqs.items.filter((i) => !i.met).map((i) => i.label).join('; ')}.`);
  }
  const raise = projectedRaisePct(state, perf);
  e.salary = roundCents(e.salary * (1 + raise) / 100) * 100;
  e.lastRaisePct = raise;
  e.nextReviewDay = addMonths(state.day, 12);
  addLog(state, raise > 0 ? 'success' : 'warning', '📋', `Evaluación anual: desempeño ${perf}/100. Aumento del ${fmtPct(raise)} (inflación del año: ${fmtPct(state.macro.inflation)}).`);
}

