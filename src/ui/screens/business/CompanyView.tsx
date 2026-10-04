import { useState } from 'react';
import { store, useGame, useUI, useDerived } from '../../store';
import { coMetricsOf, coInsightsOf, coValuationOf } from '../../derived';
import { navStore } from '../../nav';
import type { Company } from '../../../engine/business/types';
import type { GameState } from '../../../engine/state';
import type { ActionResult } from '../../../engine/result';
import { SECTOR_BY_ID, LEGAL_FORM_BY_ID, roleDef, allRoles, DEPT_NAMES, DeptId } from '../../../content/sectors';
import { coIncomeStatement } from '../../../engine/business/reports';
import { daysToBankruptcy } from '../../../engine/business/finance';
import { capacity, countRole, hasManager, managerSkill, monthlyPayroll, equipDef } from '../../../engine/business/common';
import { expectedDemand, refPrice, setPrice, setPlan, toggleProduct, buyEquipment, sellEquipment, setMaintenance } from '../../../engine/business/operations';
import { itemPlan, placeOrder, supplierAccessible, supplierUnitCost, leadDays, deliveryFee } from '../../../engine/business/inventory';
import { supplierShockMult } from '../../../engine/world/rivals';
import { PoachCard } from '../more/Rivals';
import { generateCandidates, hire, fire, train, setWage, marketWage, hiringFee, severance } from '../../../engine/business/staff';
import { fmtMoney, fmtPct } from '../../../engine/format';
import { formatDate } from '../../../engine/time/calendar';
import { Cents, usd } from '../../../engine/money';
import { Money, InfoButton, GroupedTabs, Pill, Bar, Empty, AmountInput, ConfirmButton, CardHead, Act, Stat, LineChart, Legend, NumInput, Seg, GuardedAct } from '../../components/common';
import type { TabGroup } from '../../components/common';
import { MarketingTab, FinanceTab, MarketTab, ManageTab } from './CompanyTabs';
import { ForecastPanel } from '../../components/ForecastPanel';
import { BandChart } from '../../components/charts';
import { GroupTab } from './GroupTab';
import { SECTOR_ICON } from '../../contentIcons';
import { Icon } from '../../icons';
import { explainCompany } from '../../../engine/reports/explain';

export function runCo(id: number, fn: (s: GameState, co: Company) => ActionResult | void): ActionResult {
  return store.run((s) => {
    const co = s.companies.find((c) => c.id === id);
    if (!co) return { ok: false, error: 'La empresa ya no existe.' };
    return fn(s, co);
  });
}

type CoTab = 'summary' | 'ops' | 'inventory' | 'staff' | 'marketing' | 'finance' | 'market' | 'group' | 'manage';

/** Secciones de una empresa agrupadas (las rutas "co:<id>:<sección>" no cambian). */
const TAB_GROUPS: Array<TabGroup<CoTab>> = [
  { id: 'summary', label: 'Resumen', items: [{ id: 'summary', label: 'Resumen' }] },
  { id: 'ops', label: 'Operación', items: [{ id: 'ops', label: 'Operaciones' }, { id: 'inventory', label: 'Inventario' }, { id: 'staff', label: 'Personal' }] },
  { id: 'sales', label: 'Comercial', items: [{ id: 'marketing', label: 'Marketing' }, { id: 'market', label: 'Mercado' }] },
  { id: 'money', label: 'Finanzas', items: [{ id: 'finance', label: 'Finanzas' }, { id: 'group', label: 'Grupo e inmuebles' }] },
  { id: 'manage', label: 'Gestión', items: [{ id: 'manage', label: 'Gestión' }] },
];
const HOLDING_GROUPS: Array<TabGroup<CoTab>> = [
  { id: 'summary', label: 'Resumen', items: [{ id: 'summary', label: 'Resumen' }] },
  { id: 'group', label: 'Grupo', items: [{ id: 'group', label: 'Grupo' }] },
  { id: 'finance', label: 'Finanzas', items: [{ id: 'finance', label: 'Finanzas' }] },
  { id: 'manage', label: 'Gestión', items: [{ id: 'manage', label: 'Gestión' }] },
];

/** ¿Por qué ganó o perdió? Las líneas más grandes de los últimos 30 días. */
function WhyCompany({ co }: { co: Company }) {
  const s = useGame();
  const e = explainCompany(co, s.day);
  const max = Math.max(1, ...e.items.map((x) => Math.abs(x.amount)));
  return (
    <details className="card why-company">
      <summary><strong className="small">{e.net >= 0 ? '¿Por qué gana?' : '¿Por qué pierde?'}</strong> <span className="small muted">{e.summary}</span></summary>
      <div className="explain-list" style={{ marginTop: 10 }}>
        {e.items.slice(0, 7).map((x) => (
          <div key={x.key} className={`explain-row k-${x.kind}`}>
            <div className="explain-top"><span className="small">{x.label}</span><Money c={x.amount} colored sign /></div>
            <div className="explain-bar"><span style={{ width: `${(Math.abs(x.amount) / max) * 100}%` }} className={x.amount >= 0 ? 'up' : 'down'} /></div>
          </div>
        ))}
      </div>
    </details>
  );
}

