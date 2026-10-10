import { useState } from 'react';
import { livingIndex } from '../../../engine/finance/budget';
import { useGame, useUI, store } from '../../store';
import { navStore, useNav } from '../../nav';
import { STORES, STORE_BY_ID, ITEMS, CATEGORY_INFO, TIER_NAMES, TIER_IMAGE_REQ, SLOT_NAMES, ShopCategory, ItemDef, StoreDef } from '../../../content/shops';
import { priceQuote, canSee, buyItem, installmentOptions, treatmentText, PayMethod } from '../../../engine/lifestyle/shops';
import { imageScore, imageLabel, treatment, storeImage } from '../../../engine/lifestyle/effects';
import { cardAvailable } from '../../../engine/finance/creditCard';
import { cardTier } from '../../../engine/finance/cardRewards';
import { fmtMoney, fmtPct } from '../../../engine/format';
import { spendable } from '../../../engine/finance/payments';
import { Pill, Seg, Tabs, InfoButton, Act, ScreenIntro, Empty } from '../../components/common';
import { Avatar, avatarOf } from '../../components/Avatar';
import { Icon, IconName } from '../../icons';
import { STORE_CATEGORY_ICON } from '../../contentIcons';

const CAT_ICON: Record<ShopCategory, IconName> = { ropa: 'wardrobe', vehiculos: 'car', tecnologia: 'tech', hogar: 'homegoods', lujo: 'luxury' };
const TREAT: Record<string, { tone: 'gain' | 'info' | 'warn'; label: string }> = {
  preferente: { tone: 'gain', label: 'Cliente preferente' },
  normal: { tone: 'info', label: 'Atención normal' },
  frio: { tone: 'warn', label: 'Te atienden con desgano' },
};

/** Efectos de un bien. `costIndex`: precios × costo de vida (lo que usa el presupuesto). */
export function effectsLine(it: ItemDef, costIndex = 1): string {
  const e = it.effects ?? {};
  const parts: string[] = [];
  if (it.style) parts.push(`+${it.style} de imagen${it.slot ? ` (${SLOT_NAMES[it.slot].toLowerCase()})` : ''}`);
  if (e.study) parts.push(`+${Math.round(e.study * 100)} % de aprendizaje`);
  if (e.network) parts.push(`+${e.network} de red por mes`);
  if (e.health) parts.push(`salud +${e.health}/mes`);
  if (e.stress) parts.push(`estrés ${e.stress}/mes`);
  if (e.food) parts.push(`−${Math.round(e.food * 100)} % en comida`);
  if (e.running) parts.push(`reemplaza tu gasto de transporte y cuesta ~${fmtMoney(Math.round(e.running * 100 * costIndex), { decimals: false })}/mes (combustible, seguro, mantenimiento)`);
  if (it.durable) parts.push(`se deprecia ${fmtPct(it.depreciation ?? 0, 0)} al año · reventa ${fmtPct(it.resale ?? 0, 0)}`);
  else parts.push('se gasta con el uso');
  return parts.join(' · ');
}

