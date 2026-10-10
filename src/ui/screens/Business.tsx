import { hiredPro } from '../../engine/pros/lookup';
import { useState } from 'react';
import { useGame, useUI, useDerived, store } from '../store';
import { businessesOf } from '../derived';
import { navStore, useNav } from '../nav';
import { SECTORS, SECTOR_BY_ID, LEGAL_FORMS, LEGAL_FORM_BY_ID, BizSectorId, LegalForm } from '../../content/sectors';
import { setupCosts, sectorRequirement, foundCompany, buyListing, foundHolding } from '../../engine/business/ownership';
import { isHolding } from '../../engine/business/groups';
import { JURISDICTIONS, JURISDICTION_BY_ID, type JurisdictionId } from '../../content/jurisdictions';
import { valuation, coMetrics, coIncomeStatement } from '../../engine/business/reports';
import { daysToBankruptcy } from '../../engine/business/finance';
import { ForecastPanel } from '../components/ForecastPanel';
import { attachForecast, type BusinessForecast } from '../../engine/advisor/businessForecast';
import { isOpen } from '../../engine/business/common';
import { formatDate, last90Start } from '../../engine/time/calendar';
import { fmtMoney, fmtPct } from '../../engine/format';
import { spendable } from '../../engine/finance/payments';
import { usd, Cents } from '../../engine/money';
import { Money, InfoButton, Pill, Empty, AmountInput, ConfirmButton, LineChart, CardHead, Act, Stat, Learn, Seg, ScreenIntro } from '../components/common';
import { CompanyView } from './business/CompanyView';
import { SoftGate } from '../components/Gate';
import { truceRivalIn } from '../../engine/world/rivals';
import type { Company } from '../../engine/business/types';
import { SECTOR_ICON } from '../contentIcons';
import { Icon } from '../icons';
import { CompanyTraffic, ExecCard } from './business/Corporate';

const COLORS = ['#d2a94f', '#4cc093', '#7fb2e0', '#ee7a66', '#b59be0', '#e6d27a'];

export function statusPill(co: Company, day: number) {
  if (co.status === 'insolvent') return <Pill tone="loss">Insolvente</Pill>;
  if (day < co.openDay) return <Pill tone="info">Instalándose</Pill>;
  return <Pill tone="gain">Operando</Pill>;
}

function CompanyCard({ co }: { co: Company }) {
  const s = useGame();
  const m = coMetrics(s, co);
  const sec = SECTOR_BY_ID[co.sector];
  const left = daysToBankruptcy(s, co);
  return (
    <button className="card" style={{ textAlign: 'left', font: 'inherit', color: 'inherit', cursor: 'pointer', borderColor: co.status === 'insolvent' ? 'var(--loss)' : undefined }} onClick={() => navStore.setSub('business', `co:${co.id}:summary`)}>
      <div className="co-head">
        <div className="co-logo" style={{ background: co.color }} aria-hidden><Icon name={SECTOR_ICON[co.sector]} size={20} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong>{co.name}</strong>
          <div className="tiny muted">{sec.name} · {LEGAL_FORM_BY_ID[co.legalForm].name} · {JURISDICTION_BY_ID[co.jurisdiction]?.flag}{co.parentId ? ` · de ${s.companies.find((c) => c.id === co.parentId)?.name ?? 'holding'}` : ''}{co.ownership < 1 ? ` · ${fmtPct(co.ownership, 0)} tuyo` : ''}</div>
        </div>
        {statusPill(co, s.day)}
      </div>
      <div className="kv">
        <dt>Caja</dt><dd>{fmtMoney(m.cash)}</dd>
        <dt>Ventas últimos 30 días</dt><dd>{fmtMoney(m.revenue30)}</dd>
        <dt>Resultado últimos 30 días</dt><dd className={m.net30 >= 0 ? 'gain' : 'loss'}>{fmtMoney(m.net30)}</dd>
        {m.runwayDays !== null && <><dt>Caja alcanza (estimación)</dt><dd className={m.runwayDays < 60 ? 'loss' : ''}>{Math.round(m.runwayDays)} días</dd></>}
        {left !== null && <><dt>Días hasta la quiebra</dt><dd className="loss">{left}</dd></>}
      </div>
    </button>
  );
}

