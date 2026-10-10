import type { GameState } from '../state';
import type { OwnedItem, Look } from './types';
import { ITEM_BY_ID, ItemDef, STORE_BY_ID, StoreDef, Slot, SLOT_NAMES, HAIR_STYLES, SKIN_TONES, HAIR_COLORS, TIER_IMAGE_REQ } from '../../content/shops';
import { Cents, roundCents, usd } from '../money';
import { post } from '../ledger/ledger';
import { canPayFromChecking } from '../finance/payments';
import { cardAvailable, chargeInstallments, quoteInstallments, InstallmentQuote } from '../finance/creditCard';
import { accrueRewards } from '../finance/cardRewards';
import { ActionResult, FAIL, OK } from '../result';
import { fmtMoney, fmtPct } from '../format';
import { addLog } from '../log';
import { storeImage, storeDiscount, treatment, Treatment, wornStyle, itemDef } from './effects';
import { practice } from '../skills/skills';

/**
 * TIENDAS Y POSESIONES.
 * Contabilidad:
 *  - Ropa: es consumo → gasto "Ropa y compras personales" al comprarla.
 *  - Vehículos, tecnología, hogar y lujo: activo "Bienes personales" al costo; cada
 *    mes se deprecian (gasto no monetario) y al venderlos se registra la diferencia.
 * Formas de pago: débito (cuenta corriente), efectivo, tarjeta (un pago, con
 * reintegro según tu nivel) o cuotas (sin interés si la tienda y tu tarjeta lo permiten).
 */

export type PayMethod = 'debito' | 'efectivo' | 'tarjeta' | 'cuotas';

export function listPrice(state: GameState, item: ItemDef): Cents {
  return usd(item.price * state.macro.priceIndex);
}

export interface PriceQuote {
  list: Cents;
  discount: number;
  final: Cents;
  treatment: Treatment;
}

export function priceQuote(state: GameState, item: ItemDef): PriceQuote {
  const store = STORE_BY_ID[item.storeId];
  const list = listPrice(state, item);
  const discount = storeDiscount(state, store.tier);
  return { list, discount, final: roundCents(list * (1 - discount)), treatment: treatment(state, store.tier) };
}

/** ¿Te muestran este artículo? Las colecciones exclusivas requieren buena atención. */
export function canSee(state: GameState, item: ItemDef): boolean {
  return !item.exclusive || treatment(state, STORE_BY_ID[item.storeId].tier) !== 'frio';
}

export function treatmentText(state: GameState, store: StoreDef): string {
  const t = treatment(state, store.tier);
  const req = TIER_IMAGE_REQ[store.tier];
  if (t === 'preferente') return `Te reconocen como cliente preferente: ${fmtPct(storeDiscount(state, store.tier), 0)} de descuento en todo.`;
  // En la tienda cuenta la imagen con la que te ven (tu imagen + lo que suma tu tarjeta).
  if (t === 'normal') return `Atención correcta. Si te vieran con imagen ${req + 20} o más serías cliente preferente (con descuento); hoy te ven ${storeImage(state)}.`;
  return `Te atienden con desgano y no te muestran la colección exclusiva. Necesitan verte con imagen ${req} (hoy te ven ${storeImage(state)}, contando tu tarjeta).`;
}

export function installmentOptions(state: GameState, item: ItemDef, amount: Cents): InstallmentQuote[] {
  return [3, 6, 12].map((n) => quoteInstallments(state, amount, n, STORE_BY_ID[item.storeId].freeInstallments));
}

