/* CUE — app UI. Version comes from the VERSION file (see VERSIONING.md). */
(function () {
  'use strict';

  const F = CueFormat;
  const S = CueStore;
  const view = document.getElementById('view');
  // The worker URL must change with the assets so every release is precached offline.
  const assetQuery = new URL(document.currentScript.src).search;

  /* ---------- helpers ---------- */
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function el(html) {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function plural(n, word) { return n.toLocaleString() + ' ' + word + (n === 1 ? '' : 's'); }
  function shortDate(ts) {
    return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  let toastTimer;
  function toast(msg) {
    let host = document.getElementById('toast');
    if (!host) { host = el('<div class="toast" id="toast" role="status"></div>'); document.body.appendChild(host); }
    host.textContent = msg;
    host.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => host.classList.remove('is-on'), 2200);
  }

  function updateStorageNotice() {
    let notice = document.getElementById('storage-warning');
    if (!notice) {
      notice = el('<aside id="storage-warning" class="storage-warning" role="alert" hidden></aside>');
      notice.textContent = 'Browser storage is unavailable. Changes are kept only for this session. Copy your scripts before closing this tab.';
      view.before(notice);
    }
    notice.hidden = !S.isSessionOnly();
  }
  window.addEventListener('cue:storage', updateStorageNotice);
  updateStorageNotice();

  /* ---------- library ---------- */
  function renderLibrary() {
    const scripts = S.list();
    view.replaceChildren(el(`
      <div class="toolbar">
        <h1>Scripts</h1>
        <button class="btn btn--small" id="format">Format</button>
        <button class="btn btn--small" id="settings">Settings</button>
        <button class="btn btn--primary" id="new-script">New script</button>
      </div>`));
    view.querySelector('#format').onclick = () => { location.hash = '#/format'; };
    view.querySelector('#settings').onclick = () => { location.hash = '#/settings'; };
    view.querySelector('#new-script').onclick = () => { location.hash = '#/new'; };

    if (!scripts.length) {
      view.appendChild(el(`<div class="empty-state"><h2>No scripts yet</h2><p>Tap New script, then paste or open a script file.</p></div>`));
      return;
    }
    const list = el('<div class="card-list"></div>');
    for (const rec of scripts) {
      const sc = F.parse(rec.text, S.settings().pacing);
      const secs = F.estimateSeconds(sc.tokens, sc.tempo, S.settings().pacing, Number.isFinite(rec.adj) ? rec.adj : 0);
      const card = el(`
        <article class="card" data-id="${esc(rec.id)}">
          <div class="card__main" role="button" tabindex="0">
            <h3>${esc(sc.title)}</h3>
            <p class="muted">${plural(sc.words, 'word')} · ~${F.formatDuration(secs)} at ${F.clampTempo(sc.tempo + (Number.isFinite(rec.adj) ? rec.adj : 0))} WPM · ${shortDate(rec.updatedAt)}</p>
          </div>
          <div class="card__actions">
            <button class="btn btn--small" data-act="edit">Edit</button>
            <button class="btn btn--small btn--danger" data-act="delete">Delete</button>
          </div>
        </article>`);
      card.querySelector('.card__main').onclick = () => { location.hash = '#/read/' + rec.id; };
      card.querySelector('.card__main').onkeydown = e => {
        if (e.code === 'Enter' || e.code === 'Space') { e.preventDefault(); if (!e.repeat) location.hash = '#/read/' + rec.id; }
      };
      card.querySelector('[data-act="edit"]').onclick = () => { location.hash = '#/edit/' + rec.id; };
      card.querySelector('[data-act="delete"]').onclick = () => {
        if (confirm('Delete "' + sc.title + '"?')) { S.remove(rec.id); renderLibrary(); }
      };
      list.appendChild(card);
    }
    view.appendChild(list);
  }

  const FORMAT_EXAMPLE = '---\ntitle: Club Night\ntempo: 140\n---\n\n## Welcome\nGood evening, *everyone*.\n[pause 2]\n[tempo 170]\nLet’s welcome our first guest!\n[hold Applause]\n[tempo reset]\n[note Hand over the microphone]\nThank you for joining us.';
  const AI_PROMPT = 'Write a plain-text event MC script for CUE. Return the script without code fences. Optionally start with a --- header containing title: and tempo: (60–300 WPM). Use ## headings for sections, *emphasis* for important words, blank lines for breathers. Put every stage cue on its own line: [tempo 170] sets a section pace until changed, [tempo reset] returns to the header or user default pace, [pause 3] waits exactly three seconds, [hold Applause] waits until I press Play, and [note Hand over microphone] shows an unspoken presenter note. Cues and headings are not spoken. Use holds for unpredictable applause or handovers. CUE adds the user’s configured punctuation pauses automatically. Adapt the script to the event details I provide next.';
  function renderFormat() {
    view.replaceChildren(el(`<section class="format-guide">
      <div class="toolbar"><button class="btn btn--small" id="back">← Back</button><h1>Script format</h1></div>
      <p>Plain text works. Add optional headings, *emphasis*, and cues on separate lines:</p>
      <dl><dt>[tempo 170] / [tempo reset]</dt><dd>Change pace until another tempo cue. Reset uses the header or your saved default. + / − still adjust all sections together.</dd>
      <dt>[pause 3]</dt><dd>Wait exactly three seconds, regardless of WPM. Positive decimal seconds up to 3600 work too.</dd>
      <dt>[hold Applause]</dt><dd>Stop until you press Play. The label is optional.</dd>
      <dt>[note Hand over microphone]</dt><dd>Show an unspoken presenter note with a short breather.</dd></dl>
      <p class="muted">Duration estimates include timed pauses and exclude time spent waiting at holds.</p>
      <pre>${esc(FORMAT_EXAMPLE)}</pre><button class="btn btn--primary" id="copy-prompt">Copy AI prompt</button>
      <textarea class="editor prompt" id="ai-prompt" aria-label="AI prompt" readonly></textarea>
    </section>`));
    view.querySelector('#back').onclick = () => { location.hash = '#/'; };
    const prompt = view.querySelector('#ai-prompt'); prompt.value = AI_PROMPT;
    view.querySelector('#copy-prompt').onclick = async () => {
      try { await navigator.clipboard.writeText(AI_PROMPT); toast('AI prompt copied'); }
      catch (_) { prompt.focus(); prompt.select(); toast('Select and copy the prompt below'); }
    };
  }

  /* ---------- saved delivery defaults ---------- */
  function renderSettings() {
    const saved = F.pacing(S.settings().pacing);
    const presets = {
      standard: { defaultTempo: 140, commaPause: 0.25, sentencePause: 0.5 },
      formal: { defaultTempo: 110, commaPause: 0.3, sentencePause: 0.7 },
      lively: { defaultTempo: 170, commaPause: 0.15, sentencePause: 0.35 }
    };
    view.replaceChildren(el(`
      <form id="delivery" class="settings">
        <div class="toolbar"><button type="button" class="btn btn--small" id="back">← Back</button><h1>Delivery defaults</h1><button class="btn btn--primary btn--small">Save</button></div>
        <p class="muted">Used for scripts without a tempo header. Script tempo headers take priority. Changes apply the next time you open a script.</p>
        <label>Starting profile<select id="profile"><option value="custom">Your settings</option><option value="standard">Standard</option><option value="formal">Formal / introductions</option><option value="lively">Lively / hosting</option></select></label>
        <label>Default pace (WPM)<input id="default-tempo" type="number" min="60" max="300" step="1" required></label>
        <label class="check-row"><input id="punctuation" type="checkbox"> Pause at punctuation</label>
        <label>Comma pause (seconds)<input id="comma-pause" type="number" min="0" max="2" step="0.05" required></label>
        <label>Full stop / sentence pause (seconds)<input id="sentence-pause" type="number" min="0" max="5" step="0.05" required></label>
        <label>Countdown before starting<select id="start-delay"><option value="0">Off</option><option value="3">3 seconds</option><option value="5">5 seconds</option><option value="10">10 seconds</option></select></label>
        <p class="muted">Pauses are extra time after each word and stay the same when WPM changes. Sentence pauses also apply to ! and ?. Blank lines and headings keep a brief breather.</p>
      </form>`));
    const form = view.querySelector('#delivery');
    const fill = value => {
      form.querySelector('#default-tempo').value = value.defaultTempo;
      form.querySelector('#comma-pause').value = value.commaPause;
      form.querySelector('#sentence-pause').value = value.sentencePause;
    };
    fill(saved);
    form.querySelector('#start-delay').value = [3, 5, 10].includes(S.settings().startDelay) ? S.settings().startDelay : 0;
    form.querySelector('#punctuation').checked = saved.punctuation;
    form.querySelector('#profile').onchange = e => {
      if (presets[e.target.value]) { fill(presets[e.target.value]); form.querySelector('#punctuation').checked = true; }
    };
    form.querySelector('#back').onclick = () => { location.hash = '#/'; };
    form.onsubmit = e => {
      e.preventDefault();
      S.setSettings({ pacing: F.pacing({
        defaultTempo: Number(form.querySelector('#default-tempo').value),
        punctuation: form.querySelector('#punctuation').checked,
        commaPause: Number(form.querySelector('#comma-pause').value),
        sentencePause: Number(form.querySelector('#sentence-pause').value)
      }), startDelay: Number(form.querySelector('#start-delay').value) });
      toast(S.isSessionOnly() ? 'Defaults saved only for this session' : 'Delivery defaults saved');
      location.hash = '#/';
    };
  }

  /* ---------- editor / import ---------- */
  const PLACEHOLDER = '---\ntitle: Opening Ceremony\ntempo: 130\n---\n\n## Welcome\nGood evening, everyone, and welcome to the show.\n\nPaste or type your script here.';

  function renderEditor(id) {
    const rec = id ? S.get(id) : null;
    if (id && !rec) { location.hash = '#/'; return; }
    const original = rec ? rec.text : '';

    view.replaceChildren(el(`
      <div>
        <div class="toolbar">
          <button class="btn btn--small" id="back">← Back</button>
          <h1>${rec ? 'Edit script' : 'New script'}</h1>
          <button class="btn btn--primary btn--small" id="save">Save</button>
        </div>
        <div class="editor-tools">
          <button class="btn btn--small" id="paste">Paste</button>
          <label class="btn btn--small">Open file
            <input type="file" id="file" accept=".txt,.md,text/plain,text/markdown" hidden>
          </label>
        </div>
        <textarea id="text" class="editor" spellcheck="false" autocapitalize="off" autocomplete="off"></textarea>
        <div class="summary" id="summary"></div>
      </div>`));

    const ta = view.querySelector('#text');
    const summary = view.querySelector('#summary');
    const saveBtn = view.querySelector('#save');
    ta.placeholder = PLACEHOLDER;
    ta.value = original;

    function refresh() {
      const sc = F.parse(ta.value, S.settings().pacing);
      const secs = F.estimateSeconds(sc.tokens, sc.tempo, S.settings().pacing);
      let html = ta.value.trim()
        ? `<strong>${esc(sc.title)}</strong> · ${plural(sc.words, 'word')} · ~${F.formatDuration(secs)} at ${sc.tempo} WPM`
        : '<span class="muted">Nothing here yet</span>';
      for (const w of sc.warnings) if (ta.value.trim()) html += `<div class="warn">${esc(w)}</div>`;
      summary.innerHTML = html;
      saveBtn.disabled = sc.words === 0;
    }
    ta.addEventListener('input', refresh);
    refresh();

    const dirty = () => ta.value !== original;
    view.querySelector('#back').onclick = () => {
      if (dirty() && !confirm('Discard your changes?')) return;
      location.hash = '#/';
    };
    saveBtn.onclick = () => {
      S.save({ id: rec ? rec.id : undefined, text: ta.value });
      toast(S.isSessionOnly() ? 'Saved only for this session' : 'Saved');
      location.hash = '#/';
    };
    view.querySelector('#paste').onclick = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (!text.trim()) { toast('Clipboard is empty'); return; }
        ta.value = text;
        refresh();
      } catch (_) { toast('Could not read the clipboard — paste into the box instead'); }
    };
    view.querySelector('#file').onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      ta.value = await file.text();
      refresh();
      e.target.value = '';
    };
    if (!rec) ta.focus({ preventScroll: true });
  }

  /* ---------- router ---------- */
  let current = null;   // the open reader, so it can be cleaned up on navigation

  function route() {
    if (current) { current.destroy(); current = null; }
    document.body.classList.remove('is-reading');
    const [name, id] = location.hash.replace(/^#\/?/, '').split('/');
    window.scrollTo(0, 0);
    if (name === 'format') return renderFormat();
    if (name === 'settings') return renderSettings();
    if (name === 'new') return renderEditor(null);
    if (name === 'edit' && id) return renderEditor(id);
    if (name === 'read' && id) {
      const rec = S.get(id);
      if (!rec) { location.hash = '#/'; return; }
      document.body.classList.add('is-reading');
      current = CueReader.open(view, rec, () => { location.hash = '#/'; });
      window.__cueReader = current;   // handy for debugging on a device
      return;
    }
    return renderLibrary();
  }
  window.addEventListener('hashchange', route);

  /* ---------- version + service worker ---------- */
  async function showVersion() {
    const badge = document.getElementById('app-version');
    try {
      const res = await fetch('VERSION?v=' + Date.now(), { cache: 'no-store' });
      if (!res.ok) return;
      const v = (await res.text()).trim();
      if (/^\d+\.\d+\.\d+$/.test(v)) badge.textContent = 'v' + v;
    } catch (_) { /* offline: the service worker serves the cached copy, else stays blank */ }
  }

  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js' + assetQuery, { updateViaCache: 'none' }).catch(() => { /* not fatal */ });
    });
  }

  route();
  showVersion();
  registerServiceWorker();
})();