function Portfolio() {
  const s = useGame();
  const open = s.companies.filter(isOpen);
  const c = useDerived(businessesOf);
  return (
    <>
      <ScreenIntro icon="business" title="Negocios" text="Fundá, comprá y dirigí empresas. Antes de invertir podés proyectar cómo le iría a cada negocio." term="proyeccion_negocios" />
      <div className="card">
        <CardHead title="Tus empresas" term="metodo_participacion" />
        {open.length === 0 ? (
          <p className="small muted">Todavía no tenés empresas. No hace falta tener empleo ni ahorros previos: solo el capital que cada negocio necesita. También podés combinar empresa y empleo.</p>
        ) : (
          <div className="grid2">
            <Stat label="Empresas" value={c.companies} sub={`${c.employees} empleados`} />
            <Stat label="Ventas 30 días (100 %)" value={<Money c={c.revenue} />} />
            <Stat label="Resultado atribuible 30 d" term="metodo_participacion" value={<Money c={c.attributableNet} colored sign />} />
            <Stat label="Tu parte del patrimonio" value={<Money c={c.attributableEquity} />} sub={`Valor contable ${fmtMoney(s.ledger.balances.business_equity, { decimals: false })}`} />
          </div>
        )}
        <div className="btn-row">
          <Act label="Fundar empresa" help="accion_fundar" className="btn primary" onClick={() => navStore.setSub('business', 'found')} />
          <Act label={`Comprar (${s.listings.length} en venta)`} help="accion_comprar_empresa" className="btn" onClick={() => navStore.setSub('business', 'market')} />
          <Act label="Crear holding" help="accion_fundar_holding" className="btn ghost" onClick={() => navStore.setSub('business', 'holding')} />
          <Act label="Competencia" help="grupos_rivales" className="btn ghost" onClick={() => navStore.go('more', 'rivals')} />
        </div>
      </div>
      <CompanyTraffic />
      <ExecCard />
      {open.map((co) => <CompanyCard key={co.id} co={co} />)}
      {s.formerCompanies.length > 0 && (
        <div className="card">
          <CardHead title="Empresas anteriores" />
          <div className="rows">
            {s.formerCompanies.slice().reverse().map((f) => (
              <div className="row" key={f.id}>
                <Icon name={SECTOR_ICON[f.sector]} size={16} />
                <div className="grow"><div className="title small">{f.name}</div><div className="meta">{f.outcome} el {formatDate(f.endDay)}</div></div>
                <span className="small"><Money c={f.result} colored sign /></span>
              </div>
            ))}
          </div>
          <p className="tiny muted">Resultado = dinero recibido − dinero aportado (incluye deudas que pagaste personalmente).</p>
        </div>
      )}
    </>
  );
}