export function buyItem(state: GameState, itemId: string, method: PayMethod, n = 3): ActionResult {
  const item = ITEM_BY_ID[itemId];
  if (!item) return FAIL('Artículo inexistente.');
  if (state.legal?.prison) return FAIL('No podés ir de compras mientras cumplís una condena.');
  if (!canSee(state, item)) return FAIL(`${STORE_BY_ID[item.storeId].name} solo muestra esa colección a clientes bien presentados. Mejorá tu imagen (ropa, reloj, vehículo) o conseguí una tarjeta de mayor nivel.`);
  const q = priceQuote(state, item);
  const price = q.final;
  const account = item.durable ? 'personal_assets' : 'shopping';
  const desc = `${item.name} (${STORE_BY_ID[item.storeId].name})`;
  const tag = item.durable ? 'shop:goods' : 'shop:clothes';
  const cf = item.durable ? 'investing' : 'operating';
  if (method === 'debito') {
    if (!canPayFromChecking(state, price)) return FAIL(`No te alcanza: necesitás ${fmtMoney(price)} en la cuenta corriente.`);
    post(state.ledger, { day: state.day, memo: desc, cf, tag, lines: [{ account, debit: price }, { account: 'checking', credit: price }] });
  } else if (method === 'efectivo') {
    if (state.ledger.balances.cash_wallet < price) return FAIL(`Tenés ${fmtMoney(state.ledger.balances.cash_wallet)} en efectivo.`);
    post(state.ledger, { day: state.day, memo: desc, cf, tag, lines: [{ account, debit: price }, { account: 'cash_wallet', credit: price }] });
  } else if (method === 'tarjeta') {
    if (!state.bank.card.active) return FAIL('No tenés tarjeta activa.');
    if (cardAvailable(state) < price) return FAIL(`Tu tarjeta tiene ${fmtMoney(cardAvailable(state))} disponibles.`);
    post(state.ledger, { day: state.day, memo: desc, cf: 'operating', tag, lines: [{ account, debit: price }, { account: 'credit_card', credit: price }] });
    accrueRewards(state, price);
  } else {
    const r = chargeInstallments(state, price, n, STORE_BY_ID[item.storeId].freeInstallments, desc, account);
    if (!r.ok) return r;
  }
  const o: OwnedItem = { uid: state.meta.nextId++, itemId, boughtDay: state.day, price, carrying: item.durable ? price : 0, condition: 100 };
  state.possessions.items.push(o);
  state.possessions.spent += price;
  let equipped = '';
  if (item.slot) {
    const curUid = state.possessions.outfit[item.slot];
    const cur = curUid !== undefined ? state.possessions.items.find((x) => x.uid === curUid) : undefined;
    if (!cur || wornStyle(cur) <= item.style) {
      state.possessions.outfit[item.slot] = o.uid;
      equipped = ' Ya lo tenés puesto.';
    }
  }
  if (q.discount > 0) practice(state, 'shop_vip', 'social', 20);
  addLog(state, 'expense', item.category === 'vehiculos' ? '🚗' : item.category === 'ropa' ? '🛍️' : '🛒', `Compraste ${item.name} en ${STORE_BY_ID[item.storeId].name}${method === 'cuotas' ? ` en ${n} cuotas` : method === 'tarjeta' ? ' con tarjeta' : ''}.`, price);
  return OK(`Compraste ${item.name} por ${fmtMoney(price)}${q.discount > 0 ? ` (descuento de cliente preferente ${fmtPct(q.discount, 0)})` : ''}.${equipped}`);
}

/** Valor que te pagan hoy por un bien durable. */
export function resaleValue(o: OwnedItem): Cents {
  const d = itemDef(o);
  return d?.durable ? roundCents(o.carrying * (d.resale ?? 0.5)) : 0;
}

export function sellItem(state: GameState, uid: number): ActionResult {
  const p = state.possessions;
  const o = p.items.find((x) => x.uid === uid);
  if (!o) return FAIL('No tenés ese artículo.');
  const d = itemDef(o);
  if (!d.durable) {
    p.items = p.items.filter((x) => x !== o);
    for (const s of Object.keys(p.outfit) as Slot[]) if (p.outfit[s] === uid) delete p.outfit[s];
    return OK(`Donaste ${d.name}.`);
  }
  const proceeds = resaleValue(o);
  const loss = o.carrying - proceeds;
  post(state.ledger, {
    day: state.day, memo: `Venta de ${d.name}`, cf: 'investing', tag: 'shop:sale',
    lines: [
      ...(proceeds > 0 ? [{ account: 'checking' as const, debit: proceeds }] : []),
      ...(loss > 0 ? [{ account: 'goods_depreciation' as const, debit: loss }] : []),
      ...(o.carrying > 0 ? [{ account: 'personal_assets' as const, credit: o.carrying }] : []),
      ...(loss < 0 ? [{ account: 'other_income' as const, credit: -loss }] : []),
    ],
  });
  p.items = p.items.filter((x) => x !== o);
  for (const s of Object.keys(p.outfit) as Slot[]) if (p.outfit[s] === uid) delete p.outfit[s];
  addLog(state, 'income', '🏷️', `Vendiste ${d.name} por ${fmtMoney(proceeds)}.`, proceeds);
  return OK(`Vendiste ${d.name} por ${fmtMoney(proceeds)}.`);
}

