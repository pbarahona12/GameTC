import { describe, it, expect } from 'vitest';
import { last30Start, last90Start, dayOf, isLastDayOfMonth, dateOf } from '../src/engine/time/calendar';

/** La ventana de "30 días" siempre contiene exactamente un cierre de mes (sueldos y alquileres). */
describe('Ventana de 30 días con un solo cierre de mes', () => {
  it('cualquier día de 3 años: exactamente un fin de mes y entre 28 y 31 días', () => {
    for (let day = 40; day < 365 * 3; day++) {
      const from = last30Start(day);
      let ends = 0;
      let firsts = 0;
      for (let d = from; d <= day; d++) { if (isLastDayOfMonth(d)) ends++; if (dateOf(d).d === 1) firsts++; }
      expect(ends, `día ${day}`).toBe(1);
      expect(firsts, `día ${day}: un solo alquiler`).toBe(1);
      expect(day - from + 1).toBeGreaterThanOrEqual(28);
      expect(day - from + 1).toBeLessThanOrEqual(31);
    }
  });
  it('90 días: tres cierres y tres días 1', () => {
    for (let day = 120; day < 365 * 3; day++) {
      const from = last90Start(day);
      let ends = 0;
      let firsts = 0;
      for (let d = from; d <= day; d++) { if (isLastDayOfMonth(d)) ends++; if (dateOf(d).d === 1) firsts++; }
      expect([ends, firsts], `día ${day}`).toEqual([3, 3]);
    }
  });
  it('el 30 de un mes de 31 días incluye el cierre del mes anterior', () => {
    const to = dayOf(2026, 12, 30);
    expect(last30Start(to)).toBe(dayOf(2026, 11, 30));
  });
});