function BuyPanel({ item, onDone }: { item: ItemDef; onDone: () => void }) {
  const s = useGame();
  useUI();
  const q = priceQuote(s, item);
  const store0 = STORE_BY_ID[item.storeId];
  const [method, setMethod] = useState<PayMethod>('debito');
  const [n, setN] = useState(3);
  const opts = installmentOptions(s, item, q.final);
  const quote = opts.find((o) => o.n === n) ?? opts[0];
  const checking = spendable(s);
  const avail = cardAvailable(s);
  const can = method === 'debito' ? checking >= q.final : method === 'efectivo' ? s.ledger.balances.cash_wallet >= q.final : avail >= q.final;
  return (
    <div className="buy-panel">
      <Seg<PayMethod> items={[{ id: 'debito', label: 'Débito' }, { id: 'tarjeta', label: 'Tarjeta' }, { id: 'cuotas', label: 'Cuotas' }, { id: 'efectivo', label: 'Efectivo' }]} value={method} onChange={setMethod} />
      {method === 'debito' && <p className="tiny muted">Sale de tu cuenta corriente{s.bank.overdraftSweep ? ' (y del ahorro si hace falta)' : ''}: tenés {fmtMoney(checking)}.</p>}
      {method === 'efectivo' && <p className="tiny muted">Tenés {fmtMoney(s.ledger.balances.cash_wallet)} en efectivo.</p>}
      {method === 'tarjeta' && <p className="tiny muted">Un pago en el próximo resumen. Disponible {fmtMoney(avail)}. {cardTier(s).cashback > 0 ? `Reintegro ${fmtPct(cardTier(s).cashback, 1)}: ${fmtMoney(Math.round(q.final * cardTier(s).cashback))}.` : 'Tu tarjeta Clásica no da reintegro.'}</p>}
      {method === 'cuotas' && (
        <>
          <Seg<number> items={opts.map((o) => ({ id: o.n, label: `${o.n} cuotas${o.free ? ' 0 %' : ''}` }))} value={n} onChange={setN} />
          <p className="tiny muted">
            {quote.n} cuotas de {fmtMoney(quote.payment)}{quote.free ? ' sin interés' : ` · interés total ${fmtMoney(quote.interest)}`}. Ocupa {fmtMoney(q.final)} de tu límite (disponible {fmtMoney(avail)}).
            {store0.freeInstallments > 0 && !quote.free && ` Esta tienda da hasta ${store0.freeInstallments} cuotas sin interés con tarjeta Oro o superior (la tuya: ${cardTier(s).name}, hasta ${cardTier(s).freeInstallments}).`}
          </p>
        </>
      )}
      <div className="btn-row">
        <button className="btn sm ghost" onClick={onDone}>Cancelar</button>
        <Act label={`Comprar · ${fmtMoney(q.final)}`} help="accion_comprar_tienda" className="btn sm primary" disabled={!can} onClick={() => { const r = store.run((x) => buyItem(x, item.id, method, n)); if (r.ok) onDone(); }} />
      </div>
      {!can && <span className="tiny loss">No alcanza con este medio de pago.</span>}
    </div>
  );
}

function ItemRow({ item }: { item: ItemDef }) {
  const s = useGame();
  const [open, setOpen] = useState(false);
  const q = priceQuote(s, item);
  const owned = s.possessions.items.filter((o) => o.itemId === item.id).length;
  return (
    <div className={`shop-item ${open ? 'open' : ''}`}>
      <div className="row">
        <span className="shop-swatch" style={{ background: item.colors ? `linear-gradient(135deg, ${item.colors[0]}, ${item.colors[1]})` : 'var(--surface-2)' }} aria-hidden>
          {!item.colors && <Icon name={CAT_ICON[item.category]} size={16} />}
        </span>
        <div className="grow">
          <div className="title small">{item.name} {item.exclusive && <Pill tone="accent">Exclusivo</Pill>} {owned > 0 && <Pill tone="neutral">Tenés {owned}</Pill>}</div>
          <div className="meta">{item.description}</div>
          <div className="meta">{effectsLine(item, livingIndex(s))}</div>
        </div>
        <div className="shop-price">
          {q.discount > 0 && <s className="tiny faint num">{fmtMoney(q.list, { decimals: false })}</s>}
          <strong className="num small">{fmtMoney(q.final, { decimals: q.final < 10000 })}</strong>
          {!open && <span className="act"><button className="btn sm" onClick={() => setOpen(true)}>Comprar</button><InfoButton term="accion_comprar_tienda" /></span>}
        </div>
      </div>
      {open && <BuyPanel item={item} onDone={() => setOpen(false)} />}
    </div>
  );
}

