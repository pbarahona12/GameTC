import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { makeGame, forceHire, expectConsistent } from './helpers';
import { advanceDay, simulateDays } from '../src/engine/simulation';
import { usd } from '../src/engine/money';
import { post } from '../src/engine/ledger/ledger';
import { migrate } from '../src/persistence/migrations';
import { serialize, deserialize } from '../src/persistence/save';
import { buyItem, sellItem, equip, priceQuote, canSee, possessionsMonth, resaleValue } from '../src/engine/lifestyle/shops';
import { imageScore, treatment } from '../src/engine/lifestyle/effects';
import { effectiveAmount } from '../src/engine/finance/budget';
import { requestTier, checkTier, quoteInstallments, cardAvailable } from '../src/engine/finance/creditCard';
import { applicationChance } from '../src/engine/career/career';
import { JOB_BY_ID, JOBS } from '../src/content/jobs';
import { ITEM_BY_ID } from '../src/content/shops';
import { publishCandidate, analyzeNews, estimateError } from '../src/engine/world/news';
import { answerPoach } from '../src/engine/world/rivals';
import { foundCompany, foundHolding, transferToGroup } from '../src/engine/business/ownership';
import { monthlyFixed } from '../src/engine/business/common';
import { refreshPropertyListings } from '../src/engine/realestate/realestate';
import { gateActive, openGate } from '../src/engine/progression/unlocks';
import { TUTORIAL } from '../src/engine/progression/tutorial';
import { updateProgression, jurisdictionsPresent } from '../src/engine/progression/progression';
import { evaluateManifest } from '../src/persistence/ota';
import { buildNumber } from '../src/version';
import type { GameState } from '../src/engine/state';
import { dateOf } from '../src/engine/time/calendar';

function rich(seed = 'v12', cash = 200000): GameState {
  const s = makeGame('herencia', seed);
  post(s.ledger, { day: 0, memo: 'Capital de prueba', cf: 'internal', lines: [{ account: 'checking', debit: usd(cash) }, { account: 'opening_equity', credit: usd(cash) }] });
  return s;
}

function untilStatement(s: GameState): void {
  do advanceDay(s);
  while (dateOf(s.day).d !== 26);
}

describe('1.2 · Migración de partidas', () => {
  it('una partida v4 se migra a v5 con tiendas, tarjeta por niveles y mundo, y la contabilidad cuadra', () => {
    const s = makeGame('tecnico', 'mig5');
    forceHire(s, 'ventas_asistente');
    simulateDays(s, 90);
    const raw = JSON.parse(JSON.stringify(s));
    raw.version = 4;
    delete raw.possessions;
    delete raw.world;
    delete raw.saga;
    for (const a of ['personal_assets', 'card_installments', 'card_rewards', 'shopping', 'goods_depreciation']) delete raw.ledger.balances[a];
    for (const k of ['tier', 'feeDay', 'rewardsPending', 'rewardsTotal', 'installments', 'lastTierRequest']) delete raw.bank.card[k];
    const { state, migratedFrom } = migrate(raw);
    expect(migratedFrom).toBe(4);
    // Pasa por todas las migraciones siguientes (1.4: v6 con la historia del magnate).
    expect(state.version).toBe(6);
    expect(state.saga.ranking.magnates.length).toBe(400);
    expect(state.bank.card.tier).toBe('clasica');
    expect(state.possessions.items.length).toBe(3);
    expect(state.world.rivals.length).toBe(4);
    expect(state.tutorial.completed).toContain('income');
    expectConsistent(state);
    simulateDays(state, 120);
    expectConsistent(state);
    const back = deserialize(serialize(state, 1));
    expect(back.ok).toBe(true);
  });
});

