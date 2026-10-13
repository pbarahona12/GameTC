import { test, expect } from '@playwright/test';

/**
 * Fase 1 · E6 (auditoría D9): Inicio como escena. Criterios medidos el día 0 en un
 * teléfono (Pixel 7): menos de 120 palabras, ningún control de Inicio bajo 44 px y
 * ninguna cifra con centavos. La barra de secciones de abajo no cuenta (no es Inicio).
 */
test('Inicio el día 0: menos de 120 palabras, controles de 44 px y cifras sin centavos', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Nombre').fill('Ana Inicio');
  await page.getByRole('button', { name: 'Comenzar partida' }).click();
  await expect(page.getByText('El tiempo está en pausa')).toBeVisible();
  // Medir con la pantalla quieta (la entrada de Inicio tiene una animación corta).
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const r = await page.evaluate(() => {
    const root = document.querySelector('.app') as HTMLElement;
    const nav = document.querySelector('nav[aria-label="Secciones"]') as HTMLElement | null;
    const text = root.innerText.replace(nav?.innerText ?? '', '');
    const words = text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
    const small: string[] = [];
    for (const el of Array.from(root.querySelectorAll('button, a, [role=button], input, select, summary')) as HTMLElement[]) {
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height || (nav && nav.contains(el))) continue;
      if (b.width < 43.5 || b.height < 43.5) small.push(`${Math.round(b.width)}×${Math.round(b.height)} ${(el.getAttribute('aria-label') || el.innerText).slice(0, 40)}`);
    }
    return { words, small, cents: text.match(/\$[\d,]+\.\d\d\b/g) ?? [] };
  });
  expect(r.words).toBeLessThan(120);
  expect(r.small, JSON.stringify(r.small)).toEqual([]);
  expect(r.cents).toEqual([]);
});
