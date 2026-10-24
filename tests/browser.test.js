// Dev-only browser regressions. Requires Playwright and its Chromium browser.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  let token = '20261024a';
  let failAsset = null;
  const mount = '/cue-teleprompter/';
  const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const name = url.pathname === mount ? 'index.html' : url.pathname.slice(mount.length);
    if (!url.pathname.startsWith(mount) || !/^(index\.html|VERSION|manifest\.webmanifest|sw\.js|(?:css|js|icons)\/[\w.-]+)$/.test(name) || (name === failAsset && req.headers['sec-fetch-dest'] !== 'script')) {
      res.writeHead(404).end(); return;
    }
    try {
      let content = await fs.readFile(path.join(root, name));
      if (name === 'index.html') content = content.toString().replace(/\?v=\d{8}[a-z]+/g, '?v=' + token);
      res.writeHead(200, { 'Content-Type': types[path.extname(name)] || 'text/plain', 'Cache-Control': 'no-store' });
      res.end(content);
    } catch (_) { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + mount;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, ...(process.env.CUE_BROWSER_CHANNEL ? { channel: process.env.CUE_BROWSER_CHANNEL } : {}) });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      let now = 0, next = 0;
      const frames = new Map();
      performance.now = () => now;
      window.requestAnimationFrame = callback => { frames.set(++next, callback); return next; };
      window.cancelAnimationFrame = id => frames.delete(id);
      window.stepReader = seconds => {
        for (let left = seconds * 1000; left > 0;) {
          const dt = Math.min(10, left);
          now += dt; left -= dt;
          const batch = [...frames.values()]; frames.clear();
          batch.forEach(callback => callback(now));
        }
      };
      window.pendingLocks = [];
      window.locksReleased = 0;
      Object.defineProperty(navigator, 'wakeLock', { value: {
        request: () => new Promise(resolve => window.pendingLocks.push(() => resolve({
          release: async () => { window.locksReleased++; }, addEventListener() {}
        })))
      }});
    });
    await page.goto(url);
    const state = () => page.evaluate(() => window.__cueReader._state());
    const step = seconds => page.evaluate(s => window.stepReader(s), seconds);
    const open = async (text = '---\ntempo: 120\n---\none two three four') => {
      await page.evaluate(text => {
        const rec = CueStore.save({ text }); location.hash = '#/read/' + rec.id;
      }, text);
      await page.waitForSelector('.reader');
    };
    const exit = async () => {
      await page.getByRole('button', { name: 'Back to scripts' }).click();
      await page.waitForSelector('#new-script');
    };
    await open();
    assert.equal((await state()).total, 2);
    await page.getByRole('button', { name: 'Play', exact: true }).focus();
    await page.keyboard.press('Space');
    assert.equal((await state()).playing, true, 'Space on Play activates exactly once');
    await step(1);
    const beforeTouch = (await state()).pos;
    await page.locator('.w').last().click({ force: true });
    assert.deepEqual((await state()).pos, beforeTouch, 'text is inert while playing');
    await step(1.01);
    assert.equal((await state()).ended, true, '120 WPM takes two seconds for four words');
    await page.getByRole('button', { name: 'Restart', exact: true }).click();
    assert.equal((await state()).playing, true);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();

    await page.getByRole('button', { name: 'Faster', exact: true }).focus();
    await page.keyboard.press('Space');
    assert.equal((await state()).wpm, 125);
    assert.equal((await state()).playing, false, 'Space on Faster must not start the reader');
    await page.getByRole('button', { name: 'Text size' }).click();
    const slider = page.locator('[data-el="size"]');
    await slider.focus();
    const oldSize = Number(await slider.inputValue());
    await page.keyboard.press('ArrowRight');
    assert.equal(Number(await slider.inputValue()), oldSize + 2, 'range retains native arrow keys');
    await page.keyboard.press('ArrowUp');
    assert.equal((await state()).wpm, 125, 'range arrow keys must not alter WPM');
    await page.keyboard.press('Space');
    assert.equal((await state()).playing, false, 'Space in range must not toggle playback');

    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.down('Space');
    await page.keyboard.down('Space');
    await page.keyboard.up('Space');
    assert.equal((await state()).playing, true, 'held Space toggles only once');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.evaluate(() => document.activeElement.blur());
    const beforeDrag = (await state()).pos;
    await page.mouse.move(200, 400); await page.mouse.down();
    await page.keyboard.press('Space');
    await page.mouse.move(200, 180); await page.mouse.up();
    assert.deepEqual((await state()).pos, beforeDrag, 'starting Play cancels a paused drag');

    // One pending wake request, and a late result is released after leaving the reader.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.equal(await page.evaluate(() => pendingLocks.length), 1);
    await exit();
    await page.evaluate(() => pendingLocks.shift()());
    await page.waitForFunction(() => locksReleased === 1);

    // Native keyboard activation for library cards.
    await page.locator('.card__main').first().focus();
    await page.keyboard.press('Enter');
    await page.waitForSelector('.reader');
    await exit();

    await open('---\ntempo: 120\n---\none two\n[tempo 240]\nthree four\n[pause 3]\n[hold Applause]\n[tempo reset]\nfive six');
    assert.equal((await state()).total, 5.5);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await step(1.01);
    assert.equal((await state()).wpm, 240);
    await step(0.5);
    assert.equal(await page.locator('.is-now').textContent(), 'Pause 3s');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    const timedPause = (await state()).pos;
    await step(10);
    assert.deepEqual((await state()).pos, timedPause);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await step(3.1);
    assert.equal((await state()).holding, true);
    assert.equal((await state()).playing, false);
    assert.equal(await page.locator('.is-now').textContent(), 'Applause');
    await step(10);
    assert.equal((await state()).holding, true);
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await step(0.02);
    assert.equal((await state()).wpm, 120);
    await step(1);
    assert.equal((await state()).ended, true);
    await exit();
    await open('one\n[hold]\n[hold]');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await step(1);
    for (let k = 0; k < 2; k++) {
      assert.equal((await state()).holding, true);
      await page.getByRole('button', { name: 'Resume', exact: true }).click();
      await step(0.1);
    }
    assert.equal((await state()).ended, true);
    await exit();
    // The added punctuation time holds the scroll position still.
    await page.setViewportSize({ width: 390, height: 844 });
    await open('---\ntempo: 120\n---\nWelcome, to our wonderful evening with everyone here today.');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await step(0.51);
    const frozen = await page.locator('.reader__text').getAttribute('style');
    await step(0.2);
    assert.equal(await page.locator('.reader__text').getAttribute('style'), frozen);
    await exit();
    await page.getByRole('button', { name: 'Format', exact: true }).click();
    await page.waitForSelector('#copy-prompt');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Copy AI prompt' }).click();
    assert.match(await page.evaluate(() => navigator.clipboard.readText()), /\[tempo reset\]/);
    await page.getByRole('button', { name: '← Back', exact: true }).click();
    await page.waitForSelector('#new-script');

    // User defaults persist, override plain-text fallback, and toggle punctuation off.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('#profile').selectOption('formal');
    assert.equal(await page.locator('#default-tempo').inputValue(), '110');
    await page.locator('#default-tempo').fill('155');
    await page.locator('#punctuation').uncheck();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForSelector('#new-script');
    await page.reload();
    await open('one, two.');
    assert.equal((await state()).wpm, 155);
    assert.ok(Math.abs((await state()).total - 120 / 155) < 1e-9);
    await exit();
    await open();
    assert.equal((await state()).wpm, 120, 'header overrides saved defaults');
    await exit();
    await page.evaluate(() => CueStore.setSettings({ pacing: {} }));

    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await open('## Welcome\nSome *important* words for a phone.');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const box = await page.locator('.reader__ctl').boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width, 'controls fit ' + width);
      assert.equal(await page.evaluate(() => [...document.querySelectorAll('.w')].every(word => [...word.getClientRects()].every(rect => rect.left >= 0 && rect.right <= innerWidth))), true, 'large words fit ' + width);
      await page.screenshot({ path: '/private/tmp/cue-reader-' + width + '.png' });
      await exit();
    }

    await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('Storage blocked'); }; });
    await page.getByRole('button', { name: 'New script' }).click();
    await page.locator('#text').fill('A session-only script');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForSelector('#new-script');
    assert.match(await page.locator('#storage-warning').textContent(), /only for this session/);
    assert.equal(await page.locator('#storage-warning').isVisible(), true);
    assert.equal(await page.locator('.card__main').first().textContent().then(s => s.includes('A session-only script')), true);
    assert.deepEqual(errors, []);
    await context.close();

    // Real worker install, failed update, successful update, and offline reload.
    const pwaContext = await browser.newContext();
    const pwa = await pwaContext.newPage();
    await pwa.goto(url);
    await pwa.evaluate(async () => { await navigator.serviceWorker.ready; await caches.open('other-app-cache'); });
    await pwa.waitForFunction(() => navigator.serviceWorker.controller);
    await pwaContext.setOffline(true);
    await pwa.reload();
    await pwa.waitForSelector('#new-script');
    assert.match(await pwa.locator('script[src*="app.js"]').getAttribute('src'), /20261024a/);

    await pwaContext.setOffline(false);
    token = '20261024b'; failAsset = 'js/reader.js';
    const install = async () => pwa.evaluate(async token => {
      const reg = await navigator.serviceWorker.register('sw.js?v=' + token, { updateViaCache: 'none' });
      const worker = reg.installing;
      if (!worker) return reg.active && reg.active.scriptURL;
      return new Promise(resolve => worker.addEventListener('statechange', () => {
        if (worker.state === 'activated' || worker.state === 'redundant') resolve(worker.state);
      }));
    }, token);
    await pwa.goto(url);
    await pwa.waitForSelector('#new-script');
    assert.match(await pwa.locator('script[src*="app.js"]').getAttribute('src'), /20261024b/, 'online navigation can load the next release');
    assert.equal(await install(), 'redundant', 'failed precache cannot activate');
    await pwaContext.setOffline(true);
    await pwa.reload();
    await pwa.waitForSelector('#new-script');
    assert.match(await pwa.locator('script[src*="app.js"]').getAttribute('src'), /20261024a/, 'failed update preserves old offline shell');

    await pwaContext.setOffline(false);
    failAsset = null;
    assert.equal(await install(), 'activated');
    await pwa.waitForFunction(() => navigator.serviceWorker.controller.scriptURL.includes('20261024b'));
    await pwaContext.setOffline(true);
    await pwa.reload();
    await pwa.waitForSelector('#new-script');
    assert.match(await pwa.locator('script[src*="app.js"]').getAttribute('src'), /20261024b/);
    const cachesLeft = await pwa.evaluate(() => caches.keys());
    assert.ok(cachesLeft.includes('other-app-cache'), 'other apps’ caches are preserved');
    assert.equal(cachesLeft.filter(key => key.startsWith('cue-shell-v2:')).length, 1, 'obsolete CUE shell removed');
    await pwaContext.close();
    console.log('browser tests passed: reader, keyboard, phone layouts, wake lock, storage, and offline upgrades');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
