/**
 * Bug reportado (1.4–1.5): al pasar la herencia, el heredero arrastraba los cursos,
 * títulos y certificados de quien se fue. Las vacantes miraban su propio nivel (por
 * ejemplo, secundaria) y la inscripción miraba la lista heredada («Ya obtuviste este
 * título»): no podía trabajar de lo que «tenía» ni estudiarlo.
 */
import { describe, it, expect } from 'vitest';
import { makeGame, expectConsistent } from './helpers';
import { post } from '../src/engine/ledger/ledger';
import { usd } from '../src/engine/money';
import { life, succession, repairHeirEducation, heirs } from '../src/engine/saga/life';
import { enroll } from '../src/engine/skills/education';
import { checkRequirements } from '../src/engine/career/career';
import { JOB_BY_ID } from '../src/content/jobs';
import { migrate } from '../src/persistence/migrations';
import type { GameState } from '../src/engine/state';

function gift(s: GameState, dollars: number): void {
  post(s.ledger, { day: s.day, memo: 'Aporte de prueba', cf: 'internal', tag: 'opening', lines: [{ account: 'checking', debit: usd(dollars) }, { account: 'opening_equity', credit: usd(dollars) }] });
}

/** Un padre que terminó una licenciatura en finanzas, el MBA y una certificación. */
function graduateParent(seed: string, money: number): GameState {
  const s = makeGame('egresado', seed);
  gift(s, money);
  s.day = 4000;
  s.education = { level: 'posgrado', fields: ['finanzas'], certificates: ['Contable básico'], active: [], completed: [{ courseId: 'lic_finanzas', day: 2000 }, { courseId: 'mba', day: 3000 }, { courseId: 'cert_contable', day: 1200 }] };
  life(s).birthDay = s.day - Math.round(66 * 365.25);
  return s;
}

describe('Estudios del heredero', () => {
  it('un sobrino llega con su propio técnico, sin los títulos del padre, y puede estudiar la licenciatura', () => {
    const s = graduateParent('heir-nephew', 200_000);
    expect(succession(s, 'sobrino', 'retiro').ok).toBe(true);
    expect(s.education.level).toBe('tecnico');
    expect(s.education.completed).toEqual([]);
    expect(s.education.certificates).toEqual([]);
    expect(s.education.fields).toHaveLength(1);
    const r = enroll(s, 'lic_finanzas');
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    expectConsistent(s);
  });

  it('las vacantes y la inscripción miran lo mismo: lo que estudió el heredero', () => {
    const s = graduateParent('heir-jobs', 200_000);
    succession(s, 'sobrino', 'retiro');
    // Antes: «Título en Finanzas» aparecía cumplido (campo del padre) pero el nivel no; y el MBA, «ya obtenido».
    const analyst = JOB_BY_ID['fin_analista_jr'];
    expect(checkRequirements(s, analyst).items.find((i) => i.label.startsWith('Educación'))?.met).toBe(false);
    expect(enroll(s, 'mba').ok).toBe(false);
    expect(enroll(s, 'mba').ok ? '' : (enroll(s, 'mba') as { error: string }).error).not.toMatch(/Ya obtuviste/);
  });

  it('un hijo de una familia rica llega con universidad en la carrera de su talento', () => {
    const s = graduateParent('heir-rich', 3_000_000);
    life(s).children.push({ id: 99, name: 'Lucía', born: s.day - Math.round(30 * 365.25) });
    const h = heirs(s).find((x) => x.id === 99);
    expect(h).toBeTruthy();
    succession(s, 99, 'retiro');
    expect(s.education.level).toBe('universitario');
    expect(s.education.fields).toHaveLength(1);
    expect(s.education.completed).toEqual([]);
  });

  it('las partidas guardadas con el bug se reparan al abrirlas (y la reparación no repite cambios)', () => {
    const s = graduateParent('heir-repair', 200_000);
    // Estado que dejaba la 1.5: nivel del heredero, pero cursos, campos y certificados del padre.
    life(s).ancestors.push({ name: 'Padre', born: 0, until: 3500, netWorth: 0, cause: 'fallecimiento' });
    s.education.level = 'tecnico';
    s.education.completed.push({ courseId: 'cert_ventas', day: 3600 }); // este sí lo hizo el heredero
    const raw = JSON.parse(JSON.stringify(s));
    const { state } = migrate(raw);
    expect(state.education.completed.map((c) => c.courseId)).toEqual(['cert_ventas']);
    expect(state.education.certificates).toEqual(['Ventas profesionales']);
    expect(state.education.level).toBe('tecnico');
    expect(enroll(state, 'lic_finanzas').ok).toBe(true);
    expect(repairHeirEducation(state)).toBe(false); // ya reparada
  });

  it('sin herencia no se toca nada', () => {
    const s = graduateParent('heir-none', 1000);
    const before = JSON.stringify(s.education);
    expect(repairHeirEducation(s)).toBe(false);
    expect(JSON.stringify(s.education)).toBe(before);
  });
});
