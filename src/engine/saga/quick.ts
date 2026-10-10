import type { GameState } from '../state';
import type { Cents } from '../money';
import { usd } from '../money';
import { ActionResult, FAIL } from '../result';
import { spendable } from '../finance/payments';
import { monthlyRecurring } from '../finance/budget';
import { statementRemaining } from '../finance/creditCard';
import { buyFund } from '../invest/funds';

/**
 * INVERTIR LO QUE SOBRA (1.4): una sola acción para el paso que más se repite.
 * Deja una reserva de 6 meses de gastos esenciales y de cuotas de deudas, el resumen
 * de la tarjeta y los impuestos pendientes, y pone el resto en el fondo índice.
 */
export const INDEX_FUND = 'F-IDX';

/** Cuotas mensuales de deudas personales (préstamos e hipotecas propias). */
function monthlyDebtPayments(state: GameState): Cents {
  const loans = state.bank.loans.filter((l) => l.status === 'active').reduce((a, l) => a + l.payment, 0);
  const mortgages = state.realEstate.mortgages.filter((m) => m.status === 'activa' && m.owner.kind === 'personal').reduce((a, m) => a + m.payment, 0);
  return loans + mortgages;
}

export function surplusBreakdown(state: GameState): { available: Cents; reserve: Cents; surplus: Cents } {
  const available = spendable(state);
  const taxes = state.tax.filings.filter((f) => f.status === 'due').reduce((a, f) => a + f.outstanding, 0);
  // Reserva: 6 meses de gastos esenciales y de cuotas de deudas, más el resumen de la tarjeta y los impuestos pendientes.
  const reserve = (monthlyRecurring(state, true) + monthlyDebtPayments(state)) * 6 + statementRemaining(state) + taxes;
  const surplus = Math.max(0, Math.floor((available - reserve) / 100) * 100);
  return { available, reserve, surplus };
}

export function investSurplus(state: GameState): ActionResult {
  const { surplus } = surplusBreakdown(state);
  if (surplus < usd(50 * state.macro.priceIndex)) return FAIL('No hay excedente: primero completá tu reserva de 6 meses de gastos esenciales.');
  return buyFund(state, INDEX_FUND, surplus);
}
