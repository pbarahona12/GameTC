import { describe, it, expect } from 'vitest';
import { makeGame, forceHire, expectConsistent } from './helpers';
import { advanceDay } from '../src/engine/simulation';
import { post } from '../src/engine/ledger/ledger';
import { usd } from '../src/engine/money';
import { grantAdReward, adRewardsLeft, adRewardsBlocked, AD_REWARDS, STUDY_SKIP_DAYS, type AdRewardKind } from '../src/engine/rewards';
import { balanceSheet } from '../src/engine/reports/statements';
import { newGame } from '../src/engine/state';
import { enroll, tuition } from '../src/engine/skills/education';
import { analyzeNews, estimateError } from '../src/engine/world/news';
import { COURSE_BY_ID } from '../src/content/courses';
import { JOBS } from '../src/content/jobs';

const rich = (seed: string) => {
  const s = makeGame('herencia', seed);
  post(s.ledger, { day: 0, memo: 'Capital', cf: 'internal', lines: [{ account: 'checking', debit: usd(50000) }, { account: 'opening_equity', credit: usd(50000) }] });
  return s;
};

describe('Recompensas por anuncio', () => {
  it('el análisis preciso reduce a la mitad el error de UN análisis y no se acumula', () => {
    const s = rich('ad-news');
    for (let d = 0; d < 400 && !s.world.news.some((n) => n.status === 'abierta' && n.kind !== 'hecho' && n.kind !== 'oficial'); d++) advanceDay(s);
    const n = s.world.news.find((x) => x.status === 'abierta' && x.kind !== 'hecho' && x.kind !== 'oficial')!;
    expect(n).toBeTruthy();
    expect(grantAdReward(s, 'news', '2026-10-02').ok).toBe(true);
    expect(grantAdReward(s, 'news', '2026-10-02').ok).toBe(false);
    const r = analyzeNews(s, n.id);
    expect(r.ok && r.message).toMatch(/análisis preciso/);
    expect(s.meta.ads?.newsBoost).toBe(false);
    // Con la mitad del error, la estimación cae dentro de ±3 errores típicos reducidos.
    expect(Math.abs(n.analysis!.estimate - n.reliability)).toBeLessThanOrEqual(estimateError(n.analysis!.skill) * 0.5 * 4 + 0.01);
  });

  it('adelantar estudio corre el curso hasta 3 meses y cobra las matrículas de esos meses', () => {
    const s = rich('ad-study');
    s.education.level = 'secundaria';
    const c = COURSE_BY_ID['tec_informatica'];
    const r0 = enroll(s, c.id);
    expect(r0.ok, r0.ok ? '' : r0.error).toBe(true);
    for (let d = 0; d < 10; d++) advanceDay(s);
    const a = s.education.active[0];
    const end = a.endDay;
    const checking = s.ledger.balances.checking + s.ledger.balances.savings;
    expect(grantAdReward(s, 'study', '2026-10-02', { courseId: c.id }).ok).toBe(true);
    expect(a.endDay).toBe(end - STUDY_SKIP_DAYS);
    // Elapsed 10 → 100: matrículas de los días 30, 60 y 90.
    expect(checking - (s.ledger.balances.checking + s.ledger.balances.savings)).toBe(tuition(s, c) * 3);
    expect(grantAdReward(s, 'study', '2026-10-02', { courseId: c.id }).ok).toBe(false); // 1 por día
    advanceDay(s);
    expectConsistent(s);
  });

  it('sin cursos en curso no hay nada que adelantar', () => {
    const s = rich('ad-nostudy');
    expect(grantAdReward(s, 'study', '2026-10-02').ok).toBe(false);
    expect(adRewardsLeft(s, 'study', '2026-10-02')).toBe(1);
  });
});