function Found({ parentId }: { parentId: number | null }) {
  const s = useGame();
  const [sector, setSector] = useState<BizSectorId>('minimarket');
  const [form, setForm] = useState<LegalForm>(parentId ? 'srl' : 'individual');
  const [jur, setJur] = useState<JurisdictionId>(s.tax.jurisdiction);
  const parent = parentId ? s.companies.find((c) => c.id === parentId && isOpen(c) && isHolding(c)) ?? null : null;
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);
  const sec = SECTOR_BY_ID[sector];
  const lf = LEGAL_FORM_BY_ID[form];
  const costs = setupCosts(s, sector, form);
  const [capital, setCapital] = useState<Cents>(usd(sec.recommendedCapital * s.macro.priceIndex));
  const [fc, setFc] = useState<{ key: string; f: BusinessForecast } | null>(null);
  const req = sectorRequirement(s, sec);
  const partner = lf.partnerShare > 0 ? Math.round((capital * lf.partnerShare) / (1 - lf.partnerShare)) : 0;
  const total = capital + partner;
  const working = total - costs.total;
  const monthly = costs.firstMonthFixed + costs.firstMonthPayroll;
  const personalLiquid = parent ? parent.ledger.balances.cash : spendable(s);
  return (
    <>
      <button className="btn ghost sm" onClick={() => navStore.setSub('business', parent ? `co:${parent.id}:group` : 'portfolio')}>← Volver</button>
      {parent && <div className="alert info"><span className="stripe" /><div className="small">La nueva empresa será subsidiaria de <strong>{parent.name}</strong>: el capital sale de la caja de la holding ({fmtMoney(parent.ledger.balances.cash)}). Debe ser SRL o corporación.</div></div>}
      <div className="card">
        <CardHead title="1. Sector" term="accion_fundar" />
        <div className="choice-grid">
          {SECTORS.map((x) => {
            const r = sectorRequirement(s, x);
            return (
              <button key={x.id} className={`choice ${sector === x.id ? 'on' : ''}`} onClick={() => { setSector(x.id); setCapital(usd(x.recommendedCapital * s.macro.priceIndex)); }} aria-pressed={sector === x.id}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Icon name={SECTOR_ICON[x.id]} size={20} />
                  <strong style={{ flex: 1 }}>{x.name}</strong>
                  <span className="tiny num">desde {fmtMoney(setupCosts(s, x.id, form).total, { decimals: false })}</span>
                </div>
                <span className="small muted">{x.tagline}</span>
                {sector === x.id && <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>{x.economics.map((e) => <li key={e}>{e}</li>)}</ul>}
                {r && <span className={`tiny ${r.met ? 'gain' : 'loss'}`}>{r.met ? '✓' : '✗'} {r.label}</span>}
              </button>
            );
          })}
        </div>
      </div>
      <div className="card">
        <CardHead title="2. Forma legal" term="forma_legal" />
        <div className="choice-grid">
          {LEGAL_FORMS.filter((l) => !parent || l.limitedLiability).map((l) => (
            <button key={l.id} className={`choice ${form === l.id ? 'on' : ''}`} onClick={() => setForm(l.id)} aria-pressed={form === l.id}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                <strong>{l.name}</strong>
                <span className="tiny num">{fmtMoney(usd(l.setupCost * s.macro.priceIndex), { decimals: false })}{l.monthlyAdmin ? ` + ${fmtMoney(usd(l.monthlyAdmin * s.macro.priceIndex), { decimals: false })}/mes` : ''}</span>
              </div>
              <span className="tiny gain">+ {l.pros}</span>
              <span className="tiny loss">− {l.cons}</span>
              <span className="tiny muted">{l.limitedLiability ? 'Responsabilidad limitada' : 'Responsabilidad ilimitada'} · {l.passThrough ? 'Tributa en tu declaración' : `Impuesto de sociedades ${fmtPct(JURISDICTION_BY_ID[jur].corporateRate, 0)} + ${fmtPct(JURISDICTION_BY_ID[jur].dividendRate, 0)} sobre dividendos (${JURISDICTION_BY_ID[jur].name})`}</span>
            </button>
          ))}
        </div>
        <Learn term="responsabilidad_limitada" />
      </div>
      <div className="card">
        <CardHead title="3. Jurisdicción de registro" term="jurisdiccion" />
        <JurisdictionPicker value={jur} onChange={setJur} />
      </div>
      <div className="card">
        <CardHead title="4. Identidad" />
        <div className="field">
          <label htmlFor="co-name">Nombre comercial</label>
          <input id="co-name" className="input" maxLength={32} value={name} placeholder={`Ej.: ${sec.name} ${s.player.name.split(' ')[0]}`} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="chips">
          {COLORS.map((c) => <button key={c} type="button" aria-label={`Color ${c}`} onClick={() => setColor(c)} style={{ width: 34, height: 34, borderRadius: 10, background: c, border: color === c ? '3px solid var(--text)' : '1px solid var(--line)' }} />)}
        </div>
      </div>
      <div className="card">
        <CardHead title="5. Capital" term="capital_aportado" />
        <AmountInput id="co-capital" value={capital} onChange={setCapital} max={personalLiquid} />
        <div className="rows">
          <div className="row sub"><div className="grow small">Trámites de constitución</div><span className="amt small">{fmtMoney(costs.legal)}</span></div>
          <div className="row sub"><div className="grow small">Licencia y permisos</div><span className="amt small">{fmtMoney(costs.license)}</span></div>
          <div className="row sub"><div className="grow small">Depósito del local ({sec.depositMonths} {sec.depositMonths > 1 ? 'meses' : 'mes'})</div><span className="amt small">{fmtMoney(costs.deposit)}</span></div>
          <div className="row sub"><div className="grow small">Equipos iniciales</div><span className="amt small">{fmtMoney(costs.equipment)}</span></div>
          <div className="row sub"><div className="grow small">Selección del personal inicial</div><span className="amt small">{fmtMoney(costs.hiring)}</span></div>
          <div className="row total"><div className="grow">Instalación</div><Money c={costs.total} className="amt" /></div>
          {partner > 0 && <div className="row"><div className="grow small">Aporte de tu socio ({fmtPct(lf.partnerShare, 0)})</div><span className="amt small gain">+{fmtMoney(partner)}</span></div>}
          <div className="row"><div className="grow">Capital de trabajo que queda en la empresa</div><Money c={working} className={`amt ${working < monthly * 2 ? 'loss' : ''}`} /></div>
        </div>
        <p className="small">
          Costos fijos del primer mes ≈ <strong>{fmtMoney(monthly)}</strong> (alquiler, servicios, administración y sueldos). {working > 0 ? <>El capital de trabajo cubre ≈ <strong>{(working / monthly).toFixed(1)} meses</strong> sin ventas.</> : <span className="loss">No alcanza para instalarse.</span>} Capital recomendado para este sector: {fmtMoney(costs.recommended, { decimals: false })}.
        </p>
        {total >= costs.total && (total < costs.recommended || working < monthly * 6) && <p className="small warn">{working < monthly * 3 ? 'Con menos de 3 meses de caja, casi todas las empresas quiebran antes de ganar suficientes clientes.' : 'Por debajo de lo recomendado: la empresa puede quedarse sin caja antes de ganar clientes.'} Lo prudente es cubrir al menos 6 meses de costos sin ventas.</p>}
        {truceRivalIn(s, sector) && <p className="small loss">Tenés una tregua con {truceRivalIn(s, sector)!.name} en {sec.name.toLowerCase()}: abrir esta empresa la rompe (te atacan con todo y tu reputación baja 5).</p>}
        <ForecastPanel target={{ kind: 'nueva', sector, legalForm: form, capital, jurisdiction: jur }} title="¿Cómo le iría? Proyección a 12 meses" onResult={(f) => setFc({ key: `${sector}|${form}|${capital}|${jur}`, f })} />
        <ConfirmButton
          label="Fundar empresa"
          className="btn primary block"
          disabled={!!req && !req.met}
          confirmLabel="Fundar"
          help="accion_fundar"
          detail={<>Se transferirán {fmtMoney(capital)} {parent ? `de la caja de ${parent.name}` : 'de tu cuenta corriente'} a {name || sec.name} (registrada en {JURISDICTION_BY_ID[jur].name}). Abrirá al público en 7 días.{truceRivalIn(s, sector) ? ` Rompe la tregua con ${truceRivalIn(s, sector)!.name}.` : ''}</>}
          onConfirm={() => {
            const r = store.run((st) => {
              const res = foundCompany(st, { sector, name: name || `${sec.name} ${st.player.name.split(' ')[0]}`, legalForm: form, capital, color, jurisdiction: jur, parentId: parent?.id ?? null });
              if (res.ok && fc && fc.key === `${sector}|${form}|${capital}|${jur}`) attachForecast(st, st.companies[st.companies.length - 1].id, fc.f);
              return res;
            });
            if (r.ok) {
              const co = store.ui.state!.companies[store.ui.state!.companies.length - 1];
              navStore.setSub('business', `co:${co.id}:summary`);
            }
          }}
        />
      </div>
    </>
  );
}