describe('1.2 · Tiendas, imagen y bienes', () => {
  it('la ropa es gasto, se pone sola si es mejor y sube la imagen', () => {
    const s = rich('ropa');
    const before = imageScore(s);
    const r = buyItem(s, 'camisa_oxford', 'debito');
    expect(r.ok).toBe(true);
    expect(s.ledger.balances.shopping).toBeGreaterThan(0);
    expect(s.ledger.balances.personal_assets).toBe(0);
    expect(imageScore(s)).toBeGreaterThan(before);
    expectConsistent(s);
  });

  it('un auto es un activo que se deprecia; venderlo registra la diferencia', () => {
    const s = rich('auto');
    expect(buyItem(s, 'auto_usado', 'debito').ok).toBe(true);
    const o = s.possessions.items.find((x) => x.itemId === 'auto_usado')!;
    expect(s.ledger.balances.personal_assets).toBe(o.carrying);
    const c0 = o.carrying;
    possessionsMonth(s);
    expect(o.carrying).toBeLessThan(c0);
    expect(s.ledger.balances.goods_depreciation).toBe(c0 - o.carrying);
    const cash0 = s.ledger.balances.checking;
    const proceeds = resaleValue(o);
    expect(sellItem(s, o.uid).ok).toBe(true);
    expect(s.ledger.balances.checking - cash0).toBe(proceeds);
    expect(s.ledger.balances.personal_assets).toBe(0);
    expectConsistent(s);
  });

  it('con vehículo propio, el transporte del presupuesto pasa a ser el costo del vehículo', () => {
    const s = rich('transporte');
    const it = s.budget.items.find((x) => x.key === 'transport')!;
    const base = effectiveAmount(s, it);
    buyItem(s, 'sedan_0km', 'debito');
    expect(effectiveAmount(s, it)).not.toBe(base);
    expect(effectiveAmount(s, it)).toBeGreaterThan(usd(250));
    buyItem(s, 'cocina', 'debito');
    const food = s.budget.items.find((x) => x.key === 'food')!;
    expect(effectiveAmount(s, food)).toBe(Math.round(food.amount * 0.88));
  });

  it('la imagen mejora la probabilidad en entrevistas de nivel alto', () => {
    const s = rich('entrevista');
    const job = JOBS.find((j) => j.level >= 4)!;
    const p0 = applicationChance(s, job);
    for (const id of ['camisa_medida', 'pantalon_sastre', 'zapatos_cuero', 'traje_completo', 'reloj_clasico']) expect(buyItem(s, id, 'debito').ok).toBe(true);
    expect(imageScore(s)).toBeGreaterThanOrEqual(40);
    expect(applicationChance(s, job)).toBeGreaterThan(p0);
    expect(JOB_BY_ID[job.id]).toBeDefined();
  });

  it('en tiendas de lujo, sin imagen no te muestran la colección exclusiva; con buena imagen hay descuento', () => {
    const s = rich('lujo', 400000);
    const ex = ITEM_BY_ID['abrigo_cashmere'];
    expect(treatment(s, 4)).toBe('frio');
    expect(canSee(s, ex)).toBe(false);
    expect(buyItem(s, 'abrigo_cashmere', 'debito').ok).toBe(false);
    for (const id of ['camisa_medida', 'pantalon_sastre', 'zapatos_cuero', 'traje_completo', 'reloj_clasico']) expect(buyItem(s, id, 'debito').ok).toBe(true);
    expect(imageScore(s)).toBeGreaterThanOrEqual(45);
    expect(canSee(s, ITEM_BY_ID['reloj_alta'])).toBe(true);
    expect(buyItem(s, 'sedan_lujo', 'debito').ok).toBe(true);
    expect(canSee(s, ex)).toBe(true);
    const q = priceQuote(s, ITEM_BY_ID['camisa_oxford']);
    expect(q.discount).toBeGreaterThan(0);
    expect(q.final).toBeLessThan(q.list);
    expectConsistent(s);
  });

  it('equipar solo acepta prendas y la ropa se gasta con el uso', () => {
    const s = rich('gasto');
    buyItem(s, 'buzo_capucha', 'debito');
    const buzo = s.possessions.items.find((x) => x.itemId === 'buzo_capucha')!;
    expect(equip(s, buzo.uid).ok).toBe(true);
    const c0 = buzo.condition;
    possessionsMonth(s);
    expect(buzo.condition).toBe(c0 - 4);
  });
});

