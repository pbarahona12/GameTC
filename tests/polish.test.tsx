// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { GameStore } from '../src/ui/store';
import { exportToFile } from '../src/persistence/platformStorage';
import { needsExportReminder, EXPORT_REMINDER, type SlotMeta } from '../src/persistence/slots';
import { listingGrossYield, listingRent, marketRent } from '../src/engine/realestate/realestate';
import { makeGame, expectConsistent } from './helpers';
import { voluntaryDisclosure, finePlan } from '../src/engine/legal/legal';
import { usd } from '../src/engine/money';

vi.mock('../src/persistence/platformStorage', async (orig) => {
  const actual = await orig<typeof import('../src/persistence/platformStorage')>();
  return { ...actual, exportToFile: vi.fn(async () => ({ ok: true, message: 'Exportada.' })) };
});

const DAY = 24 * 60 * 60 * 1000;
beforeEach(() => localStorage.clear());

describe('Fase 8 · recordatorio de exportar', () => {
  const meta = (over: Partial<SlotMeta> = {}): SlotMeta => ({ id: 'main', name: 'Ana', day: 10, netWorth: null, savedAt: 0, createdAt: 0, ...over });

  it('no molesta en la primera semana, recuerda si nunca se exportó y respeta «Más tarde»', () => {
    expect(needsExportReminder(meta(), 6 * DAY, 0)).toBe(false);
    expect(needsExportReminder(meta(), 8 * DAY, 0)).toBe(true);
    expect(needsExportReminder(meta({ exportedAt: 2 * DAY }), 20 * DAY, 0)).toBe(false);
    expect(needsExportReminder(meta({ exportedAt: 2 * DAY }), 2 * DAY + EXPORT_REMINDER.everyMs, 0)).toBe(true);
    expect(needsExportReminder(meta(), 8 * DAY, 9 * DAY)).toBe(false);
    expect(needsExportReminder(undefined, 100 * DAY, 0)).toBe(false);
  });

  it('exportar registra la fecha en la partida y los guardados siguientes la conservan', async () => {
    const st = new GameStore();
    await st.boot();
    await st.startNewGame({ name: 'Ana', background: 'egresado', style: 'libre', seed: 'exp' });
    expect(st.activeSlotMeta()?.exportedAt).toBeUndefined();
    const before = Date.now();
    await st.exportFile();
    expect(vi.mocked(exportToFile)).toHaveBeenCalled();
    const at = st.activeSlotMeta()?.exportedAt;
    expect(at).toBeGreaterThanOrEqual(before);
    st.step(3);
    await st.save();
    expect(st.activeSlotMeta()?.exportedAt).toBe(at);
    expect(st.activeSlotMeta()?.day).toBe(3);
    st.stopClock();
  });

  it('una exportación cancelada o fallida no cuenta', async () => {
    vi.mocked(exportToFile).mockResolvedValueOnce({ ok: false, message: 'Cancelada.' });
    const st = new GameStore();
    await st.boot();
    await st.startNewGame({ name: 'Beto', background: 'egresado', style: 'libre', seed: 'exp2' });
    await st.exportFile();
    expect(st.activeSlotMeta()?.exportedAt).toBeUndefined();
    st.stopClock();
  });
});

describe('Fase 8 · mercado de inmuebles ordenable por rendimiento', () => {
  it('el rendimiento bruto usa el alquiler del contrato o el de mercado, y los terrenos no rentan', () => {
    const s = makeGame('herencia', 'yield');
    for (const l of s.realEstate.listings) {
      const p = l.property;
      const rent = listingRent(s, l);
      if (p.lease) expect(rent).toBe(p.lease.rent);
      else if (p.type === 'terreno') expect(rent).toBe(0);
      else expect(rent).toBe(marketRent(s, p));
      expect(listingGrossYield(s, l)).toBeCloseTo((rent * 12) / l.askPrice, 12);
    }
  });
});

describe('Fase 8 · Android: copia de seguridad y archivos compartidos mínimos', () => {
  const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
  it('la copia automática de Android incluye solo las partidas (no las actualizaciones descargadas)', () => {
    expect(manifest).toMatch(/android:fullBackupContent="@xml\/backup_rules"/);
    expect(manifest).toMatch(/android:dataExtractionRules="@xml\/data_extraction_rules"/);
    const full = readFileSync('android/app/src/main/res/xml/backup_rules.xml', 'utf8');
    const extraction = readFileSync('android/app/src/main/res/xml/data_extraction_rules.xml', 'utf8');
    for (const xml of [full, extraction]) {
      const includes = [...xml.matchAll(/<include domain="(\w+)" path="([^"]*)"/g)].map((m) => `${m[1]}:${m[2]}`);
      expect(new Set(includes)).toEqual(new Set(['file:saves/']));
    }
  });

  it('el FileProvider solo expone la caché (donde se escribe el archivo exportado)', () => {
    const paths = readFileSync('android/app/src/main/res/xml/file_paths.xml', 'utf8');
    expect(paths).not.toMatch(/external-path|files-path|root-path/);
    expect(paths).toMatch(/<cache-path /);
  });
});

