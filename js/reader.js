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
    back: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="2.6" height="14" rx="1.1" fill="currentColor"/><path d="M19 6.2v11.6a.9.9 0 0 1-1.4.75l-8.6-5.8a.9.9 0 0 1 0-1.5l8.6-5.8A.9.9 0 0 1 19 6.2z" fill="currentColor"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="16.4" y="5" width="2.6" height="14" rx="1.1" fill="currentColor"/><path d="M5 6.2v11.6a.9.9 0 0 0 1.4.75l8.6-5.8a.9.9 0 0 0 0-1.5L6.4 5.45A.9.9 0 0 0 5 6.2z" fill="currentColor"/></svg>',
    minus: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 12h12"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 12h12M12 6v12"/></svg>'
  };

  const TEMPO_STEP = 5;         // WPM per press of slower / faster
  const SKIP_BACK_GRACE = 1.5;  // seconds into a sentence before "previous" restarts it instead of going back
  const SIZE_MIN = 24;
  const SIZE_MAX = 96;

  const MARKER = 0.38;          // reading line sits this far down the screen
  const IDLE_MS = 3000;         // dim the top bar after this long while playing
  const LINE_TOLERANCE = 6;     // px: words within this of each other share a line

  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function open(host, rec, onExit, onReorder, options = {}) {
    let focusMode = S.settings().focusMode === 'line' ? 'line' : 'word';
    let guideRows = [3, 4, 5].includes(S.settings().guideRows) ? S.settings().guideRows : 3;
    let visual = F.readerLayout(S.settings());
    const marker = () => focusMode === 'line' ? 0.5 : MARKER;
    const pacing = F.pacing(S.settings().pacing);
    const sc = F.parse(rec.text, pacing);
    const tokens = sc.tokens;
    const n = tokens.length;
    const base = sc.tempo;
    const starts = F.sentenceStarts(tokens);
    const sections = tokens.flatMap((t, i) => t.t === 'h' ? [{ i, title: t.s }] : []);
    const startDelay = [3, 5, 10].includes(S.settings().startDelay) ? S.settings().startDelay : 0;
    let adj = Number.isFinite(rec.adj) ? rec.adj : 0;   // live +/- offset on top of the script tempo
    let wpm = F.clampTempo(base + adj);

    /* ---------- DOM ---------- */
    const root_ = document.createElement('div');
    root_.className = 'reader is-paused' + (sections.length ? ' reader--sections' : '');
    let html = '';
    tokens.forEach((t, i) => {
      if (t.t === 'w') html += '<span class="w' + (t.em ? ' em' : '') + '" data-i="' + i + '">' + esc(t.s) + '</span> ';
      else if (t.t === 'pause' || t.t === 'hold') html += '<span class="cue cue--wait" data-i="' + i + '">' + esc(t.t === 'pause' ? 'Ⅱ Pause ' + t.seconds + 's' : 'Ⅱ Hold · ' + t.s) + '</span> ';
      else if (t.t === 'note') html += '<div class="cue" data-i="' + i + '">' + esc(t.t === 'pause' ? 'Pause ' + t.seconds + 's' : t.s) + '</div>';
      else if (t.t === 'h') html += '<div class="sect" data-i="' + i + '">' + esc(t.s) + '</div>';
      else html += '<div class="gap" data-i="' + i + '"></div>';
    });
    function sectionButton(section, k) {
      const label = esc(section.title);
      return '<div class="agenda__row" data-agenda-row="' + k + '"><button class="agenda__handle" data-reorder-handle="' + k + '" aria-label="Drag section ' + label + '" title="Drag to move; arrow keys also work">⠿</button><button class="btn agenda__item" data-section="' + k + '"><span class="agenda__number" aria-hidden="true">' + String(k + 1).padStart(2, '0') + '</span><span class="agenda__content"><span class="agenda__label">' + label + '</span><span class="agenda__meta"><span data-section-state></span><span class="mono" data-section-time="' + k + '"></span></span></span></button><div class="agenda__moves"><button class="btn btn--small" data-move-section="' + k + '" data-direction="-1" aria-label="Move ' + label + ' up"' + (k === 0 ? ' disabled' : '') + '>↑ Up</button><button class="btn btn--small" data-move-section="' + k + '" data-direction="1" aria-label="Move ' + label + ' down"' + (k === sections.length - 1 ? ' disabled' : '') + '>↓ Down</button></div></div>';
    }
    const sectionList = sections.map(sectionButton).join('');
    const sidebar = sections.length ? '<aside class="reader__agenda" aria-label="Event agenda markers"><div class="reader__agenda-head"><h2>Event agenda</h2><span class="mono">' + sections.length + ' sections</span><button class="btn btn--small" data-act="reorder" aria-pressed="false">Reorder</button></div><nav class="agenda-list" aria-label="Script sections">' + sectionList + '</nav><p class="reader__agenda-hint">Select a section to pause and jump.</p></aside>' : '';
    const sectionStrip = sections.length ? '<button class="reader__section" data-act="agenda" aria-label="Open event agenda"><span class="reader__section-number mono" data-el="sectionNumber"></span><span class="reader__section-content"><span data-el="sectionTitle"></span><span class="reader__section-next" data-el="sectionNext"></span></span><span aria-hidden="true">⌄</span></button>' : '';
    root_.innerHTML = sidebar + sectionStrip +
      '<div class="reader__stage"><div class="reader__guide" aria-hidden="true"></div><div class="reader__cue-status" data-el="cueStatus" role="status" hidden><strong data-el="cueTitle"></strong><span data-el="cueDetail"></span><small data-el="cueHint"></small></div><div class="reader__text">' + html + '<div class="reader__end">end of script</div></div><div class="reader__fade reader__fade--past" aria-hidden="true"></div><div class="reader__fade reader__fade--next" aria-hidden="true"></div></div>' +
      '<div class="reader__top">' +
        '<button class="icon-btn" data-act="exit" aria-label="Back to scripts">' + ICON.back + '</button>' +
        '<div class="reader__title">' + esc(sc.title) + '</div>' +
        '<div class="reader__left mono" data-el="left"></div>' +
        '<button class="icon-btn icon-btn--text" data-act="agenda" aria-label="Agenda"' + (sections.length ? '' : ' disabled') + '>≡</button>' +
        '<button class="icon-btn icon-btn--text" data-act="size" aria-label="Text size">Aa</button>' +
      '</div>' +
      '<div class="sheet" data-el="sheet" hidden>' +
        '<label class="sheet__row"><span>Text size</span><span class="mono" data-el="sizeVal"></span></label>' +
        '<input aria-label="Text size" type="range" min="' + SIZE_MIN + '" max="' + SIZE_MAX + '" step="2" data-el="size">' +
        '<label class="sheet__focus">Guide height<select aria-label="Guide height" data-el="guideRows"><option value="3">3 rows</option><option value="4">4 rows</option><option value="5">5 rows</option></select></label>' +
        '<label class="sheet__focus">Reading width <output data-el="widthValue"></output><input aria-label="Reading width" data-el="width" type="range" min="50" max="100" step="5"></label>' +
        '<label class="sheet__focus">Line spacing <output data-el="spacingValue"></output><input aria-label="Line spacing" data-el="spacing" type="range" min="1.2" max="2.2" step="0.1"></label>' +
        '<label class="sheet__focus">Reading focus<select aria-label="Reading focus" data-el="focus"><option value="word">Word by word</option><option value="line">Centre guide</option></select></label>' +
        '<button class="btn btn--small sheet__edit" data-act="edit">Quick edit</button>' +
      '</div>' +
      '<dialog class="quick-editor" aria-labelledby="quick-edit-title"><div class="toolbar"><h2 id="quick-edit-title">Quick edit</h2><button class="btn btn--small" data-act="discard-edit">Discard changes</button><button class="btn btn--primary btn--small" data-act="save-edit">Save quick edits</button></div><p class="muted">Save updates this script. Reading stays paused at your place, or the passage you changed.</p><textarea class="editor" data-el="editText" aria-label="Edit script text" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea><p class="muted" data-el="editSummary" role="status"></p></dialog>' +
      '<dialog class="agenda" aria-labelledby="agenda-title"><div class="toolbar"><h2 id="agenda-title">Agenda</h2><button class="btn btn--small" data-act="reorder" aria-pressed="false">Reorder</button><button class="btn btn--small" data-act="close-agenda">Close</button></div>' +
        '<p class="muted" data-el="agendaHelp">Choose a section, then press Play. Shortcuts: 1–9, Page Up / Page Down.</p>' +
        '<div class="agenda-list">' + sectionList + '</div></dialog>' +
      '<div class="reader__countdown" data-el="countdown" role="status" aria-live="polite" hidden></div>' +
      '<div class="reader__bar">' +
        '<div class="reader__stats mono" data-el="stats"></div>' +
        '<div class="reader__tempo mono" data-el="tempo"></div>' +
        '<div class="reader__ctl">' +
          '<button class="ctl-btn" data-act="prev" aria-label="Previous sentence">' + ICON.prev + '</button>' +
          '<button class="ctl-btn" data-act="slower" aria-label="Slower">' + ICON.minus + '</button>' +
          '<button class="play-btn" data-act="toggle" aria-label="Play">' + ICON.play + '</button>' +
          '<button class="ctl-btn" data-act="faster" aria-label="Faster">' + ICON.plus + '</button>' +
          '<button class="ctl-btn" data-act="next" aria-label="Next sentence">' + ICON.next + '</button>' +
        '</div>' +
      '</div>';
    host.replaceChildren(root_);

    const stage = root_.querySelector('.reader__stage');
    const text = root_.querySelector('.reader__text');
    const playBtn = root_.querySelector('[data-act="toggle"]');
    const leftEl = root_.querySelector('[data-el="left"]');
    const tempoEl = root_.querySelector('[data-el="tempo"]');
    const agenda = root_.querySelector('.agenda');
    const quickEditor = root_.querySelector('.quick-editor');
    const editText = root_.querySelector('[data-el="editText"]');
    const editComposer = root.CueEditor.mount(editText);
    const editButton = root_.querySelector('[data-act="edit"]');
    const editSave = root_.querySelector('[data-act="save-edit"]');
    const countdownEl = root_.querySelector('[data-el="countdown"]');
    const cueStatus = root_.querySelector('[data-el="cueStatus"]');
    const statsEl = root_.querySelector('[data-el="stats"]');
    const sheet = root_.querySelector('[data-el="sheet"]');
    const sizeInput = root_.querySelector('[data-el="size"]');
    const sizeVal = root_.querySelector('[data-el="sizeVal"]');
    const els = new Array(n);
    text.querySelectorAll('[data-i]').forEach(e => { els[+e.dataset.i] = e; });

    /* ---------- timeline ---------- */
    let dur = new Float64Array(n);
    let T = new Float64Array(n + 1);   // start time of each token; T[n] = total
    let total = 0;
    const motion = new Float64Array(n + 1);
    const motionDur = new Float64Array(n);

    function wpmAt(i) { return F.tempoFor(tokens[i], base, adj); }

    function buildTimeline() {
      let t = 0, moving = 0;
      const timing = F.playbackPacing(pacing, focusMode);
      for (let i = 0; i < n; i++) {
        dur[i] = F.tokenSeconds(tokens[i], wpmAt(i), timing);
        T[i] = t;
        t += dur[i];
        motion[i] = moving;
        motionDur[i] = F.beats(tokens[i]) * 60 / wpmAt(i);
        moving += motionDur[i];
      }
      T[n] = t;
      motion[n] = moving;
      total = t;
      shownSection = -2;
    }

    /* ---------- layout: where each line sits ---------- */
    let lines = [];            // { start, y }
    let lineOf = new Int32Array(n);
    let lineHeight = 0;

    function layout() {
      lines = [];
      text.style.width = Math.min(960, stage.clientWidth) * visual.readingWidth / 100 + 'px';
      root_.style.setProperty('--reader-line-spacing', visual.lineSpacing);
      lineHeight = parseFloat(getComputedStyle(text).lineHeight);
      let curY = -1e9;
      let forceNew = true;
      for (let i = 0; i < n; i++) {
        if (tokens[i].t === 'pause' || tokens[i].t === 'hold') { lineOf[i] = Math.max(0, lines.length - 1); continue; }
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
      if (!lines.length) lines.push({ start: 0, y: 0 });
      const targetHeight = lineHeight * guideRows;
      const strip = root_.querySelector('.reader__section');
      const header = root_.querySelector('.reader__top');
      const bar = root_.querySelector('.reader__bar');
      const topEdge = Math.max(header.offsetHeight, strip && strip.offsetHeight ? strip.offsetTop + strip.offsetHeight : 0) + 12;
      const firstReadout = statsEl.offsetHeight ? statsEl : tempoEl;
      const bottomEdge = bar.offsetTop + firstReadout.offsetTop - 12;
      const halfRoom = Math.max(16, Math.min(stage.clientHeight / 2 - topEdge, bottomEdge - stage.clientHeight / 2));
      root_.style.setProperty('--guide-half', Math.min(targetHeight / 2, halfRoom) + 'px');
    }

    function nextLine(k) {
      return lines[k + 1] || (focusMode === 'line' ? { start: n, y: lines[k].y + lineHeight } : null);
    }

    function yAt(i, f) {
      const k = lineOf[i];
      const line = lines[k];
      const next = nextLine(k);
      if (!next) return line.y;
      const t0 = motion[line.start];
      const span = motion[next.start] - t0;
      if (span <= 0) return line.y;
      const frac = Math.min(1, Math.max(0, (motion[i] + Math.min(f * dur[i], motionDur[i]) - t0) / span));
      return line.y + (next.y - line.y) * frac;
    }

    function timeAtY(y) {
      if (!lines.length) return 0;
      if (y <= lines[0].y) return 0;
      for (let k = 0; k < lines.length; k++) {
        const next = nextLine(k);
        if (!next) return total;
        if (y < next.y) {
          const frac = (y - lines[k].y) / (next.y - lines[k].y);
          const p = posAtTime(motion[lines[k].start] + frac * (motion[next.start] - motion[lines[k].start]), motion, motionDur);
          return T[p.i] + p.f * motionDur[p.i];
        }
      }
      return total;
    }

    function posAtTime(t, times = T, durations = dur) {
      t = Math.min(Math.max(0, t), times[n]);
      let lo = 0, hi = n - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (times[mid] <= t) lo = mid; else hi = mid - 1;
      }
      const d = durations[lo];
      return { i: lo, f: d > 0 ? Math.min(1, (t - times[lo]) / d) : 0 };
    }

    /* ---------- state ---------- */
    let pos = { i: Math.min(Math.max(0, rec.pos || 0), Math.max(0, n - 1)), f: 0 };
    if (Number.isInteger(options.section) && sections[options.section]) pos = { i: sections[options.section].i, f: 0 };
    if (Number.isInteger(options.position)) pos = { i: Math.max(0, Math.min(n - 1, options.position)), f: 0 };
    let reordering = false;
    let playing = false;
    let countdown = 0;
    let needsCountdown = true;
    let elapsed = 0;
    let ended = false;
    let holding = tokens[pos.i] && tokens[pos.i].t === 'hold';
    let raf = 0;
    let last = 0;
    let shownI = -1;
    let shownLeft = '';
    let shownSection = -2;
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

    function updateTempo() {
      wpm = n ? wpmAt(pos.i) : F.clampTempo(base + adj);
      const label = wpm + ' WPM' + (adj ? ' (' + (adj > 0 ? '+' : '−') + Math.abs(adj) + ')' : '');
      if (tempoEl.textContent !== label) tempoEl.textContent = label;
    }

    function changeTempo(delta) {
      const current = wpmAt(pos.i);
      const next = F.clampTempo(current + delta);
      if (next === current) return;
      adj += next - current;
      buildTimeline();            // position is index-based, so it carries over untouched
      updateTempo();
      shownLeft = '';
      render();
      S.save({ id: rec.id, adj }, false);
      wake();
    }

    function skipSentence(dir) {
      if (!starts.length) return;
      let cur = 0;
      for (let k = 0; k < starts.length; k++) if (starts[k] <= pos.i) cur = k;
      let target;
      if (dir > 0) target = cur + 1 < starts.length ? starts[cur + 1] : null;
      else target = (timeNow() - T[starts[cur]] > SKIP_BACK_GRACE || cur === 0) ? starts[cur] : starts[cur - 1];
      if (target === null) return;
      pos = { i: target, f: 0 };
      holding = false;
      ended = false;
      setPlayIcon();
      render();
      savePos();
      wake();
    }

    function refreshEdit() {
      editComposer.refresh();
      const edited = F.parse(editText.value, pacing);
      editSave.disabled = edited.words === 0;
      root_.querySelector('[data-el="editSummary"]').textContent = edited.words + ' words' + (edited.warnings.length ? ' · ' + edited.warnings.join('; ') : '');
    }
    function openQuickEdit() {
      if (playing) return;
      setReordering(false); sheet.hidden = true;
      editText.value = rec.text; refreshEdit(); quickEditor.showModal();
      const parts = F.sourceSections(rec.text);
      let chapter = -1;
      sections.forEach((section, k) => { if (section.i <= pos.i) chapter = k; });
      const offset = chapter >= 0 ? parts.prefix.length + parts.sections.slice(0, chapter).join('').length : 0;
      editComposer.focusAt(offset);
    }
    function saveQuickEdit() {
      if (!editComposer.validate()) return;
      const edited = F.parse(editText.value, pacing);
      if (!edited.words || !onReorder) return;
      if (editText.value === rec.text) { quickEditor.close(); return; }
      const position = F.positionAfterEdit(tokens, edited.tokens, pos.i);
      onReorder(editText.value, undefined, false, { position, reordering: false });
    }
    editText.addEventListener('input', refreshEdit);
    quickEditor.addEventListener('close', () => { if (!destroyed) playBtn.focus({ preventScroll: true }); });

    function setReordering(value) {
      if (value) { pause(); drag = null; }
      reordering = value;
      root_.classList.toggle('is-reordering', value);
      root_.querySelector('[data-el="agendaHelp"]').textContent = value ? 'Drag a dotted handle, or use Up and Down. Each move saves the whole chapter. Choose Done when finished.' : 'Choose a section, then press Play. Shortcuts: 1–9, Page Up / Page Down.';
      root_.querySelectorAll('[data-act="reorder"]').forEach(button => {
        button.textContent = value ? 'Done' : 'Reorder';
        button.setAttribute('aria-pressed', String(value));
      });
    }
    function moveSection(from, to) {
      if (!onReorder || !reordering || from === to || !sections[to]) return;
      pause();
      onReorder(F.moveSection(rec.text, from, to), to, agenda.open);
    }

    // Pointer handles work with mouse, touch and pen; plain text never becomes draggable.
    let sectionDrag = null;
    root_.addEventListener('pointerdown', e => {
      const handle = e.target.closest('[data-reorder-handle]');
      if (!handle || !reordering || !e.isPrimary || e.button !== 0) return;
      e.preventDefault();
      handle.setPointerCapture(e.pointerId);
      sectionDrag = { handle, scope: handle.closest('.agenda-list'), from: Number(handle.dataset.reorderHandle), to: Number(handle.dataset.reorderHandle), y: e.clientY, moved: false };
    });
    root_.addEventListener('pointermove', e => {
      if (!sectionDrag) return;
      const d = sectionDrag;
      if (!d.moved && Math.abs(e.clientY - d.y) < 6) return;
      d.moved = true;
      let nearest = Infinity;
      d.scope.querySelectorAll('[data-agenda-row]').forEach(row => {
        const box = row.getBoundingClientRect();
        const distance = Math.abs(e.clientY - box.y - box.height / 2);
        if (distance < nearest) { nearest = distance; d.to = Number(row.dataset.agendaRow); }
      });
      d.scope.querySelectorAll('[data-agenda-row]').forEach(row => {
        row.classList.toggle('is-dragging', Number(row.dataset.agendaRow) === d.from);
        row.classList.toggle('is-drop-target', Number(row.dataset.agendaRow) === d.to && d.to !== d.from);
      });
    });
    function endSectionDrag(e) {
      if (!sectionDrag) return;
      const d = sectionDrag; sectionDrag = null;
      d.scope.querySelectorAll('.is-dragging, .is-drop-target').forEach(row => row.classList.remove('is-dragging', 'is-drop-target'));
      if (e.type !== 'pointercancel' && d.moved) moveSection(d.from, d.to);
    }
    root_.addEventListener('pointerup', endSectionDrag);
    root_.addEventListener('pointercancel', endSectionDrag);
    root_.addEventListener('keydown', e => {
      const handle = e.target.closest('[data-reorder-handle]');
      if (handle && reordering && ['ArrowUp', 'ArrowDown'].includes(e.code)) {
        e.preventDefault();
        const from = Number(handle.dataset.reorderHandle);
        moveSection(from, from + (e.code === 'ArrowUp' ? -1 : 1));
      }
    });
    agenda.addEventListener('cancel', () => setReordering(false));

    function jumpSection(k) {
      if (!sections[k]) return;
      pause();
      pos = { i: sections[k].i, f: 0 };
      holding = false; ended = false;
      agenda.close();
      setPlayIcon(); render(); savePos(); wake();
    }

    function updateAgenda() {
      if (!sections.length) return;
      let current = -1;
      sections.forEach((section, k) => { if (section.i <= pos.i) current = k; });
      if (current === shownSection) return;
      shownSection = current;
      root_.querySelectorAll('[data-section]').forEach(button => {
        const k = Number(button.dataset.section);
        const state = k < current ? 'earlier' : k === current ? 'current' : k === current + 1 ? 'next' : 'upcoming';
        button.dataset.state = state;
        button.querySelector('[data-section-state]').textContent = { earlier: 'Earlier', current: 'Current', next: 'Next', upcoming: 'Upcoming' }[state];
        if (k === current) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
        const end = k + 1 < sections.length ? sections[k + 1].i : n;
        const hasHold = tokens.slice(sections[k].i, end).some(token => token.t === 'hold');
        button.querySelector('[data-section-time]').textContent = '~' + F.formatDuration(T[end] - T[sections[k].i]) + (hasHold ? ' + hold' : '');
      });
      root_.querySelector('[data-el="sectionNumber"]').textContent = (current < 0 ? '—' : String(current + 1).padStart(2, '0')) + ' / ' + String(sections.length).padStart(2, '0');
      root_.querySelector('[data-el="sectionTitle"]').textContent = current < 0 ? 'Opening' : sections[current].title;
      root_.querySelector('[data-el="sectionNext"]').textContent = current + 1 < sections.length ? 'Next · ' + sections[current + 1].title : 'Final section';
      const active = root_.querySelector('.reader__agenda [aria-current]');
      if (active && root_.querySelector('.reader__agenda').offsetWidth) active.scrollIntoView({ block: 'nearest' });
    }

    function updateReadouts() {
      countdownEl.hidden = countdown <= 0;
      const countLabel = countdown > 0 ? 'Starting in ' + Math.ceil(countdown) : '';
      if (countdownEl.textContent !== countLabel) countdownEl.textContent = countLabel;
      const stats = F.formatDuration(elapsed) + ' reading · ' + sc.words + ' words';
      if (statsEl.textContent !== stats) statsEl.textContent = stats;
      const cue = tokens[pos.i];
      const waiting = cue.t === 'pause' || cue.t === 'hold';
      cueStatus.hidden = !waiting;
      root_.classList.toggle('is-waiting', waiting);
      if (waiting) {
        const labels = {
          cueTitle: cue.t === 'hold' ? 'Hold' : 'Pause',
          cueDetail: cue.t === 'hold' ? cue.s : Math.max(1, Math.ceil(dur[pos.i] * (1 - pos.f))) + 's',
          cueHint: cue.t === 'hold' ? 'Press Play when ready' : playing ? 'Continue automatically' : 'Press Play to resume the countdown'
        };
        for (const [key, value] of Object.entries(labels)) {
          const node = cueStatus.querySelector('[data-el="' + key + '"]');
          if (node.textContent !== value) node.textContent = value;
        }
      }
      const left = holding ? 'Hold · press Play' : cue.t === 'pause' ? 'Pause · ' + Math.ceil(dur[pos.i] * (1 - pos.f)) + 's' : '~' + F.formatDuration(total - timeNow()) + ' left';
      if (left !== shownLeft) { leftEl.textContent = left; shownLeft = left; }
    }

    function render() {
      if (!n) return;
      const y = yAt(pos.i, pos.f);
      text.style.transform = 'translate3d(0,' + (stage.clientHeight * marker() - y).toFixed(1) + 'px,0)';
      updateHighlight();
      updateReadouts();
      updateTempo();
      updateAgenda();
    }

    function setPlayIcon() {
      const icon = ended ? 'restart' : (playing ? 'pause' : 'play');
      playBtn.innerHTML = ICON[icon];
      editButton.disabled = playing;
      editButton.title = playing ? 'Pause playback to edit' : 'Edit this script without leaving the reader';
      playBtn.setAttribute('aria-label', ended ? 'Restart' : (playing ? 'Pause' : holding ? 'Resume' : 'Play'));
      root_.classList.toggle('is-paused', !playing);
      root_.classList.toggle('is-ended', ended);
    }

    function savePos() {
      const latest = S.get(rec.id);
      if (!latest || latest.text !== rec.text) return;
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
        if (tokens[pos.i].t === 'hold' && pos.f < 1) { holding = true; pause(); return; }
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
      let readingDt = dt;
      if (countdown > 0) {
        readingDt = Math.max(0, dt - countdown);
        countdown = Math.max(0, countdown - dt);
        if (countdown === 0) needsCountdown = false;
      }
      if (readingDt > 0) { elapsed += readingDt; advance(readingDt); }
      render();
      if (playing) raf = requestAnimationFrame(frame);
    }

    function play() {
      if (n === 0) return;
      setReordering(false);
      drag = null;   // a gesture begun while paused cannot scrub after playback starts
      if (ended) { pos = { i: 0, f: 0 }; ended = false; shownI = -1; needsCountdown = true; elapsed = 0; }
      const resumeHold = holding;
      if (holding) { holding = false; pos.f = 1; }
      countdown = needsCountdown && !resumeHold ? startDelay : 0;
      if (!countdown) needsCountdown = false;
      playing = true;
      last = performance.now();
      setPlayIcon();
      wake();
      raf = requestAnimationFrame(frame);
    }

    function pause() {
      countdown = 0;
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
      if (reordering || playing || !n || !e.isPrimary || e.button !== 0) return;   // text is inert while playing
      drag = { startClientY: e.clientY, startY: yAt(pos.i, pos.f), moved: false, target: e.target };
      stage.setPointerCapture(e.pointerId);
    });
    stage.addEventListener('pointermove', (e) => {
      if (!drag || playing) return;
      const dy = e.clientY - drag.startClientY;
      if (!drag.moved && Math.abs(dy) < 6) return;
      drag.moved = true;
      pos = posAtTime(timeAtY(drag.startY - dy));
      holding = tokens[pos.i].t === 'hold';
      ended = false;
      setPlayIcon();
      render();
    });
    function endDrag(e) {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (!d.moved && e.type !== 'pointercancel' && !playing) {
        const hit = d.target.closest && d.target.closest('[data-i]');
        if (hit) { pos = { i: +hit.dataset.i, f: 0 }; holding = tokens[pos.i].t === 'hold'; ended = false; setPlayIcon(); render(); }
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
      const move = e.target.closest('[data-move-section]');
      if (move) { const from = Number(move.dataset.moveSection); moveSection(from, from + Number(move.dataset.direction)); return; }
      const section = e.target.closest('[data-section]');
      if (section) { jumpSection(Number(section.dataset.section)); return; }
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      if (act === 'toggle') toggle();
      else if (act === 'exit') exit();
      else if (act === 'faster') changeTempo(TEMPO_STEP);
      else if (act === 'slower') changeTempo(-TEMPO_STEP);
      else if (act === 'next') skipSentence(1);
      else if (act === 'prev') skipSentence(-1);
      else if (act === 'agenda') {
        pause(); sheet.hidden = true;
        updateAgenda();
        agenda.showModal();
      }
      else if (act === 'reorder') setReordering(!reordering);
      else if (act === 'close-agenda') { setReordering(false); agenda.close(); }
      else if (act === 'edit') openQuickEdit();
      else if (act === 'save-edit') saveQuickEdit();
      else if (act === 'discard-edit') quickEditor.close();
      else if (act === 'size') sheet.hidden = !sheet.hidden;
    });
    function onKey(e) {
      if (agenda.open || quickEditor.open || reordering) return;
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (e.code === 'Space') {
        // Buttons already activate on Space; handling it here would also toggle playback.
        if (e.target.closest('button')) return;
        e.preventDefault();
        if (!e.repeat) toggle();
      }
      else if (e.code === 'KeyE' && !playing) { e.preventDefault(); openQuickEdit(); }
      else if (e.code === 'Escape') exit();
      else if (/^Digit[1-9]$/.test(e.code) && !e.repeat) { e.preventDefault(); jumpSection(Number(e.code.slice(-1)) - 1); }
      else if (e.code === 'PageDown') { e.preventDefault(); const k = sections.findIndex(section => section.i > pos.i); if (k >= 0) jumpSection(k); }
      else if (e.code === 'PageUp') { e.preventDefault(); let k = -1; sections.forEach((section, index) => { if (section.i < pos.i) k = index; }); if (k >= 0) jumpSection(k); }
      else if (e.code === 'ArrowUp') { e.preventDefault(); changeTempo(TEMPO_STEP); }
      else if (e.code === 'ArrowDown') { e.preventDefault(); changeTempo(-TEMPO_STEP); }
      else if (e.code === 'ArrowRight') { e.preventDefault(); skipSentence(1); }
      else if (e.code === 'ArrowLeft') { e.preventDefault(); skipSentence(-1); }
    }
    document.addEventListener('keydown', onKey);
    function onVisibility() {
      if (document.hidden) { if (playing) pause(); }
      else holdScreen();
    }
    document.addEventListener('visibilitychange', onVisibility);
    root_.addEventListener('pointermove', wake);

    /* ---------- reading focus and text size ---------- */
    const focusInput = root_.querySelector('[data-el="focus"]');
    const widthInput = root_.querySelector('[data-el="width"]');
    const spacingInput = root_.querySelector('[data-el="spacing"]');
    function updateVisualControls() {
      widthInput.value = visual.readingWidth;
      spacingInput.value = visual.lineSpacing;
      root_.querySelector('[data-el="widthValue"]').textContent = visual.readingWidth + '%';
      root_.querySelector('[data-el="spacingValue"]').textContent = visual.lineSpacing.toFixed(1) + '×';
    }
    function applyVisual() {
      visual = F.readerLayout({ readingWidth: Number(widthInput.value), lineSpacing: Number(spacingInput.value) });
      updateVisualControls(); layout(); render(); S.setSettings(visual);
    }
    widthInput.addEventListener('input', applyVisual);
    spacingInput.addEventListener('input', applyVisual);
    updateVisualControls();
    const rowsInput = root_.querySelector('[data-el="guideRows"]');
    rowsInput.value = guideRows;
    rowsInput.addEventListener('change', () => {
      guideRows = Number(rowsInput.value);
      layout(); render(); S.setSettings({ guideRows });
    });
    function applyFocus(value, persist) {
      const tokenElapsed = n ? pos.f * dur[pos.i] : 0;
      focusMode = value === 'line' ? 'line' : 'word';
      buildTimeline();
      if (n && dur[pos.i] > 0) pos.f = Math.min(1, tokenElapsed / dur[pos.i]);
      root_.classList.toggle('reader--line', focusMode === 'line');
      root_.style.setProperty('--reading-line', marker() * 100 + '%');
      focusInput.value = focusMode;
      render();
      if (persist) S.setSettings({ focusMode });
    }
    focusInput.addEventListener('change', () => applyFocus(focusInput.value, true));
    function applySize(px, persist) {
      root_.style.setProperty('--reader-size', px + 'px');
      sizeVal.textContent = px + 'px';
      layout();
      render();
      if (persist) S.setSettings({ fontSize: px });
    }
    sizeInput.addEventListener('input', () => applySize(+sizeInput.value, true));
    // tapping the stage closes the sheet
    stage.addEventListener('pointerdown', () => { sheet.hidden = true; });

    /* ---------- keep the screen on while the reader is open ---------- */
    let wakeLock = null;
    let requestingWake = false;
    let destroyed = false;
    async function holdScreen() {
      try {
        if (!('wakeLock' in navigator) || wakeLock || requestingWake || destroyed || document.hidden) return;
        requestingWake = true;
        const lock = await navigator.wakeLock.request('screen');
        if (destroyed || document.hidden) { await lock.release(); return; }
        wakeLock = lock;
        lock.addEventListener('release', () => { if (wakeLock === lock) wakeLock = null; });
      } catch (_) { /* unsupported or denied: the screen may dim, nothing else breaks */ }
      finally { requestingWake = false; }
    }

    const ro = new ResizeObserver(() => { layout(); render(); });
    ro.observe(stage);

    /* ---------- init ---------- */
    buildTimeline();
    updateTempo();
    if (n) updateReadouts();
    const savedSize = S.settings().fontSize;
    if (savedSize) root_.style.setProperty('--reader-size', savedSize + 'px');
    layout();
    sizeInput.value = savedSize || Math.round(parseFloat(getComputedStyle(text).fontSize));
    sizeVal.textContent = sizeInput.value + 'px';
    applyFocus(focusMode, false);
    setPlayIcon();
    render();
    holdScreen();
    if (n === 0) playBtn.disabled = true;
    if (options.reordering) {
      setReordering(true);
      if (options.agendaOpen) agenda.showModal();
      const scope = options.agendaOpen ? agenda : root_.querySelector('.reader__agenda');
      const handle = scope && scope.querySelector('[data-reorder-handle="' + options.section + '"]');
      if (handle) handle.focus({ preventScroll: true });
      savePos();
    }

    return {
      destroy() {
        if (destroyed) return;
        destroyed = true;
        quickEditor.close();
        editComposer.destroy();
        agenda.close();
        playing = false;
        savePos();
        cancelAnimationFrame(raf);
        clearTimeout(idleTimer);
        ro.disconnect();
        if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
        document.removeEventListener('keydown', onKey);
        document.removeEventListener('visibilitychange', onVisibility);
      },
      // exposed for tests
      _state: () => ({ pos: { ...pos }, playing, reordering, ended, holding, focusMode, guideRows, visual: { ...visual }, countdown, elapsed, total, lines: lines.length, wpm, adj })
    };
  }

  root.CueReader = { open };
})(self);
