import { makeGame, expectConsistent } from './helpers';
import { advanceDay } from '../src/engine/simulation';
import { post, entryDelta } from '../src/engine/ledger/ledger';
import { CASH_ACCOUNTS } from '../src/engine/ledger/accounts';
import { usd } from '../src/engine/money';
import { nextRandom, randInt, RngHolder, seedFromString } from '../src/engine/rng';
import type { GameState } from '../src/engine/state';
import { isLastDayOfMonth } from '../src/engine/time/calendar';
import { balanceSheet, incomeStatement, cashFlowStatement } from '../src/engine/reports/statements';
import { analyze } from '../src/engine/advisor/advisor';
import { placeStockOrder, placeBracket, cancelOrder } from '../src/engine/invest/stocks';
import { buyBond, sellBond } from '../src/engine/invest/bonds';
import { buyFund, sellFund } from '../src/engine/invest/funds';
import { buyMogul, sellMogul } from '../src/engine/invest/mogul';
import { buyProperty, sellProperty, setRent, renovate, setUse, marketRent, prepayMortgage, setManagement, inspectListing } from '../src/engine/realestate/realestate';
import { foundCompany, foundHolding, transferToGroup, spinOff, liquidate, distribute, maxDistribution } from '../src/engine/business/ownership';
import { grantIcLoan, setGroupPolicy } from '../src/engine/business/groups';
import { hirePro, firePro, commissionAudit, trainPro } from '../src/engine/pros/pros';
import { activeMandates, openMandate, depositMandate, withdrawMandate, setMandateProfile } from '../src/engine/invest/managed';
import { setUnderreport, startVenture, depositUndeclared, launderThroughCompany, bribe, skimCash, voluntaryDisclosure, payFine, finePlan, prepareDefense, assignLawyer, acceptPlea, setCompanyIrregular, resolveInspection } from '../src/engine/legal/legal';
import { requestResidence } from '../src/engine/tax/taxEngine';
import { openDeposit } from '../src/engine/finance/banking';
import { buyItem, sellItem, equip } from '../src/engine/lifestyle/shops';
import { ITEMS } from '../src/content/shops';
import { requestTier, payCard } from '../src/engine/finance/creditCard';
import { analyzeNews } from '../src/engine/world/news';
import { answerPoach } from '../src/engine/world/rivals';
import { dilemmaView, decide } from '../src/engine/saga/dilemmas';
import { mergeCompanies, issueBonds, bondCapacity, goPublic, acquireRival, buyBackShares } from '../src/engine/saga/corporate';
import { hireExecTeam, dismissExecTeam } from '../src/engine/saga/executive';
import { possibleDeals, signDeal } from '../src/engine/saga/integration';
import { createFoundation, donateToFoundation, succession, heirs, life } from '../src/engine/saga/life';
import { startPriceWar } from '../src/engine/saga/rivalry';
import { investSurplus } from '../src/engine/saga/quick';

/**
 * AUDITORÍA INTEGRAL: bots que toman decisiones aleatorias en TODOS los
 * sistemas (bolsa, bonos, fondos, Mogul, inmuebles, hipotecas, empresas,
 * holdings, profesionales, jurisdicciones y actividades ilegales ficticias)
 * durante años de juego. Cada fin de mes se exige:
 *  - invariantes contables y de todos los subregistros;
 *  - Δ patrimonio neto = resultado neto del mes (nada aparece ni desaparece);
 *  - flujo de caja: apertura + operativo + inversión + financiamiento = cierre;
 *  - el asesor produce análisis con datos.
 */
function pickOne<T>(bot: RngHolder, arr: T[]): T | undefined {
  return arr.length ? arr[randInt(bot, 0, arr.length - 1)] : undefined;
}