function Summary({ co }: { co: Company }) {
  const s = useGame();
  const m = useDerived(coMetricsOf, co.id);
  const insights = useDerived(coInsightsOf, co.id);
  const v = useDerived(coValuationOf, co.id);
  const left = daysToBankruptcy(s, co);
  const h = co.history.slice(-18);
  return (
    <>
      {s.day < co.openDay && (
        <div className="alert info"><span className="stripe" /><div className="small">Período de instalación: abre al público el {formatDate(co.openDay)}. Mientras tanto llegan los pedidos iniciales de insumos.</div></div>
      )}
      {left !== null && (
        <div className="alert critical"><span className="stripe" /><div className="small"><strong>Insolvente:</strong> {fmtMoney(m.arrears)} de deudas vencidas. Quiebra en {left} días si no se regulariza. Aportá capital desde Finanzas o cerrá ordenadamente en Gestión.</div></div>
      )}
      <div className="grid2">
        <Stat label="Caja" term="liquidez" value={<Money c={m.cash} />} sub={m.runwayDays !== null ? `Alcanza ~${Math.round(m.runwayDays)} días (estim.)` : 'Genera caja'} />
        <Stat label="Ventas 30 días" term="ingresos_vs_beneficio" value={<Money c={m.revenue30} />} sub={m.salesTrend !== null ? `${m.salesTrend >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(m.salesTrend * 100))} % vs. 30 días previos` : 'Sin comparación aún'} />
        <Stat label="Resultado 30 días" term="estado_resultados" value={<Money c={m.net30} colored sign />} sub={`Margen bruto ${fmtPct(m.grossMargin30)}`} />
        <Stat label="Cuota de mercado" term="cuota_mercado" value={fmtPct(m.share)} sub={m.lostShare > 0.02 ? `Pierde ${Math.round(m.lostShare * 100)} % de la demanda` : 'Atiende la demanda'} />
        <Stat label="Calidad" term="capacidad" value={`${Math.round(co.quality)}/100`} sub="Insumos, personal, equipos" />
        <Stat label="Reputación · marca" term="conocimiento_marca" value={`${Math.round(co.reputation)} · ${Math.round(co.awareness)}`} sub="Reputación y conocimiento" />
        <Stat label="Personal" term="nomina" value={co.employees.length} sub={`Nómina ${fmtMoney(m.payrollMonthly, { decimals: false })}/mes`} />
        <Stat label="Valoración" term="valoracion" value={<Money c={v.value} />} sub={`Por ${v.method}`} />
      </div>
      {s.day >= co.openDay && <WhyCompany co={co} />}
      {h.length > 1 && (
        <div className="card">
          <CardHead title="Evolución mensual" term="estado_resultados" />
          <LineChart series={[{ name: 'Ventas', values: h.map((x) => x.revenue), color: 'var(--accent)' }, { name: 'Resultado neto', values: h.map((x) => x.netIncome), color: 'var(--info)' }, { name: 'Caja', values: h.map((x) => x.cash), color: 'var(--gain)', dashed: true }]} />
          <Legend series={[{ name: 'Ventas', values: [], color: 'var(--accent)' }, { name: 'Resultado neto', values: [], color: 'var(--info)' }, { name: 'Caja', values: [], color: 'var(--gain)' }]} />
        </div>
      )}
      {co.forecast && <ForecastVsReality co={co} />}
      {sectorModel(co) !== 'holding' && co.status !== 'sold' && <ForecastPanel target={{ kind: 'empresa', companyId: co.id }} title="¿Cómo le irá? Próximos 12 meses" />}
      <div className="section-title"><h2>Asesor empresarial</h2><InfoButton term="asesor" /></div>
      {insights.length === 0 && <Empty icon="check">Sin alertas para esta empresa{m.daysOpen < 30 ? ' (algunas se activan tras 30 días de operación)' : ''}.</Empty>}
      {insights.map((i) => (
        <button key={i.id} className={`alert ${i.severity}`} style={{ textAlign: 'left' }} onClick={() => navStore.open({ kind: 'advisor' })}>
          <span className="stripe" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <strong className="small">{i.title}</strong>
            <span className="small muted">{i.what}</span>
            {i.timeframe && <span className="tiny">Plazo estimado: {i.timeframe}</span>}
          </div>
        </button>
      ))}
    </>
  );
}

