import type { TutorialStep } from '../engine/progression/tutorial';
import { navStore } from './nav';

/** Lleva a donde se cumple una misión (Inicio y la lista de Misiones usan lo mismo). */
export function goToMission(step: Pick<TutorialStep, 'id' | 'tab' | 'sub'>): void {
  // Misiones que se cumplen mirando algo en Inicio: abrir lo que hay que mirar.
  if (step.id === 'networth') navStore.open({ kind: 'term', id: 'patrimonio_neto' });
  else if (step.id === 'liquidity') navStore.open({ kind: 'advisor' });
  else navStore.go(step.tab, step.sub);
}
