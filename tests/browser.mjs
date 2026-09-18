// Install Playwright separately, or use the supplied primary runtime module path.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = await import('playwright'); }
catch { playwright = await import(pathToFileURL(require.resolve('playwright', { paths: [process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES || '.'] })).href); }
playwright = playwright.default || playwright;
const browser = await playwright.chromium.launch({ headless: true, args: ['--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
const url = process.env.TEST_URL || 'http://127.0.0.1:3000';
const open = async () => { await page.goto(url); await page.waitForFunction(() => !document.querySelector('#studio').inert); };
try {
  await open();
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/initial.png', fullPage: true });
  await page.getByRole('button', { name: '音を出さずに測る' }).click();
  assert.equal(await page.locator('.result strong').count(), 4);
  await page.locator('[data-preset="interference"]').click();
  for (const [bar, expected] of [[0, '0%'], [1, '50%'], [2, '100%'], [3, '50%']]) {
    await page.locator(`[data-bar="${bar}"]`).click();
    assert.equal(await page.locator('.prob-value').nth(2).textContent(), expected);
  }
  await page.locator('[data-bar="0"]').click();
  await page.getByRole('button', { name: 'この小節をクリア' }).click();
  await page.locator('[data-gate="H"]').click(); await page.locator('[data-q="0"][data-col="0"]').click();
  await page.locator('[data-gate="CNOT"]').click();
  await page.locator('[data-q="0"][data-col="1"]').click(); await page.locator('[data-q="4"][data-col="1"]').click();
  assert.deepEqual(await page.locator('.distribution-row code').allTextContents(), ['00000', '10001']);
  assert.equal(await page.locator('.cnot-wire').count(), 1);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click(); assert.equal(await page.locator('.cnot-wire').count(), 0);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click(); assert.equal(await page.locator('.cnot-wire').count(), 1);
  await page.locator('#freeze').click(); const fixed = await page.locator('.result strong').allTextContents();
  await page.locator('#measure').click(); assert.deepEqual(await page.locator('.result strong').allTextContents(), fixed);
  const downloadEvent = page.waitForEvent('download'); await page.locator('#save').click();
  const download = await downloadEvent; const downloadPath = await download.path();
  await page.locator('[data-preset="dream"]').click(); await page.locator('#import-file').setInputFiles(downloadPath);
  await page.waitForFunction(() => document.querySelector('#mode-label').textContent.includes('FIXED'));
  assert.deepEqual(await page.locator('.result strong').allTextContents(), fixed);
  await page.locator('#import-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":999}') });
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('壊れた'));
  assert.deepEqual(await page.locator('.result strong').allTextContents(), fixed);
  await page.waitForFunction(() => document.querySelector('#save-state').textContent.includes('保存済み'));
  await open(); assert.deepEqual(await page.locator('.result strong').allTextContents(), fixed);
  await page.locator('#bpm').fill('180'); await page.locator('#bpm').press('Tab');
  await page.locator('#play').click(); await page.waitForSelector('.result.active');
  await page.waitForFunction(() => document.querySelectorAll('.result')[1].classList.contains('active'), { timeout: 5000 });
  await page.locator('#stop').click(); assert.equal(await page.locator('.result.active').count(), 0);
  await page.locator('#play').click(); await page.locator('#stop').click();
  await page.waitForTimeout(200); assert.equal(await page.locator('.result.active').count(), 0);
  await page.locator('#help').click(); assert.equal(await page.locator('#help-dialog').evaluate(el => el.open), true);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#help-dialog').evaluate(el => el.open), false);
  await page.locator('[data-preset="dream"]').click();
  await page.locator('#measure').click();
  await mkdir('test-results', { recursive: true });
  await page.waitForSelector('#toast:not(.visible)');
  await page.locator('.topbar').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(100);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.locator('[data-gate="X"]').click(); await page.locator('[data-q="0"][data-col="0"]').click();
  await page.locator('.topbar').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  const traversal = await page.request.get(`${url}/.git/config`); assert.equal(traversal.status(), 404);
  assert.deepEqual(errors, []);
  console.log('Browser checks passed: interference, Bell correlation, editor, undo/redo, JSON round-trip, invalid imports, IndexedDB, playback, stop, help, mobile layout, server isolation.');
} catch (error) {
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/failure.png', fullPage: true });
  console.error('Browser console:', errors);
  throw error;
} finally { await browser.close(); }
