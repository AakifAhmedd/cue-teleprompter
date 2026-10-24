// Run with: node tests/store.test.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const persisted = new Map();
const events = [];
let blocked = false;
const root = { dispatchEvent: event => events.push(event.type) };
vm.runInNewContext(fs.readFileSync(require.resolve('../js/store.js'), 'utf8'), {
  self: root, Event,
  localStorage: {
    getItem: key => persisted.get(key) || null,
    setItem: (key, value) => {
      if (blocked) throw new Error('Storage unavailable');
      persisted.set(key, value);
    }
  }
});
const S = root.CueStore;
const script = S.save({ text: 'Original' });
assert.equal(S.isSessionOnly(), false);
blocked = true;
S.save({ id: script.id, text: 'Unsaved on disk' });
S.setSettings({ fontSize: 48 });
assert.equal(S.isSessionOnly(), true);
assert.equal(S.get(script.id).text, 'Unsaved on disk');
assert.equal(JSON.parse(persisted.get('cue:scripts:v1'))[0].text, 'Original');
assert.equal(events.length, 1, 'warn once when session-only mode begins');
blocked = false;
S.save({ id: script.id, text: 'Recovered' });
assert.equal(S.isSessionOnly(), true, 'settings are still session-only');
S.setSettings({ fontSize: 50 });
assert.equal(S.isSessionOnly(), false);
assert.equal(events.length, 2, 'clear the warning after all writes recover');
assert.equal(JSON.parse(persisted.get('cue:scripts:v1'))[0].text, 'Recovered');
assert.equal(JSON.parse(persisted.get('cue:settings:v1')).fontSize, 50);
S.save({ id: script.id, pos: 3, adj: 5 }, false);
const before = S.get(script.id);
assert.equal(S.addMany(['Recovered', 'Restored', 'Restored']), 1);
assert.equal(S.list().length, 2);
assert.equal(S.get(script.id).pos, before.pos);
assert.equal(S.get(script.id).adj, before.adj);
assert.equal(S.list().find(rec => rec.text === 'Restored').pos, 0);
assert.equal(S.addMany(['Restored']), 0, 'restore is idempotent');
console.log('store tests passed');