export function equip(state: GameState, uid: number): ActionResult {
  const o = state.possessions.items.find((x) => x.uid === uid);
  if (!o) return FAIL('No tenés ese artículo.');
  const d = itemDef(o);
  if (!d.slot) return FAIL('Eso no se puede usar puesto.');
  state.possessions.outfit[d.slot] = uid;
  return OK(`Te pusiste ${d.name}.`);
}

export function unequip(state: GameState, slot: Slot): ActionResult {
  if (state.possessions.outfit[slot] === undefined) return FAIL('No tenés nada puesto ahí.');
  if (slot === 'torso' || slot === 'piernas' || slot === 'calzado') return FAIL(`No podés salir sin ${SLOT_NAMES[slot].toLowerCase()}: cambiala por otra prenda.`);
  delete state.possessions.outfit[slot];
  return OK('Listo.');
}

export function setLook(state: GameState, patch: Partial<Look>): ActionResult {
  const l = state.possessions.look;
  if (patch.skin !== undefined && patch.skin >= 0 && patch.skin < SKIN_TONES.length) l.skin = patch.skin;
  if (patch.hairColor !== undefined && patch.hairColor >= 0 && patch.hairColor < HAIR_COLORS.length) l.hairColor = patch.hairColor;
  if (patch.hair !== undefined && HAIR_STYLES.includes(patch.hair)) l.hair = patch.hair;
  return OK();
}

/** Mejor prenda propia disponible para cada lugar (para "vestirse con lo mejor"). */
export function dressBest(state: GameState): ActionResult {
  const p = state.possessions;
  let changes = 0;
  for (const o of p.items) {
    const d = itemDef(o);
    if (!d?.slot) continue;
    const curUid = p.outfit[d.slot];
    const cur = curUid !== undefined ? p.items.find((x) => x.uid === curUid) : undefined;
    if (!cur || wornStyle(o) > wornStyle(cur)) {
      p.outfit[d.slot] = o.uid;
      changes++;
    }
  }
  return changes ? OK('Te vestiste con lo mejor que tenés.') : OK('Ya estás usando lo mejor que tenés.');
}

/**
 * Cierre de mes: depreciación de bienes durables (un asiento) y desgaste de la ropa.
 * Un bien nunca baja de un 5 % de su precio (valor de rezago).
 */
export function possessionsMonth(state: GameState): void {
  const p = state.possessions;
  if (!p) return;
  let dep = 0;
  for (const o of p.items) {
    const d = itemDef(o);
    if (!d) continue;
    if (d.durable) {
      const floor = roundCents(o.price * 0.05);
      const cut = Math.min(Math.max(0, o.carrying - floor), roundCents((o.carrying * (d.depreciation ?? 0)) / 12));
      if (cut > 0) {
        o.carrying -= cut;
        dep += cut;
      }
      if (d.category === 'vehiculos' || d.category === 'tecnologia') o.condition = Math.max(20, o.condition - 1);
    } else {
      const worn = Object.values(p.outfit).includes(o.uid);
      o.condition = Math.max(0, o.condition - (worn ? (STORE_BY_ID[d.storeId].tier >= 3 ? 2 : 4) : 1));
    }
  }
  if (dep > 0) post(state.ledger, { day: state.day, memo: 'Depreciación mensual de bienes personales', cf: 'internal', tag: 'shop:depreciation', lines: [{ account: 'goods_depreciation', debit: dep }, { account: 'personal_assets', credit: dep }] });
  const worn = Object.values(p.outfit).map((uid) => p.items.find((x) => x.uid === uid)).filter((x): x is OwnedItem => !!x && !itemDef(x).durable);
  const tired = worn.filter((x) => x.condition < 40 && x.condition >= 36);
  if (tired.length && !state.meta.projection) addLog(state, 'info', '🧵', `Tu ropa se ve gastada (${tired.map((x) => itemDef(x).name).join(', ')}): rinde la mitad de estilo. Podés reemplazarla en Tiendas.`);
}

export function goodsValue(state: GameState): Cents {
  return (state.possessions?.items ?? []).reduce((s, o) => s + o.carrying, 0);
}

