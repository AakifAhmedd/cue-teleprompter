/* CUE — app UI. Version comes from the VERSION file (see VERSIONING.md). */
(function () {
  'use strict';

  const F = CueFormat;
  const S = CueStore;
  const view = document.getElementById('view');

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

  /* ---------- library ---------- */
  function renderLibrary() {
    const scripts = S.list();
    view.replaceChildren(el(`
      <div class="toolbar">
        <h1>Scripts</h1>
        <button class="btn btn--primary" id="new-script">New script</button>
      </div>`));
    view.querySelector('#new-script').onclick = () => { location.hash = '#/new'; };

    if (!scripts.length) {
      view.appendChild(el(`<div class="empty-state"><h2>No scripts yet</h2><p>Tap New script, then paste or open a script file.</p></div>`));
      return;
    }
    const list = el('<div class="card-list"></div>');
    for (const rec of scripts) {
      const sc = F.parse(rec.text);
      const secs = F.estimateSeconds(sc.tokens, sc.tempo);
      const card = el(`
        <article class="card" data-id="${esc(rec.id)}">
          <div class="card__main" role="button" tabindex="0">
            <h3>${esc(sc.title)}</h3>
            <p class="muted">${plural(sc.words, 'word')} · ~${F.formatDuration(secs)} at ${sc.tempo} WPM · ${shortDate(rec.updatedAt)}</p>
          </div>
          <div class="card__actions">
            <button class="btn btn--small" data-act="edit">Edit</button>
            <button class="btn btn--small btn--danger" data-act="delete">Delete</button>
          </div>
        </article>`);
      card.querySelector('.card__main').onclick = () => { location.hash = '#/edit/' + rec.id; };
      card.querySelector('[data-act="edit"]').onclick = () => { location.hash = '#/edit/' + rec.id; };
      card.querySelector('[data-act="delete"]').onclick = () => {
        if (confirm('Delete "' + sc.title + '"?')) { S.remove(rec.id); renderLibrary(); }
      };
      list.appendChild(card);
    }
    view.appendChild(list);
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
      const sc = F.parse(ta.value);
      const secs = F.estimateSeconds(sc.tokens, sc.tempo);
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
      toast('Saved');
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
  function route() {
    const [name, id] = location.hash.replace(/^#\/?/, '').split('/');
    window.scrollTo(0, 0);
    if (name === 'new') return renderEditor(null);
    if (name === 'edit' && id) return renderEditor(id);
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
      navigator.serviceWorker.register('sw.js').catch(() => { /* not fatal */ });
    });
  }

  route();
  showVersion();
  registerServiceWorker();
})();
