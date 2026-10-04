import type { GameState } from '../state';
import type { Company } from './types';
import { sectorOf, hasManager, effectiveManagerSkill, capacity, countRole, coLog, monthlyPayroll } from './common';
import { itemPlan, supplierAccessible, supplierUnitCost } from './inventory';
import { refPrice } from './operations';
import { generateCandidates, hire, fire } from './staff';
import { startCampaign } from './marketing';
import { roleDef } from '../../content/sectors';
import { clamp, roundCents } from '../money';
import { randRange } from '../rng';
import { fmtMoney } from '../format';

/**
 * Delegación en el gerente (revisión semanal). Solo actúa si hay un gerente
 * contratado y la opción está activada. La calidad de sus decisiones depende
 * de su habilidad: un gerente flojo se equivoca más al estimar cantidades.
 *
 *  - Reposición: punto de pedido = consumo × (plazo + 3 días); cantidad = 14 días de consumo;
 *    elige el proveedor accesible de mejor relación calidad/precio.
 *  - Precios: busca un margen objetivo sobre el costo y se acerca al precio de la competencia (paso máx. 5 %).
 *  - Personal: contrata si faltan capacidad y ventas; despide si la capacidad sobra de forma sostenida.
 */
export function weeklyManager(state: GameState, co: Company): void {
  if (!hasManager(co) || sectorOf(co).model === 'holding') return;
  const skill = effectiveManagerSkill(state, co);
  const err = () => 1 + randRange(state, -1, 1) * Math.max(0, (70 - skill) / 200);
  const sec = sectorOf(co);
  const d = co.delegation;
  const changes: string[] = [];
  /** Resumen legible de lo que decidió el gerente esta semana (se muestra en la empresa). */
  const report: string[] = [];

  if (d.autoReorder) {
    for (const r of co.rules) {
      const plan = itemPlan(state, co, r.item);
      if (plan.usage <= 0) continue;
      // Mejor relación calidad / costo REAL de hoy (inflación, costos del sector y exclusividades de rivales).
      const value = (x: (typeof sec.suppliers)[number]) => x.quality / Math.max(1, supplierUnitCost(state, x, co));
      const options = sec.suppliers.filter((s) => s.itemId === r.item && supplierAccessible(state, s));
      const best = [...options].sort((a, b) => value(b) - value(a))[0];
      const item = sec.items.find((i) => i.id === r.item)!;
      const maxCover = item.shelfLifeDays ? Math.max(2, item.shelfLifeDays * 0.6) : 21;
      const s = best ?? sec.suppliers.find((x) => x.id === r.supplierId)!;
      if (s.id !== r.supplierId) {
        const prev = sec.suppliers.find((x) => x.id === r.supplierId);
        report.push(`${item.name}: cambió de ${prev?.name ?? 'proveedor'} a ${s.name} (mejor calidad por precio).`);
      }
      r.supplierId = s.id;
      r.reorderPoint = Math.ceil(plan.usage * (plan.leadDays + 3) * err());
      r.orderQty = Math.max(s.minOrder, Math.ceil(plan.usage * Math.min(14, maxCover) * err()));
      r.enabled = true;
    }
    // Manufactura: el plan de producción sigue la demanda reciente (sin exceder mucho la capacidad).
    if (sec.model === 'manufacturing') {
      const recent = co.stats.slice(-14);
      const capUnits = capacity(state, co).production;
      let totalLabor = 0;
      const want: Record<string, number> = {};
      for (const ps of co.products) {
        const p = sec.products.find((x) => x.id === ps.id)!;
        const dem = recent.length ? recent.reduce((s, x) => s + (x.demand[p.id] ?? 0), 0) / recent.length : p.marketDaily * 0.05;
        const stock = ps.finished.reduce((s, l) => s + l.qty, 0);
        want[p.id] = Math.max(0, dem * 1.1 - stock / 7) * err();
        totalLabor += want[p.id] * p.laborUnits;
      }
      const scale = totalLabor > capUnits && totalLabor > 0 ? capUnits / totalLabor : 1;
      for (const ps of co.products) ps.plan = Math.max(0, Math.round(want[ps.id] * scale * 10) / 10);
    }
    changes.push('reposición');
    report.push(`Ajustó ${co.rules.length} regla${co.rules.length === 1 ? '' : 's'} de reposición según el consumo reciente.`);
  }

  if (d.autoPricing) {
    const market = state.markets[co.sector];
    const rivals = market.competitors.filter((c) => c.active);
    const avgMult = rivals.length ? rivals.reduce((s, c) => s + c.priceMult, 0) / rivals.length : 1;
    for (const ps of co.products) {
      const p = sec.products.find((x) => x.id === ps.id)!;
      let unitCost = 0;
      for (const r of p.recipe) {
        const sup = sec.suppliers.find((s) => s.id === co.rules.find((x) => x.item === r.item)?.supplierId) ?? sec.suppliers.find((s) => s.itemId === r.item);
        if (sup) unitCost += supplierUnitCost(state, sup, co) * r.qty;
      }
      const ref = refPrice(state, p);
      const costPrice = unitCost > 0 ? unitCost * d.targetMarkup : ref;
      const target = (costPrice + ref * avgMult) / 2;
      const next = clamp(target * err(), ps.price * 0.95, ps.price * 1.05);
      const old = ps.price;
      ps.price = Math.max(1, roundCents(next / 5) * 5);
      if (ps.price !== old) report.push(`${p.name}: precio ${fmtMoney(old)} → ${fmtMoney(ps.price)}.`);
    }
    changes.push('precios');
  }

  if (d.autoStaffing) {
    const recent = co.stats.slice(-7);
    let dem = 0;
    let lost = 0;
    for (const s of recent) for (const k of Object.keys(s.demand)) { dem += s.demand[k]; lost += s.lost[k] ?? 0; }
    const cap = capacity(state, co);
    // Utilización promedio en los días con demanda (los días sin actividad, como fines de semana, no cuentan).
    const active = recent.filter((x) => Object.values(x.demand).some((v) => v > 0) && x.capacity > 0);
    const util = active.length ? active.reduce((s, x) => s + x.capacityUsed / x.capacity, 0) / active.length : 0;
    const prodRole = sec.roles.find((r) => r.capacity)!;
    const lostShare = dem > 0 ? lost / dem : 0;
    // Solo contrata si las ventas perdidas pagan el sueldo con margen (decisión económica, no solo operativa).
    const avgPrice = co.products.reduce((s, p) => s + p.price, 0) / Math.max(1, co.products.length);
    const lostRevenueMonth = (lost / Math.max(1, recent.length)) * 30 * avgPrice * 0.45;
    const wage = roleDef(sec, prodRole.id).baseWage * 100 * state.macro.priceIndex;
    // Se contrata solo si el cuello de botella es la CAPACIDAD (no la falta de insumos o de stock).
    const capacityBound = active.filter((x) => x.lostReason !== '' && !/falta|stock/.test(x.lostReason)).length >= Math.ceil(active.length * 0.6) && util > 0.8;
    if (capacityBound && lostShare > 0.08 && lostRevenueMonth > wage * 1.1 && co.ledger.balances.cash > monthlyPayroll(state, co) * 0.5) {
      // Cuello de botella: ¿producción o atención?
      let role = prodRole.id;
      if (sec.model === 'food_service') {
        const svc = sec.roles.find((r) => r.capacity?.kind === 'service')!;
        const serviceUsed = recent.reduce((s, x) => s + x.serviceUsed, 0) / Math.max(1, recent.length);
        if (cap.service > 0 && serviceUsed / cap.service > util) role = svc.id;
      }
      const c = generateCandidates(state, co, role).sort((a, b) => b.skill / b.wage - a.skill / a.wage)[0];
      if (hire(state, co, c.id, true).ok) changes.push(`contrató ${roleDef(sec, role).name.toLowerCase()}`);
    } else if (util < 0.45 && active.length >= 4) {
      const same = co.employees.filter((e) => e.role === prodRole.id);
      if (same.length > 1) {
        const worst = same.sort((a, b) => a.skill - b.skill)[0];
        if (fire(state, co, worst.id, true).ok) changes.push(`despidió a ${worst.name} por baja utilización`);
      }
    }
  }
  // Marketing de mantenimiento: sin publicidad el conocimiento de marca decae 1 % por día.
  if (d.autoPricing && co.awareness < 30 && !co.campaigns.some((c) => c.endDay >= state.day)) {
    const fixed = monthlyPayroll(state, co);
    const daily = Math.round(Math.max(1000, 1200 * state.macro.priceIndex) * (skill >= 60 ? 1.2 : 1));
    if (co.ledger.balances.cash > fixed + daily * 30 && sec.model !== 'holding') {
      const r = startCampaign(state, co, 'digital', daily, 30, sec.model === 'services' || sec.model === 'subscription' ? 'empresas' : 'general');
      if (r.ok) changes.push('campaña de mantenimiento');
    }
  }
  const staff = changes.filter((c) => c.startsWith('contrató') || c.startsWith('despidió'));
  for (const c of staff) report.push(`${c.charAt(0).toUpperCase()}${c.slice(1)}.`);
  if (changes.includes('campaña de mantenimiento')) report.push('Lanzó una campaña digital de 30 días para sostener el conocimiento de marca.');
  if (staff.length && countRole(co, 'gerente') > 0) {
    coLog(state, co, 'info', '🧭', `el gerente ${staff.join(' y ')}. Nómina mensual: ${fmtMoney(monthlyPayroll(state, co))}.`);
  }
  if (!state.meta.projection) co.managerReport = { day: state.day, items: report.length ? report : ['Sin cambios: todo dentro de lo previsto.'] };
}