function worldAction(s: GameState, bot: RngHolder): void {
  const r = nextRandom(bot);
  const stock = pickOne(bot, s.stocks.stocks.filter((x) => x.status === 'activa'));
  const cos = s.companies.filter((c) => c.status === 'active' || c.status === 'insolvent');
  const co = pickOne(bot, cos);
  if (r < 0.1 && stock) placeStockOrder(s, { stockId: stock.id, side: 'compra', type: 'mercado', qty: randInt(bot, 1, 150) });
  else if (r < 0.15) {
    const h = pickOne(bot, Object.keys(s.stocks.holdings));
    if (h) placeStockOrder(s, { stockId: h, side: 'venta', type: nextRandom(bot) < 0.5 ? 'mercado' : 'limite', qty: Math.max(1, Math.floor(s.stocks.holdings[h].qty / 2)), limit: Math.round(s.stocks.stocks.find((x) => x.id === h)!.price * 1.03) });
  } else if (r < 0.18) {
    const h = pickOne(bot, Object.keys(s.stocks.holdings));
    const st = s.stocks.stocks.find((x) => x.id === h);
    if (h && st) placeBracket(s, h, s.stocks.holdings[h].qty, Math.round(st.price * 0.93), Math.round(st.price * 1.08));
  } else if (r < 0.2) {
    const o = pickOne(bot, s.stocks.orders.filter((x) => x.status === 'abierta'));
    if (o) cancelOrder(s, o.id);
  } else if (r < 0.25) {
    const b = pickOne(bot, s.bonds.issues.filter((x) => x.status === 'vigente'));
    if (b) buyBond(s, b.id, randInt(bot, 1, 8));
  } else if (r < 0.27) {
    const h = pickOne(bot, Object.keys(s.bonds.holdings));
    if (h) sellBond(s, h, 1);
  } else if (r < 0.32) {
    const f = pickOne(bot, s.funds.funds);
    if (f) buyFund(s, f.id, usd(randInt(bot, 100, 4000)));
  } else if (r < 0.34) {
    const h = pickOne(bot, Object.keys(s.funds.holdings));
    if (h) sellFund(s, h, s.funds.holdings[h].qty * nextRandom(bot));
  } else if (r < 0.38) {
    const a = pickOne(bot, s.mogul.assets.filter((x) => x.status === 'activo'));
    if (a) buyMogul(s, a.id, Math.max(0.01, Math.round((usd(randInt(bot, 500, 5000)) / a.nav) * 100) / 100));
  } else if (r < 0.4) {
    const h = pickOne(bot, Object.keys(s.mogul.holdings));
    if (h) sellMogul(s, h, s.mogul.holdings[h].qty);
  } else if (r < 0.46) {
    const l = pickOne(bot, s.realEstate.listings);
    if (l) {
      if (nextRandom(bot) < 0.3) inspectListing(s, l.id);
      const owner = co && nextRandom(bot) < 0.3 ? { kind: 'company' as const, id: co.id } : { kind: 'personal' as const };
      const fin = nextRandom(bot) < 0.5 ? { bankId: owner.kind === 'company' ? 'austral_corp' : 'andina_hipo', amount: Math.round(l.askPrice * 0.5), years: 15, rateType: (nextRandom(bot) < 0.5 ? 'fija' : 'variable') as 'fija' | 'variable' } : null;
      buyProperty(s, l.id, { owner, financing: fin, offer: nextRandom(bot) < 0.3 ? Math.round(l.askPrice * 0.93) : undefined });
    }
  } else if (r < 0.5) {
    const p = pickOne(bot, s.realEstate.properties);
    if (p) {
      const k = nextRandom(bot);
      if (k < 0.35) setRent(s, p.id, Math.round(marketRent(s, p) * (0.9 + nextRandom(bot) * 0.3)));
      else if (k < 0.45) renovate(s, p.id, 'ligera');
      else if (k < 0.55) setManagement(s, p.id, nextRandom(bot) < 0.5 ? 'agencia' : 'propia');
      else if (k < 0.65) setUse(s, p.id, p.owner.kind === 'personal' ? 'jugador' : p.owner.kind === 'company' ? p.owner.id : null);
      else if (k < 0.75 && p.mortgageId) prepayMortgage(s, p.mortgageId, usd(2000));
      else if (k < 0.9) sellProperty(s, p.id, 'publicar', Math.round(p.appraisal * 1.02));
      else sellProperty(s, p.id, 'rapida');
    }
  } else if (r < 0.54) {
    const sectors = ['cafeteria', 'minimarket', 'saas', 'muebles', 'consultora'] as const;
    if (cos.length < 5) foundCompany(s, { sector: sectors[randInt(bot, 0, 4)], name: `Empresa ${s.day}`, legalForm: nextRandom(bot) < 0.7 ? 'srl' : 'individual', capital: usd(randInt(bot, 25000, 60000)), jurisdiction: nextRandom(bot) < 0.2 ? 'meridia' : undefined });
  } else if (r < 0.56) {
    if (!cos.some((c) => c.sector === 'holding')) foundHolding(s, { name: `Holding ${s.day}`, legalForm: 'srl', capital: usd(15000) });
  } else if (r < 0.59) {
    const h = cos.find((c) => c.sector === 'holding');
    const sub = pickOne(bot, cos.filter((c) => c.sector !== 'holding' && !c.parentId));
    if (h && sub) transferToGroup(s, sub.id, h.id);
    if (h && nextRandom(bot) < 0.3) setGroupPolicy(s, h.id, { upstreamPayout: nextRandom(bot), cashPooling: nextRandom(bot) < 0.5 });
  } else if (r < 0.61) {
    const h = cos.find((c) => c.sector === 'holding');
    const sub = pickOne(bot, cos.filter((c) => c.parentId === h?.id));
    if (h && sub) {
      if (nextRandom(bot) < 0.6) grantIcLoan(s, h.id, sub.id, usd(randInt(bot, 500, 5000)), 0.04, 12);
      else spinOff(s, sub);
    }
  } else if (r < 0.63) {
    if (co && nextRandom(bot) < 0.3) liquidate(s, co, 'voluntary');
    else if (co) {
      const m = maxDistribution(s, co).max;
      if (m > 0) distribute(s, co, Math.round(m * nextRandom(bot)) || 1);
    }
  } else if (r < 0.67) {
    const pro = pickOne(bot, s.pros.market);
    if (pro?.kind === 'auditor' && co) commissionAudit(s, co.id, pro.id);
    else if (pro) hirePro(s, pro.id, pro.kind === 'gerente' || (co && nextRandom(bot) < 0.3 && pro.kind !== 'asesor') ? co?.id ?? 'personal' : 'personal');
    const h = pickOne(bot, s.pros.hires);
    if (h && nextRandom(bot) < 0.2) firePro(s, h.id);
  } else if (r < 0.7) {
    setUnderreport(s, [0, 0, 0.25, 0.5][randInt(bot, 0, 3)]);
    if (co && nextRandom(bot) < 0.3) setCompanyIrregular(s, co.id, { underreport: nextRandom(bot) < 0.5 ? 0.3 : 0, inflatedBooks: nextRandom(bot) < 0.2 ? 0.3 : 0 });
  } else if (r < 0.73) {
    const k = nextRandom(bot);
    if (k < 0.3) startVenture(s, ['contrabando', 'apuestas', 'falsificados'][randInt(bot, 0, 2)], usd(randInt(bot, 500, 5000)));
    else if (k < 0.5 && s.ledger.balances.undeclared_cash > 0) depositUndeclared(s, Math.round(s.ledger.balances.undeclared_cash / 2) || 1);
    else if (k < 0.65 && co && s.ledger.balances.undeclared_cash > 0) launderThroughCompany(s, co.id, Math.round(s.ledger.balances.undeclared_cash / 2) || 1);
    else if (k < 0.75 && co) bribe(s, 'contrato', co.id);
    else if (k < 0.85 && co) skimCash(s, co.id, usd(randInt(bot, 100, 2000)));
    else {
      const a = pickOne(bot, s.legal.acts.filter((x) => x.status === 'oculto' && (x.kind === 'evasion' || x.kind === 'evasion_empresa')));
      if (a) voluntaryDisclosure(s, a.id);
    }
  } else if (r < 0.76) {
    const f = pickOne(bot, s.legal.fines.filter((x) => x.balance > 0));
    if (f) {
      if (nextRandom(bot) < 0.5) payFine(s, f.id);
      else finePlan(s, f.id);
    }
    const c = pickOne(bot, s.legal.cases.filter((x) => x.stage !== 'cerrado'));
    if (c) {
      const lawyer = s.pros.hires.find((h) => h.pro.kind === 'abogado');
      if (lawyer) assignLawyer(s, c.id, lawyer.id);
      if (c.stage === 'imputacion' && nextRandom(bot) < 0.5) acceptPlea(s, c.id);
      else prepareDefense(s, c.id);
    }
    const i = pickOne(bot, s.legal.inspections.filter((x) => !x.resolved));
    if (i) resolveInspection(s, i.id, ['pagar', 'impugnar', 'sobornar'][randInt(bot, 0, 2)] as 'pagar');
  } else if (r < 0.77) {
    requestResidence(s, ['valdoria', 'norvalia', 'meridia', 'isla_coral'][randInt(bot, 0, 3)] as 'valdoria');
  } else if (r < 0.8) {
    openDeposit(s, usd(randInt(bot, 200, 3000)), 6);
  } else if (r < 0.84) {
    // Gestor de inversiones (v1.1): contratar, abrir, aportar, retirar, cambiar perfil, capacitar o despedir.
    const g = s.pros.hires.find((h) => h.pro.kind === 'gestor');
    if (!g) {
      const p = s.pros.market.find((x) => x.kind === 'gestor');
      if (p) hirePro(s, p.id, 'personal');
    } else {
      const m = activeMandates(s).find((x) => x.hireId === g.id);
      const k = nextRandom(bot);
      if (!m) openMandate(s, g.id, usd(randInt(bot, 2500, 20000)), (['conservador', 'moderado', 'agresivo'] as const)[randInt(bot, 0, 2)]);
      else if (k < 0.35) depositMandate(s, m.id, usd(randInt(bot, 200, 5000)));
      else if (k < 0.6) withdrawMandate(s, m.id, usd(randInt(bot, 200, 4000)));
      else if (k < 0.75) setMandateProfile(s, m.id, (['conservador', 'moderado', 'agresivo'] as const)[randInt(bot, 0, 2)]);
      else if (k < 0.9) trainPro(s, g.id);
      else firePro(s, g.id);
    }
  } else if (r < 0.9) {
    // 1.2: tiendas, bienes, tarjetas por niveles, cuotas y vestidor.
    const k = nextRandom(bot);
    if (k < 0.45) {
      const it = pickOne(bot, ITEMS);
      const method = (['debito', 'tarjeta', 'cuotas', 'efectivo'] as const)[randInt(bot, 0, 3)];
      if (it) buyItem(s, it.id, method, [3, 6, 12][randInt(bot, 0, 2)]);
    } else if (k < 0.6) {
      const o = pickOne(bot, s.possessions.items.filter((x) => x.uid > 0));
      if (o) sellItem(s, o.uid);
    } else if (k < 0.7) {
      const o = pickOne(bot, s.possessions.items);
      if (o) equip(s, o.uid);
    } else if (k < 0.8) {
      requestTier(s, (['clasica', 'oro', 'platino', 'black'] as const)[randInt(bot, 0, 3)]);
      s.bank.card.lastTierRequest = -999;
    } else if (k < 0.9) {
      const n = pickOne(bot, s.world.news.filter((x) => x.status === 'abierta'));
      if (n) analyzeNews(s, n.id);
    } else {
      const p = pickOne(bot, s.world.poach.filter((x) => x.status === 'abierta'));
      if (p) answerPoach(s, p.id, nextRandom(bot) < 0.5);
      else if (s.bank.card.dueDay >= 0) payCard(s, s.bank.card.statementBalance);
    }
  } else if (r < 0.92) {
    const l = pickOne(bot, s.realEstate.listings.filter((x) => x.property.type === 'cochera'));
    if (l) buyProperty(s, l.id, { owner: { kind: 'personal' } });
  } else if (r < 0.97) {
    sagaAction(s, bot);
  }
}

