import { test, expect, type Page } from '@playwright/test';

/**
 * Fase 0 · E8 (auditoría D6), en el navegador y sobre la compilación real:
 * con una oferta de empleo pendiente, cerrar la app y volver 8 horas después no
 * hace vencer la oferta. El reloj del navegador se adelanta con page.clock.
 */

const topDate = (page: Page) => page.locator('.topbar .date-block .d');

async function openMenuItem(page: Page, item: string) {
  await page.getByRole('button', { name: /^Más opciones/ }).click();
  await page.getByRole('menuitem', { name: new RegExp(`^${item}`) }).click();
}

async function bottomTab(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name }).click();
}

/** Día guardado de la partida abierta (índice de partidas en el almacenamiento). */
const savedDay = (page: Page) => page.evaluate(() => {
  const reg = JSON.parse(localStorage.getItem('urt.slots') ?? 'null');
  return reg?.slots?.find((x: { id: string }) => x.id === reg.active)?.day ?? null;
});

test('una oferta pendiente sigue abierta después de 8 horas con la app cerrada', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByLabel('Nombre').fill('Ausente E2E');
  await page.getByText('Opciones avanzadas').click();
  await page.getByLabel('Semilla del mundo').fill('e2e-ausencia');
  await page.getByRole('button', { name: 'Comenzar partida' }).click();
  await expect(page.getByText('El tiempo está en pausa')).toBeVisible();

  // Postularse a todo y avanzar hasta tener una oferta SIN aceptarla.
  await bottomTab(page, 'Carrera');
  await page.getByRole('tab', { name: 'Vacantes' }).click();
  const applyButtons = page.getByRole('button', { name: 'Postularme', exact: true });
  const available = await applyButtons.count();
  for (let i = 0; i < available; i++) {
    const b = applyButtons.first();
    if (!(await b.isEnabled())) break;
    await b.click();
  }
  await page.getByRole('tab', { name: /^Empleo/ }).click();
  const accept = page.getByRole('button', { name: 'Aceptar', exact: true });
  for (let week = 0; week < 10 && !(await accept.isVisible()); week++) await openMenuItem(page, 'Avanzar 1 semana');
  await expect(accept).toBeVisible();
  const dateBefore = await topDate(page).textContent();

  // Se guarda poco después de la última acción: esperar a que el día quede escrito.
  await expect.poll(() => savedDay(page), { timeout: 15_000 }).toBeGreaterThan(0);
  const dayBefore = await savedDay(page);
  await page.close();

  // Volver 8 horas después (8 h a 10 min por día = 48 días: más que los 7 de la oferta).
  const later = await context.newPage();
  later.on('pageerror', (e) => errors.push(e.message));
  await later.clock.install({ time: Date.now() + 8 * 60 * 60 * 1000 });
  await later.goto('/');
  await expect(later.getByText(/El tiempo te esperó/)).toBeVisible();
  await expect(topDate(later)).toHaveText(dateBefore!);
  await bottomTab(later, 'Carrera');
  await later.getByRole('tab', { name: /^Empleo/ }).click();
  await expect(later.getByRole('button', { name: 'Aceptar', exact: true })).toBeVisible();
  expect(await savedDay(later)).toBe(dayBefore);

  expect(errors).toEqual([]);
});
