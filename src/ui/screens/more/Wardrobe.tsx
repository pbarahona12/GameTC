import { ageOf } from '../../../engine/saga/life';
import { useState } from 'react';
import { useGame, useUI, store } from '../../store';
import { navStore } from '../../nav';
import { ITEM_BY_ID, SLOTS, SLOT_NAMES, SKIN_TONES, HAIR_COLORS, HAIR_STYLES, HAIR_STYLE_NAMES, TIER_NAMES, StoreTier, Slot } from '../../../content/shops';
import { imageBreakdown, imageLabel, treatment, JOB_IMAGE_EXPECTED, itemDef, possessionEffects, bestVehicle } from '../../../engine/lifestyle/effects';
import { equip, unequip, sellItem, setLook, dressBest, resaleValue, goodsValue } from '../../../engine/lifestyle/shops';
import { fmtMoney } from '../../../engine/format';
import { Bar, Pill, InfoButton, Act, ConfirmButton, ScreenIntro, CardHead, Empty } from '../../components/common';
import { Avatar, avatarOf } from '../../components/Avatar';
import { Icon } from '../../icons';
import { effectsLine } from './Shops';

export function WardrobeScreen() {
  const s = useGame();
  useUI();
  const [slot, setSlot] = useState<Slot | null>(null);
  const b = imageBreakdown(s);
  const p = s.possessions;
  const fx = possessionEffects(s);
  const durables = p.items.filter((o) => itemDef(o)?.durable);
  const loose = p.items.filter((o) => !itemDef(o)?.durable && !Object.values(p.outfit).includes(o.uid));
  const expected = [1, 2, 3, 4, 5].map((lvl) => ({ lvl, need: JOB_IMAGE_EXPECTED[lvl], delta: Math.max(-24, Math.min(24, b.total - JOB_IMAGE_EXPECTED[lvl])) * 0.25 }));
  const v = bestVehicle(s);
  return (
    <>
      <ScreenIntro icon="wardrobe" title="Tu personaje" text="Tu imagen resume cómo te presentás: la ropa que llevás puesta, reloj y accesorios, tu vehículo y tu reputación. Cambia cómo te tratan en entrevistas, negociaciones y tiendas." term="imagen_personal" />
      <div className="card wardrobe-hero">
        <div className="wh-avatar"><Avatar data={avatarOf(s)} size={128} title={`${s.player.name}, imagen ${b.total}`} /></div>
        <div className="wh-info">
          <span className="eyebrow">Imagen personal <InfoButton term="imagen_personal" /></span>
          <div className="wh-score"><strong className="num">{b.total}</strong><span className="small muted">/100 · {imageLabel(b.total)}</span></div>
          <button type="button" className="link tiny" onClick={() => navStore.open({ kind: 'life' })}>{s.player.name} · {Math.floor(ageOf(s))} años · salud {Math.round(s.player.attributes.health)}/100</button>
          {([['Ropa puesta', b.outfit, 50], ['Reloj y accesorio', b.accessories, 22], ['Vehículo', b.vehicle, 20], ['Reputación', b.reputation, 8]] as Array<[string, number, number]>).map(([l, val, max]) => (
            <div key={l} className="wh-bar"><span className="tiny muted">{l}</span><span className="tiny num">{val}/{max}</span><Bar value={val / max} /></div>
          ))}
          <Act label="Vestirme con lo mejor" help="accion_vestirse" className="btn sm" onClick={() => store.run(dressBest)} />
        </div>
      </div>
      <div className="card">
        <CardHead title="Qué te da tu imagen" term="trato_tiendas" />
        <div className="rows">
          {expected.map((e) => (
            <div className="row" key={e.lvl}>
              <div className="grow small">Entrevistas de nivel {e.lvl} <span className="tiny muted">(se espera {e.need})</span></div>
              <span className={`small num ${e.delta >= 0 ? 'gain' : 'loss'}`}>{e.delta >= 0 ? '+' : ''}{e.delta.toFixed(1)} pts</span>
            </div>
          ))}
          <div className="treat-row"><span className="small">Trato en tiendas</span><span className="tiny muted">{([1, 2, 3, 4] as StoreTier[]).map((t) => `${TIER_NAMES[t]}: ${treatment(s, t) === 'preferente' ? 'preferente' : treatment(s, t) === 'normal' ? 'normal' : 'fría'}`).join(' · ')}</span></div>
          {(fx.study > 0 || fx.network > 0 || fx.health !== 0 || fx.stress !== 0 || fx.food > 0) && (
            <div className="treat-row"><span className="small">Tus bienes cada mes</span><span className="tiny muted">{[fx.study > 0 && `+${Math.round(fx.study * 100)} % aprendizaje`, fx.network > 0 && `+${fx.network} red`, fx.health !== 0 && `salud ${fx.health > 0 ? '+' : ''}${fx.health}`, fx.stress !== 0 && `estrés ${fx.stress}`, fx.food > 0 && `−${Math.round(fx.food * 100)} % comida`].filter(Boolean).join(' · ')}</span></div>
          )}
        </div>
      </div>
      <div className="card">
        <CardHead title="Lo que llevás puesto" term="accion_vestirse" right={<button className="btn sm ghost" onClick={() => navStore.setSub('more', 'shops')}><Icon name="shop" size={15} /> Tiendas</button>} />
        <div className="rows">
          {SLOTS.map((sl) => {
            const uid = p.outfit[sl];
            const o = uid !== undefined ? p.items.find((x) => x.uid === uid) : undefined;
            const d = o ? itemDef(o) : undefined;
            const options = p.items.filter((x) => itemDef(x)?.slot === sl && x.uid !== uid);
            return (
              <div key={sl} className="slot-row">
                <button className="row clickable slot-btn" onClick={() => setSlot(slot === sl ? null : sl)}>
                  <span className="shop-swatch" style={{ background: d?.colors ? `linear-gradient(135deg, ${d.colors[0]}, ${d.colors[1]})` : 'var(--surface-2)' }} aria-hidden />
                  <div className="grow">
                    <div className="tiny muted">{SLOT_NAMES[sl]}</div>
                    <div className="title small">{d ? d.name : 'Nada'} {o && !d?.durable && o.condition < 40 && <Pill tone="warn">Gastada</Pill>}</div>
                    {o && !d?.durable && <div className="cond"><Bar value={o.condition / 100} tone={o.condition < 40 ? 'warn' : undefined} /></div>}
                  </div>
                  <span className="tiny muted">{options.length ? `${options.length} opción${options.length > 1 ? 'es' : ''}` : ''}</span>
                  <Icon name="chevron" size={16} />
                </button>
                {slot === sl && (
                  <div className="slot-options">
                    {options.length === 0 && <span className="tiny muted">No tenés otra prenda para este lugar. Comprá una en Tiendas.</span>}
                    {options.map((x) => (
                      <button key={x.uid} className="chip-btn" onClick={() => { store.run((st) => equip(st, x.uid)); setSlot(null); }}>
                        {itemDef(x).name} · +{itemDef(x).durable || x.condition >= 40 ? itemDef(x).style : itemDef(x).style / 2}{!itemDef(x).durable && ` · ${x.condition} %`}
                      </button>
                    ))}
                    {o && (sl === 'abrigo' || sl === 'reloj' || sl === 'accesorio') && <button className="chip-btn" onClick={() => { store.run((st) => unequip(st, sl)); setSlot(null); }}>Quitármelo</button>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="card">
        <CardHead title={`Tus bienes · ${fmtMoney(goodsValue(s), { decimals: false })}`} term="bienes_personales" />
        {durables.length === 0 && <Empty icon="package">Todavía no tenés vehículos, tecnología, muebles ni joyas.</Empty>}
        <div className="rows">
          {durables.map((o) => {
            const d = itemDef(o);
            return (
              <div className="row" key={o.uid} style={{ flexWrap: 'wrap' }}>
                <div className="grow">
                  <div className="title small">{d.name} {v?.uid === o.uid && <Pill tone="accent">En uso</Pill>}</div>
                  <div className="meta">Valor {fmtMoney(o.carrying)} (pagaste {fmtMoney(o.price)}) · {effectsLine(d, s.macro.priceIndex)}</div>
                </div>
                <ConfirmButton label="Vender" className="btn sm ghost" help="accion_vender_bien" confirmLabel={`Vender por ${fmtMoney(resaleValue(o))}`} detail={<>Te pagan {fmtMoney(resaleValue(o))} ({Math.round((d.resale ?? 0.5) * 100)} % de su valor actual). La diferencia con el valor contable se registra como pérdida.</>} onConfirm={() => store.run((st) => sellItem(st, o.uid))} />
              </div>
            );
          })}
        </div>
      </div>
      {loose.length > 0 && (
        <div className="card">
          <CardHead title="Ropa guardada" term="accion_vender_bien" />
          <div className="rows">
            {loose.map((o) => (
              <div className="row" key={o.uid}>
                <div className="grow"><div className="title small">{ITEM_BY_ID[o.itemId].name}</div><div className="meta">{SLOT_NAMES[ITEM_BY_ID[o.itemId].slot!]} · estado {o.condition} %</div></div>
                <Act label="Ponérmela" help="accion_vestirse" className="btn sm" onClick={() => store.run((st) => equip(st, o.uid))} />
                <ConfirmButton label="Donar" className="btn sm ghost" help="accion_vender_bien" confirmLabel="Donar" detail="La prenda deja de estar en tu guardarropa." onConfirm={() => store.run((st) => sellItem(st, o.uid))} />
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="card">
        <CardHead title="Apariencia" term="apariencia" />
        <span className="small muted">Tono de piel</span>
        <div className="swatches">{SKIN_TONES.map((c, i) => <button key={c} className={`swatch ${p.look.skin === i ? 'on' : ''}`} style={{ background: c }} aria-label={`Tono ${i + 1}`} onClick={() => store.run((st) => setLook(st, { skin: i }), { toast: false })} />)}</div>
        <span className="small muted">Peinado</span>
        <div className="chips">{HAIR_STYLES.map((h) => <button key={h} className={p.look.hair === h ? 'on' : ''} onClick={() => store.run((st) => setLook(st, { hair: h }), { toast: false })}>{HAIR_STYLE_NAMES[h]}</button>)}</div>
        <span className="small muted">Color de pelo</span>
        <div className="swatches">{HAIR_COLORS.map((c, i) => <button key={c} className={`swatch ${p.look.hairColor === i ? 'on' : ''}`} style={{ background: c }} aria-label={`Color ${i + 1}`} onClick={() => store.run((st) => setLook(st, { hairColor: i }), { toast: false })} />)}</div>
        <span className="tiny muted">La apariencia es solo visual: la imagen depende de la ropa, no de tu físico.</span>
      </div>
    </>
  );
}