function Ops({ co }: { co: Company }) {
  const s = useGame();
  useUI();
  const sec = SECTOR_BY_ID[co.sector];
  const cap = capacity(s, co);
  const recent = co.stats.slice(-30);
  const [prices, setPrices] = useState<Record<string, Cents>>({});
  const rivals = s.markets[co.sector].competitors.filter((c) => c.active);
  const avgMult = rivals.length ? rivals.reduce((a, c) => a + c.priceMult, 0) / rivals.length : 1;
  return (
    <>
      <div className="card">
        <CardHead title="Productos y precios" term="accion_precio" />
        {sec.model === 'subscription' && (
          <div className="kv">
            <dt>Suscriptores</dt><dd>{Math.round(co.subscribers)}</dd>
            <dt>Ingreso recurrente mensual (MRR)</dt><dd>{fmtMoney(Math.round(co.subscribers * co.products[0].price))}</dd>
            <dt>Altas (30 días)</dt><dd>{recent.reduce((a, x) => a + (x.sold.plan ?? 0), 0).toFixed(0)}</dd>
            <dt>Cancelaciones (30 días)</dt><dd>{recent.reduce((a, x) => a + (x.lost.plan ?? 0), 0).toFixed(0)}</dd>
          </div>
        )}
        {co.products.map((ps) => {
          const p = sec.products.find((x) => x.id === ps.id)!;
          const sold = recent.reduce((a, x) => a + (x.sold[p.id] ?? 0), 0);
          const lost = recent.reduce((a, x) => a + (x.lost[p.id] ?? 0), 0);
          const draft = prices[p.id] ?? ps.price;
          const demandNow = expectedDemand(s, co, p, ps.price, s.day);
          const demandDraft = expectedDemand(s, co, p, draft, s.day);
          let unitCost = 0;
          for (const r of p.recipe) {
            const sup = sec.suppliers.find((x) => x.id === co.rules.find((y) => y.item === r.item)?.supplierId) ?? sec.suppliers.find((x) => x.itemId === r.item);
            if (sup) unitCost += supplierUnitCost(s, sup) * r.qty;
          }
          unitCost += Math.round(usd(sec.variableCost * s.macro.priceIndex) * (sec.model === 'subscription' ? 1 : 1));
          return (
            <div key={p.id} className="stack" style={{ gap: 6, borderBottom: '1px solid var(--line)', paddingBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong style={{ flex: 1 }}>{p.name}</strong>
                <label className="tiny"><input type="checkbox" checked={ps.active} onChange={() => runCo(co.id, (st, c) => toggleProduct(st, c, p.id, !ps.active))} /> a la venta</label>
              </div>
              <div className="kv">
                <dt>Precio actual</dt><dd>{fmtMoney(ps.price)} / {p.unit}</dd>
                <dt>Referencia del mercado</dt><dd>{fmtMoney(refPrice(s, p))} (rivales ≈ {fmtMoney(Math.round(refPrice(s, p) * avgMult))})</dd>
                <dt>Costo directo por unidad (estim.)</dt><dd>{fmtMoney(unitCost)}</dd>
                <dt>Vendido 30 días · perdido</dt><dd>{sold.toFixed(0)} · {lost.toFixed(0)}</dd>
                <dt>Demanda esperada por día (estim.)</dt><dd>{demandNow.toFixed(1)}</dd>
              </div>
              <div className="inline-form">
                <div style={{ flex: 1, minWidth: 140 }}><AmountInput id={`price-${co.id}-${p.id}`} label={`Precio de ${p.name}`} value={draft} onChange={(v) => setPrices({ ...prices, [p.id]: v })} /></div>
                <GuardedAct
                  label="Aplicar"
                  help="accion_precio"
                  className="btn sm dark"
                  disabled={!(draft > 0) || draft === ps.price}
                  warning={draft > 0 && draft < unitCost
                    ? <>Con {fmtMoney(draft)} cada unidad se vende {fmtMoney(unitCost - draft)} por debajo de su costo directo estimado ({fmtMoney(unitCost)}).</>
                    : draft > 0 && demandNow > 0 && demandDraft < demandNow * 0.25
                      ? <>Con {fmtMoney(draft)} la demanda esperada cae de {demandNow.toFixed(1)} a {demandDraft.toFixed(1)} por día.</>
                      : undefined}
                  confirmLabel="Aplicar igual"
                  onConfirm={() => runCo(co.id, (st, c) => setPrice(st, c, p.id, draft))}
                />
              </div>
              {draft !== ps.price && <p className="tiny muted">Con {fmtMoney(draft)} la demanda esperada sería {demandDraft.toFixed(1)}/día ({demandDraft >= demandNow ? '+' : ''}{Math.round((demandDraft / Math.max(0.01, demandNow) - 1) * 100)} %). Elasticidad del sector: {p.elasticity}. <InfoButton term="elasticidad" /></p>}
              {sec.model === 'manufacturing' && (
                <div className="inline-form">
                  <span className="small" style={{ flex: 1 }}>Plan de producción diario (stock: {ps.finished.reduce((a, l) => a + l.qty, 0)})</span>
                  <NumInput id={`plan-${co.id}-${p.id}`} value={ps.plan} onChange={(n) => runCo(co.id, (st, c) => setPlan(st, c, p.id, n))} suffix="u/día" />
                  <InfoButton term="accion_plan" />
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="card">
        <CardHead title="Capacidad" term="capacidad" />
        <div className="kv">
          {cap.production > 0 && <><dt>Producción</dt><dd>{cap.production.toFixed(1)} unidades de trabajo/día</dd></>}
          {cap.service > 0 && <><dt>Atención</dt><dd>{cap.service.toFixed(0)} clientes o artículos/día</dd></>}
          {cap.hours > 0 && <><dt>Horas facturables</dt><dd>{cap.hours.toFixed(1)} h/día</dd></>}
          {cap.users > 0 && <><dt>Suscriptores soportados</dt><dd>{Math.round(cap.users)}</dd></>}
          <dt>Bono de equipos</dt><dd>+{Math.round(cap.equipmentBonus * 100)} %</dd>
        </div>
        {recent.length > 0 && <p className="tiny muted">Uso promedio (30 días): {fmtPct(recent.reduce((a, x) => a + (x.capacity > 0 ? x.capacityUsed / x.capacity : 0), 0) / recent.length)}. Último cuello de botella: {recent.slice(-7).map((x) => x.lostReason).filter(Boolean).pop() ?? 'ninguno'}.</p>}
      </div>
      <div className="card">
        <CardHead title="Equipos" term="accion_equipo" />
        <div className="rows">
          {co.assets.map((a) => {
            const d = equipDef(co, a.equipId);
            return (
              <div className="row" key={a.id} style={{ flexWrap: 'wrap' }}>
                <div className="grow">
                  <div className="title small">{d.name} {a.brokenUntil > s.day && <Pill tone="loss">averiado hasta {formatDate(a.brokenUntil)}</Pill>}</div>
                  <div className="meta">Valor contable {fmtMoney(a.bookValue)} · condición {Math.round(a.condition)}/100</div>
                  <Bar value={a.condition / 100} tone={a.condition < 40 ? 'loss' : a.condition < 60 ? 'warn' : 'gain'} />
                </div>
                <ConfirmButton label="Vender" className="btn sm ghost" help="accion_equipo" confirmLabel="Vender usado" detail="Se vende a un valor menor que el contable (equipo usado)." onConfirm={() => runCo(co.id, (st, c) => sellEquipment(st, c, a.id))} />
              </div>
            );
          })}
        </div>
        <div className="field">
          <label>Mantenimiento <InfoButton term="accion_mantenimiento" /></label>
          <Seg items={[{ id: 'none', label: 'Ninguno' }, { id: 'basic', label: 'Básico' }, { id: 'preventive', label: 'Preventivo' }]} value={co.maintenance} onChange={(v) => runCo(co.id, (st, c) => setMaintenance(st, c, v))} />
        </div>
        <span className="eyebrow">Comprar equipos</span>
        {sec.equipment.map((e) => (
          <div className="row" key={e.id} style={{ flexWrap: 'wrap' }}>
            <div className="grow">
              <div className="title small">{e.name}</div>
              <div className="meta">{e.description} Vida útil {e.lifeMonths} meses · mantenimiento {fmtMoney(usd(e.maintenance * s.macro.priceIndex))}/mes</div>
            </div>
            <ConfirmButton label={fmtMoney(usd(e.cost * s.macro.priceIndex), { decimals: false })} className="btn sm" confirmLabel="Comprar" help="accion_equipo" detail={<>Se paga de la caja de {co.name} ({fmtMoney(co.ledger.balances.cash)}) y se deprecia en {e.lifeMonths} meses.</>} onConfirm={() => runCo(co.id, (st, c) => buyEquipment(st, c, e.id))} />
          </div>
        ))}
      </div>
    </>
  );
}

function Inventory({ co }: { co: Company }) {
  const s = useGame();
  useUI();
  const sec = SECTOR_BY_ID[co.sector];
  const [item, setItem] = useState(sec.items[0]?.id ?? '');
  const [supplier, setSupplier] = useState('');
  const [qty, setQty] = useState(0);
  if (!sec.items.length) return <div className="card"><Empty icon="package">Este negocio no maneja inventario: vende {sec.model === 'subscription' ? 'suscripciones' : 'horas de servicio'}.</Empty></div>;
  const sups = sec.suppliers.filter((x) => x.itemId === item);
  const sup = sups.find((x) => x.id === supplier) ?? sups[0];
  const q = qty || sup?.minOrder || 0;
  return (
    <>
      <div className="card">
        <CardHead title="Existencias y planificación" term="punto_reorden" />
        <div className="hscroll">
          <table className="table">
            <thead><tr><th>Insumo</th><th className="r">Stock</th><th className="r">En camino</th><th className="r">Consumo/día</th><th className="r">Cobertura</th><th>Riesgo</th></tr></thead>
            <tbody>
              {sec.items.map((it) => {
                const p = itemPlan(s, co, it.id);
                return (
                  <tr key={it.id}>
                    <td>{it.name}<div className="tiny faint">{it.shelfLifeDays ? `vence en ${it.shelfLifeDays} d` : 'no perecedero'}</div></td>
                    <td className="r">{p.onHand.toFixed(1)}</td>
                    <td className="r">{p.inTransit.toFixed(0)}</td>
                    <td className="r">{p.usage.toFixed(1)}</td>
                    <td className="r">{p.coverDays === Infinity ? '—' : `${p.coverDays.toFixed(0)} d`}</td>
                    <td><Pill tone={p.risk === 'alto' ? 'loss' : p.risk === 'medio' ? 'warn' : 'gain'}>{p.risk}</Pill></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="tiny muted">Valor del inventario: {fmtMoney(co.ledger.balances.inventory)} (FIFO). Cobertura = stock ÷ consumo diario de los últimos 14 días. <InfoButton term="inventario" /></p>
      </div>
      <div className="card">
        <CardHead title="Reglas de reposición" term="accion_regla" />
        {co.delegation.autoReorder && hasManager(co) && <p className="small info">El gerente ajusta estas reglas cada semana (delegación activa).</p>}
        {co.rules.map((r) => {
          const p = itemPlan(s, co, r.item);
          const it = sec.items.find((x) => x.id === r.item)!;
          return (
            <div key={r.item} className="stack" style={{ gap: 6, borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <label style={{ flex: 1 }}><input type="checkbox" checked={r.enabled} onChange={() => runCo(co.id, (_st, c) => { c.rules.find((x) => x.item === r.item)!.enabled = !r.enabled; })} /> <strong className="small">{it.name}</strong></label>
                <select className="input" style={{ width: 'auto', minHeight: 36, fontSize: 12 }} aria-label={`Proveedor de ${it.name}`} value={r.supplierId} onChange={(e) => runCo(co.id, (_st, c) => { c.rules.find((x) => x.item === r.item)!.supplierId = e.target.value; })}>
                  {sec.suppliers.filter((x) => x.itemId === r.item).map((x) => <option key={x.id} value={x.id} disabled={!supplierAccessible(s, x)}>{x.name}</option>)}
                </select>
              </div>
              <div className="inline-form small">
                <span>Pedir cuando queden</span>
                <NumInput id={`rp-${co.id}-${r.item}`} value={r.reorderPoint} onChange={(n) => runCo(co.id, (_st, c) => { c.rules.find((x) => x.item === r.item)!.reorderPoint = n; })} suffix={it.unit} />
                <span>cantidad</span>
                <NumInput id={`rq-${co.id}-${r.item}`} value={r.orderQty} onChange={(n) => runCo(co.id, (_st, c) => { c.rules.find((x) => x.item === r.item)!.orderQty = n; })} suffix={it.unit} />
              </div>
              <span className="tiny muted">Sugerido: punto {Math.ceil(p.reorderPoint)} (consumo × {p.leadDays} días de entrega + seguridad {Math.ceil(p.safetyStock)}).</span>
            </div>
          );
        })}
      </div>
      <div className="card">
        <CardHead title="Hacer un pedido" term="accion_pedido" />
        <div className="field">
          <label htmlFor="po-item">Insumo</label>
          <select id="po-item" className="input" value={item} onChange={(e) => { setItem(e.target.value); setSupplier(''); setQty(0); }}>
            {sec.items.map((it) => <option key={it.id} value={it.id}>{it.name}</option>)}
          </select>
        </div>
        <div className="hscroll">
          <table className="table">
            <thead><tr><th></th><th>Proveedor</th><th className="r">Precio</th><th className="r">Calidad</th><th className="r">Entrega</th><th className="r">Fiabilidad</th><th>Pago</th><th className="r">Mínimo</th></tr></thead>
            <tbody>
              {sups.map((x) => {
                const ok = supplierAccessible(s, x);
                const blocked = co.blockedSuppliers.includes(x.id);
                return (
                  <tr key={x.id} style={{ opacity: ok ? 1 : 0.5 }}>
                    <td><input type="radio" name="sup" aria-label={x.name} checked={sup?.id === x.id} disabled={!ok} onChange={() => { setSupplier(x.id); setQty(0); }} /></td>
                    <td>{x.name}{!ok && <div className="tiny loss">requiere red de contactos {x.networkRequired}</div>}{blocked && <div className="tiny loss">sin crédito (factura impaga)</div>}</td>
                    <td className="r">{fmtMoney(supplierUnitCost(s, x))}{supplierShockMult(s, x.id) > 1 && <div className="tiny loss">+{Math.round((supplierShockMult(s, x.id) - 1) * 100)} % exclusividad</div>}</td>
                    <td className="r">{x.quality}</td>
                    <td className="r">{leadDays(co, x)} d</td>
                    <td className="r">{Math.round(x.reliability * 100)} %</td>
                    <td>{x.paymentDays && !blocked ? `${x.paymentDays} días` : 'contado'}</td>
                    <td className="r">{x.minOrder}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {sup && (
          <>
            <div className="inline-form">
              <span className="small">Cantidad</span>
              <NumInput id="po-qty" live value={q} onChange={setQty} min={0} step={1} suffix={sec.items.find((x) => x.id === item)!.unit} />
            </div>
            <p className="small">Total {fmtMoney(Math.round(supplierUnitCost(s, sup) * q))} + flete {fmtMoney(deliveryFee(s, co, sup))}. Caja: {fmtMoney(co.ledger.balances.cash)}.</p>
            <Act label="Pedir" help="accion_pedido" className="btn primary" onClick={() => runCo(co.id, (st, c) => placeOrder(st, c, sup.id, q))} />
          </>
        )}
      </div>
      {(co.orders.length > 0 || co.payables.length > 0) && (
        <div className="card">
          <CardHead title="Pedidos y facturas" term="cuentas_por_pagar" />
          <div className="rows">
            {co.orders.map((o) => (
              <div className="row" key={o.id}>
                <div className="grow"><div className="title small">{o.qty} {o.item} · {sec.suppliers.find((x) => x.id === o.supplierId)?.name}</div><div className="meta">Llega {formatDate(o.eta)}{o.delayed ? ' (demorado)' : ''} · {o.prepaid ? 'pagado' : 'a crédito'}</div></div>
                <span className="amt small">{fmtMoney(o.total)}</span>
              </div>
            ))}
            {co.payables.map((p) => (
              <div className="row" key={p.id}>
                <div className="grow"><div className="title small">Factura {sec.suppliers.find((x) => x.id === p.supplierId)?.name}</div><div className="meta">Vence {formatDate(p.dueDay)}</div></div>
                <span className="amt small">{fmtMoney(p.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

function Staff({ co }: { co: Company }) {
  const s = useGame();
  useUI();
  const sec = SECTOR_BY_ID[co.sector];
  const [role, setRole] = useState(sec.roles[0].id);
  const [wages, setWages] = useState<Record<number, Cents>>({});
  const cands = co.candidates.filter((c) => c.role === role);
  const depts = new Map<DeptId, number>();
  for (const e of co.employees) depts.set(roleDef(sec, e.role).dept, (depts.get(roleDef(sec, e.role).dept) ?? 0) + 1);
  return (
    <>
      <div className="card">
        <CardHead title={`Equipo (${co.employees.length})`} term="nomina" />
        <p className="small muted">Nómina mensual con cargas: {fmtMoney(monthlyPayroll(s, co))}. Productividad = (0.5 + habilidad/100) × (0.7 + 0.3 × moral/100).</p>
        {co.employees.length === 0 && <p className="small loss">Sin personal no hay producción ni atención.</p>}
        {co.employees.map((e) => {
          const r = roleDef(sec, e.role);
          const mw = marketWage(s, co, e.role, e.skill);
          const draft = wages[e.id] ?? e.wage;
          return (
            <details key={e.id} className="card flat" style={{ padding: 10 }}>
              <summary style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer' }}>
                <span style={{ flex: 1 }}><strong className="small">{e.name}</strong> <span className="tiny muted">· {r.name}</span></span>
                {e.trainingUntil > s.day && <Pill tone="info">capacitación</Pill>}
                {e.absentUntil > s.day && <Pill tone="warn">ausente</Pill>}
                <span className="tiny num">H {Math.round(e.skill)} · M {Math.round(e.morale)}</span>
              </summary>
              <div className="stack" style={{ gap: 6, marginTop: 8 }}>
                <div className="kv">
                  <dt>Salario</dt><dd>{fmtMoney(e.wage)} (mercado {fmtMoney(mw)})</dd>
                  <dt>Habilidad</dt><dd>{Math.round(e.skill)}/100</dd>
                  <dt>Moral</dt><dd className={e.morale < 40 ? 'loss' : ''}>{Math.round(e.morale)}/100</dd>
                  <dt>Desde</dt><dd>{formatDate(e.hiredDay)}</dd>
                  <dt>Indemnización hoy</dt><dd>{fmtMoney(severance(s, e))}</dd>
                </div>
                <p className="tiny muted">{r.description}</p>
                <div className="inline-form">
                  <div style={{ flex: 1, minWidth: 130 }}><AmountInput id={`wage-${e.id}`} value={draft} onChange={(v) => setWages({ ...wages, [e.id]: v })} /></div>
                  <Act label="Nuevo salario" help="accion_salario" className="btn sm" disabled={draft === e.wage} onClick={() => runCo(co.id, (st, c) => setWage(st, c, e.id, draft))} />
                </div>
                <div className="btn-row">
                  <Act label={`Capacitar (${fmtMoney(usd(300 * s.macro.priceIndex), { decimals: false })})`} help="accion_capacitar" className="btn sm" onClick={() => runCo(co.id, (st, c) => train(st, c, e.id))} />
                  <ConfirmButton label="Despedir" className="btn sm danger" help="accion_despedir" confirmLabel="Despedir" detail={<>Se pagan los días trabajados y {fmtMoney(severance(s, e))} de indemnización.</>} onConfirm={() => runCo(co.id, (st, c) => fire(st, c, e.id))} />
                </div>
              </div>
            </details>
          );
        })}
      </div>
      <div className="card">
        <CardHead title="Contratar" term="accion_contratar" />
        <select className="input" aria-label="Puesto" value={role} onChange={(e) => setRole(e.target.value)}>
          {allRoles(sec).map((r) => <option key={r.id} value={r.id}>{r.name} · {DEPT_NAMES[r.dept]}</option>)}
        </select>
        <p className="tiny muted">{roleDef(sec, role).description}</p>
        <button className="btn sm" onClick={() => runCo(co.id, (st, c) => { generateCandidates(st, c, role); })}>Buscar candidatos</button>
        {cands.map((c) => (
          <div className="row" key={c.id} style={{ flexWrap: 'wrap' }}>
            <div className="grow">
              <div className="title small">{c.name}</div>
              <div className="meta">Habilidad {c.skill} · pide {fmtMoney(c.wage)}/mes · selección {fmtMoney(hiringFee(s, co, c.wage))}</div>
            </div>
            <Act label="Contratar" help="accion_contratar" className="btn sm primary" onClick={() => runCo(co.id, (st, x) => hire(st, x, c.id))} />
          </div>
        ))}
        <p className="tiny muted">Mejor red de contactos y reputación atraen candidatos más hábiles.</p>
      </div>
      <div className="card">
        <CardHead title="Departamentos" />
        <div className="rows">
          {(Object.keys(DEPT_NAMES) as DeptId[]).map((d) => {
            const roles = allRoles(sec).filter((r) => r.dept === d);
            if (!roles.length) return null;
            return (
              <div className="row" key={d}>
                <div className="grow"><div className="title small">{DEPT_NAMES[d]}</div><div className="meta">{roles.map((r) => r.name).join(', ')}</div></div>
                <Pill tone={depts.get(d) ? 'gain' : 'neutral'}>{depts.get(d) ?? 0}</Pill>
              </div>
            );
          })}
        </div>
      </div>
      <div className="card">
        <CardHead title="Delegación" term="accion_delegar" />
        {!hasManager(co) ? (
          <p className="small muted">Contratá un <strong>Gerente general</strong> para delegar la reposición, los precios y el personal. Sin gerente, las decisiones son tuyas (las reglas de reposición siguen funcionando).</p>
        ) : (
          <>
            <p className="small">Gerente con habilidad {managerSkill(co)}: {managerSkill(co) >= 70 ? 'decisiones precisas' : managerSkill(co) >= 50 ? 'decisiones razonables con algún error' : 'se equivoca con frecuencia al estimar cantidades'}.</p>
            {(['autoReorder', 'autoPricing', 'autoStaffing'] as const).map((k) => (
              <label key={k} className="row"><input type="checkbox" checked={co.delegation[k]} onChange={() => runCo(co.id, (_st, c) => { c.delegation[k] = !c.delegation[k]; })} /><span className="grow small">{{ autoReorder: 'Reposición de inventario', autoPricing: 'Precios', autoStaffing: 'Contrataciones y despidos' }[k]}</span></label>
            ))}
            {co.delegation.autoPricing && (
              <div className="inline-form small"><span>Margen objetivo sobre el costo</span><NumInput id={`markup-${co.id}`} value={Math.round(co.delegation.targetMarkup * 100)} onChange={(n) => runCo(co.id, (_st, c) => { c.delegation.targetMarkup = Math.max(1, n / 100); })} suffix="%" /></div>
            )}
            {co.managerReport && (
              <div className="manager-report">
                <div className="title small">Resumen semanal del gerente · {formatDate(co.managerReport.day)}</div>
                {co.managerReport.items.length
                  ? <ul className="small">{co.managerReport.items.map((x, i) => <li key={i}>{x}</li>)}</ul>
                  : <p className="small muted">Esta semana no hizo cambios: todo seguía dentro de lo previsto.</p>}
              </div>
            )}
          </>
        )}
        <p className="tiny muted">Empleados de apoyo en la empresa: {['contador', 'vendedor', 'marketing', 'rrhh', 'soporte', 'logistica', 'investigador'].map((r) => `${roleDef(sec, r).name} ${countRole(co, r)}`).join(' · ')}.</p>
      </div>
    </>
  );
}

function sectorModel(co: Company): string {
  return SECTOR_BY_ID[co.sector].model;
}

/** Compara la proyección hecha antes de fundar/comprar con lo que realmente pasó. */
function ForecastVsReality({ co }: { co: Company }) {
  const f = co.forecast!;
  const real = co.history.filter((h) => h.day > f.day).slice(0, f.months);
  const bands = f.revenue.map(([p10, p50, p90]) => ({ p10, p50, p90 }));
  const done = real.length;
  const inRange = real.filter((h, i) => h.revenue >= f.revenue[i][0] && h.revenue <= f.revenue[i][2]).length;
  return (
    <div className="card">
      <CardHead title="Tu proyección vs. la realidad" term="proyeccion_negocios" />
      <p className="small muted">Antes de {co.npc ? 'comprarla' : 'empezar'} proyectaste las ventas (área: rango, línea: escenario central). La línea punteada es lo que realmente vendió.</p>
      <BandChart bands={bands} actual={real.map((h) => h.revenue)} label="Ventas proyectadas y reales" color="var(--gain)" />
      <p className="small">{done === 0 ? 'Todavía no cerró ningún mes desde la proyección.' : `${inRange} de ${done} meses quedaron dentro del rango proyectado. Comparar tus proyecciones con la realidad te da experiencia en Proyección de negocios.`}</p>
    </div>
  );
}

export function CompanyView({ co, tab }: { co: Company; tab: string }) {
  const s = useGame();
  const sec = SECTOR_BY_ID[co.sector];
  const is = coIncomeStatement(co, Math.max(co.openDay, s.day - 29), s.day);
  return (
    <>
      <button className="btn ghost sm" onClick={() => navStore.setSub('business', 'portfolio')}>← Mis empresas</button>
      <div className="card">
        <div className="co-head">
          <div className="co-logo" style={{ background: co.color }} aria-hidden><Icon name={SECTOR_ICON[co.sector]} size={20} /></div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h1 style={{ fontSize: 19 }}>{co.name}</h1>
            <div className="tiny muted">{sec.name} · {LEGAL_FORM_BY_ID[co.legalForm].name}{co.parentId ? ` · subsidiaria de ${s.companies.find((c) => c.id === co.parentId)?.name ?? ''}` : ''}{co.ownership < 1 ? ` · tu parte ${fmtPct(co.ownership, 1)}` : ''}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <Money c={co.ledger.balances.cash} className="amt" />
            <div className="tiny muted">caja · 30 d <span className={is.netIncome >= 0 ? 'gain' : 'loss'}>{fmtMoney(is.netIncome, { decimals: false, sign: true })}</span></div>
          </div>
        </div>
      </div>
      {s.world.poach.filter((p) => p.status === 'abierta' && p.companyId === co.id).map((p) => <PoachCard key={p.id} p={p} />)}
      {co.saleOffer && co.saleOffer.expires >= s.day && co.saleOffer.from && tab !== 'manage' && (
        <button className="alert opportunity" style={{ textAlign: 'left' }} onClick={() => navStore.setSub('business', `co:${co.id}:manage`)}>
          <span className="stripe" />
          <div className="small" style={{ flex: 1 }}><strong>{co.saleOffer.from} ofrece {fmtMoney(co.saleOffer.price, { decimals: false })} por {co.name}.</strong> Tocá para ver la oferta en Gestión.</div>
        </button>
      )}
      <GroupedTabs<CoTab> label={`Secciones de ${co.name}`} groups={sec.model === 'holding' ? HOLDING_GROUPS : TAB_GROUPS} value={tab as CoTab} onChange={(t) => { navStore.setSub('business', `co:${co.id}:${t}`); window.scrollTo({ top: 0 }); }} />
      {tab === 'summary' && <Summary co={co} />}
      {tab === 'ops' && <Ops co={co} />}
      {tab === 'inventory' && <Inventory co={co} />}
      {tab === 'staff' && <Staff co={co} />}
      {tab === 'marketing' && <MarketingTab co={co} />}
      {tab === 'finance' && <FinanceTab co={co} />}
      {tab === 'market' && <MarketTab co={co} />}
      {tab === 'group' && <GroupTab co={co} />}
      {tab === 'manage' && <ManageTab co={co} />}
    </>
  );
}