/** 1.4: decisiones con plazo, fusiones, bonos, equipo directivo, proveedores propios, legado y rivalidad. */
function sagaAction(s: GameState, bot: RngHolder): void {
  const k = nextRandom(bot);
  const mine = s.companies.filter((c) => (c.status === 'active' || c.status === 'insolvent') && !c.npc);
  if (k < 0.3) {
    const d = pickOne(bot, s.saga.dilemmas.open);
    const v = d ? dilemmaView(s, d) : null;
    const o = v ? pickOne(bot, v.options.filter((x) => !x.blocked)) : undefined;
    if (d && o) decide(s, d.id, o.id);
  } else if (k < 0.4) {
    const a = pickOne(bot, mine);
    const b = a ? pickOne(bot, mine.filter((c) => c.id !== a.id && c.sector === a.sector)) : undefined;
    if (a && b) mergeCompanies(s, a.id, b.id);
  } else if (k < 0.5) {
    const co = pickOne(bot, mine);
    if (co) issueBonds(s, co.id, Math.max(usd(500_000), Math.round(bondCapacity(s, co) / 2)), [3, 5, 10][randInt(bot, 0, 2)]);
    if (co) goPublic(s, co.id, 0.2);
    if (co?.listed) buyBackShares(s, co, 0.05);
  } else if (k < 0.6) {
    if (s.saga.exec?.hired) dismissExecTeam(s);
    else hireExecTeam(s);
  } else if (k < 0.7) {
    const p = pickOne(bot, possibleDeals(s));
    if (p) signDeal(s, p.kind, p.supplier.id, p.buyer.id);
  } else if (k < 0.8) {
    if (!life(s).foundation) createFoundation(s, 'Fundación Bot');
    else donateToFoundation(s, usd(randInt(bot, 100, 5000)));
    investSurplus(s);
  } else if (k < 0.9) {
    const r = pickOne(bot, s.world.rivals.filter((x) => !x.acquired));
    const co = pickOne(bot, mine.filter((c) => r && r.sectors.includes(c.sector)));
    if (r && co) startPriceWar(s, r, co.sector, randInt(bot, 60, 200));
    if (r && s.progression.stage >= 8) acquireRival(s, r.id);
  } else {
    // Sucesión de vez en cuando (envejecemos al personaje para probarla).
    if (nextRandom(bot) < 0.2) {
      life(s).birthDay = s.day - Math.round(61 * 365.25);
      succession(s, heirs(s)[0].id, 'retiro');
    }
  }
}

