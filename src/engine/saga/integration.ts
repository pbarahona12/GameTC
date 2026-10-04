import type { GameState } from '../state';
import type { Company } from '../business/types';
import type { BizSectorId } from '../../content/sectors';
import { roundCents } from '../money';
import { ActionResult, FAIL, OK } from '../result';
import { coPost } from '../business/companyLedger';
import { fmtPct } from '../format';
import { chronicle } from './chronicle';

/**
 * PROVEEDORES PROPIOS (integración vertical, 1.4): una empresa tuya le presta un
 * servicio o le vende insumos a otra tuya, con un precio interno.
 *  - insumos:      minimercado → cafetería. La cafetería paga 8 % menos sus insumos
 *                  y le paga al minimercado el 3 % de sus ventas.
 *  - gestion:      consultora → cualquiera. 30 % menos de gastos administrativos;
 *                  paga a la consultora el 1.5 % de sus ventas.
 *  - equipamiento: fábrica de muebles → cafetería o minimercado. 25 % menos de
 *                  mantenimiento; paga a la fábrica el 1 % de sus ventas.
 * El pago interno se registra como ingresos y gastos intragrupo (en un grupo se
 * eliminan al consolidar). El beneficio real es el ahorro del comprador.
 */
export type DealKind = 'insumos' | 'gestion' | 'equipamiento';

export interface Deal {
  id: number;
  kind: DealKind;
  supplierId: number;
  buyerId: number;
  since: number;
}

export const DEAL_INFO: Record<DealKind, { name: string; supplier: BizSectorId[]; buyer: BizSectorId[] | 'any'; discount: number; fee: number; what: string }> = {
  insumos: { name: 'Insumos propios', supplier: ['minimarket'], buyer: ['cafeteria'], discount: 0.08, fee: 0.03, what: '8 % menos en insumos' },
  gestion: { name: 'Gestión compartida', supplier: ['consultora'], buyer: 'any', discount: 0.3, fee: 0.015, what: '30 % menos de gastos administrativos' },
  equipamiento: { name: 'Equipamiento propio', supplier: ['muebles'], buyer: ['cafeteria', 'minimarket'], discount: 0.25, fee: 0.01, what: '25 % menos de mantenimiento' },
};

function deals(state: GameState): Deal[] {
  if (!state.saga) return [];
  state.saga.deals ??= [];
  return state.saga.deals;
}

const open = (c?: Company) => !!c && (c.status === 'active' || c.status === 'insolvent') && !c.npc;

/** Descuento vigente para una empresa compradora (0 si no tiene un acuerdo de ese tipo). */
export function dealDiscount(state: GameState, co: Company | undefined, kind: DealKind): number {
  if (!co || !state.saga) return 0;
  const d = deals(state).find((x) => x.kind === kind && x.buyerId === co.id);
  if (!d) return 0;
  const sup = state.companies.find((c) => c.id === d.supplierId);
  return open(sup) ? DEAL_INFO[kind].discount : 0;
}

export function dealsOf(state: GameState, coId: number): Deal[] {
  return deals(state).filter((d) => d.buyerId === coId || d.supplierId === coId);
}

/** Acuerdos posibles entre tus empresas que todavía no existen. */
export function possibleDeals(state: GameState): Array<{ kind: DealKind; supplier: Company; buyer: Company }> {
  const mine = state.companies.filter((c) => open(c) && c.sector !== 'holding');
  const out: Array<{ kind: DealKind; supplier: Company; buyer: Company }> = [];
  for (const kind of Object.keys(DEAL_INFO) as DealKind[]) {
    const info = DEAL_INFO[kind];
    for (const sup of mine.filter((c) => info.supplier.includes(c.sector))) {
      for (const buyer of mine) {
        if (buyer === sup || (info.buyer !== 'any' && !info.buyer.includes(buyer.sector))) continue;
        if (deals(state).some((d) => d.kind === kind && d.buyerId === buyer.id)) continue;
        out.push({ kind, supplier: sup, buyer });
      }
    }
  }
  return out;
}

export function signDeal(state: GameState, kind: DealKind, supplierId: number, buyerId: number): ActionResult {
  const ok = possibleDeals(state).some((p) => p.kind === kind && p.supplier.id === supplierId && p.buyer.id === buyerId);
  if (!ok) return FAIL('Ese acuerdo no es posible entre esas empresas.');
  const sup = state.companies.find((c) => c.id === supplierId)!;
  const buyer = state.companies.find((c) => c.id === buyerId)!;
  deals(state).push({ id: state.meta.nextId++, kind, supplierId, buyerId, since: state.day });
  chronicle(state, 'empresa', 'network', `${sup.name} abastece a ${buyer.name}`, `${DEAL_INFO[kind].name}: ${DEAL_INFO[kind].what} para ${buyer.name}.`);
  return OK(`Acuerdo firmado: ${buyer.name} obtiene ${DEAL_INFO[kind].what} y le paga a ${sup.name} el ${fmtPct(DEAL_INFO[kind].fee, 1)} de sus ventas.`);
}

export function endDeal(state: GameState, id: number): ActionResult {
  const before = deals(state).length;
  state.saga.deals = deals(state).filter((d) => d.id !== id);
  return state.saga.deals.length < before ? OK('Acuerdo terminado.') : FAIL('Ese acuerdo no existe.');
}

/** Día 1 de cada mes: pagos internos según las ventas del mes del comprador; los acuerdos con empresas cerradas se dan de baja. */
export function dealsMonth(state: GameState): void {
  if (!state.saga) return;
  for (const d of [...deals(state)]) {
    const sup = state.companies.find((c) => c.id === d.supplierId);
    const buyer = state.companies.find((c) => c.id === d.buyerId);
    if (!open(sup) || !open(buyer)) {
      state.saga.deals = deals(state).filter((x) => x !== d);
      continue;
    }
    const sales = buyer!.history[buyer!.history.length - 1]?.revenue ?? 0;
    const fee = Math.min(roundCents(sales * DEAL_INFO[d.kind].fee), buyer!.ledger.balances.cash);
    if (fee <= 0) continue;
    coPost(buyer!.ledger, { day: state.day, memo: `${DEAL_INFO[d.kind].name}: pago a ${sup!.name}`, cf: 'operating', tag: 'ic:deal', lines: [{ account: 'ic_expense', debit: fee }, { account: 'cash', credit: fee }] });
    coPost(sup!.ledger, { day: state.day, memo: `${DEAL_INFO[d.kind].name}: cobro a ${buyer!.name}`, cf: 'operating', tag: 'ic:deal', lines: [{ account: 'cash', debit: fee }, { account: 'ic_income', credit: fee }] });
  }
}
