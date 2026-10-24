/* CUE — local storage for scripts and settings. Everything stays in this browser. */
(function (root) {
  'use strict';

  const KEY_SCRIPTS = 'cue:scripts:v1';
  const KEY_SETTINGS = 'cue:settings:v1';
  const memory = {};   // fallback if localStorage is blocked

  function read(key, fallback) {
    try {
      const raw = (key in memory) ? memory[key] : localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) { return fallback; }
  }

  function write(key, value) {
    const wasSessionOnly = Object.keys(memory).length > 0;
    const raw = JSON.stringify(value);
    try { localStorage.setItem(key, raw); delete memory[key]; }
    catch (_) { memory[key] = raw; }
    if (wasSessionOnly !== (Object.keys(memory).length > 0)) root.dispatchEvent(new Event('cue:storage'));
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  const Store = {
    addTutorial(text) {
      const all = read(KEY_SCRIPTS, []);
      const existing = all.find(rec => rec.id === 'cue-tutorial');
      if (existing) return existing;
      const rec = { id: 'cue-tutorial', text, pos: 0, adj: 0, updatedAt: Date.now() };
      all.push(rec); write(KEY_SCRIPTS, all);
      return rec;
    },
    ensureTutorial(text, previousText) {
      const existing = this.get('cue-tutorial');
      // Upgrade only the exact bundled sample; never replace a person's edits or deletion.
      const previous = Array.isArray(previousText) ? previousText : [previousText];
      if (existing && previous.includes(existing.text)) {
        this.save({ id: existing.id, text, adj: 0 });
      }
      if (this.settings().tutorialAdded) return;
      this.addTutorial(text);
      this.setSettings({ tutorialAdded: true });
    },
    isSessionOnly() { return Object.keys(memory).length > 0; },
    list() {
      return read(KEY_SCRIPTS, []).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    get(id) {
      return read(KEY_SCRIPTS, []).find(s => s.id === id) || null;
    },
    // Create (no id) or update a script. Other fields (e.g. saved position) are kept.
    // touch=false keeps the edited-time (used when only saving position/tempo).
    save(patch, touch = true) {
      const all = read(KEY_SCRIPTS, []);
      let rec = patch.id ? all.find(s => s.id === patch.id) : null;
      if (!rec) {
        rec = { id: newId(), text: '', pos: 0, adj: 0, updatedAt: 0 };
        all.push(rec);
      }
      const textChanged = patch.text !== undefined && patch.text !== rec.text;
      Object.assign(rec, patch, { id: rec.id });
      if (textChanged) rec.pos = 0;   // an edited script starts from the top again
      if (touch || !rec.updatedAt) rec.updatedAt = Date.now();
      write(KEY_SCRIPTS, all);
      return rec;
    },
    // Restore validated text in one write; keep existing scripts and reader state.
    addMany(texts) {
      const all = read(KEY_SCRIPTS, []);
      const seen = new Set(all.map(rec => rec.text));
      const ids = new Set(all.map(rec => rec.id));
      let added = 0;
      for (const text of texts) {
        if (seen.has(text)) continue;
        let id;
        do { id = newId(); } while (ids.has(id));
        ids.add(id); seen.add(text);
        all.push({ id, text, pos: 0, adj: 0, updatedAt: Date.now() });
        added++;
      }
      if (added) write(KEY_SCRIPTS, all);
      return added;
    },
    remove(id) {
      write(KEY_SCRIPTS, read(KEY_SCRIPTS, []).filter(s => s.id !== id));
    },
    settings() {
      return Object.assign({}, read(KEY_SETTINGS, {}));
    },
    setSettings(patch) {
      write(KEY_SETTINGS, Object.assign(read(KEY_SETTINGS, {}), patch));
    }
  };

  root.CueStore = Store;
})(self);