function Market({ buyerId }: { buyerId: number | null }) {
  const s = useGame();
  const [offers, setOffers] = useState<Record<number, Cents>>({});
  const [fcs, setFcs] = useState<Record<number, BusinessForecast>>({});
  const holdings = s.companies.filter((c) => isOpen(c) && isHolding(c));
  const [buyer, setBuyer] = useState<number | null>(buyerId);
  return (
    <>
      <button className="btn ghost sm" onClick={() => navStore.setSub('business', 'portfolio')}>← Volver</button>
      <div className="card">
        <CardHead title="Empresas en venta" term="accion_comprar_empresa" />
        <p className="small muted">Estas empresas operaron con el mismo motor del juego: sus estados financieros son reales. El listado se renueva cada 60 días.</p>
        {holdings.length > 0 && (
          <div className="field">
            <label>Comprador</label>
            <div className="chips">
              <button aria-pressed={buyer === null} onClick={() => setBuyer(null)} style={buyer === null ? { background: 'var(--text)', color: 'var(--bg)' } : undefined}>Vos (personal)</button>
              {holdings.map((h) => <button key={h.id} aria-pressed={buyer === h.id} onClick={() => setBuyer(h.id)} style={buyer === h.id ? { background: 'var(--text)', color: 'var(--bg)' } : undefined}>{h.name} (caja {fmtMoney(h.ledger.balances.cash, { decimals: false })})</button>)}
            </div>
          </div>
        )}
      </div>
      {s.listings.length === 0 && <Empty icon="tag">No hay empresas en venta en este momento. Volvé en unas semanas.</Empty>}
      {s.listings.map((l) => {
        const co = l.company;
        const sec = SECTOR_BY_ID[co.sector];
        const v = valuation(s, co);
        const is = coIncomeStatement(co, Math.max(co.openDay, last90Start(s.day)), s.day);
        const b = co.ledger.balances;
        const offer = offers[l.id] ?? l.askPrice;
        const pay = Math.min(offer, l.askPrice); // ofrecer más que lo pedido no sube el precio
        const fee = Math.round(pay * 0.03);
        return (
          <div className="card" key={l.id}>
            <div className="co-head">
              <div className="co-logo" style={{ background: co.color }} aria-hidden><Icon name={SECTOR_ICON[co.sector]} size={20} /></div>
              <div style={{ flex: 1 }}>
                <strong>{co.name}</strong>
                <div className="tiny muted">{sec.name} · {LEGAL_FORM_BY_ID[co.legalForm].name} · desde {formatDate(co.foundedDay)}</div>
              </div>
              <Money c={l.askPrice} className="amt" />
            </div>
            <p className="small muted">{l.reason} Oferta válida hasta {formatDate(l.expiresDay)}.</p>
            <div className="kv">
              <dt>Valoración estimada <InfoButton term="valoracion" /></dt><dd>{fmtMoney(v.value)}</dd>
              <dt>Método</dt><dd>{v.method}</dd>
              <dt>Patrimonio contable</dt><dd>{fmtMoney(v.book)}</dd>
              <dt>Ventas anualizadas</dt><dd>{fmtMoney(v.revenueAnnual)}</dd>
              <dt>EBITDA anualizado <InfoButton term="ebitda" /></dt><dd className={v.ebitdaAnnual >= 0 ? '' : 'loss'}>{fmtMoney(v.ebitdaAnnual)}</dd>
              <dt>Resultado neto (últimos 3 meses)</dt><dd className={is.netIncome >= 0 ? 'gain' : 'loss'}>{fmtMoney(is.netIncome)}</dd>
              <dt>Caja · deudas</dt><dd>{fmtMoney(b.cash)} · {fmtMoney(b.loans + b.payables + b.arrears + b.taxes_payable)}</dd>
              <dt>Empleados · reputación</dt><dd>{co.employees.length} · {Math.round(co.reputation)}/100</dd>
            </div>
            {co.history.length > 1 && <LineChart series={[{ name: 'Ventas mensuales', values: co.history.map((h) => h.revenue), color: 'var(--accent)' }, { name: 'Resultado', values: co.history.map((h) => h.netIncome), color: 'var(--info)' }]} height={110} />}
            <details>
              <summary className="small"><strong><Icon name="sparkles" size={14} /> Proyectar esta empresa antes de comprarla</strong></summary>
              <ForecastPanel compact target={{ kind: 'compra', listingId: l.id }} title="Si la comprás: próximos 12 meses" onResult={(f) => setFcs((m) => ({ ...m, [l.id]: f }))} />
            </details>
            <div className="field">
              <label htmlFor={`offer-${l.id}`}>Tu oferta {l.negotiated && <span className="tiny loss">(ya contraofertaste: solo acepta el precio pedido)</span>}</label>
              <AmountInput id={`offer-${l.id}`} value={offer} onChange={(c) => setOffers({ ...offers, [l.id]: c })} />
            </div>
            <ConfirmButton
              label={offer < l.askPrice ? 'Contraofertar' : 'Comprar'}
              className="btn primary"
              help="accion_comprar_empresa"
              disabled={!(offer > 0)}
              confirmLabel="Confirmar"
              detail={<>Pagarías {fmtMoney(pay)} + {fmtMoney(fee)} de costos legales (3 %).{truceRivalIn(s, co.sector) ? ` Rompe tu tregua con ${truceRivalIn(s, co.sector)!.name} en ${sec.name.toLowerCase()}.` : ''} {offer < l.askPrice ? 'El vendedor puede rechazar la contraoferta (una sola vez).' : ''}{!(hiredPro(s, 'abogado', buyer ?? 'personal') ?? hiredPro(s, 'abogado', 'personal')) ? ' Sin un abogado contratado, si la empresa tiene una contingencia oculta (juicios o deudas del dueño anterior), la paga la empresa después de comprarla.' : ''}</>}
              onConfirm={() => {
                const r = store.run((st) => {
                  const res = buyListing(st, l.id, offer, buyer);
                  if (res.ok && fcs[l.id]) attachForecast(st, co.id, fcs[l.id]);
                  return res;
                });
                if (r.ok) navStore.setSub('business', `co:${co.id}:summary`);
              }}
            />
          </div>
        );
      })}
    </>
  );
}

