/**
 * Casos que encontró la auditoría de caos 50 × 20 (1.6).
 */
import { describe, it, expect } from 'vitest';
import { makeGame } from './helpers';
import { fundsDay } from '../src/engine/invest/funds';
import { brokerFee } from '../src/engine/invest/portfolio';
import { isTradingDay } from '../src/engine/invest/stocks';
import { advanceDay } from '../src/engine/simulation';

describe('Caos 50 × 20', () => {
  it('un fondo sectorial no explota si una de sus acciones se desplomó a centavos con un dividendo fijo', () => {
    const s = makeGame('herencia', 'chaos-fund');
    while (!isTradingDay(s.day + 1)) advanceDay(s);
    s.day++;
    const f = s.funds.funds.find((x) => x.id === 'F-IND')!;
    const nav = f.nav;
    for (const st of s.stocks.stocks.filter((x) => ['ACRV', 'MADN'].includes(x.id))) {
      st.prevClose = 4;
      st.price = 1;
      st.dividend = 15;
      st.exDay = s.day;
    }
    fundsDay(s);
    expect(f.nav / nav).toBeLessThan(1.2);
    expect(f.nav / nav).toBeGreaterThan(0.3);
  });

  it('la comisión del corredor nunca supera lo que se vende', () => {
    const s = makeGame('herencia', 'chaos-fee');
    expect(brokerFee(s, 50)).toBe(50);
    expect(brokerFee(s, 0)).toBe(0);
    expect(brokerFee(s, 1_000_000)).toBe(2000);
  });
});
