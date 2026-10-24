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
    // Reader frames are manual; async UI checks must poll independently of requestAnimationFrame.
    const until = (fn, arg) => page.waitForFunction(fn, arg, { polling: 25 });
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
    assert.equal(await page.evaluate(() => CueFormat.parse(CueStore.get('cue-tutorial').text).words), 707);
    await page.evaluate(() => CueStore.save({ id: 'cue-tutorial', text: 'My tutorial edits' }));
    await page.reload();
    assert.equal(await page.evaluate(() => CueStore.get('cue-tutorial').text), 'My tutorial edits');
    await page.evaluate(() => CueStore.remove('cue-tutorial'));
    await page.reload();
    assert.equal(await page.evaluate(() => CueStore.get('cue-tutorial')), null);
    await page.getByRole('button', { name: 'Tutorial', exact: true }).click();
    await page.waitForSelector('.reader');
    assert.ok((await state()).total > 290 && (await state()).total < 330);
    assert.equal(await page.locator('.agenda [data-section]').count(), 6);
    await exit();
    await page.reload();
    assert.equal(await page.evaluate(() => CueStore.list().filter(rec => rec.id === 'cue-tutorial').length), 1);

    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => CueStore.setSettings({ focusMode: 'line', fontSize: 44 }));
      await open(await page.evaluate(() => CueTutorial.text.replace(/tempo: \d+/, 'tempo: 300')));
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      const stress = await page.evaluate(() => {
        const tokens = CueFormat.parse(CueStore.get(location.hash.split('/').pop()).text).tokens;
        let previous = window.__cueReader._state();
        let y = new DOMMatrixReadOnly(document.querySelector('.reader__text').style.transform).m42;
        let maxCueExit = 0;
        for (let k = 0; k < 50000; k++) {
          if (previous.holding) document.querySelector('[data-act="toggle"]').click();
          stepReader(1 / 120);
          const next = window.__cueReader._state();
          const nextY = new DOMMatrixReadOnly(document.querySelector('.reader__text').style.transform).m42;
          if (previous.pos.i !== next.pos.i && ['pause', 'hold'].includes(tokens[previous.pos.i].t)) maxCueExit = Math.max(maxCueExit, Math.abs(nextY - y));
          previous = next; y = nextY;
          if (next.ended) break;
        }
        return { maxCueExit, ended: previous.ended };
      });
      assert.equal(stress.ended, true);
      assert.ok(stress.maxCueExit < 8, 'no visible cue-exit jump at 300 WPM: ' + stress.maxCueExit);
      console.log('300 WPM tutorial (' + width + 'px): largest cue-exit step ' + stress.maxCueExit.toFixed(1) + 'px');
      await exit();
    }
    await page.evaluate(() => pendingLocks.splice(0).forEach(resolve => resolve()));
    await until(() => locksReleased === 2);
    await page.evaluate(() => { locksReleased = 0; CueStore.setSettings({ focusMode: 'word', fontSize: null }); });
    await page.setViewportSize({ width: 1280, height: 720 });

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
    const dragStage = await page.locator('.reader__stage').boundingBox();
    await page.mouse.move(dragStage.x + 100, 400); await page.mouse.down();
    await page.keyboard.press('Space');
    await page.mouse.move(dragStage.x + 100, 180); await page.mouse.up();
    assert.deepEqual((await state()).pos, beforeDrag, 'starting Play cancels a paused drag');

    // One pending wake request, and a late result is released after leaving the reader.
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    assert.equal(await page.evaluate(() => pendingLocks.length), 1);
    await exit();
    await page.evaluate(() => pendingLocks.shift()());
    await until(() => locksReleased === 1);

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

    await page.setViewportSize({ width: 1440, height: 900 });
    await open('## Welcome\none two\n## Awards\nthree four');
    assert.equal(await page.locator('.reader__agenda').isVisible(), true);
    assert.equal(await page.locator('.reader__agenda [data-section="0"]').getAttribute('aria-current'), 'true');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Agenda', exact: true }).click();
    assert.equal((await state()).playing, false, 'agenda pauses the reader');
    await page.locator('.agenda [data-section="1"]').click();
    assert.equal(await page.locator('.is-now').textContent(), 'Awards');
    assert.equal(await page.locator('.reader__agenda [data-section="1"]').getAttribute('aria-current'), 'true');
    assert.equal(await page.locator('.reader__agenda [data-section="0"]').getAttribute('data-state'), 'earlier');
    await page.locator('.reader__agenda [data-section="0"]').click();
    assert.equal((await state()).playing, false);
    assert.equal(await page.locator('.is-now').textContent(), 'Welcome');
    await page.keyboard.press('Digit1');
    assert.equal(await page.locator('.is-now').textContent(), 'Welcome');
    await page.keyboard.press('PageDown');
    assert.equal(await page.locator('.is-now').textContent(), 'Awards');
    await page.keyboard.press('PageUp');
    assert.equal(await page.locator('.is-now').textContent(), 'Welcome');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await step(2);
    assert.equal(await page.locator('.reader__agenda [data-section="1"]').getAttribute('aria-current'), 'true', 'agenda follows playback');
    await page.getByRole('button', { name: 'Agenda', exact: true }).click();
    await page.screenshot({ path: '/private/tmp/cue-agenda.png' });
    await page.keyboard.press('Escape');
    assert.equal(await page.locator('.agenda').isVisible(), false);
    await exit();
    await page.evaluate(() => CueStore.setSettings({ startDelay: 3 }));
    await open();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await step(2);
    assert.equal((await state()).pos.i, 0);
    assert.equal((await state()).elapsed, 0, 'countdown excluded from reading time');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    assert.equal((await state()).countdown, 0, 'Pause cancels countdown');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await step(3.05);
    assert.equal((await state()).countdown, 0);
    assert.ok((await state()).elapsed < 0.06);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    assert.equal((await state()).countdown, 0, 'ordinary resume is immediate');
    await exit();
    await page.evaluate(() => CueStore.setSettings({ startDelay: 0 }));

    // Reorder source chapters, not just their agenda labels.
    const reorderSource = '---\ntitle: Reorder practice\ntempo: 120\n---\nOpening words stay first.\n\n## Alpha\nAlpha body.\n[note Alpha cue]\n\n## Beta\n[pause 2]\nBeta body.\n\n## Gamma\nGamma body.\n[hold Gamma cue]';
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(reorderSource);
    const recordId = await page.evaluate(() => location.hash.split('/').pop());
    const storedHeads = () => page.evaluate(id => CueFormat.parse(CueStore.get(id).text).tokens.filter(t => t.t === 'h').map(t => t.s), recordId);
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.locator('.reader__agenda [data-act="reorder"]').click();
    assert.equal((await state()).playing, false);
    const sourceHandle = await page.locator('.reader__agenda [data-reorder-handle="2"]').boundingBox();
    const targetRow = await page.locator('.reader__agenda [data-agenda-row="0"]').boundingBox();
    await page.mouse.move(sourceHandle.x + 12, sourceHandle.y + 20); await page.mouse.down();
    await page.mouse.move(sourceHandle.x + 12, targetRow.y + targetRow.height / 2, { steps: 8 });
    await page.mouse.up();
    await until(id => CueFormat.parse(CueStore.get(id).text).tokens.filter(t => t.t === 'h')[0].s === 'Gamma', recordId);
    assert.deepEqual(await storedHeads(), ['Gamma', 'Alpha', 'Beta']);
    assert.equal((await state()).reordering, true);
    assert.equal(await page.locator('.is-now').textContent(), 'Gamma');
    assert.ok(await page.evaluate(id => CueStore.get(id).text.startsWith('---\ntitle: Reorder practice\ntempo: 120\n---\nOpening words stay first.'), recordId));
    await page.locator('.reader__agenda [data-move-section="0"][data-direction="1"]').click();
    assert.deepEqual(await storedHeads(), ['Alpha', 'Gamma', 'Beta']);
    await page.locator('.reader__agenda [data-reorder-handle="1"]').press('ArrowDown');
    assert.deepEqual(await storedHeads(), ['Alpha', 'Beta', 'Gamma']);
    await page.locator('.reader__agenda [data-act="reorder"]').click();
    assert.equal((await state()).reordering, false);
    await exit();
    await page.setViewportSize({ width: 390, height: 844 });
    await open(reorderSource);
    await page.getByRole('button', { name: 'Agenda', exact: true }).click();
    await page.locator('.agenda [data-act="reorder"]').click();
    await page.locator('.agenda [data-move-section="2"][data-direction="-1"]').click();
    assert.equal(await page.locator('.agenda').isVisible(), true, 'phone reorder keeps agenda open');
    assert.equal(await page.locator('.agenda [data-section="1"] .agenda__label').textContent(), 'Gamma');
    await page.screenshot({ path: '/private/tmp/cue-agenda-reordering-phone.png' });
    await page.locator('.agenda [data-act="reorder"]').click();
    await page.keyboard.press('Escape');
    await exit();

    // Focus modes preserve place and pace; duration estimates follow their different punctuation behavior.
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    await page.locator('#reading-focus').selectOption('line');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForSelector('#new-script');
    await page.reload();
    const focusScript = '---\ntitle: Annual Club Evening\ntempo: 140\n---\n## Welcome\nGood evening, everyone. Welcome to our annual celebration. Tonight we recognise our volunteers and celebrate the projects we created together.\n\n## Our next guest\nPlease welcome our president to the stage.\n[hold Applause]\nThank you for joining us.';
    await page.evaluate(() => CueStore.setSettings({ fontSize: 44 }));
    for (const size of [{ width: 390, height: 844 }, { width: 1440, height: 900 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(size);
      await open(focusScript);
      assert.equal((await state()).focusMode, 'line');
      assert.equal(await page.locator('.reader__agenda').isVisible(), size.width >= 1180);
      assert.equal(await page.locator('.reader__section').isVisible(), size.width < 1180);
      assert.match(await page.locator('[data-el="sectionTitle"]').textContent(), /Welcome/);
      assert.match(await page.locator('[data-el="sectionNext"]').textContent(), /Our next guest/);
      assert.match(await page.locator('.agenda [data-section="1"] [data-section-time]').textContent(), /hold/);
      const guide = await page.locator('.reader__guide').boundingBox();
      const stage = await page.locator('.reader__stage').boundingBox();
      assert.ok(Math.abs(guide.y + guide.height / 2 - (stage.y + stage.height / 2)) < 1, 'guide is centred');
      const rowHeight = await page.locator('.reader__text').evaluate(e => parseFloat(getComputedStyle(e).lineHeight));
      if (size.height >= 800) assert.ok(Math.abs(guide.height - rowHeight * 3) < 1, 'guide defaults to three text rows');
      assert.match(await page.locator('.reader__fade--past').evaluate(e => getComputedStyle(e).backdropFilter), /blur\(3px\)/);
      const past = await page.locator('.reader__fade--past').boundingBox();
      const future = await page.locator('.reader__fade--next').boundingBox();
      assert.ok(Math.abs(past.y + past.height - guide.y) < 1, 'past blur ends at guide edge');
      assert.ok(Math.abs(future.y - guide.y - guide.height) < 1, 'future fade begins below guide');
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await step(1.2);
      const snapshot = await state();
      await page.getByRole('button', { name: 'Text size' }).click();
      if (size.height >= 800) {
        await page.getByLabel('Guide height', { exact: true }).selectOption('4');
        assert.ok(Math.abs((await page.locator('.reader__guide').boundingBox()).height - rowHeight * 4) < 1);
        assert.deepEqual((await state()).pos, snapshot.pos);
        await page.getByLabel('Guide height', { exact: true }).selectOption('3');
      }
      await page.getByLabel('Reading focus', { exact: true }).selectOption('word');
      assert.equal((await state()).pos.i, snapshot.pos.i);
      assert.equal((await state()).playing, true);
      assert.ok((await state()).total > snapshot.total, 'word mode includes punctuation pauses');
      assert.equal((await state()).wpm, snapshot.wpm);
      await page.getByRole('button', { name: 'Text size' }).click();
      await page.screenshot({ path: '/private/tmp/cue-focus-word-' + size.width + '.png' });
      await page.getByRole('button', { name: 'Text size' }).click();
      await page.getByLabel('Reading focus', { exact: true }).selectOption('line');
      assert.equal((await state()).pos.i, snapshot.pos.i);
      assert.ok(Math.abs((await state()).total - snapshot.total) < 1e-8);
      await page.getByRole('button', { name: 'Text size' }).click();
      await page.screenshot({ path: '/private/tmp/cue-focus-line-' + size.width + '.png' });
      if (size.width === 1440) {
        const beforeResize = await state();
        await page.setViewportSize({ width: 390, height: 844 });
        assert.deepEqual((await state()).pos, beforeResize.pos);
        assert.equal((await state()).total, beforeResize.total);
        assert.equal(await page.locator('.reader__section').isVisible(), true);
        await page.setViewportSize(size);
      }
      if (size.width < 1180) {
        await page.getByRole('button', { name: 'Open event agenda' }).click();
        assert.equal((await state()).playing, false);
        await page.locator('.agenda [data-section="1"]').click();
        assert.equal(await page.locator('[data-el="sectionTitle"]').textContent(), 'Our next guest');
        assert.equal(await page.locator('[data-el="sectionNext"]').textContent(), 'Final section');
      }
      const controls = await page.locator('.reader__ctl').boundingBox();
      assert.ok(controls.y >= guide.y + guide.height, 'controls stay below focus band');
      await exit();
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => CueStore.setSettings({ focusMode: 'line', fontSize: 36 }));
    const continuous = '---\ntitle: A Community Evening\ntempo: 120\n---\nWelcome, everyone. Today we celebrate every volunteer in our community. Your work has made a lasting difference to many people. Thank you for bringing such kindness and energy into this room. We will hear from our president and welcome our next guest. There is a wonderful evening ahead for all of us.';
    await open(continuous);
    assert.equal((await state()).total, await page.evaluate(text => CueFormat.parse(text).words * 0.5, continuous));
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await step(0.3);
    let priorY = null;
    for (let k = 0; k < 40; k++) {
      await step(0.05);
      const y = await page.locator('.reader__text').evaluate(e => new DOMMatrixReadOnly(e.style.transform).m42);
      if (priorY !== null) assert.ok(y < priorY, 'centre guide keeps moving through commas and full stops');
      priorY = y;
    }
    await step(9.7);
    await page.screenshot({ path: '/private/tmp/cue-centre-refined-390.png' });
    await exit();
    // Even a one-line script can be scrubbed within its last line while paused.
    await open('---\ntempo: 120\n---\none two three four');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await step(1);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await page.mouse.move(160, 250); await page.mouse.down();
    await page.mouse.move(160, 240); await page.mouse.up();
    assert.equal((await state()).pos.i, 2, 'small scrub does not jump to the end of the final line');
    await exit();
    await open('---\ntempo: 120\n---\none\n[pause 1]\ntwo\n[hold Applause]\nthree.');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await step(0.6);
    const explicitPause = await page.locator('.reader__text').getAttribute('style');
    await step(0.2);
    assert.equal(await page.locator('.reader__text').getAttribute('style'), explicitPause, 'explicit pause still stops centre guide');
    await step(1.4);
    assert.equal((await state()).holding, true);
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await step(0.51);
    assert.equal((await state()).ended, true);
    await exit();
    await page.evaluate(() => CueStore.setSettings({ focusMode: 'word', fontSize: null }));
    await page.setViewportSize({ width: 390, height: 844 });

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

    // Import validates everything first, skips exact duplicates, and never overwrites records.
    const beforeImport = await page.evaluate(() => CueStore.list().length);
    const sourceText = '---\ntitle: Backup Round Trip\ntempo: 120\n---\n## Welcome\nLiteral <img src=x onerror=alert(1)> text.\n[hold Applause]';
    const fixture = JSON.stringify({ format: 'cue-library', schema: 1, scripts: [{ text: sourceText }, { text: sourceText }] });
    const upload = text => page.locator('#restore').setInputFiles({ name: 'cue-scripts.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await upload(fixture);
    await until(n => CueStore.list().length === n + 1, beforeImport);
    await upload(fixture);
    await until(() => document.getElementById('toast').textContent.includes('already'));
    assert.equal(await page.evaluate(() => CueStore.list().length), beforeImport + 1);
    await upload('{"format":"cue-library","schema":1,"scripts":[{"text":"Never partially import"},{"text":5}]}');
    await until(() => document.getElementById('toast').textContent.includes('invalid'));
    assert.equal(await page.evaluate(() => CueStore.list().length), beforeImport + 1);
    let roundTrip = page.locator('.card').filter({ hasText: 'Backup Round Trip' });
    await roundTrip.locator('summary').click();
    const textDownload = await Promise.all([page.waitForEvent('download'), roundTrip.getByRole('button', { name: 'Export text' }).click()]).then(results => results[0]);
    assert.equal(await fs.readFile(await textDownload.path(), 'utf8'), sourceText);
    await roundTrip.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await page.waitForSelector('#text');
    assert.match(await page.locator('#text').inputValue(), /Backup Round Trip — copy/);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.waitForSelector('#new-script');
    const search = page.getByRole('searchbox', { name: 'Search scripts' });
    await search.fill('round trip');
    assert.equal(await page.locator('.card:visible').count(), 2);
    await search.fill('nothing-matches-this-query');
    assert.equal(await page.locator('.card:visible').count(), 0);
    assert.equal(await page.locator('#search-status').textContent(), 'No matching scripts');
    await search.fill('');
    const libraryDownload = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Back up scripts' }).click()]).then(results => results[0]);
    const backedUp = JSON.parse(await fs.readFile(await libraryDownload.path(), 'utf8'));
    assert.equal(backedUp.scripts.length, beforeImport + 2);
    assert.deepEqual(Object.keys(backedUp.scripts[0]), ['text']);
    assert.equal(await page.locator('.card img').count(), 0, 'imported markup is inert');
    await page.screenshot({ path: '/private/tmp/cue-library-final.png' });
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'library fits phone');
      await page.screenshot({ path: '/private/tmp/cue-library-' + width + '.png' });
      await page.getByRole('button', { name: 'Settings', exact: true }).click();
      await page.waitForSelector('#delivery');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'settings fit phone');
      await page.screenshot({ path: '/private/tmp/cue-settings-' + width + '.png' });
      await page.getByRole('button', { name: '← Back', exact: true }).click();
      await page.waitForSelector('#new-script');
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
