/* CUE — reader. Scrolls a script at a words-per-minute tempo.

   Position is kept as (token index, fraction through that token), never as a
   pixel offset, so it survives resizes and tempo changes. Each frame the
   position is turned into a scroll offset by interpolating between the
   vertical positions of the rendered lines, which keeps the motion smooth
   while still tracking exactly where the voice should be. */
(function (root) {
  'use strict';

  const F = root.CueFormat;
  const S = root.CueStore;

  const ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="4.5" width="4.2" height="15" rx="1.3" fill="currentColor"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.3" fill="currentColor"/></svg>',
    restart: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4.5h4.5"/></svg>',
    back: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>'
  };

  const MARKER = 0.38;          // reading line sits this far down the screen
  const IDLE_MS = 3000;         // dim the top bar after this long while playing
  const LINE_TOLERANCE = 6;     // px: words within this of each other share a line

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function open(host, rec, onExit) {
    const sc = F.parse(rec.text);
    const tokens = sc.tokens;
    const n = tokens.length;
    const base = sc.tempo;

    /* ---------- DOM ---------- */
    const root_ = document.createElement('div');
    root_.className = 'reader is-paused';
    let html = '';
    tokens.forEach((t, i) => {
      if (t.t === 'w') html += '<span class="w' + (t.em ? ' em' : '') + '" data-i="' + i + '">' + esc(t.s) + '</span> ';
      else if (t.t === 'h') html += '<div class="sect" data-i="' + i + '">' + esc(t.s) + '</div>';
      else html += '<div class="gap" data-i="' + i + '"></div>';
    });
    root_.innerHTML =
      '<div class="reader__stage"><div class="reader__text">' + html + '<div class="reader__end">end of script</div></div></div>' +
      '<div class="reader__top">' +
        '<button class="icon-btn" data-act="exit" aria-label="Back to scripts">' + ICON.back + '</button>' +
        '<div class="reader__title">' + esc(sc.title) + '</div>' +
        '<div class="reader__left mono" data-el="left"></div>' +
      '</div>' +
      '<div class="reader__bar">' +
        '<div class="reader__tempo mono" data-el="tempo"></div>' +
        '<button class="play-btn" data-act="toggle" aria-label="Play">' + ICON.play + '</button>' +
      '</div>';
    host.replaceChildren(root_);

    const stage = root_.querySelector('.reader__stage');
    const text = root_.querySelector('.reader__text');
    const playBtn = root_.querySelector('[data-act="toggle"]');
    const leftEl = root_.querySelector('[data-el="left"]');
    const tempoEl = root_.querySelector('[data-el="tempo"]');
    const els = new Array(n);
    text.querySelectorAll('[data-i]').forEach(e => { els[+e.dataset.i] = e; });

    /* ---------- timeline ---------- */
    let dur = new Float64Array(n);
    let T = new Float64Array(n + 1);   // start time of each token; T[n] = total
    let total = 0;

    function wpmAt(_i) { return base; }

    function buildTimeline() {
      let t = 0;
      for (let i = 0; i < n; i++) {
        dur[i] = F.tokenSeconds(tokens[i], wpmAt(i));
        T[i] = t;
        t += dur[i];
      }
      T[n] = t;
      total = t;
    }

    /* ---------- layout: where each line sits ---------- */
    let lines = [];            // { start, y }
    let lineOf = new Int32Array(n);

    function layout() {
      lines = [];
      let curY = -1e9;
      let forceNew = true;
      for (let i = 0; i < n; i++) {
        const e = els[i];
        const y = e.offsetTop + e.offsetHeight / 2;
        const isWord = tokens[i].t === 'w';
        if (forceNew || !isWord || Math.abs(y - curY) > LINE_TOLERANCE) {
          lines.push({ start: i, y });
          curY = y;
        }
        lineOf[i] = lines.length - 1;
        forceNew = !isWord;
      }
    }

    function yAt(i, f) {
      const k = lineOf[i];
      const line = lines[k];
      const next = lines[k + 1];
      if (!next) return line.y;
      const t0 = T[line.start];
      const span = T[next.start] - t0;
      if (span <= 0) return line.y;
      const frac = Math.min(1, Math.max(0, (T[i] + f * dur[i] - t0) / span));
      return line.y + (next.y - line.y) * frac;
    }

    function timeAtY(y) {
      if (!lines.length) return 0;
      if (y <= lines[0].y) return 0;
      for (let k = 0; k < lines.length; k++) {
        const next = lines[k + 1];
        if (!next) return total;
        if (y < next.y) {
          const frac = (y - lines[k].y) / (next.y - lines[k].y);
          return T[lines[k].start] + frac * (T[next.start] - T[lines[k].start]);
        }
      }
      return total;
    }

    function posAtTime(t) {
      t = Math.min(Math.max(0, t), total);
      let lo = 0, hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (T[mid] <= t) lo = mid; else hi = mid - 1;
      }
      const d = dur[lo];
      return { i: lo, f: d > 0 ? Math.min(1, (t - T[lo]) / d) : 0 };
    }

    /* ---------- state ---------- */
    let pos = { i: Math.min(Math.max(0, rec.pos || 0), Math.max(0, n - 1)), f: 0 };
    let playing = false;
    let ended = false;
    let raf = 0;
    let last = 0;
    let shownI = -1;
    let shownLeft = '';
    let idleTimer = 0;

    function timeNow() { return T[pos.i] + pos.f * dur[pos.i]; }

    function updateHighlight() {
      if (pos.i === shownI) return;
      const from = shownI < 0 ? 0 : Math.min(shownI, pos.i);
      const to = shownI < 0 ? n - 1 : Math.max(shownI, pos.i);
      for (let i = from; i <= to; i++) {
        els[i].classList.toggle('is-past', i < pos.i);
        els[i].classList.toggle('is-now', i === pos.i);
      }
      shownI = pos.i;
    }

    function updateReadouts() {
      const left = '~' + F.formatDuration(total - timeNow()) + ' left';
      if (left !== shownLeft) { leftEl.textContent = left; shownLeft = left; }
    }

    function render() {
      if (!n) return;
      const y = yAt(pos.i, pos.f);
      text.style.transform = 'translate3d(0,' + (stage.clientHeight * MARKER - y).toFixed(1) + 'px,0)';
      updateHighlight();
      updateReadouts();
    }

    function setPlayIcon() {
      const icon = ended ? 'restart' : (playing ? 'pause' : 'play');
      playBtn.innerHTML = ICON[icon];
      playBtn.setAttribute('aria-label', ended ? 'Restart' : (playing ? 'Pause' : 'Play'));
      root_.classList.toggle('is-paused', !playing);
      root_.classList.toggle('is-ended', ended);
    }

    function savePos() {
      S.save({ id: rec.id, pos: ended ? 0 : pos.i }, false);
    }

    function wake() {
      root_.classList.remove('is-idle');
      clearTimeout(idleTimer);
      if (playing) idleTimer = setTimeout(() => root_.classList.add('is-idle'), IDLE_MS);
    }

    function advance(dt) {
      let rem = dt;
      while (rem > 0 && pos.i < n) {
        const d = dur[pos.i];
        const leftHere = d * (1 - pos.f);
        if (rem < leftHere) { pos.f += rem / d; rem = 0; }
        else { rem -= leftHere; pos.i++; pos.f = 0; }
      }
      if (pos.i >= n) {
        pos = { i: n - 1, f: 1 };
        ended = true;
        pause();
      }
    }

    function frame(now) {
      if (!playing) return;
      const dt = Math.min(0.1, (now - last) / 1000);   // a background tab must not make it jump
      last = now;
      advance(dt);
      render();
      if (playing) raf = requestAnimationFrame(frame);
    }

    function play() {
      if (n === 0) return;
      if (ended) { pos = { i: 0, f: 0 }; ended = false; shownI = -1; }
      playing = true;
      last = performance.now();
      setPlayIcon();
      wake();
      raf = requestAnimationFrame(frame);
    }

    function pause() {
      playing = false;
      cancelAnimationFrame(raf);
      setPlayIcon();
      wake();
      render();
      savePos();
    }

    function toggle() { playing ? pause() : play(); }

    /* ---------- paused-only interaction: scrub and tap-to-jump ---------- */
    let drag = null;
    stage.addEventListener('pointerdown', (e) => {
      wake();
      if (playing) return;   // text is inert while playing so a stray touch can't move you
      drag = { startClientY: e.clientY, startY: yAt(pos.i, pos.f), moved: false, target: e.target };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = e.clientY - drag.startClientY;
      if (!drag.moved && Math.abs(dy) < 6) return;
      drag.moved = true;
      pos = posAtTime(timeAtY(drag.startY - dy));
      ended = false;
      setPlayIcon();
      render();
    });
    function endDrag(e) {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (!d.moved) {
        const hit = d.target.closest && d.target.closest('[data-i]');
        if (hit) { pos = { i: +hit.dataset.i, f: 0 }; ended = false; setPlayIcon(); render(); }
      }
      savePos();
    }
    stage.addEventListener('pointerup', endDrag);
    stage.addEventListener('pointercancel', endDrag);

    /* ---------- controls ---------- */
    function exit() {
      if (playing) pause(); else savePos();
      onExit();
    }
    root_.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      if (btn.dataset.act === 'toggle') toggle();
      else if (btn.dataset.act === 'exit') exit();
    });
    function onKey(e) {
      if (e.code === 'Space') { e.preventDefault(); toggle(); }
      else if (e.code === 'Escape') exit();
    }
    document.addEventListener('keydown', onKey);
    function onVisibility() { if (document.hidden && playing) pause(); }
    document.addEventListener('visibilitychange', onVisibility);
    root_.addEventListener('pointermove', wake);

    const ro = new ResizeObserver(() => { layout(); render(); });
    ro.observe(stage);

    /* ---------- init ---------- */
    tempoEl.textContent = base + ' WPM';
    buildTimeline();
    layout();
    setPlayIcon();
    render();
    if (n === 0) playBtn.disabled = true;

    return {
      destroy() {
        playing = false;
        savePos();
        cancelAnimationFrame(raf);
        clearTimeout(idleTimer);
        ro.disconnect();
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('visibilitychange', onVisibility);
      },
      // exposed for tests
      _state: () => ({ pos: { ...pos }, playing, ended, total, lines: lines.length })
    };
  }

  root.CueReader = { open };
})(self);
