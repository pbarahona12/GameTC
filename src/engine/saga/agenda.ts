import type { GameState } from '../state';
import { JOB_BY_ID } from '../../content/jobs';
import { fmtMoney } from '../format';
import { statementRemaining } from '../finance/creditCard';
import { dilemmaView } from './dilemmas';
import { spendable } from '../finance/payments';
import { isOpen } from '../business/common';

/**
 * AGENDA DE PENDIENTES (1.4): todo lo que espera una respuesta tuya, en un solo
 * lugar y ordenado por vencimiento. Los datos ya existían repartidos en Carrera,
 * Competencia, Noticias, Legal, Finanzas y cada empresa; acá se juntan.
 * Es una vista (no guarda nada): se calcula desde la partida.
 */
export type AgendaTarget =
  | { kind: 'tab'; tab: 'home' | 'career' | 'finance' | 'invest' | 'business' | 'more' | 'reports'; sub?: string }
  | { kind: 'dilemma'; id: number };

export interface AgendaItem {
  key: string;
  icon: string;
  title: string;
  detail: string;
  /** Día límite (null = sin fecha). */
  due: number | null;
  tone: 'danger' | 'warning' | 'info' | 'opportunity';
  target: AgendaTarget;
}

export function agenda(s: GameState): AgendaItem[] {
  const out: AgendaItem[] = [];
  // Decisiones con plazo.
  for (const d of s.saga?.dilemmas.open ?? []) {
    const v = dilemmaView(s, d);
    if (v) out.push({ key: `dil:${d.id}`, icon: v.icon, title: v.title, detail: `${v.options.length} opciones`, due: d.deadline, tone: 'warning', target: { kind: 'dilemma', id: d.id } });
  }
  // Ofertas de empleo.
  for (const a of s.career.applications) {
    if (a.status !== 'offer' || a.offerExpiresDay === undefined) continue;
    const job = JOB_BY_ID[a.jobId];
    out.push({ key: `job:${a.id}`, icon: 'mail', title: `Oferta: ${job?.title ?? 'empleo'}`, detail: `${job?.employer ?? ''} · ${fmtMoney(a.offerSalary ?? 0, { decimals: false })}/mes`, due: a.offerExpiresDay, tone: 'opportunity', target: { kind: 'tab', tab: 'career', sub: 'job' } });
  }
  // Rivales: tentaciones a tus empleados y ofertas por tus empresas.
  for (const p of s.world.poach) {
    if (p.status !== 'abierta') continue;
    const co = s.companies.find((c) => c.id === p.companyId);
    out.push({ key: `poach:${p.id}`, icon: 'poach', title: `Quieren llevarse a ${p.employeeName}`, detail: `${co?.name ?? ''} · le ofrecen ${fmtMoney(p.wage, { decimals: false })}/mes`, due: p.expires, tone: 'warning', target: { kind: 'tab', tab: 'more', sub: 'rivals' } });
  }
  for (const c of s.companies) {
    if (!c.saleOffer || c.saleOffer.expires < s.day || !c.saleOffer.from) continue;
    out.push({ key: `offer:${c.id}`, icon: 'deal', title: `${c.saleOffer.from} quiere comprar ${c.name}`, detail: `Ofrece ${fmtMoney(c.saleOffer.price, { decimals: false })}`, due: c.saleOffer.expires, tone: 'opportunity', target: { kind: 'tab', tab: 'business', sub: `co:${c.id}:manage` } });
  }
  // Legal: inspecciones y multas.
  for (const i of s.legal.inspections) {
    if (i.resolved) continue;
    const co = s.companies.find((c) => c.id === i.companyId);
    out.push({ key: `insp:${i.id}`, icon: 'legal', title: `Inspección en ${co?.name ?? 'tu empresa'}`, detail: `${i.reason} · multa ${fmtMoney(i.fine, { decimals: false })}`, due: i.dueDay, tone: 'danger', target: { kind: 'tab', tab: 'more', sub: 'legal' } });
  }
  for (const f of s.legal.fines) {
    if (f.balance <= 0 || f.installment) continue;
    out.push({ key: `fine:${f.id}`, icon: 'legal', title: `Multa: ${f.label}`, detail: `Saldo ${fmtMoney(f.balance, { decimals: false })}`, due: f.dueDay, tone: 'danger', target: { kind: 'tab', tab: 'more', sub: 'legal' } });
  }
  // Impuestos y tarjeta.
  for (const f of s.tax.filings) {
    if (f.status !== 'due' || f.outstanding <= 0) continue;
    out.push({ key: `tax:${f.year}`, icon: 'tax', title: `Impuestos ${f.year} por pagar`, detail: fmtMoney(f.outstanding, { decimals: false }), due: f.dueDay, tone: 'warning', target: { kind: 'tab', tab: 'more', sub: 'tax' } });
  }
  const card = s.bank.card;
  const rest = statementRemaining(s);
  if (card.active && card.dueDay >= s.day && rest > 0 && card.autopay !== 'full') {
    out.push({ key: 'card', icon: 'card', title: 'Resumen de la tarjeta', detail: `Pagá ${fmtMoney(rest, { decimals: false })} completo para no pagar intereses`, due: card.dueDay, tone: spendable(s) < rest ? 'danger' : 'info', target: { kind: 'tab', tab: 'finance', sub: 'card' } });
  }
  // Rumores que te tocan (tus sectores o algo que podrías comprar) y oportunidades con fecha.
  const mySectors = new Set(s.companies.filter((c) => isOpen(c)).map((c) => c.sector));
  for (const n of s.world.news) {
    if (n.status !== 'abierta' || n.resolveDay === null) continue;
    const mine = (n.ref?.sector && mySectors.has(n.ref.sector)) || n.ref?.listingId !== undefined || n.ref?.propertyListingId !== undefined;
    if (!mine) continue;
    out.push({ key: `news:${n.id}`, icon: 'news', title: n.title, detail: n.analysis ? `Tu estimación: ~${Math.round(n.analysis.estimate * 100)} % de que sea cierto` : 'Rumor sin analizar', due: n.resolveDay, tone: 'info', target: { kind: 'tab', tab: 'more', sub: 'news' } });
  }
  for (const l of s.realEstate.listings) {
    if (!l.note.startsWith('Remate judicial')) continue;
    out.push({ key: `remate:${l.id}`, icon: 'realestate', title: `Remate: ${l.property.name}`, detail: `Base ${fmtMoney(l.askPrice, { decimals: false })}`, due: l.expiresDay, tone: 'opportunity', target: { kind: 'tab', tab: 'invest', sub: 'realestate' } });
  }
  return out.sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity));
}
