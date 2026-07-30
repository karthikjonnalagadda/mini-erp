/**
 * Captures the README screenshot set from a running, seeded local instance.
 *
 * The README has always listed twelve screenshots under `docs/screenshots/` with a
 * note to "capture from a seeded local instance". Nobody ever did, so the project's
 * most-read document shipped twelve broken image links. This script closes that
 * permanently: the shots are reproducible rather than a one-off manual chore, so
 * they can be refreshed after a UI change instead of silently going stale.
 *
 * Selectors are the ones the demo harness already proves against this app on every
 * run — accessible roles and `id`s, no `data-testid` (the application ships none).
 *
 * Requires the stack running, plus Playwright — which is NOT a dependency of this
 * repository, because a documentation tool should not weigh down every install:
 *
 *   npm i -D @playwright/test && npx playwright install chromium
 *   npm run screenshots
 *
 * Writes PNGs to docs/screenshots/ at 1600x900, deviceScaleFactor 1.
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const WEB = process.env.DEMO_BASE_URL ?? 'http://localhost:5173';
const API = process.env.DEMO_API_URL ?? 'http://localhost:4000';
const EMAIL = process.env.DEMO_ADMIN_EMAIL ?? 'admin@erpportal.io';
const PASSWORD = process.env.DEMO_PASSWORD ?? 'Admin@12345';

const OUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/screenshots');

const VIEWPORT = { width: 1600, height: 900 };

let captured = 0;
const failures = [];

/**
 * One screenshot. Never throws — a missing screen should cost that one image, not
 * the other eleven, and the summary at the end reports exactly what is missing.
 */
const shot = async (page, name, prepare) => {
  try {
    await prepare(page);
    // Let fonts, chart animations and any row transition finish. Charts animate on
    // mount, and a shot taken mid-animation shows half-drawn bars.
    await page.waitForTimeout(1_200);
    // Back to the top. Expanding an accordion or focusing a control can scroll the
    // document, and a screenshot that starts mid-page loses the header that tells
    // the reader which screen they are looking at — the Swagger shot lost its API
    // title exactly this way.
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => undefined);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(OUT, `${name}.png`) });
    captured += 1;
    console.log(`  ✓ ${name}.png`);
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    failures.push({ name, message });
    console.warn(`  ✗ ${name}.png — ${message}`);
  }
};

/** Waits for a list screen to hold real rows rather than skeleton placeholders. */
const waitForRows = async (page) => {
  await page.waitForLoadState('networkidle').catch(() => undefined);
  await page
    .locator('table tbody tr')
    .filter({ hasNot: page.locator('.skeleton') })
    .first()
    .waitFor({ state: 'visible', timeout: 20_000 });
};

const main = async () => {
  await fs.mkdir(OUT, { recursive: true });
  console.log(`\nCapturing to ${OUT}\n`);

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  // -- 01 Login (before authenticating) ------------------------------------
  await shot(page, '01-login', async () => {
    await page.goto(`${WEB}/login`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /Sign in/ }).waitFor({ state: 'visible' });
  });

  // -- Authenticate --------------------------------------------------------
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.getByRole('button', { name: /Sign in/ }).click();
  await page.waitForURL('**/dashboard', { timeout: 30_000 });
  await page.waitForLoadState('networkidle').catch(() => undefined);

  await shot(page, '02-dashboard', async () => {
    await page.getByRole('heading', { name: /^Good (morning|afternoon|evening),/ }).waitFor();
  });

  await shot(page, '03-customers', async () => {
    await page.goto(`${WEB}/customers`, { waitUntil: 'networkidle' });
    await waitForRows(page);
  });

  // Detail pages need a real id, so navigate by clicking a row rather than
  // guessing a UUID.
  await shot(page, '04-customer-detail', async () => {
    await page.goto(`${WEB}/customers`, { waitUntil: 'networkidle' });
    await waitForRows(page);
    await page.locator('table tbody tr a').first().click();
    await page.waitForURL(/\/customers\/[0-9a-f-]{36}/, { timeout: 20_000 });
    await page.waitForLoadState('networkidle').catch(() => undefined);
  });

  await shot(page, '05-products', async () => {
    await page.goto(`${WEB}/products`, { waitUntil: 'networkidle' });
    await waitForRows(page);
  });

  // Inventory with the stock-adjustment dialog open — the dialog is the screen's
  // most interesting state and the README caption promises it.
  await shot(page, '06-inventory', async () => {
    await page.goto(`${WEB}/inventory`, { waitUntil: 'networkidle' });
    await waitForRows(page);
    const adjust = page.getByRole('button', { name: /^Adjust stock for / }).first();
    if (await adjust.isVisible().catch(() => false)) {
      await adjust.click();
      await page.getByRole('dialog').waitFor({ state: 'visible', timeout: 10_000 });
    }
  });

  await shot(page, '07-challan-form', async () => {
    // Escape any dialog the previous shot left open.
    await page.keyboard.press('Escape').catch(() => undefined);
    await page.goto(`${WEB}/challans/new`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /challan/i }).first().waitFor({ timeout: 20_000 });
  });

  await shot(page, '08-challan-detail', async () => {
    await page.goto(`${WEB}/challans`, { waitUntil: 'networkidle' });
    await waitForRows(page);
    await page.locator('table tbody tr a').first().click();
    await page.waitForURL(/\/challans\/[0-9a-f-]{36}/, { timeout: 20_000 });
    await page.waitForLoadState('networkidle').catch(() => undefined);
  });

  await shot(page, '09-stock-movements', async () => {
    await page.goto(`${WEB}/stock-movements`, { waitUntil: 'networkidle' });
    await waitForRows(page);
  });

  await shot(page, '10-audit-logs', async () => {
    await page.goto(`${WEB}/audit-logs`, { waitUntil: 'networkidle' });
    await waitForRows(page);
  });

  // -- Dark mode -----------------------------------------------------------
  await shot(page, '11-dark-mode', async () => {
    await page.goto(`${WEB}/dashboard`, { waitUntil: 'networkidle' });
    await page.getByRole('heading', { name: /^Good (morning|afternoon|evening),/ }).waitFor();
    const toggle = page.getByRole('button', { name: /Switch to dark theme/ });
    if (await toggle.isVisible().catch(() => false)) await toggle.click();
    await page.waitForFunction(
      () => document.documentElement.classList.contains('dark'),
      undefined,
      { timeout: 5_000 },
    );
  });

  // Restore light mode so the Swagger shot is consistent with the rest.
  const back = page.getByRole('button', { name: /Switch to light theme/ });
  if (await back.isVisible().catch(() => false)) await back.click();

  // -- Swagger UI ----------------------------------------------------------
  await shot(page, '12-api-docs', async () => {
    await page.goto(`${API}/api/v1/docs`, { waitUntil: 'networkidle' });
    await page.locator('.opblock-tag, .info .title, h2.title').first().waitFor({ timeout: 20_000 });
    // Expand the first two operation groups so the surface is legible.
    const tags = page.locator('.opblock-tag');
    for (let i = 0; i < Math.min(2, await tags.count()); i += 1) {
      await tags.nth(i).click().catch(() => undefined);
      await page.waitForTimeout(400);
    }
  });

  await browser.close();

  console.log(`\n${captured}/12 captured`);
  if (failures.length > 0) {
    console.log('\nMissing:');
    for (const f of failures) console.log(`  · ${f.name} — ${f.message}`);
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
