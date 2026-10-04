import { store } from './store';

/**
 * RESPUESTA SENSORIAL (1.4): sonidos cortos sintetizados (sin archivos de audio)
 * y vibración breve en los festejos. Ambos se pueden apagar en Ajustes; el
 * sonido viene apagado por defecto. Nunca suena con el tiempo corriendo solo:
 * solo en respuesta a algo que el jugador ve en pantalla.
 */
type Tone = 'coin' | 'success' | 'fanfare' | 'tap' | 'warning';

let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  try {
    ctx ??= new AC();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

const NOTES: Record<Tone, Array<[number, number, number]>> = {
  // [frecuencia Hz, inicio s, duración s]
  coin: [[988, 0, 0.08], [1319, 0.07, 0.16]],
  tap: [[660, 0, 0.05]],
  success: [[523, 0, 0.1], [659, 0.09, 0.1], [784, 0.18, 0.2]],
  fanfare: [[523, 0, 0.12], [659, 0.11, 0.12], [784, 0.22, 0.12], [1047, 0.33, 0.35]],
  warning: [[330, 0, 0.14], [262, 0.13, 0.22]],
};

export function playTone(tone: Tone): void {
  if (!store.ui.settings.sound) return;
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime + 0.01;
  for (const [f, start, dur] of NOTES[tone]) {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = tone === 'warning' ? 'sawtooth' : 'triangle';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t0 + start);
    g.gain.exponentialRampToValueAtTime(0.12, t0 + start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + dur);
    o.connect(g).connect(ac.destination);
    o.start(t0 + start);
    o.stop(t0 + start + dur + 0.02);
  }
}

export function vibrate(pattern: number | number[]): void {
  if (!store.ui.settings.haptics || typeof navigator === 'undefined' || !navigator.vibrate) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* sin vibración */
  }
}

/** Festejo completo según el tamaño. */
export function celebrateFeedback(size: 'small' | 'big'): void {
  playTone(size === 'big' ? 'fanfare' : 'success');
  vibrate(size === 'big' ? [30, 60, 30, 60, 80] : 25);
}
