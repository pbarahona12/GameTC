import type { GameState } from '../state';
import type { Cents } from '../money';
import { roundCents, usd } from '../money';
import { ActionResult, FAIL } from '../result';
import { spendable } from '../finance/payments';
import { monthlyRecurring } from '../finance/budget';
import { statementRemaining } from '../finance/creditCard';
import { buyFund } from '../invest/funds';

/**
 * INVERTIR LO QUE SOBRA (1.4): una sola acción para el paso que más se repite.
 * Deja una reserva de 6 meses de gastos esenciales, el resumen de la tarjeta y los
 * impuestos pendientes, y pone el resto en el fondo índice (con su comisión real).
 */
export const INDEX_FUND = 'F-IDX';

export function surplusBreakdown(state: GameState): { available: Cents; reserve: Cents; surplus: Cents } {
  const available = spendable(state);
  const taxes = state.tax.filings.filter((f) => f.status === 'due').reduce((a, f) => a + f.outstanding, 0);
  const reserve = monthlyRecurring(state, true) * 6 + statementRemaining(state) + taxes;
  const surplus = Math.max(0, roundCents((available - reserve) / 100) * 100);
  return { available, reserve, surplus };
}

export function investSurplus(state: GameState): ActionResult {
  const { surplus } = surplusBreakdown(state);
  if (surplus < usd(50 * state.macro.priceIndex)) return FAIL('No hay excedente: primero completá tu reserva de 6 meses de gastos esenciales.');
  return buyFund(state, INDEX_FUND, surplus);
}
