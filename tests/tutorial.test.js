const assert = require('node:assert/strict');
const F = require('../js/format.js');
const T = require('../js/tutorial.js');
const script = F.parse(T.text);
assert.ok(script.words >= 650 && script.words <= 800);
assert.equal(script.tokens.filter(t => t.t === 'h').length, 6);
assert.deepEqual(script.warnings, []);
for (const mode of ['word', 'line']) {
  const seconds = F.estimateSeconds(script.tokens, script.tempo, F.playbackPacing({}, mode));
  assert.ok(seconds >= 270 && seconds <= 340, 'roughly five minutes in ' + mode);
}
assert.match(T.source, /^https:\/\/www\.nps\.gov\//);
assert.match(T.text, /Fellow countrymen/);
assert.match(T.text, /With malice toward none/);
console.log('tutorial tests passed');
