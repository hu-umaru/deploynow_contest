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
  assert.ok((await page.locator('#source-title').textContent()).includes('歓喜の歌'));
  assert.equal(await page.locator('.measurement-marker').count(), 4);
  await page.locator('[data-remix="faithful"]').click();
  await page.locator('#measure').click();
  assert.equal(await page.locator('.result strong').count(), 16);
  assert.ok((await page.locator('.result strong').allTextContents()).every(s => s === '11000'));
  await page.locator('[data-remix="gentle"]').click();
  assert.equal(await page.locator('.prob-value').nth(0).textContent(), '75%');
  await page.locator('[data-demo="twinkle"]').click();
  assert.ok((await page.locator('#source-title').textContent()).includes('きらきら星'));
  await page.locator('#score-file').setInputFiles('public/ode-to-joy.musicxml');
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('楽譜を16列'));
  assert.ok((await page.locator('#source-title').textContent()).includes('歓喜の歌'));
  assert.ok((await page.locator('#conversion-summary').textContent()).includes('19音'));
  await page.locator('#score-file').setInputFiles({ name: 'invalid.xml', mimeType: 'application/xml', buffer: Buffer.from('<score-partwise>') });
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('score-partwise'));
  assert.ok((await page.locator('#source-title').textContent()).includes('歓喜の歌'));
  // Real browser DOMParser: ties, two voices, rests, chords, dotted metronome, forward/backup and malformed input.
  const parser = await page.evaluate(async () => {
    const { parseMusicXML } = await import('/src/musicxml.js');
    const wrap = measures => `<score-partwise><part-list/><part id="P1">${measures}</part></score-partwise>`;
    const note = (step, duration, extra = '') => `<note><pitch><step>${step}</step><octave>4</octave></pitch><duration>${duration}</duration>${extra}</note>`;
    const xml = wrap(`<measure><attributes><divisions>2</divisions></attributes><direction><direction-type><metronome><beat-unit>quarter</beat-unit><beat-unit-dot/><per-minute>80</per-minute></metronome></direction-type></direction>${note('C',8,'<tie type="start"/><voice>1</voice>')}<backup><duration>8</duration></backup>${note('E',2,'<voice>2</voice>')}<note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>2</voice></note><note><rest/><duration>2</duration></note><forward><duration>4</duration></forward></measure><measure>${note('C',2,'<tie type="stop"/><voice>1</voice>')}<note><rest/><duration>6</duration></note></measure>`);
    const result = parseMusicXML(xml);
    const invalid = [wrap('<measure><attributes><divisions>0</divisions></attributes></measure>'), wrap(`<measure><attributes><transpose><chromatic>2</chromatic></transpose></attributes>${note('C',1)}</measure>`), '<score-timewise/>', '<!DOCTYPE x [<!ENTITY x "bad">]><score-partwise/>'];
    return { bpm: result.bpm, notes: result.notes, rejected: invalid.map(x => { try { parseMusicXML(x); return false; } catch { return true; } }) };
  });
  assert.equal(parser.bpm, 120);
  assert.deepEqual(parser.notes.map(n => [n.midi, n.start, n.duration]), [[67, 0, 1], [64, 0, 1], [60, 0, 5]]);
  assert.ok(parser.rejected.every(Boolean));
  await page.locator('#freeze').click(); const fixed = await page.locator('.result strong').allTextContents();
  await page.locator('#measure').click(); assert.deepEqual(await page.locator('.result strong').allTextContents(), fixed);
  const downloadEvent = page.waitForEvent('download'); await page.locator('#save').click();
  const download = await downloadEvent; const downloadPath = await download.path();
  await page.locator('[data-preset="dream"]').click(); await page.locator('#import-file').setInputFiles(downloadPath);
  await page.waitForFunction(() => document.querySelector('#mode-label').textContent.includes('FIXED'));
  assert.deepEqual(await page.locator('.result strong').allTextContents(), fixed);
  assert.ok((await page.locator('#source-title').textContent()).includes('歓喜の歌'));
  await page.locator('#import-file').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{"version":999}') });
  await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('壊れた'));
  assert.deepEqual(await page.locator('.result strong').allTextContents(), fixed);
  await page.waitForFunction(() => document.querySelector('#save-state').textContent.includes('保存済み'));
  await open(); assert.deepEqual(await page.locator('.result strong').allTextContents(), fixed);
  await page.locator('#bpm').fill('180'); await page.locator('#bpm').press('Tab');
  await page.locator('#listen-compare').click();
  await page.waitForFunction(() => document.querySelector('#playback-mode').textContent.includes('A 原曲'));
  await page.waitForFunction(() => document.querySelector('#playback-mode').textContent.includes('B 量子'), null, { timeout: 10000 });
  await page.locator('#stop').click(); assert.equal(await page.locator('.result.active').count(), 0);
  await page.locator('#play').click();
  await page.waitForSelector('[data-result="1"].active', { timeout: 2000 });
  assert.equal(await page.locator('[data-beat="1"]').getAttribute('aria-pressed'), 'true');
  await page.locator('#stop').click();
  await page.locator('#play').click(); await page.locator('#stop').click();
  await page.waitForTimeout(200); assert.equal(await page.locator('.result.active').count(), 0);
  await page.locator('[data-preset="interference"]').click();
  for (const [beat, expected] of [[0, '0%'], [1, '50%'], [2, '50%'], [3, '50%']]) {
    await page.locator(`[data-beat="${beat}"]`).click();
    assert.equal(await page.locator('.prob-value').nth(2).textContent(), expected);
  }
  await page.locator('[data-bar="0"]').click();
  await page.getByRole('button', { name: 'この小節をクリア' }).click();
  await page.locator('[data-gate="PAIR"]').click();
  await page.locator('[data-q="0"][data-col="0"]').click(); await page.locator('[data-q="4"][data-col="0"]').click();
  assert.deepEqual(await page.locator('.distribution-row code').allTextContents(), ['00000', '10001']);
  assert.equal(await page.locator('.cnot-wire').count(), 1);
  await page.getByRole('button', { name: '元に戻す', exact: true }).click(); assert.equal(await page.locator('.cnot-wire').count(), 0);
  await page.getByRole('button', { name: 'やり直す', exact: true }).click(); assert.equal(await page.locator('.cnot-wire').count(), 1);
  await page.locator('#help').click(); assert.equal(await page.locator('#help-dialog').evaluate(el => el.open), true);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#help-dialog').evaluate(el => el.open), false);
  await page.locator('[data-demo="ode"]').click();
  await page.locator('#measure').click();
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
  console.log('Browser checks passed: MusicXML piano import, voices/chords/ties/tempo/rests, invalid files, source encoding, A/B alternating playback, measurement every beat, collapse-aware probabilities, composite gates, JSON/IndexedDB, undo/redo, stop, help, responsive layout.');
} catch (error) {
  await mkdir('test-results', { recursive: true });
  await page.screenshot({ path: 'test-results/failure.png', fullPage: true });
  console.error('Browser console:', errors);
  throw error;
} finally { await browser.close(); }