function StoreView({ st }: { st: StoreDef }) {
  const s = useGame();
  useUI();
  const t = treatment(s, st.tier);
  const items = ITEMS.filter((i) => i.storeId === st.id);
  const visible = items.filter((i) => canSee(s, i));
  const hidden = items.length - visible.length;
  return (
    <>
      <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => navStore.setSub('more', 'shops')}>← Tiendas</button>
      <div className="card store-hero">
        <div className="card-head">
          <span className="store-logo" aria-hidden><Icon name={STORE_CATEGORY_ICON[st.category]} size={22} /></span>
          <div style={{ flex: 1 }}>
            <h2>{st.name}</h2>
            <div className="tiny muted">{CATEGORY_INFO[st.category].name} · categoría {TIER_NAMES[st.tier].toLowerCase()} · {st.tagline}</div>
          </div>
          <InfoButton term="trato_tiendas" />
        </div>
        <div className={`treat ${t}`}><Pill tone={TREAT[t].tone}>{TREAT[t].label}</Pill> <span className="small">{treatmentText(s, st)}</span></div>
        {st.freeInstallments > 0 && <span className="tiny muted">Hasta {st.freeInstallments} cuotas sin interés con tarjeta Oro o superior (según el nivel de tu tarjeta).</span>}
      </div>
      <div className="card" style={{ paddingBlock: 4 }}>
        <div className="rows">{visible.map((i) => <ItemRow key={i.id} item={i} />)}</div>
        {hidden > 0 && <p className="small muted" style={{ padding: '10px 0' }}><Icon name="eye" size={14} /> {hidden} artículo{hidden > 1 ? 's' : ''} de la colección exclusiva no se muestra{hidden > 1 ? 'n' : ''}: necesitás imagen {TIER_IMAGE_REQ[st.tier]} (en la tienda te ven {storeImage(s)}).</p>}
      </div>
    </>
  );
}

export function ShopsScreen() {
  const s = useGame();
  useUI();
  const nav = useNav();
  const [, storeId] = (nav.sub.more ?? 'shops').split(':');
  const [cat, setCat] = useState<ShopCategory>('ropa');
  const st = storeId ? STORE_BY_ID[storeId] : undefined;
  if (st) return <StoreView st={st} />;
  const img = imageScore(s);
  return (
    <>
      <ScreenIntro icon="shop" title="Tiendas" text="Ropa, vehículos, tecnología, hogar y lujo. Todo tiene un efecto real: tu imagen, tus gastos, tu salud o tu estudio. Pagá con débito, tarjeta o en cuotas." term="imagen_personal" />
      <button className="card image-card" onClick={() => navStore.setSub('more', 'wardrobe')}>
        <Avatar data={avatarOf(s)} size={54} bust />
        <div style={{ flex: 1, textAlign: 'left' }}>
          <span className="eyebrow">Tu imagen</span>
          <div><strong className="num" style={{ fontSize: 22 }}>{img}</strong> <span className="small muted">/ 100 · {imageLabel(img)}</span></div>
          <span className="tiny muted">Tarjeta {cardTier(s).name}{cardTier(s).storeImage ? ` (+${cardTier(s).storeImage} en tiendas)` : ''} · tocá para vestirte</span>
        </div>
        <Icon name="chevron" />
      </button>
      <Tabs<ShopCategory> items={(Object.keys(CATEGORY_INFO) as ShopCategory[]).map((c) => ({ id: c, label: CATEGORY_INFO[c].name }))} value={cat} onChange={setCat} />
      <p className="small muted">{CATEGORY_INFO[cat].what}</p>
      {STORES.filter((x) => x.category === cat).map((x) => {
        const t = treatment(s, x.tier);
        return (
          <button key={x.id} className="card store-card" onClick={() => navStore.setSub('more', `shops:${x.id}`)}>
            <span className="store-logo" aria-hidden><Icon name={STORE_CATEGORY_ICON[x.category]} size={22} /></span>
            <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
              <strong>{x.name}</strong>
              <div className="tiny muted">{TIER_NAMES[x.tier]} · {x.tagline}</div>
              <div style={{ marginTop: 4 }}><Pill tone={TREAT[t].tone}>{TREAT[t].label}</Pill></div>
            </div>
            <Icon name="chevron" />
          </button>
        );
      })}
      {STORES.filter((x) => x.category === cat).length === 0 && <Empty icon="store">No hay tiendas en esta categoría.</Empty>}
    </>
  );
}
