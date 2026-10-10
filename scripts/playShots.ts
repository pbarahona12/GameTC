/**
 * Capturas para la ficha de Google Play (y para revisar la interfaz).
 *
 *   npm run build && npm run shots
 *
 * Juega 7 años con el bot emprendedor (decisiones reales del motor, sin dinero
 * regalado), importa esa partida en la compilación y saca 8 capturas de teléfono en
 * `docs/play/`. Proporción 2:1 (412 × 824 a 2,625×): Google Play rechaza capturas
 * con el lado largo mayor al doble del corto.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium, type Page } from '@playwright/test';
import { runBot } from '../tests/bots/strategies';
import type { GameState } from '../src/engine/state';
import { serialize } from '../src/persistence/save';
import { chooseGoal } from '../src/engine/saga/goals';
import { dilemmasDay } from '../src/engine/saga/dilemmas';
import { simulateDays } from '../src/engine/simulation';
import { dateOf } from '../src/engine/time/calendar';

const OUT = 'docs/play';
const URL = 'http://127.0.0.1:4174/';

function playedGame(): GameState {
  let last: GameState | null = null;
  runBot('emprendedor', 'tecnico', 'play-shots', 7, { onMonth: (s) => { last = s; } });
  const s = last as GameState | null;
  if (!s) throw new Error('El bot no cerró ningún mes.');
  // Pasar el cierre de mes: el día 1 se ven el sueldo cobrado y el mes completo en los informes.
  for (let i = 0; i < 31 && dateOf(s.day).d !== 2; i++) simulateDays(s, 1);
  s.player.name = 'Adriana';
  const NAMES: Record<string, string> = { consultora: 'Rivas Consultores', cafeteria: 'Café Aurora', minimarket: 'Mercadito Sol', saas: 'Nube Clara', muebles: 'Roble & Pino' };
  for (const co of s.companies) if (co.name.startsWith('Bot ')) co.name = NAMES[co.sector] ?? co.name.replace('Bot ', '');
  for (const g of ['top100', 'casa_propia', 'tres_empresas']) chooseGoal(s, g);
  // Que haya una decisión abierta para mostrarla (una plantilla real, con su sorteo).
  if (!s.saga.dilemmas.open.length) { s.saga.dilemmas.nextDay = s.day; dilemmasDay(s); }
  s.meta.lastRealTime = Date.now();
  return s;
}

async function closeCelebrations(page: Page) {
  for (let i = 0; i < 10; i++) {
    const b = page.getByRole('button', { name: /¡Seguimos!|Continuar/ });
    if (!(await b.first().isVisible().catch(() => false))) return;
    await b.first().click();
    await page.waitForTimeout(250);
  }
}

async function shot(page: Page, name: string, top = true) {
  if (top) await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ${OUT}/${name}.png`);
}

async function tab(page: Page, name: string) {
  await page.getByRole('navigation', { name: 'Secciones' }).getByRole('button', { name }).click();
  await closeCelebrations(page);
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const save = serialize(playedGame(), Date.now());
  const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', '4174', '--strictPort'], { stdio: 'ignore' });
  try {
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(URL)).ok) break; } catch { /* todavía arrancando */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    const browser = await chromium.launch(process.env.PW_CHROMIUM_PATH ? { executablePath: process.env.PW_CHROMIUM_PATH } : {});
    const ctx = await browser.newContext({ viewport: { width: 412, height: 824 }, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true, colorScheme: 'dark', locale: 'es-419' });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(URL);
    await page.getByRole('button', { name: /Importar/ }).click();
    await page.getByText('O pegar el texto exportado').click();
    await page.locator('#imp').fill(save);
    await page.getByRole('button', { name: 'Importar y verificar' }).click();
    await page.waitForTimeout(1200);
    await closeCelebrations(page);
    await page.waitForTimeout(4500); // festejos chicos

    // Una jugadora de 7 años ya no mira las misiones del principio: las oculta (como en Ajustes).
    const hide = page.getByRole('button', { name: 'Ocultar misiones' });
    if (await hide.isVisible().catch(() => false)) { await hide.click(); await page.waitForTimeout(4500); }
    await shot(page, '1-inicio');
    await page.locator('.agenda-row').first().click();
    await shot(page, '2-decision', false);
    await page.keyboard.press('Escape');

    await tab(page, 'Más');
    await page.getByRole('button', { name: /Listas de fortunas/ }).click();
    await shot(page, '3-fortunas');
    await page.getByRole('button', { name: 'Volver a Más' }).click();

    await tab(page, 'Negocios');
    const company = page.locator('button.card').first();
    if (await company.isVisible().catch(() => false)) await company.click();
    await shot(page, '4-empresa');

    await tab(page, 'Invertir');
    await page.getByRole('tab', { name: /Bolsa/ }).or(page.getByRole('button', { name: /^Bolsa/ })).first().click();
    await shot(page, '5-inversiones');

    await tab(page, 'Más');
    await page.getByRole('button', { name: /Informes financieros/ }).click();
    await closeCelebrations(page);
    await page.getByRole('button', { name: 'Mes ant.' }).or(page.getByRole('tab', { name: 'Mes ant.' })).first().click();
    await shot(page, '6-informes');

    await tab(page, 'Más');
    await page.getByRole('button', { name: /Tu crónica/ }).click();
    await shot(page, '7-cronica', false);
    await page.keyboard.press('Escape');

    await page.locator('.age-chip').click();
    await shot(page, '8-vida', false);

    writeFileSync(`${OUT}/errores.txt`, errors.join('\n'));
    if (errors.length) console.error(`Errores de la página: ${errors.length} (ver ${OUT}/errores.txt)`);
    await browser.close();
  } finally {
    server.kill();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