describe('Fase 0 · E9 (auditoría D5): los anuncios no crean dinero ni perdonan deudas', () => {
  const OLD_KINDS = ['cash', 'debt'] as unknown as AdRewardKind[];

  it('las recompensas viejas de dinero y de deuda ya no existen ni tocan el libro mayor', async () => {
    const { takeLoan } = await import('../src/engine/finance/loans');
    const { BANKS } = await import('../src/content/banks');
    const s = rich('ad-removed');
    forceHire(s, JOBS[0].id);
    s.credit.score = 760;
    let ok = false;
    for (const b of BANKS) if (!ok) ok = takeLoan(s, b.id, usd(4000), 24).ok;
    expect(ok).toBe(true);
    const loan = s.bank.loans[s.bank.loans.length - 1];
    const balances = JSON.stringify(s.ledger.balances);
    const loanBefore = loan.balance;
    for (const kind of OLD_KINDS) {
      expect(Object.keys(AD_REWARDS)).not.toContain(kind);
      expect(adRewardsLeft(s, kind, '2026-10-02')).toBe(0);
      for (let i = 0; i < 3; i++) expect(grantAdReward(s, kind, '2026-10-02', { loanId: loan.id } as never).ok).toBe(false);
    }
    expect(JSON.stringify(s.ledger.balances)).toBe(balances);
    expect(loan.balance).toBe(loanBefore);
    expectConsistent(s);
  });

  it('el ciclo de la auditoría (préstamo máximo + anuncios durante 10 días reales) no aumenta el patrimonio', async () => {
    const { takeLoan } = await import('../src/engine/finance/loans');
    const { BANKS } = await import('../src/content/banks');
    const play = (withAds: boolean) => {
      const s = makeGame('egresado', 'ad-cycle');
      forceHire(s, JOBS[0].id);
      s.credit.score = 760;
      for (const b of BANKS) takeLoan(s, b.id, usd(10000), 24);
      for (let realDay = 1; realDay <= 10; realDay++) {
        const today = `2026-10-${String(realDay).padStart(2, '0')}`;
        if (withAds) for (const kind of [...Object.keys(AD_REWARDS), 'cash', 'debt'] as AdRewardKind[]) for (let i = 0; i < 3; i++) grantAdReward(s, kind, today);
        for (let d = 0; d < 30; d++) advanceDay(s);
      }
      expectConsistent(s);
      return balanceSheet(s).netWorth;
    };
    // Con anuncios, el patrimonio no puede superar al de la misma partida sin anuncios.
    expect(play(true)).toBeLessThanOrEqual(play(false));
  });

  it('durante un desafío con semilla no hay recompensas; al terminarlo vuelven', async () => {
    const { CHALLENGES } = await import('../src/engine/saga/challenges');
    const s = newGame({ name: 'Tester', background: 'egresado', style: 'libre', seed: 'ad-challenge', nowReal: 1, challenge: CHALLENGES[0].id });
    expect(s.saga.challenge?.id).toBe(CHALLENGES[0].id);
    expect(adRewardsBlocked(s)).toMatch(/desafío/);
    for (const kind of Object.keys(AD_REWARDS) as AdRewardKind[]) {
      expect(adRewardsLeft(s, kind, '2026-10-02')).toBe(0);
      expect(grantAdReward(s, kind, '2026-10-02').ok).toBe(false);
    }
    expect(s.meta.ads?.newsBoost ?? false).toBe(false);
    s.saga.challenge!.failed = true;
    expect(adRewardsBlocked(s)).toBeNull();
    expect(grantAdReward(s, 'news', '2026-10-02').ok).toBe(true);
  });

  it('las recompensas que quedan tampoco crean dinero (el estudio cobra la matrícula como siempre)', () => {
    const s = rich('ad-nomoney');
    s.education.level = 'secundaria';
    const r0 = enroll(s, 'tec_informatica');
    expect(r0.ok).toBe(true);
    const nw = balanceSheet(s).netWorth;
    expect(grantAdReward(s, 'news', '2026-10-02').ok).toBe(true);
    expect(grantAdReward(s, 'study', '2026-10-02', { courseId: 'tec_informatica' }).ok).toBe(true);
    expect(balanceSheet(s).netWorth).toBeLessThanOrEqual(nw);
    expectConsistent(s);
  });
});