describe('Fase 8 · hallazgos de la prueba de caos (50 semillas × 20 años)', () => {
  it('regularizar una evasión cuyo impuesto omitido es cero no crea un asiento vacío ni una deuda', () => {
    const s = makeGame('herencia', 'zero-evasion');
    s.options.illegalEnabled = true;
    s.legal.acts.push({ id: s.meta.nextId++, kind: 'evasion', day: s.day, label: 'Declaración sin diferencia', benefit: 0, amount: usd(10), evidence: 20, severity: 1, witnesses: 0, jurisdiction: s.tax.jurisdiction, statuteDay: s.day + 2000, status: 'oculto' });
    const act = s.legal.acts[s.legal.acts.length - 1];
    const fines = s.legal.fines.length;
    const r = voluntaryDisclosure(s, act.id);
    expect(r.ok).toBe(true);
    expect(act.status).toBe('regularizado');
    expect(s.legal.fines.length).toBe(fines);
    expectConsistent(s);
  });

  it('un plan de pagos sobre una multa de pocos centavos no registra un recargo de cero', () => {
    const s = makeGame('herencia', 'tiny-fine');
    s.legal.fines.push({ id: s.meta.nextId++, caseId: null, label: 'Saldo mínimo', balance: 3, original: 3, dueDay: s.day + 30, installment: null, garnishing: false });
    const f = s.legal.fines[s.legal.fines.length - 1];
    const r = finePlan(s, f.id);
    expect(r.ok).toBe(true);
    expect(f.installment).toBeGreaterThanOrEqual(1);
    expect(f.balance).toBe(3);
  });
});

describe('Fase 8 · montos enormes no se salen de la pantalla', () => {
  it('fmtMoneyFit deja el monto completo si entra y lo abrevia si no', async () => {
    const { fmtMoneyFit, fmtCompact, fmtPct } = await import('../src/engine/format');
    expect(fmtMoneyFit(usd(81_507), { decimals: false })).toBe('$81,507');
    expect(fmtMoneyFit(usd(9_502_007_410), { decimals: false })).toBe('$9.50B');
    expect(fmtMoneyFit(usd(9_431_211_140.52), { sign: true })).toBe('+$9.43B');
    expect(fmtMoneyFit(-usd(2_500_000_000_000))).toBe('−$2.50T');
    expect(fmtCompact(usd(4_000_000_000_000_000))).toBe('$4,000T');
    expect(fmtPct(133.216, 1)).toBe('13,322\u00a0%');
    expect(fmtPct(0.199, 1)).toBe('19.9\u00a0%');
  });

  it('la cifra principal achica la letra según el largo del número', async () => {
    const { render } = await import('@testing-library/react');
    const { BigAmount } = await import('../src/ui/components/common');
    const { container } = render(<BigAmount c={usd(9_514_003_894.55)} />);
    const el = container.querySelector('.big-fit') as HTMLElement;
    expect(el.textContent).toBe('$9,514,003,894.55');
    expect(el.style.getPropertyValue('--chars')).toBe('17');
  });
});

describe('Privacidad y términos: lo que dicen coincide con lo que hace la app', () => {
  it('la app solo declara el permiso de internet; el único SDK de terceros es AdMob (declarado en la política), sin analíticas ni compras', async () => {
    const manifest = readFileSync('android/app/src/main/AndroidManifest.xml', 'utf8');
    const perms = [...manifest.matchAll(/uses-permission android:name="([^"]+)"/g)].map((m) => m[1]);
    expect(perms).toEqual(['android.permission.INTERNET']);
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { dependencies: Record<string, string> };
    expect(Object.keys(pkg.dependencies).filter((d) => /admob|ads|analytics|firebase|billing|purchase|sentry|amplitude|mixpanel/i.test(d))).toEqual(['@capacitor-community/admob']);
    const { PRIVACY } = await import('../src/content/legal');
    expect(PRIVACY.map((s) => s.title)).toContain('Anuncios (Google AdMob)');
  });

  it('la única conexión de red es la búsqueda de actualizaciones en GitHub', async () => {
    const { execSync } = await import('node:child_process');
    const hits = execSync("grep -rln 'fetch(\\|XMLHttpRequest\\|navigator.sendBeacon\\|new WebSocket' src || true", { encoding: 'utf8' }).trim().split('\n').filter(Boolean);
    expect(hits).toEqual(['src/persistence/ota.ts']);
    const { OTA_BASE } = await import('../src/persistence/ota');
    expect(OTA_BASE.startsWith('https://raw.githubusercontent.com/')).toBe(true);
  });

  it('las páginas públicas incluyen todas las secciones, escapadas, y la hoja de la app las muestra', async () => {
    const { renderLegalPage } = await import('../scripts/legalPages');
    const { PRIVACY, TERMS, LICENSES } = await import('../src/content/legal');
    const priv = renderLegalPage('privacy');
    const terms = renderLegalPage('terms');
    for (const s of PRIVACY) expect(priv).toContain(s.title);
    for (const s of TERMS) expect(terms).toContain(s.title);
    for (const l of LICENSES) expect(terms).toContain(l.license);
    expect(priv).toMatch(/<title>Política de privacidad/);
    expect(priv).not.toMatch(/<script/);
  });
});
