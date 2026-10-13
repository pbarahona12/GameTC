// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { navStore } from '../src/ui/nav';
import { GameStore, NEXT_SPEED, store } from '../src/ui/store';
import { Onboarding } from '../src/ui/screens/Onboarding';
import { GroupedTabs } from '../src/ui/components/common';
import { STAGES } from '../src/engine/progression/progression';
import { GATES, sectionsFromStage } from '../src/engine/progression/unlocks';
import { GLOSSARY } from '../src/content/glossary';
import { TUTORIAL } from '../src/engine/progression/tutorial';
import { PLAY_STYLES } from '../src/content/backgrounds';

beforeEach(() => {
  localStorage.clear();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  navStore.reset();
});
afterEach(() => cleanup());

describe('Fase 7 · botón atrás de Android con historial real', () => {
  it('cierra hojas, vuelve a la vista anterior, a la pestaña anterior, a Inicio y por último deja salir', () => {
    navStore.go('invest');
    navStore.setSub('invest', 'funds');
    navStore.go('business');
    navStore.open({ kind: 'settings' });
    navStore.open({ kind: 'term', id: 'liquidez' });
    expect(navStore.back()).toBe(true); // hoja actual
    expect(navStore.get().sheets).toEqual([{ kind: 'settings' }]);
    expect(navStore.back()).toBe(true); // hoja anterior
    expect(navStore.get().sheets).toEqual([]);
    expect(navStore.back()).toBe(true); // pestaña anterior (Invertir → Fondos)
    expect(navStore.get().tab).toBe('invest');
    expect(navStore.get().sub.invest).toBe('funds');
    expect(navStore.back()).toBe(true); // vista anterior dentro de Invertir
    expect(navStore.get().sub.invest).toBeUndefined();
    expect(navStore.back()).toBe(true); // Inicio
    expect(navStore.get().tab).toBe('home');
    expect(navStore.back()).toBe(false); // ya no hay adónde volver: la app puede cerrarse
  });

  it('sin historial (por ejemplo, tras abrir otra partida) vuelve a Inicio antes de salir', () => {
    navStore.go('career');
    navStore.reset();
    navStore.go('finance');
    navStore.reset();
    expect(navStore.get().tab).toBe('home');
    expect(navStore.back()).toBe(false);
  });
});

describe('Fase 7 · controles del tiempo', () => {
  it('la velocidad rota 1× → 2× → 4× → 8× → 1× y Play/Pausa reanuda a la velocidad elegida', async () => {
    expect([1, 2, 4, 8].map((v) => NEXT_SPEED[v as 1 | 2 | 4 | 8])).toEqual([2, 4, 8, 1]);
    const st = new GameStore();
    await st.boot();
    await st.startNewGame({ name: 'T', background: 'egresado', style: 'libre', seed: 'ux' });
    expect(st.getSnapshot().speed).toBe(0);
    st.cycleSpeed();
    st.cycleSpeed();
    expect(st.getSnapshot().settings.playSpeed).toBe(4);
    expect(st.getSnapshot().speed).toBe(0); // cambiar la velocidad no arranca el tiempo
    st.togglePlay();
    expect(st.getSnapshot().speed).toBe(4);
    st.cycleSpeed();
    expect(st.getSnapshot().speed).toBe(8); // en marcha, el cambio se aplica enseguida
    st.togglePlay();
    expect(st.getSnapshot().speed).toBe(0);
    st.stopClock();
  });
});

describe('Fase 7 · primera partida', () => {
  it('lo esencial está a la vista (nombre, aspecto, origen, comenzar) y lo demás en opciones avanzadas', () => {
    render(<Onboarding />);
    expect(screen.getByLabelText('Nombre')).toBeTruthy();
    expect(screen.getByRole('radiogroup', { name: 'Origen' })).toBeTruthy();
    const adv = screen.getByText('Opciones avanzadas').closest('details')!;
    expect(adv.open).toBe(false);
    expect(adv.textContent).toMatch(/Semilla del mundo/);
    expect(adv.textContent).toMatch(/Dificultad económica/);
    expect(adv.textContent).toMatch(/Actividades ilegales ficticias: desactivadas/);
    // Importar es secundario: un botón que despliega el importador.
    expect(screen.queryByText('Elegir archivo de partida')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /¿Ya tenés una partida\? Importar/ }));
    expect(screen.getByText(/Elegir archivo de partida/)).toBeTruthy();
  });

  it('las actividades ilegales arrancan desactivadas', () => {
    const spy = vi.spyOn(store, 'startNewGame').mockResolvedValue(true);
    render(<Onboarding />);
    fireEvent.change(screen.getByLabelText('Nombre'), { target: { value: '  Ana  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Comenzar partida' }));
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ name: 'Ana', illegalEnabled: false, difficulty: 'normal' }));
    spy.mockRestore();
  });
});

describe('Fase 7 · pestañas agrupadas', () => {
  const groups = [
    { id: 'a', label: 'Mis inversiones', items: [{ id: 'portfolio', label: 'Mis inversiones' }] },
    { id: 'b', label: 'Bolsa', items: [{ id: 'lite', label: 'Bolsa simple' }, { id: 'pro', label: 'Trading Pro' }] },
  ];

  it('muestra los grupos, las subsecciones del grupo activo y conserva los ids de cada sección', () => {
    const onChange = vi.fn();
    render(<GroupedTabs groups={groups} value="pro" onChange={onChange} label="Inversiones" />);
    expect(screen.getByRole('tab', { name: 'Bolsa', selected: true })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Trading Pro', selected: true })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Bolsa simple' }));
    expect(onChange).toHaveBeenLastCalledWith('lite');
    // Al cambiar de grupo se abre su primera sección.
    fireEvent.click(screen.getByRole('tab', { name: 'Mis inversiones' }));
    expect(onChange).toHaveBeenLastCalledWith('portfolio');
  });

  it('un grupo de una sola sección no muestra la fila de subsecciones', () => {
    render(<GroupedTabs groups={groups} value="portfolio" onChange={() => {}} />);
    expect(screen.getAllByRole('tablist')).toHaveLength(1);
  });
});