describe('1.2 · Tarjetas por niveles, reintegros y cuotas', () => {
  it('sin puntaje ni ingresos no te dan una Oro (y queda la consulta)', () => {
    const s = rich('oro-no');
    const inq = s.credit.inquiries.length;
    const r = requestTier(s, 'oro');
    expect(r.ok).toBe(false);
    expect(s.credit.inquiries.length).toBe(inq + 1);
    expect(requestTier(s, 'oro').ok).toBe(false); // antes de 30 días
  });

  it('con requisitos cumplidos se aprueba, cobra el costo anual y acredita reintegros en el resumen', () => {
    const s = rich('oro-si');
    forceHire(s, 'ventas_gerente', 4200);
    s.day = 400;
    s.credit.score = 760;
    s.credit.firstAccountDay = 0;
    const chk = checkTier(s, 'oro');
    expect(chk.eligible).toBe(true);
    let r = requestTier(s, 'oro');
    for (let i = 0; !r.ok && i < 5; i++) {
      s.bank.card.lastTierRequest = -999;
      r = requestTier(s, 'oro');
    }
    expect(r.ok).toBe(true);
    expect(s.bank.card.tier).toBe('oro');
    expect(s.ledger.balances.bank_fees).toBeGreaterThan(0);
    expect(buyItem(s, 'notebook', 'tarjeta').ok).toBe(true);
    expect(s.bank.card.rewardsPending).toBeGreaterThan(0);
    untilStatement(s);
    expect(s.ledger.balances.card_rewards).toBeGreaterThan(0);
    expect(s.bank.card.rewardsPending).toBe(0);
    expectConsistent(s);
  });

  it('cuotas: sin interés solo si la tienda y el nivel lo permiten; cada resumen pasa una cuota', () => {
    const s = rich('cuotas');
    s.bank.card.limit = usd(5000);
    const qFree = quoteInstallments(s, usd(900), 3, 6);
    expect(qFree.free).toBe(false); // Clásica no tiene cuotas sin interés
    s.bank.card.tier = 'oro';
    expect(quoteInstallments(s, usd(900), 3, 6).free).toBe(true);
    expect(quoteInstallments(s, usd(900), 6, 6).free).toBe(false);
    const avail = cardAvailable(s);
    expect(buyItem(s, 'notebook', 'cuotas', 3).ok).toBe(true);
    const price = s.possessions.items.find((x) => x.itemId === 'notebook')!.price;
    expect(cardAvailable(s)).toBe(avail - price);
    expect(s.ledger.balances.card_installments).toBe(price);
    untilStatement(s);
    expect(s.bank.card.installments[0].paidCount).toBe(1);
    expect(s.ledger.balances.card_installments).toBe(price - Math.ceil(price / 3));
    untilStatement(s);
    untilStatement(s);
    expect(s.ledger.balances.card_installments).toBe(0);
    expect(s.bank.card.installments.length).toBe(0);
    expectConsistent(s);
  });
});

describe('1.2 · Noticias calibradas y análisis', () => {
  it('de las noticias publicadas, la fracción cierta coincide con su confiabilidad', () => {
    const s = rich('calibracion');
    const pub: Array<{ r: number; t: boolean }> = [];
    for (let i = 0; i < 6000; i++) {
      for (const truth of [true, false]) {
        const n = publishCandidate(s, truth, () => ({ kind: 'rumor', topic: 'economia', icon: '📰', title: 'x', body: 'x', reliability: 0, truth, resolveDay: null }));
        if (n) pub.push({ r: n.reliability, t: n.truth });
      }
      s.world.news = [];
    }
    for (const [lo, hi] of [[0.3, 0.5], [0.5, 0.7], [0.7, 0.95]]) {
      const bucket = pub.filter((x) => x.r >= lo && x.r < hi);
      const frac = bucket.filter((x) => x.t).length / bucket.length;
      const mean = bucket.reduce((a, x) => a + x.r, 0) / bucket.length;
      expect(Math.abs(frac - mean)).toBeLessThan(0.04);
    }
  });

  it('con más habilidad, la estimación de confiabilidad se equivoca menos (nunca es exacta)', () => {
    const err = (level: number) => {
      const s = rich('analisis-' + level);
      s.skills.finEdu.level = level;
      let sum = 0;
      for (let i = 0; i < 400; i++) {
        const n = publishCandidate(s, true, () => ({ kind: 'rumor', topic: 'economia', icon: '📰', title: 'x', body: 'x', reliability: 0, truth: true, resolveDay: null }))
          ?? publishCandidate(s, false, () => ({ kind: 'rumor', topic: 'economia', icon: '📰', title: 'x', body: 'x', reliability: 0, truth: false, resolveDay: null }));
        if (!n) continue;
        expect(analyzeNews(s, n.id).ok).toBe(true);
        sum += Math.abs(n.analysis!.estimate - n.reliability);
      }
      return sum / 400;
    };
    const low = err(1);
    const high = err(100);
    expect(high).toBeLessThan(low / 3);
    expect(high).toBeGreaterThan(0);
    expect(estimateError(100)).toBeGreaterThan(0);
  });
});

