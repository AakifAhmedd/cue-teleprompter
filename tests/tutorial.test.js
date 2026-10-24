const assert = require('node:assert/strict');
const F = require('../js/format.js');
const T = require('../js/tutorial.js');
const script = F.parse(T.text);
assert.ok(script.words >= 400 && script.words <= 600);
assert.equal(script.tokens.filter(t => t.t === 'h').length, 6);
assert.deepEqual(script.warnings, []);
for (const mode of ['word', 'line']) {
  const seconds = F.estimateSeconds(script.tokens, script.tempo, F.playbackPacing({}, mode));
  assert.ok(seconds >= 180 && seconds <= 320, 'three to five minutes in ' + mode);
}
assert.match(T.text, /rogue and peasant slave am I/);
assert.match(T.text, /catch the conscience of the King/);
assert.match(T.source, /gutenberg.org/);
assert.equal(script.tokens.filter(t => t.t === 'pause').length, 2);
assert.equal(T.legacyTexts.length, 2);
assert.match(T.legacyTexts[0], /The Last Broadcast/);
assert.match(T.legacyTexts[1], /Fellow countrymen/);
console.log('tutorial tests passed');