describe('Fase 7 · textos veraces y formato numérico único', () => {
  it('las etapas no prometen funciones que no existen: solo recomiendan secciones reales', () => {
    for (const st of STAGES) expect('unlocks' in st).toBe(false);
    const all = STAGES.flatMap((s) => sectionsFromStage(s.n));
    expect(all.map((g) => g.id).sort()).toEqual(GATES.map((g) => g.id).sort());
  });

  it('no quedan etiquetas de desarrollo («Fase 2», «Fase 3») en textos del juego', () => {
    const texts = [...PLAY_STYLES.map((p) => p.hint), ...TUTORIAL.map((t) => t.body), ...STAGES.map((s) => s.description)];
    expect(texts.filter((t) => /\bFase \d\b/.test(t))).toEqual([]);
  });

  it('los textos usan el mismo formato numérico que la interfaz (1,500.50 y 0.4 %)', () => {
    const texts = GLOSSARY.flatMap((g) => Object.values(g).filter((v): v is string => typeof v === 'string'));
    const spanishThousands = texts.filter((t) => /\$\d{1,3}(\.\d{3})+\b/.test(t));
    const spanishDecimals = texts.filter((t) => /\b\d+,\d{1,2} ?%/.test(t));
    expect(spanishThousands).toEqual([]);
    expect(spanishDecimals).toEqual([]);
  });

  it('las indicaciones de navegación apuntan a pantallas que existen', () => {
    const bodies = TUTORIAL.map((t) => t.body).join(' ');
    expect(bodies).not.toMatch(/Carrera → Empleos|Inicio → Noticias|🧭/);
    expect(bodies).toMatch(/Carrera → Vacantes/);
  });
});

describe('Fase 7 · accesibilidad', () => {
  const css = readFileSync('src/ui/theme.css', 'utf8');
  const html = readFileSync('index.html', 'utf8');

  it('el zoom del sistema no está bloqueado', () => {
    expect(html).not.toMatch(/maximum-scale|user-scalable\s*=\s*no/);
  });

  it('los colores de texto cumplen contraste AA (4.5:1) sobre los fondos en tema claro y oscuro', () => {
    const lum = (hex: string) => {
      const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(1 + i, 3 + i), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
      return (x + 0.05) / (y + 0.05);
    };
    // Primer bloque de tokens = tema claro; el segundo = tema oscuro.
    const blocks = [...css.matchAll(/--bg: (#[0-9a-f]{6});[\s\S]*?--info: (#[0-9a-f]{6});/g)].slice(0, 2).map((m) => m[0]);
    expect(blocks).toHaveLength(2);
    for (const block of blocks) {
      const tok = (name: string) => block.match(new RegExp(`--${name}: (#[0-9a-f]{6});`))![1];
      for (const fg of ['text', 'muted', 'faint', 'accent', 'gain', 'loss', 'warn', 'info']) {
        for (const bg of ['bg', 'surface', 'surface-2']) {
          expect(ratio(tok(fg), tok(bg)), `${fg} sobre ${bg}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });
});

describe('Fase 1 · E6: cifras cortas en Inicio', () => {
  it('sin centavos y abreviadas desde 10.000', async () => {
    const { fmtMoneyShort } = await import('../src/engine/format');
    expect(fmtMoneyShort(95_049)).toBe('$950');
    expect(fmtMoneyShort(180_000)).toBe('$1,800');
    expect(fmtMoneyShort(40_930_118)).toBe('$409 mil');
    expect(fmtMoneyShort(340_000_000)).toBe('$3.4 M');
    expect(fmtMoneyShort(4_070_000_000_000)).toBe('$40.7 mil M');
    expect(fmtMoneyShort(-350_000_000, { sign: true })).toBe('−$3.5 M');
    expect(fmtMoneyShort(200_000_000, { sign: true })).toBe('+$2 M');
  });
});

describe('1.6 · Asesor en imperios grandes', () => {
  it('la misma alerta de 3 o más empresas se agrupa en una; con menos, se muestran por separado', async () => {
    const { groupCompanyInsights, GROUP_FROM } = await import('../src/engine/advisor/advisor');
    const mk = (co: number, name: string) => ({ id: `co${co}-losses`, severity: 'warning' as const, category: 'empresa' as const, title: `📉 ${name}: 5 meses seguidos con pérdidas`, what: 'Resultados…', why: '', data: [], consequence: '', options: [], ifNothing: '' });
    const two = groupCompanyInsights([mk(1, 'A'), mk(2, 'B')]);
    expect(two).toHaveLength(2);
    const many = groupCompanyInsights([mk(1, 'Café Uno'), mk(2, 'Café Dos'), mk(3, 'Café Tres'), { ...mk(4, 'Otra'), id: 'co4-cash' }]);
    expect(GROUP_FROM).toBe(3);
    expect(many).toHaveLength(2);
    const g = many.find((i) => i.id === 'grupo-losses')!;
    expect(g.title).toBe('📉 3 empresas: meses seguidos con pérdidas');
    expect(g.what).toBe('Café Uno, Café Dos, Café Tres.');
    expect(g.data).toHaveLength(3);
  });
});
