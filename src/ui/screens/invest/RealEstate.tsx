import { useState } from 'react';
import { useGame, useUI, useDerived, store } from '../../store';
import { navStore } from '../../nav';
import { InfoButton, CardHead, Pill, NumInput, Act, Learn, LineChart, Money, Seg, AmountInput, ConfirmButton, Empty, Stat, Bar, GuardedAct } from '../../components/common';
import {
  buyProperty, inspectListing, allMortgageQuotes, sellProperty, setRent, setManagement, renovate, developLand, setUse, prepayMortgage,
  appraise, propertyReport, marketRent, listingRent, listingGrossYield, closingCosts, ownerLabel, ownerCash, monthlyEconomics, zoneState, marketVacancy, SALE_COMMISSION, quickSalePrice, buyerWeeklyChance, tenantWeeklyChance, rentNoFasterBelow, knownRepairCost,
} from '../../../engine/realestate/realestate';
import { ZONES, ZONE_BY_ID, PROPERTY_TYPE_NAMES, BUILD_COST } from '../../../content/realestate';
import { jurisdictionById } from '../../../content/jurisdictions';
import { fmtMoney, fmtPct, fmtNumber } from '../../../engine/format';
import { formatDate } from '../../../engine/time/calendar';
import type { GameState } from '../../../engine/state';
import type { Property, PropertyOwner, PropertyType, PropertyListing } from '../../../engine/realestate/types';
import { Icon } from '../../icons';
import { PROPERTY_ICON } from '../../contentIcons';

type Sub = 'mine' | 'market' | 'zones';

function owners(s: GameState): Array<{ id: string; label: string; owner: PropertyOwner }> {
  return [
    { id: 'p', label: 'A título personal', owner: { kind: 'personal' } },
    ...s.companies.filter((c) => c.status === 'active').map((c) => ({ id: `c${c.id}`, label: c.name, owner: { kind: 'company', id: c.id } as PropertyOwner })),
  ];
}

function statusOf(s: GameState, p: Property): { label: string; tone: 'gain' | 'warn' | 'loss' | 'info' | 'neutral' } {
  if (p.development) return { label: `En obra hasta ${formatDate(p.development.until)}`, tone: 'info' };
  if (p.renovation) return { label: `Renovando hasta ${formatDate(p.renovation.until)}`, tone: 'info' };
  if (p.usedBy === 'jugador') return { label: 'Tu vivienda', tone: 'neutral' };
  if (typeof p.usedBy === 'number') return { label: `Local de ${s.companies.find((c) => c.id === p.usedBy)?.name ?? 'empresa'}`, tone: 'neutral' };
  if (p.evictionUntil) return { label: 'Desalojo en curso', tone: 'loss' };
  if (p.lease) return p.lease.unpaidMonths > 0 ? { label: `Inquilino moroso (${p.lease.unpaidMonths} m)`, tone: 'loss' } : { label: 'Alquilado', tone: 'gain' };
  if (p.type === 'terreno') return { label: 'Terreno', tone: 'neutral' };
  return { label: p.listedForRent ? 'Vacío · en alquiler' : 'Vacío', tone: 'warn' };
}

// ------------------------------------------------------------ Mis inmuebles