describe('1.2 · Mercado con vida', () => {
  it('años con empresa: los rivales actúan, se anticipan eventos y la contabilidad cuadra', () => {
    const s = rich('rivales', 400000);
    forceHire(s, 'ventas_asistente');
    expect(foundCompany(s, { sector: 'cafeteria', name: 'Café Test', legalForm: 'srl', capital: usd(120000) }).ok).toBe(true);
    for (let y = 0; y < 5; y++) {
      simulateDays(s, 365);
      expectConsistent(s);
    }
    const moves = s.world.rivals.reduce((a, r) => a + r.moves.length, 0);
    expect(moves).toBeGreaterThan(5);
    const resolved = s.world.news.filter((n) => n.status === 'cumplida' || n.status === 'desmentida');
    expect(resolved.length).toBeGreaterThan(5);
    expect(s.world.news.some((n) => n.topic === 'bolsa')).toBe(true);
  });

  it('igualar una oferta retiene al empleado; dejarlo ir lo saca de la empresa', () => {
    const s = rich('poach', 300000);
    foundCompany(s, { sector: 'cafeteria', name: 'Café Poach', legalForm: 'srl', capital: usd(80000) });
    const co = s.companies[0];
    const [a, b] = co.employees;
    s.world.poach.push({ id: 9001, companyId: co.id, employeeId: a.id, employeeName: a.name, rivalId: 'altamira', wage: a.wage + usd(200), expires: s.day + 10, status: 'abierta' });
    s.world.poach.push({ id: 9002, companyId: co.id, employeeId: b.id, employeeName: b.name, rivalId: 'nexo', wage: b.wage + usd(200), expires: s.day + 10, status: 'abierta' });
    expect(answerPoach(s, 9001, true).ok).toBe(true);
    expect(co.employees.find((e) => e.id === a.id)!.wage).toBe(a.wage);
    expect(answerPoach(s, 9002, false).ok).toBe(true);
    expect(co.employees.some((e) => e.id === b.id)).toBe(false);
    expect(answerPoach(s, 9001, true).ok).toBe(false);
  });

  it('una holding sin subsidiarias cuesta poco; cada subsidiaria suma costos de gestión', () => {
    const s = rich('holding', 300000);
    s.credit.score = 720;
    expect(foundHolding(s, { name: 'Holding Test', legalForm: 'srl', capital: usd(10000) }).ok).toBe(true);
    const h = s.companies[0];
    const empty = monthlyFixed(s, h);
    expect(empty).toBeLessThan(usd(200));
    expect(foundCompany(s, { sector: 'cafeteria', name: 'Café Sub', legalForm: 'srl', capital: usd(60000) }).ok).toBe(true);
    expect(transferToGroup(s, s.companies[1].id, h.id).ok).toBe(true);
    expect(monthlyFixed(s, h)).toBeGreaterThan(empty);
    expectConsistent(s);
  });
});