export function Business() {
  const nav = useNav();
  const s = useGame();
  useUI();
  const sub = nav.sub.business ?? 'portfolio';
  if (sub.startsWith('co:')) {
    const [, id, tab] = sub.split(':');
    const co = s.companies.find((c) => c.id === Number(id));
    if (co) return <CompanyView key={co.id} co={co} tab={tab ?? 'summary'} />;
    return (
      <>
        <Empty icon="package">Esa empresa ya no forma parte de tu cartera.</Empty>
        <button className="btn" onClick={() => navStore.setSub('business', 'portfolio')}>Ver mis empresas</button>
      </>
    );
  }
  if (sub.startsWith('found')) return <Found parentId={sub.includes(':') ? Number(sub.split(':')[1]) : null} />;
  if (sub.startsWith('market')) return <Market buyerId={sub.includes(':') ? Number(sub.split(':')[1]) : null} />;
  if (sub === 'holding') return <SoftGate id="holding"><NewHolding /></SoftGate>;
  if (!s.companies.length && !s.formerCompanies.length) return <SoftGate id="business"><Portfolio /></SoftGate>;
  return <Portfolio />;
}

function JurisdictionPicker({ value, onChange }: { value: JurisdictionId; onChange: (j: JurisdictionId) => void }) {
  const s = useGame();
  return (
    <div className="choice-grid">
      {JURISDICTIONS.map((j) => (
        <button key={j.id} className={`choice ${value === j.id ? 'on' : ''}`} onClick={() => onChange(j.id)} aria-pressed={value === j.id}>
          <div style={{ display: 'flex', gap: 8 }}><strong style={{ flex: 1 }}>{j.flag} {j.name}</strong>{j.id === s.tax.jurisdiction && <Pill tone="accent">Tu residencia</Pill>}</div>
          <span className="tiny muted">Sociedades {fmtPct(j.corporateRate, 0)} · dividendos {fmtPct(j.dividendRate, 0)} · controles ×{j.enforcement.toFixed(1)}</span>
          {j.id !== s.tax.jurisdiction && <span className="tiny warn">Siendo residente de otro país: +{fmtMoney(usd(j.foreignCompanyAdmin * s.macro.priceIndex), { decimals: false })}/mes de administración.</span>}
        </button>
      ))}
    </div>
  );
}

