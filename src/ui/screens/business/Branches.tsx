import { useState } from 'react';
import { useGame } from '../../store';
import type { Company } from '../../../engine/business/types';
import { SECTOR_BY_ID } from '../../../content/sectors';
import { branchCosts, branchBlocker, openBranch, closeBranch, BRANCH_SETUP_DAYS } from '../../../engine/business/branches';
import { CITY_MARKET, CITY_ORDER, HOME_CITY, MAX_BRANCHES, locales } from '../../../engine/business/locations';
import { cityShare, effectivePrice } from '../../../engine/business/operations';
import { cityName } from '../../../engine/saga/ranking';
import { fmtMoney, fmtPct } from '../../../engine/format';
import { formatDate } from '../../../engine/time/calendar';
import type { JurisdictionId } from '../../../content/jurisdictions';
import { CardHead, ConfirmButton, Pill } from '../../components/common';
import { Icon } from '../../icons';
import { runCo } from './CompanyView';

/**
 * LOCALES Y SUCURSALES (1.6): dónde vende la empresa y cuánto del mercado de cada
 * ciudad capta. Abrir un local en otra ciudad abre ese mercado.
 */
export function BranchesCard({ co }: { co: Company }) {
  const s = useGame();
  const [city, setCity] = useState<JurisdictionId>('norvalia');
  if (co.sector === 'holding' || co.npc) return null;
  const sec = SECTOR_BY_ID[co.sector];
  const p = sec.products[0];
  const price = effectivePrice(s, co, p.id);
  const open = locales(co, s.day);
  const costs = branchCosts(s, co);
  const blocked = branchBlocker(s, co, city);
  const branches = co.branches ?? [];
  return (
    <div className="card">
      <CardHead title="Locales y ciudades" term="sucursales" />
      <p className="small muted">Cada ciudad tiene su propio mercado. Tu local principal está en {cityName(HOME_CITY)}; una sucursal en otra ciudad te abre ese mercado, y una más en la misma ciudad suma clientes con rendimientos decrecientes.</p>
      <div className="rows">
        {CITY_ORDER.map((c) => {
          const n = open[c] ?? 0;
          const opening = branches.filter((b) => b.city === c && b.openDay > s.day);
          if (!n && !opening.length) return null;
          return (
            <div className="row" key={c}>
              <div className="grow">
                <div className="title small">{cityName(c)} · {n} local{n === 1 ? '' : 'es'}{opening.length ? <span className="tiny muted"> (+{opening.length} abre el {formatDate(opening[0].openDay)})</span> : null}</div>
                <div className="meta">Mercado {fmtPct(CITY_MARKET[c], 0)} del de la capital{n ? ` · tu cuota de ${p.name.toLowerCase()} ≈ ${fmtPct(cityShare(s, co, p, price, c), 0)}` : ''}</div>
              </div>
              {branches.filter((b) => b.city === c).slice(-1).map((b) => (
                <ConfirmButton key={b.id} label="Cerrar uno" className="btn ghost" confirmLabel="Cerrar" detail={<>Deja de pagar alquiler y servicios y recuperás el depósito de {fmtMoney(b.deposit, { decimals: false })}. Equipos y personal quedan en la empresa (podés venderlos o despedir).</>} onConfirm={() => runCo(co.id, (st) => closeBranch(st, co.id, b.id))} />
              ))}
            </div>
          );
        })}
      </div>
      {branches.length < MAX_BRANCHES && (
        <>
          <span className="eyebrow">Abrir una sucursal</span>
          <div className="chips" role="group" aria-label="Ciudad de la sucursal">
            {CITY_ORDER.map((c) => <button key={c} aria-pressed={city === c} onClick={() => setCity(c)} style={city === c ? { background: 'var(--text)', color: 'var(--bg)' } : undefined}>{cityName(c)}</button>)}
          </div>
          <div className="kv">
            <dt>Inversión</dt><dd>{fmtMoney(costs.total, { decimals: false })} <span className="tiny muted">(licencia, depósito, equipos y selección)</span></dd>
            <dt>Cada mes</dt><dd>{fmtMoney(costs.monthly, { decimals: false })} de alquiler y servicios + {fmtMoney(costs.payroll, { decimals: false })} de sueldos</dd>
            <dt>Mercado nuevo</dt><dd>{open[city] ? 'Ya estás: suma presencia' : `${fmtPct(CITY_MARKET[city], 0)} del de la capital`}</dd>
            <dt>Abre en</dt><dd>{BRANCH_SETUP_DAYS} días</dd>
          </div>
          {blocked && <p className="small warn"><Icon name="info" size={14} /> {blocked}</p>}
          <ConfirmButton label={`Abrir en ${cityName(city)}`} className="btn primary" disabled={!!blocked} confirmLabel="Confirmar" detail={<>La empresa paga {fmtMoney(costs.total, { decimals: false })} de su caja. Si el local no vende lo suficiente, sus costos fijos achican la ganancia: conviene expandirse con una empresa que ya gana y tiene capacidad para atender más clientes.</>} onConfirm={() => runCo(co.id, (st) => openBranch(st, co.id, city))} />
        </>
      )}
      {branches.length >= MAX_BRANCHES && <Pill tone="neutral">Máximo de {MAX_BRANCHES} sucursales</Pill>}
    </div>
  );
}