function PropertyDetail({ p }: { p: Property }) {
  const s = useGame();
  useUI();
  const r = propertyReport(s, p);
  const econ = monthlyEconomics(s, p);
  const m = s.realEstate.mortgages.find((x) => x.id === p.mortgageId && x.status === 'activa');
  const mr = marketRent(s, p);
  const [rent, setRentV] = useState(p.askingRent || mr);
  const [salePrice, setSalePrice] = useState(p.forSale?.price ?? p.appraisal);
  const [prepay, setPrepay] = useState(0);
  const [devTo, setDevTo] = useState<Exclude<PropertyType, 'terreno'>>('vivienda');
  const st = statusOf(s, p);
  const j = jurisdictionById(p.jurisdiction);
  const coId = p.owner.kind === 'company' ? p.owner.id : null;
  const devM2 = Math.round(p.m2 * 0.8);
  const devCost = Math.round(devM2 * BUILD_COST[devTo] * s.macro.priceIndex * 100);
  const quick = quickSalePrice(p);
  const saleChance = salePrice > 0 ? buyerWeeklyChance(s, salePrice, p.appraisal) : 0;
  const rentFloor = rentNoFasterBelow(s, p);
  const rentChance = rent > 0 ? tenantWeeklyChance(s, p, rent) : 0;
  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <div className="card-head">
        <div style={{ flex: 1 }}>
          <h2><Icon name={PROPERTY_ICON[p.type]} size={18} /> {p.name}</h2>
          <div className="tiny muted">{PROPERTY_TYPE_NAMES[p.type]} · {fmtNumber(p.m2)} m² · {ZONE_BY_ID[p.zoneId]?.name} ({j.name}) · categoría {p.grade}/5</div>
          <div className="tiny muted">Dueño: {ownerLabel(s, p.owner)}</div>
        </div>
        <button className="btn sm ghost" onClick={() => navStore.setSub('invest', 'realestate')}>Cerrar</button>
      </div>
      <Pill tone={st.tone}>{st.label}</Pill>
      <div className="grid2">
        <Stat label="Tasación" term="tasacion" value={<Money c={p.appraisal} />} sub={<>Compra {fmtMoney(p.purchasePrice, { decimals: false })} · <Money c={r.gainSincePurchase} colored sign /></>} />
        <Stat label="Patrimonio neto" term="apalancamiento" value={<Money c={r.equity} />} sub={r.debt ? `Deuda ${fmtMoney(r.debt, { decimals: false })} · LTV ${fmtPct(r.debt / Math.max(1, p.appraisal), 0)}` : 'Sin hipoteca'} />
        <Stat label="Flujo mensual" term="flujo_caja" value={<Money c={r.monthlyCashFlow} colored sign />} sub="Alquiler − gastos − impuesto − cuota" />
        <Stat label="Rentabilidad neta" term="cap_rate" value={fmtPct(r.netYield, 1)} sub={`Bruta ${fmtPct(r.grossYield, 1)} · cash-on-cash ${r.cashOnCash === null ? '—' : fmtPct(r.cashOnCash, 1)}`} />
      </div>
      <div className="kv">
        <dt>Estado de conservación <InfoButton term="depreciacion" /></dt><dd><Bar value={p.condition / 100} tone={p.condition < 50 ? 'loss' : p.condition < 70 ? 'warn' : 'gain'} /> {Math.round(p.condition)}/100</dd>
        <dt>Ocupación (12 m) <InfoButton term="vacancia" /></dt><dd>{fmtPct(r.occupancy, 0)}</dd>
        <dt>Alquiler de mercado</dt><dd>{fmtMoney(mr)}/mes</dd>
        {p.lease && <><dt>Contrato</dt><dd>{p.lease.tenant} · {fmtMoney(p.lease.rent)}/mes hasta {formatDate(p.lease.endDay)}</dd></>}
        <dt>Mantenimiento estimado <InfoButton term="gastos_inmueble" /></dt><dd>{fmtMoney(econ.maintenance)}/mes</dd>
        {econ.agency > 0 && <><dt>Honorario de la inmobiliaria</dt><dd>{fmtMoney(econ.agency)}/mes</dd></>}
        <dt>Impuesto inmobiliario <InfoButton term="impuesto_inmobiliario" /></dt><dd>{fmtPct(j.propertyTaxRate, 2)} anual · próximo {fmtMoney(p.nextTaxAmount)} el {formatDate(p.nextTaxDay)}</dd>
        <dt>Rendimiento total desde la compra <InfoButton term="roi" /></dt><dd>{fmtPct(r.totalReturn, 1)}</dd>
        <dt>Acumulado</dt><dd>Alquileres {fmtMoney(p.totals.rent, { decimals: false })} · gastos {fmtMoney(p.totals.expenses + p.totals.tax, { decimals: false })} · intereses {fmtMoney(p.totals.interest, { decimals: false })}</dd>
        {p.owner.kind === 'company' && <><dt>Valor en libros de la empresa <InfoButton term="depreciacion" /></dt><dd>{fmtMoney(p.carrying)} (depreciación acumulada {fmtMoney(p.accumDepreciation)})</dd></>}
      </div>
      {p.hiddenDefect?.discovered && <p className="small loss">Vicio oculto detectado: reparación estimada {fmtMoney(p.hiddenDefect.cost)}.</p>}
      {p.monthly.length > 1 && (
        <>
          <strong className="small">Resultado neto mensual (últimos {Math.min(24, p.monthly.length)} meses)</strong>
          <LineChart series={[{ name: 'Neto', values: p.monthly.slice(-24).map((x) => x.net), color: 'var(--accent)' }, { name: 'Alquiler', values: p.monthly.slice(-24).map((x) => x.rent), color: 'var(--gain)' }]} height={110} />
        </>
      )}

      {m && (
        <div className="card flat" style={{ padding: 12, gap: 6 }}>
          <div className="card-head"><strong style={{ flex: 1 }}>Hipoteca</strong><InfoButton term="hipoteca" /></div>
          <div className="kv">
            <dt>Saldo</dt><dd>{fmtMoney(m.balance)}</dd>
            <dt>Tasa</dt><dd>{fmtPct(m.apr, 2)} {m.rateType === 'variable' ? <>variable <InfoButton term="tasa_variable" /></> : 'fija'}</dd>
            <dt>Cuota mensual</dt><dd>{fmtMoney(m.payment)} · próxima {formatDate(m.nextDueDay)}</dd>
            <dt>Pagos</dt><dd>{m.paymentsMade} de {m.termMonths}{m.missed ? ` · ${m.missed} impaga(s)` : ''}</dd>
            <dt>Recurso <InfoButton term="recurso_hipotecario" /></dt><dd>{m.recourse ? 'Con recurso: si la ejecutan y no alcanza, seguís debiendo' : 'Sin recurso: responde solo el inmueble'}</dd>
          </div>
          {m.missed > 0 && <p className="small loss">Con 3 cuotas impagas el banco ejecuta la hipoteca y remata el inmueble al 75 % de la tasación. <InfoButton term="ejecucion_hipotecaria" /></p>}
          <div className="field">
            <label htmlFor="prepay">Amortización anticipada</label>
            <AmountInput id="prepay" value={prepay} onChange={setPrepay} max={Math.min(m.balance, ownerCash(s, p.owner))} />
          </div>
          <Act label="Amortizar" help="accion_amortizar_hipoteca" className="btn sm" disabled={!(prepay > 0)} onClick={() => store.run((x) => prepayMortgage(x, m.id, prepay))} />
        </div>
      )}

      {p.type !== 'terreno' && !p.development && (
        <div className="card flat" style={{ padding: 12, gap: 8 }}>
          <div className="card-head"><strong style={{ flex: 1 }}>Alquiler y administración</strong><InfoButton term="alquiler" /></div>
          {p.usedBy === null && p.lease && <p className="small">Alquilado a {p.lease.tenant} por {fmtMoney(p.lease.rent)}/mes hasta el {formatDate(p.lease.endDay)}. Al vencer, el inquilino puede renovar (a valor de mercado) o irse; si se va, vas a poder fijar el alquiler pedido.</p>}
          {p.usedBy === null && !p.lease && (
            <>
              <div className="field">
                <label htmlFor="rent">Alquiler pedido (mercado {fmtMoney(mr)})</label>
                <AmountInput id="rent" value={rent} onChange={setRentV} />
                {rent > 0 && <span className="tiny muted">Probabilidad de conseguir inquilino cada semana: ≈{fmtPct(rentChance, 0)}.</span>}
              </div>
              <div className="btn-row">
                <GuardedAct
                  label={p.listedForRent ? 'Actualizar alquiler' : 'Publicar en alquiler'}
                  help="accion_alquilar"
                  className="btn sm"
                  disabled={!(rent > 0)}
                  warning={rent > 0 && rent < rentFloor ? <>Pedís {fmtMoney(rent)}/mes ({fmtPct(rent / Math.max(1, mr) - 1, 0)} frente al mercado). Por debajo de {fmtMoney(rentFloor)} el inquilino no llega más rápido: solo cobrás menos durante todo el contrato.</> : undefined}
                  confirmLabel="Publicar igual"
                  onConfirm={() => store.run((x) => setRent(x, p.id, rent, true))}
                />
                {p.listedForRent && <button className="btn sm ghost" onClick={() => store.run((x) => setRent(x, p.id, p.askingRent || mr, false))}>Dejar de ofrecer</button>}
              </div>
            </>
          )}
          <div className="btn-row">
            <Seg items={[{ id: 'propia', label: 'Administración propia' }, { id: 'agencia', label: 'Inmobiliaria (8 %)' }]} value={p.management} onChange={(v) => store.run((x) => setManagement(x, p.id, v))} />
            <InfoButton term="accion_administracion" />
          </div>
          <div className="btn-row">
            {p.owner.kind === 'personal' && p.type === 'vivienda' && p.usedBy !== 'jugador' && (
              <Act label="Vivir aquí" help="accion_uso_propio" className="btn sm" disabled={!!p.lease} onClick={() => store.run((x) => setUse(x, p.id, 'jugador'))} />
            )}
            {coId !== null && p.usedBy !== coId && <Act label="Usar como local de la empresa" help="accion_uso_propio" className="btn sm" disabled={!!p.lease} onClick={() => store.run((x) => setUse(x, p.id, coId))} />}
            {p.usedBy !== null && <Act label="Dejar de usarlo (alquilar)" help="accion_uso_propio" className="btn sm" onClick={() => store.run((x) => setUse(x, p.id, null))} />}
          </div>
        </div>
      )}

      {!p.development && !p.renovation && (
        <div className="card flat" style={{ padding: 12, gap: 8 }}>
          <div className="card-head"><strong style={{ flex: 1 }}>{p.type === 'terreno' ? 'Construir' : 'Obras'}</strong><InfoButton term={p.type === 'terreno' ? 'accion_desarrollar' : 'accion_renovar'} /></div>
          {p.type === 'terreno' ? (
            <>
              <Seg items={[{ id: 'vivienda', label: 'Viviendas' }, { id: 'local', label: 'Locales' }, { id: 'oficina', label: 'Oficinas' }, { id: 'cochera', label: 'Cocheras' }]} value={devTo} onChange={setDevTo} />
              <p className="small">Construir {fmtNumber(devM2)} m² cuesta ≈ {fmtMoney(devCost)} y tarda 9–15 meses. Tasación estimada al terminar (a los precios de hoy) ≈ {fmtMoney(appraise(s, { ...p, type: devTo, m2: devM2, condition: 100 }))}.</p>
              <ConfirmButton label="Iniciar construcción" help="accion_desarrollar" className="btn sm" detail={`Se pagan ${fmtMoney(devCost)} ahora desde ${ownerLabel(s, p.owner)}.`} onConfirm={() => store.run((x) => developLand(x, p.id, devTo))} />
            </>
          ) : (
            <div className="btn-row">
              <ConfirmButton label={`Renovación ligera (${fmtMoney(Math.round(p.appraisal * 0.04), { decimals: false })})`} help="accion_renovar" className="btn sm" detail="+15 de conservación en 1 mes. Se puede hacer con inquilino." onConfirm={() => store.run((x) => renovate(x, p.id, 'ligera'))} />
              <ConfirmButton label={`Integral (${fmtMoney(Math.round(p.appraisal * 0.12), { decimals: false })})`} help="accion_renovar" className="btn sm" detail="Conservación al 100 % y sube una categoría. 3 meses; requiere el inmueble vacío." onConfirm={() => store.run((x) => renovate(x, p.id, 'integral'))} />
            </div>
          )}
        </div>
      )}

      {!p.development && (
        <div className="card flat" style={{ padding: 12, gap: 8 }}>
          <div className="card-head"><strong style={{ flex: 1 }}>Vender</strong><InfoButton term="accion_vender_inmueble" /></div>
          {p.forSale ? (
            <>
              <p className="small">Publicado a {fmtMoney(p.forSale.price)} desde el {formatDate(p.forSale.since)} ({fmtPct(p.forSale.price / p.appraisal - 1, 0)} frente a la tasación).</p>
              <button className="btn sm" onClick={() => store.run((x) => sellProperty(x, p.id, 'retirar'))}>Retirar de la venta</button>
            </>
          ) : (
            <>
              <div className="field">
                <label htmlFor="sale">Precio de publicación</label>
                <AmountInput id="sale" value={salePrice} onChange={setSalePrice} />
                <span className="tiny muted">Comisión {fmtPct(SALE_COMMISSION, 0)}{m ? ` · se cancela la hipoteca (${fmtMoney(m.balance)})` : ''} · neto ≈ {fmtMoney(Math.round(salePrice * (1 - SALE_COMMISSION)) - (m?.balance ?? 0))}{salePrice > 0 ? ` · probabilidad de comprador por semana ≈${fmtPct(saleChance, 0)}` : ''}</span>
              </div>
              <div className="btn-row">
                <GuardedAct
                  label="Publicar en venta"
                  help="accion_vender_inmueble"
                  className="btn sm"
                  disabled={!(salePrice > 0)}
                  warning={salePrice > 0 && salePrice < quick ? <>Publicás a {fmtMoney(salePrice)} ({fmtPct(salePrice / p.appraisal - 1, 0)} frente a la tasación de {fmtMoney(p.appraisal)}): menos que la venta rápida, que te paga {fmtMoney(quick)} hoy mismo.</> : undefined}
                  confirmLabel="Publicar igual"
                  onConfirm={() => store.run((x) => sellProperty(x, p.id, 'publicar', salePrice))}
                />
                <ConfirmButton label={`Venta rápida (${fmtMoney(quick, { decimals: false })})`} className="btn sm ghost" detail={`Se vende hoy al 92 % de la tasación. Neto ≈ ${fmtMoney(Math.round(quick * (1 - SALE_COMMISSION)) - (m?.balance ?? 0))}.`} onConfirm={() => store.run((x) => sellProperty(x, p.id, 'rapida'))} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Valor, deuda y flujo mensual de tus inmuebles y los de tus empresas. */
function myPropertiesTotals(s: GameState) {
  let value = 0;
  let debt = 0;
  let flow = 0;
  for (const p of s.realEstate.properties) {
    if (p.owner.kind === 'mogul') continue;
    const r = propertyReport(s, p);
    value += r.value;
    debt += r.debt;
    flow += r.monthlyCashFlow;
  }
  return { value, debt, flow };
}

function Mine({ selected }: { selected: number | null }) {
  const s = useGame();
  useUI();
  const props = s.realEstate.properties.filter((p) => p.owner.kind !== 'mogul');
  const sel = selected !== null ? props.find((p) => p.id === selected) : null;
  const totals = useDerived(myPropertiesTotals);
  return (
    <>
      {sel && <PropertyDetail key={sel.id} p={sel} />}
      <div className="grid2">
        <Stat label="Valor de tus inmuebles" term="tasacion" value={<Money c={totals.value} />} sub={`${props.length} inmueble(s)`} />
        <Stat label="Hipotecas" term="hipoteca" value={<Money c={totals.debt} />} sub={`Patrimonio ${fmtMoney(totals.value - totals.debt, { decimals: false })}`} />
        <Stat label="Flujo mensual estimado" term="flujo_caja" value={<Money c={totals.flow} colored sign />} />
        <Stat label="Alquileres y repartos (año)" term="alquiler" value={<Money c={s.tax.ytd.rentalIncome ?? 0} />} sub="Alquileres personales y repartos de Mogul (para impuestos)" />
      </div>
      {props.length === 0 && <Empty icon="realestate">Todavía no tenés inmuebles. Mirá el mercado: podés comprar a tu nombre o a nombre de una empresa, con o sin hipoteca.</Empty>}
      {props.length > 0 && (
        <div className="card" style={{ paddingBlock: 4 }}>
          <div className="rows">
            {props.map((p) => {
              const st = statusOf(s, p);
              const r = propertyReport(s, p);
              return (
                <button key={p.id} className="row clickable" style={{ border: 0, borderBottom: '1px solid var(--line)', background: 'none', textAlign: 'left', width: '100%' }} onClick={() => { navStore.setSub('invest', `realestate:prop:${p.id}`); window.scrollTo({ top: 0 }); }}>
                  <div className="grow">
                    <div className="title small"><Icon name={PROPERTY_ICON[p.type]} size={15} /> {p.name}</div>
                    <div className="meta">{ownerLabel(s, p.owner)} · <Pill tone={st.tone}>{st.label}</Pill></div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className="amt small">{fmtMoney(p.appraisal, { decimals: false })}</div>
                    <div className="tiny"><Money c={r.monthlyCashFlow} colored sign />/mes</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------ Mercado

function ListingDetail({ l }: { l: PropertyListing }) {
  const s = useGame();
  useUI();
  const p = l.property;
  const os = owners(s);
  const [ownerId, setOwnerId] = useState('p');
  const owner = os.find((o) => o.id === ownerId)?.owner ?? { kind: 'personal' as const };
  const [offer, setOffer] = useState(l.askPrice);
  const [finance, setFinance] = useState(false);
  const [loan, setLoan] = useState(Math.round(l.askPrice * 0.6));
  const [years, setYears] = useState(25);
  const [rateType, setRateType] = useState<'fija' | 'variable'>('fija');
  const [bankId, setBankId] = useState<string | null>(null);
  const price = Math.min(offer, l.askPrice);
  const cc = closingCosts(s, price, p.jurisdiction);
  const mr = marketRent(s, p);
  const expRent = listingRent(s, l);
  const quotes = finance ? allMortgageQuotes(s, owner, price, loan, years, rateType, p.type, expRent) : [];
  const chosen = quotes.find((q) => q.bank.id === bankId && q.approved) ?? quotes.find((q) => q.approved) ?? null;
  const fee = finance && chosen ? chosen.fee : 0;
  const repair = knownRepairCost(p);
  const cashNeeded = price - (finance && chosen ? loan : 0) + cc.total + fee + repair;
  const avail = ownerCash(s, owner);
  const gross = p.appraisal > 0 ? (expRent * 12) / l.askPrice : 0;
  const j = jurisdictionById(p.jurisdiction);
  const econ = monthlyEconomics(s, { ...p, lease: p.lease ?? { tenant: '', rent: expRent, startDay: 0, endDay: 0, reliability: 1, unpaidMonths: 0 } });
  const noi = (econ.rent - econ.maintenance - econ.tax) * 12;
  return (
    <div className="card" style={{ borderColor: 'var(--accent)' }}>
      <div className="card-head">
        <div style={{ flex: 1 }}>
          <h2><Icon name={PROPERTY_ICON[p.type]} size={18} /> {p.name}</h2>
          <div className="tiny muted">{PROPERTY_TYPE_NAMES[p.type]} · {fmtNumber(p.m2)} m² · {ZONE_BY_ID[p.zoneId]?.name} ({j.name}) · categoría {p.grade}/5 · conservación {Math.round(p.condition)}/100</div>
        </div>
        <button className="btn sm ghost" onClick={() => navStore.setSub('invest', 'realestate:market')}>Cerrar</button>
      </div>
      <p className="small">{l.note}</p>
      <div className="kv">
        <dt>Precio pedido</dt><dd>{fmtMoney(l.askPrice)} ({fmtPct(l.askPrice / p.appraisal - 1, 0)} frente a la tasación)</dd>
        <dt>Tasación <InfoButton term="tasacion" /></dt><dd>{fmtMoney(p.appraisal)}</dd>
        <dt>{p.lease ? 'Inquilino actual' : 'Alquiler de mercado'}</dt><dd>{p.lease ? `${p.lease.tenant} · ${fmtMoney(p.lease.rent)}/mes hasta ${formatDate(p.lease.endDay)}` : p.type === 'terreno' ? 'No genera renta' : `${fmtMoney(mr)}/mes`}</dd>
        <dt>Rentabilidad bruta <InfoButton term="cap_rate" /></dt><dd>{fmtPct(gross, 1)} · neta ≈ {fmtPct(noi / l.askPrice, 1)}</dd>
        <dt>Vacancia de la zona <InfoButton term="vacancia" /></dt><dd>{fmtPct(marketVacancy(s, p.zoneId, p.type), 0)}</dd>
        <dt>Gastos de escritura <InfoButton term="impuesto_transferencia" /></dt><dd>{fmtMoney(cc.total)} (transferencia {fmtPct(j.transferTaxRate, 1)} + escribano 1 %)</dd>
        <dt>Impuesto inmobiliario anual</dt><dd>{fmtPct(j.propertyTaxRate, 2)} ≈ {fmtMoney(Math.round(p.appraisal * j.propertyTaxRate), { decimals: false })}</dd>
        <dt>Vicios ocultos <InfoButton term="vicio_oculto" /></dt><dd>{p.hiddenDefect?.discovered ? <span className="loss">Detectado: reparación {fmtMoney(p.hiddenDefect.cost)}, a cargo del comprador al escriturar</span> : 'Desconocido (inspeccioná antes de comprar)'}</dd>
        <dt>Publicación vence</dt><dd>{formatDate(l.expiresDay)}</dd>
      </div>
      <Act label="Inspección técnica" help="accion_inspeccion" className="btn sm" disabled={!!p.hiddenDefect?.discovered} onClick={() => store.run((x) => inspectListing(x, l.id))} />

      <div className="field">
        <label>Comprador</label>
        <div className="chips">{os.map((o) => <button key={o.id} aria-pressed={ownerId === o.id} onClick={() => setOwnerId(o.id)} style={ownerId === o.id ? { background: 'var(--text)', color: 'var(--bg)' } : undefined}>{o.label}</button>)}</div>
        <span className="tiny muted">Disponible: {fmtMoney(avail)}. {owner.kind === 'company' ? 'La empresa lo registra al costo y lo deprecia; los alquileres son ingresos de la empresa.' : 'A título personal: se valúa a tasación y los alquileres tributan en tu declaración.'}</span>
      </div>
      <div className="field">
        <label htmlFor="offer">Tu oferta {l.negotiated ? '(el vendedor ya no negocia)' : ''}</label>
        <AmountInput id="offer" value={offer} onChange={setOffer} />
        <span className="tiny muted">Ofrecer por debajo del precio pedido tiene una probabilidad de ser aceptado que baja cuanto más bajo ofrecés; mejora con tus habilidades de negociación e inmobiliaria. Si te rechazan, solo queda el precio publicado.</span>
      </div>
      <label className="small" style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={finance} onChange={(e) => setFinance(e.target.checked)} /> Financiar con hipoteca <InfoButton term="hipoteca" />
      </label>
      {finance && (
        <div className="card flat" style={{ padding: 12, gap: 8 }}>
          <div className="field">
            <label htmlFor="loan">Monto del préstamo ({fmtPct(loan / Math.max(1, price), 0)} del precio) <InfoButton term="ltv" /></label>
            <AmountInput id="loan" value={loan} onChange={setLoan} />
          </div>
          <div className="field">
            <label htmlFor="yrs">Plazo (años)</label>
            <NumInput id="yrs" live value={years} onChange={setYears} min={5} max={30} />
          </div>
          <Seg items={[{ id: 'fija', label: 'Tasa fija' }, { id: 'variable', label: 'Tasa variable' }]} value={rateType} onChange={setRateType} />
          <div className="rows">
            {quotes.map((q) => (
              <button key={q.bank.id} className="row clickable" disabled={!q.approved} style={{ border: '1px solid ' + (chosen?.bank.id === q.bank.id ? 'var(--accent)' : 'var(--line)'), borderRadius: 10, background: 'none', textAlign: 'left', width: '100%', opacity: q.approved ? 1 : 0.75 }} onClick={() => setBankId(q.bank.id)}>
                <div className="grow">
                  <div className="title small">{q.bank.name}</div>
                  <div className="meta">{q.approved ? `${fmtPct(q.apr, 2)} · cuota ${fmtMoney(q.payment)} · comisión ${fmtMoney(q.fee)} · intereses totales ${fmtMoney(q.totalInterest, { decimals: false })}` : q.reasons.join(' ')}</div>
                  {q.dti !== null && <div className="tiny faint">Cuotas / ingresos: {fmtPct(q.dti, 0)} <InfoButton term="ratio_deuda_ingreso" /></div>}
                </div>
                <Pill tone={q.approved ? 'gain' : 'loss'}>{q.approved ? 'Aprobable' : 'Rechazo'}</Pill>
              </button>
            ))}
          </div>
          <p className="tiny muted">Con 3 cuotas impagas el banco ejecuta la garantía. En {j.name} las hipotecas son {j.mortgageRecourse ? 'con recurso (si el remate no cubre la deuda, seguís debiendo)' : 'sin recurso (responde solo el inmueble)'}.</p>
        </div>
      )}
      <p className="small">Efectivo necesario: <strong>{fmtMoney(cashNeeded)}</strong> {cashNeeded > avail && <span className="loss">(te faltan {fmtMoney(cashNeeded - avail)})</span>}</p>
      <ConfirmButton
        label={offer < l.askPrice ? `Ofertar ${fmtMoney(offer, { decimals: false })}` : 'Comprar al precio pedido'}
        help="accion_comprar_inmueble"
        className="btn primary"
        disabled={!(offer > 0) || cashNeeded > avail || (finance && (!chosen || !(loan > 0)))}
        detail={<>Precio {fmtMoney(price)} + gastos {fmtMoney(cc.total + fee)}{repair ? ` + reparación del vicio oculto ${fmtMoney(repair)}` : ''}{finance && chosen ? ` · hipoteca ${fmtMoney(loan)} con ${chosen.bank.name}` : ''}. Comprador: {os.find((o) => o.id === ownerId)?.label}.</>}
        onConfirm={() => store.run((x) => {
          const r = buyProperty(x, l.id, { owner, offer: offer < l.askPrice ? offer : undefined, financing: finance && chosen ? { bankId: chosen.bank.id, amount: loan, years, rateType } : null });
          if (r.ok) navStore.setSub('invest', `realestate:prop:${p.id}`);
          return r;
        })}
      />
    </div>
  );
}

function Market({ selected }: { selected: number | null }) {
  const s = useGame();
  useUI();
  const [type, setType] = useState<'todos' | PropertyType>('todos');
  const [zone, setZone] = useState('todas');
  const [order, setOrder] = useState<'precio' | 'rendimiento' | 'tasacion'>('precio');
  const rank: Record<typeof order, (l: PropertyListing) => number> = {
    precio: (l) => l.askPrice,
    rendimiento: (l) => -listingGrossYield(s, l),
    tasacion: (l) => l.askPrice / l.property.appraisal,
  };
  const list = s.realEstate.listings
    .filter((l) => (type === 'todos' || l.property.type === type) && (zone === 'todas' || l.property.zoneId === zone))
    .sort((a, b) => rank[order](a) - rank[order](b) || a.askPrice - b.askPrice);
  const sel = selected !== null ? s.realEstate.listings.find((l) => l.id === selected) : null;
  return (
    <>
      {sel && <ListingDetail key={sel.id} l={sel} />}
      <div className="chips">
        {([['todos', 'Todos'], ['cochera', 'Cocheras'], ['vivienda', 'Viviendas'], ['local', 'Locales'], ['oficina', 'Oficinas'], ['terreno', 'Terrenos']] as Array<['todos' | PropertyType, string]>).map(([id, label]) => (
          <button key={id} className={type === id ? 'on' : ''} aria-pressed={type === id} onClick={() => setType(id)}>{label}</button>
        ))}
      </div>
      <p className="tiny muted">Para empezar con poco capital: cocheras y estudios. <InfoButton term="cochera" /> <InfoButton term="estudio_inmueble" /></p>
      <div className="chips">
        {[{ id: 'todas', name: 'Todas las zonas' }, ...ZONES].map((z) => <button key={z.id} aria-pressed={zone === z.id} onClick={() => setZone(z.id)} style={zone === z.id ? { background: 'var(--text)', color: 'var(--bg)' } : undefined}>{z.name}</button>)}
      </div>
      <div className="inline-form">
        <span className="tiny muted">Ordenar por</span>
        <Seg items={[{ id: 'precio', label: 'Precio' }, { id: 'rendimiento', label: 'Rendimiento' }, { id: 'tasacion', label: 'Vs. tasación' }]} value={order} onChange={setOrder} />
      </div>
      {list.length === 0 && <Empty icon="search">No hay publicaciones con esos filtros. El mercado se renueva cada mes.</Empty>}
      <div className="card" style={{ paddingBlock: 4 }}>
        <div className="rows">
          {list.map((l) => {
            const p = l.property;
            const rent = listingRent(s, l);
            return (
              <button key={l.id} className="row clickable" style={{ border: 0, borderBottom: '1px solid var(--line)', background: 'none', textAlign: 'left', width: '100%' }} onClick={() => { navStore.setSub('invest', `realestate:list:${l.id}`); window.scrollTo({ top: 0 }); }}>
                <div className="grow">
                  <div className="title small"><Icon name={PROPERTY_ICON[p.type]} size={15} /> {p.name}</div>
                  <div className="meta">{ZONE_BY_ID[p.zoneId]?.name} · {fmtNumber(p.m2)} m² · {p.lease ? 'con inquilino' : 'libre'}{rent ? ` · renta bruta ${fmtPct(listingGrossYield(s, l), 1)}` : ''}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className="amt small">{fmtMoney(l.askPrice, { decimals: false })}</div>
                  <span className={`tiny ${l.askPrice <= p.appraisal ? 'gain' : 'loss'}`}>{l.askPrice > p.appraisal ? '+' : ''}{fmtPct(l.askPrice / p.appraisal - 1, 0)} vs tasación</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}

function Zones() {
  const s = useGame();
  useUI();
  return (
    <>
      {ZONES.map((z) => {
        const zs = zoneState(s, z.id);
        const j = jurisdictionById(z.jurisdiction);
        const h = zs.history.slice(-36);
        const y1 = h.length > 12 ? zs.index / h[h.length - 13].index - 1 : null;
        return (
          <div className="card" key={z.id}>
            <CardHead title={z.name} right={<span className="tiny muted">{j.name}</span>} />
            <p className="small">{z.description}</p>
            {h.length > 1 && <LineChart series={[{ name: 'Precios', values: h.map((x) => x.index * 1000), color: 'var(--accent)' }, { name: 'Alquileres', values: h.map((x) => x.rentIndex * 1000), color: 'var(--gain)' }]} height={90} format={(v) => (v / 10).toFixed(0)} />}
            <div className="kv">
              <dt>Precio vivienda</dt><dd>{fmtMoney(Math.round(z.price.vivienda * zs.index * 100), { decimals: false })}/m²</dd>
              <dt>Variación de precios 12 m <InfoButton term="plusvalia" /></dt><dd>{y1 === null ? '—' : fmtPct(y1, 1)}</dd>
              <dt>Vacancia viviendas <InfoButton term="vacancia" /></dt><dd>{fmtPct(marketVacancy(s, z.id, 'vivienda'), 0)}</dd>
              <dt>Riesgo de morosidad</dt><dd>{z.tenantRisk < 0.2 ? 'Bajo' : z.tenantRisk < 0.35 ? 'Medio' : 'Alto'}</dd>
              <dt>Impuesto inmobiliario / transferencia</dt><dd>{fmtPct(j.propertyTaxRate, 2)} / {fmtPct(j.transferTaxRate, 1)}</dd>
            </div>
          </div>
        );
      })}
    </>
  );
}

export function RealEstateScreen({ param }: { param: string }) {
  const s = useGame();
  useUI();
  const [kind, id] = param.split(':');
  const sub: Sub = kind === 'market' || kind === 'list' ? 'market' : kind === 'zones' ? 'zones' : 'mine';
  return (
    <>
      <div className="card">
        <CardHead title="Bienes raíces" term="inmueble" />
        <Learn term="inmueble" />
        <div className="kv">
          <dt>Tasa de política <InfoButton term="interes" /></dt><dd>{fmtPct(s.macro.policyRate, 2)}</dd>
          <dt>Publicaciones en el mercado</dt><dd>{s.realEstate.listings.length}</dd>
        </div>
      </div>
      <Seg items={[{ id: 'mine', label: 'Mis inmuebles' }, { id: 'market', label: 'Mercado' }, { id: 'zones', label: 'Zonas' }]} value={sub} onChange={(v) => navStore.setSub('invest', v === 'mine' ? 'realestate' : `realestate:${v}`)} />
      {sub === 'mine' && <Mine selected={kind === 'prop' ? Number(id) : null} />}
      {sub === 'market' && <Market selected={kind === 'list' ? Number(id) : null} />}
      {sub === 'zones' && <Zones />}
    </>
  );
}
