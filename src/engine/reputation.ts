import type { GameState } from './state';
import { clamp } from './money';
import { JOB_BY_ID } from '../content/jobs';
import { LIFESTYLE_BY_ID } from '../content/lifestyle';
import { imageScore } from './lifestyle/effects';
import { foundationReputation } from './saga/life';
import { isOpen } from './business/common';

/**
 * DE DÓNDE SALE TU REPUTACIÓN (fase 1 · E4, auditoría D4).
 *
 * La reputación tiende cada mes al OBJETIVO que se calcula acá (monthlyAttributes
 * se acerca un 5 % por mes). Hasta la 1.5 el objetivo salía sobre todo del nivel de
 * tu empleo: un magnate sin empleo quedaba en 5–40 y no podía llegar a la etapa 8
 * (que pide 60). Ahora tu imperio es una fuente más:
 *  - Carrera: nivel del puesto × 12 (como antes).
 *  - Empresas: por cada empresa abierta, 16 + 8 × su reputación (0–1); las que
 *    pierden plata en los últimos 3 meses cuentan 40 %. Tope 60: tres empresas
 *    rentables pesan como el puesto más alto (nivel 5 × 12).
 *  - Empleados: 4 × log10(1 + empleados de todas tus empresas). Tope 10.
 *  - Listas de fortunas: top 100 de tu ciudad +5, top 10 +10, número 1 +15; top 100
 *    mundial +5 más.
 * La fuente principal (carrera o imperio, la mayor) cuenta entera y la otra suma un
 * 30 %: tener empleo y empresas ayuda, pero no se cuenta dos veces lo mismo.
 * Certificados, estilo de vida, imagen y fundación suman como siempre.
 */
export interface ReputationSources {
  career: number;
  companies: number;
  employees: number;
  ranking: number;
  /** Carrera o imperio (empresas + empleados + listas), lo que pese más, más el 30 % del otro. */
  professional: number;
  certificates: number;
  lifestyle: number;
  image: number;
  foundation: number;
  target: number;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** ¿La empresa ganó plata en sus últimos 3 cierres de mes? */
function profitable(netIncomes: number[]): boolean {
  const last = netIncomes.slice(-3);
  return last.length > 0 && last.reduce((a, b) => a + b, 0) > 0;
}

export function reputationSources(state: GameState): ReputationSources {
  const job = state.career.job ? JOB_BY_ID[state.career.job.jobId] : null;
  const career = job ? job.level * 12 : 0;
  const open = state.companies.filter((c) => isOpen(c) && !c.npc);
  const companies = Math.min(60, open.reduce((sum, c) => sum + (16 + 8 * clamp(c.reputation, 0, 100) / 100) * (profitable(c.history.map((h) => h.netIncome)) ? 1 : 0.4), 0));
  const staff = open.reduce((n, c) => n + c.employees.length, 0);
  const employees = Math.min(10, 4 * Math.log10(1 + staff));
  const rk = state.saga?.ranking?.player;
  const city = rk?.city ?? null;
  const ranking = (city === null ? 0 : city === 1 ? 15 : city <= 10 ? 10 : 5) + (rk?.global !== null && rk?.global !== undefined ? 5 : 0);
  const empire = companies + employees + ranking;
  const professional = Math.max(5, career, empire) + 0.3 * Math.min(career, empire);
  const certificates = state.education.certificates.length * 2;
  const lifestyle = LIFESTYLE_BY_ID[state.budget.lifestyle].reputation * 3;
  const image = imageScore(state) / 10;
  const foundation = foundationReputation(state);
  return {
    career, companies: round1(companies), employees: round1(employees), ranking, professional: round1(professional),
    certificates, lifestyle, image: round1(image), foundation: round1(foundation),
    target: round1(professional + certificates + lifestyle + image + foundation),
  };
}