function NewHolding() {
  const s = useGame();
  const [name, setName] = useState('');
  const [form, setForm] = useState<'srl' | 'corporacion'>('srl');
  const [jur, setJur] = useState<JurisdictionId>(s.tax.jurisdiction);
  const lf = LEGAL_FORM_BY_ID[form];
  const [capital, setCapital] = useState<Cents>(usd(Math.max(5000, lf.setupCost * 2) * s.macro.priceIndex));
  return (
    <>
      <button className="btn ghost sm" onClick={() => navStore.setSub('business', 'portfolio')}>← Volver</button>
      <div className="card">
        <CardHead title="Crear una holding" term="holding" />
        <Learn term="holding" />
        <p className="small">Una holding es una sociedad cuyo negocio es ser dueña de otras empresas. Sirve para administrarlas como grupo: centralizar caja, prestarse dinero, cobrar honorarios de gestión y recibir dividendos de sus subsidiarias sin retención. No vende productos: sus ingresos vienen de las subsidiarias.</p>
        <div className="alert warning"><span className="stripe" /><div className="small" style={{ flex: 1 }}><strong>Cuesta dinero todos los meses.</strong> Sin subsidiarias paga domicilio legal, servicios y administración (~{fmtMoney(usd((80 + 20 + lf.monthlyAdmin) * s.macro.priceIndex), { decimals: false })}/mes) y no tiene ingresos propios. Cada subsidiaria suma ~{fmtMoney(usd(180 * s.macro.priceIndex), { decimals: false })}/mes de gestión. Conviene cuando ya tenés al menos una SRL o corporación para transferirle.</div></div>
        <div className="field">
          <label htmlFor="h-name">Nombre</label>
          <input id="h-name" className="input" maxLength={32} value={name} placeholder={`Ej.: Grupo ${s.player.name.split(' ')[0]}`} onChange={(e) => setName(e.target.value)} />
        </div>
        <Seg items={[{ id: 'srl', label: 'SRL' }, { id: 'corporacion', label: 'Corporación' }]} value={form} onChange={setForm} />
        <span className="tiny muted">{lf.pros} {lf.cons}</span>
      </div>
      <div className="card">
        <CardHead title="Jurisdicción" term="jurisdiccion" />
        <JurisdictionPicker value={jur} onChange={setJur} />
      </div>
      <div className="card">
        <CardHead title="Capital inicial" term="capital_aportado" />
        <AmountInput id="h-cap" value={capital} onChange={setCapital} max={spendable(s)} />
        <p className="tiny muted">Incluye los trámites de constitución ({fmtMoney(usd(lf.setupCost * s.macro.priceIndex), { decimals: false })}). El resto queda como caja de la holding para fundar o comprar subsidiarias.</p>
        <ConfirmButton label="Crear holding" help="accion_fundar_holding" className="btn primary block" detail={<>Se transferirán {fmtMoney(capital)} de tu cuenta corriente.</>}
          onConfirm={() => {
            const r = store.run((st) => foundHolding(st, { name: name || `Grupo ${st.player.name.split(' ')[0]}`, legalForm: form, capital, jurisdiction: jur }));
            if (r.ok) {
              const co = store.ui.state!.companies[store.ui.state!.companies.length - 1];
              navStore.setSub('business', `co:${co.id}:group`);
            }
          }} />
      </div>
    </>
  );
}