/**
 * Escala de la prueba de caos. Por defecto (en cada `npm test`): 3 semillas × 3 años.
 * La corrida larga (`npm run chaos`, semanal en el CI) usa 50 semillas × 20 años.
 */
const CHAOS_SEEDS = Math.max(1, Number(process.env.URT_CHAOS_SEEDS ?? 3));
const CHAOS_YEARS = Math.max(1, Number(process.env.URT_CHAOS_YEARS ?? 3));

describe('Auditoría integral de todos los sistemas (bots aleatorios)', () => {
  for (const seed of Array.from({ length: CHAOS_SEEDS }, (_, i) => `w${i + 1}`)) {
    it(`semilla ${seed}: ${CHAOS_YEARS} años con decisiones aleatorias en inversiones, inmuebles, grupos, profesionales y sistema legal`, () => {
      const s = makeGame('herencia', 'world-audit-' + seed);
      post(s.ledger, { day: 0, memo: 'Capital de prueba', cf: 'internal', lines: [{ account: 'checking', debit: usd(400000) }, { account: 'opening_equity', credit: usd(400000) }] });
      s.credit.score = 720;
      const bot = { rng: seedFromString(`bot|${seed}`) };
      let monthStart = s.day + 1;
      let nw0 = balanceSheet(s).netWorth;
      let actions = 0;
      while (s.day < CHAOS_YEARS * 365) {
        advanceDay(s);
        if (nextRandom(bot) < 0.45) {
          worldAction(s, bot);
          actions++;
        }
        if (isLastDayOfMonth(s.day)) {
          expectConsistent(s);
          const is = incomeStatement(s, monthStart, s.day);
          const nw1 = balanceSheet(s).netWorth;
          expect(nw1 - nw0).toBe(is.netResult);
          const cf = cashFlowStatement(s, monthStart, s.day);
          if (cf.opening + cf.totalOperating + cf.totalInvesting + cf.totalFinancing !== cf.closing) {
            const bad = s.ledger.entries.filter((e) => e.day >= monthStart && e.cf === 'internal' && CASH_ACCOUNTS.reduce((a, acc) => a + entryDelta(e, acc), 0) !== 0);
            throw new Error('Flujo de caja no concilia; asientos internos que mueven caja: ' + bad.map((e) => `${e.memo} [${e.tag}]`).join('; '));
          }
          for (const i of analyze(s)) expect(i.data.length).toBeGreaterThan(0);
          monthStart = s.day + 1;
          nw0 = nw1;
        }
      }
      if (process.env.URT_CHAOS_STATS) console.log(seed, JSON.stringify({ fusiones: s.formerCompanies.filter((f) => f.outcome === 'fusionada').length, bonos: s.companies.reduce((a, c) => a + c.loans.filter((l) => l.bullet).length, 0), cotizadas: s.companies.filter((c) => c.listed).length, guerras: s.saga.rivalry?.warsSurvived ?? 0, generacion: s.saga.life?.generation, decisiones: s.saga.stats.decisions, equipo: !!s.saga.exec?.hired, acuerdos: s.saga.deals?.length ?? 0, empresas: s.companies.length, etapa: s.progression.stage }));
      expect(actions).toBeGreaterThan(100 * CHAOS_YEARS);
      expect(s.stocks.trades.length).toBeGreaterThan(10);
      expect(s.possessions.spent).toBeGreaterThan(0);
    }, 30_000 * CHAOS_YEARS);
  }
});
