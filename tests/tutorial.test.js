const assert = require('node:assert/strict');
const F = require('../js/format.js');
const T = require('../js/tutorial.js');
const script = F.parse(T.text);
assert.ok(script.words >= 550 && script.words <= 750);
assert.equal(script.tokens.filter(t => t.t === 'h').length, 6);
assert.deepEqual(script.warnings, []);
for (const mode of ['word', 'line']) {
  const seconds = F.estimateSeconds(script.tokens, script.tempo, F.playbackPacing({}, mode));
  assert.ok(seconds >= 180 && seconds <= 320, 'three to five minutes in ' + mode);
}
assert.match(T.text, /The Last Broadcast/);
assert.match(T.text, /original fictional villain monologue/);
assert.ok(script.tokens.filter(t => t.t === 'w' && t.p === 2).length >= 60, 'natural sentence breaks');
assert.equal(script.tokens.filter(t => t.t === 'pause').length, 2);
assert.match(T.legacyText, /Fellow countrymen/);
assert.match(T.legacySource, /^https:\/\/www\.nps\.gov\//);
console.log('tutorial tests passed');