describe('1.2 · Inmuebles de entrada, misiones, secciones y etapas', () => {
  it('siempre hay una cochera y un estudio baratos a la venta', () => {
    const s = makeGame('herencia', 'entrada');
    for (let m = 0; m < 12; m++) {
      refreshPropertyListings(s);
      expect(s.realEstate.listings.some((l) => l.property.type === 'cochera' && l.askPrice <= usd(26000 * s.macro.priceIndex))).toBe(true);
      expect(s.realEstate.listings.some((l) => l.property.type === 'vivienda' && l.property.m2 <= 34 && l.askPrice <= usd(60000 * s.macro.priceIndex))).toBe(true);
      simulateDays(s, 30);
    }
  });

  it('las misiones dan su recompensa una sola vez', () => {
    const s = makeGame('herencia', 'misiones');
    const xp0 = s.skills.social.xp + s.skills.social.level * 1e6;
    buyItem(s, 'camisa_oxford', 'debito');
    updateProgression(s);
    expect(s.tutorial.completed).toContain('dress');
    const xp1 = s.skills.social.xp + s.skills.social.level * 1e6;
    expect(xp1).toBeGreaterThan(xp0);
    updateProgression(s);
    expect(s.skills.social.xp + s.skills.social.level * 1e6).toBe(xp1);
    expect(new Set(TUTORIAL.map((t) => t.id)).size).toBe(TUTORIAL.length);
  });

  it('las secciones avanzadas recomiendan esperar pero se pueden abrir igual', () => {
    const s = makeGame('herencia', 'gates');
    expect(gateActive(s, 'business', false)).not.toBeNull();
    expect(gateActive(s, 'business', true)).toBeNull();
    openGate(s, 'business');
    expect(gateActive(s, 'business', false)).toBeNull();
  });

  it('la etapa 10 se puede alcanzar: cuenta empresas e inmuebles en varias jurisdicciones', () => {
    const s = rich('juris', 900000);
    expect(jurisdictionsPresent(s)).toBe(0);
    expect(foundCompany(s, { sector: 'cafeteria', name: 'Café Isla', legalForm: 'srl', capital: usd(60000), jurisdiction: 'isla_coral' }).ok).toBe(true);
    expect(foundCompany(s, { sector: 'cafeteria', name: 'Café Local', legalForm: 'srl', capital: usd(60000) }).ok).toBe(true);
    expect(jurisdictionsPresent(s)).toBe(2);
  });
});

describe('1.2 · Actualizaciones por internet', () => {
  const ctx = { webBuild: 10200, nativeCode: 5, failed: [] as number[], manual: false };
  const good = { format: 'urt-ota', version: '1.2.1', build: 10201, minNativeCode: 5, file: 'web-10201.html', sha256: 'a'.repeat(64), size: 10, date: '2026-09-28', notes: [] };
  it('solo ofrece versiones mayores y compatibles con la APK instalada', () => {
    expect(buildNumber('1.2.0')).toBe(10200);
    expect(evaluateManifest(good, ctx).kind).toBe('available');
    expect(evaluateManifest({ ...good, build: 10200 }, ctx).kind).toBe('none');
    expect(evaluateManifest({ ...good, minNativeCode: 6 }, ctx).kind).toBe('needs-apk');
    expect(evaluateManifest(good, { ...ctx, failed: [10201] }).kind).toBe('failed-before');
    expect(evaluateManifest(good, { ...ctx, failed: [10201], manual: true }).kind).toBe('available');
    expect(evaluateManifest({ ...good, file: '../evil.html' }, ctx).kind).toBe('error');
    expect(evaluateManifest({ ...good, sha256: 'xyz' }, ctx).kind).toBe('error');
  });

  it('el puente para las APK 1.2 (ota/ en main) coincide con su archivo y les pide la APK nueva', () => {
    if (!existsSync('ota/manifest.json')) return;
    const m = JSON.parse(readFileSync('ota/manifest.json', 'utf8'));
    const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
    const html = readFileSync(`ota/${m.file}`);
    expect(m.format).toBe('urt-ota');
    expect(m.build).toBeLessThanOrEqual(buildNumber(pkg.version));
    expect(html.length).toBe(m.size);
    expect(createHash('sha256').update(html).digest('hex')).toBe(m.sha256);
    // Una APK 1.2 (versionCode 5, Capacitor 6) nunca instala por internet una página de Capacitor 8.
    expect(evaluateManifest(m, { webBuild: 10200, nativeCode: 5, failed: [], manual: true }).kind).toBe('needs-apk');
  });
});
