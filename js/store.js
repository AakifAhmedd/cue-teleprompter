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
    const raw = JSON.stringify(value);
    try { localStorage.setItem(key, raw); delete memory[key]; }
    catch (_) { memory[key] = raw; }
  }

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  const Store = {
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
