// Run with: node tests/format.test.js
const assert = require('assert');
const F = require('../js/format.js');

// front matter, title, tempo
let s = F.parse('---\ntitle: Opening\ntempo: 150\n---\nHello there, friends. Welcome!');
assert.strictEqual(s.title, 'Opening');
assert.strictEqual(s.tempo, 150);
assert.strictEqual(s.words, 4);
assert.strictEqual(s.tokens[1].p, 1);   // "there,"
assert.strictEqual(s.tokens[2].p, 2);   // "friends."

// no front matter: title from first heading, default tempo
s = F.parse('## Welcome\nGood evening everyone.');
assert.strictEqual(s.title, 'Welcome');
assert.strictEqual(s.tempo, F.DEFAULT_TEMPO);
assert.strictEqual(s.tokens[0].t, 'h');

// no title or heading: first words
s = F.parse('Good evening ladies and gentlemen and welcome to the show');
assert.strictEqual(s.title, 'Good evening ladies and gentlemen and…');

// bad tempo warns and falls back
s = F.parse('---\ntempo: fast\n---\nHi there.');
assert.strictEqual(s.tempo, F.DEFAULT_TEMPO);
assert.ok(s.warnings.some(w => /tempo/.test(w)));

// emphasis, including multi-word, and asterisks stripped
s = F.parse('This is *very important* news, **really**.');
const w = s.tokens.filter(t => t.t === 'w');
assert.deepStrictEqual(w.map(t => t.s), ['This', 'is', 'very', 'important', 'news,', 'really.']);
assert.deepStrictEqual(w.map(t => t.em), [false, false, true, true, false, true]);

// paragraph breaks collapse; trailing break dropped
s = F.parse('One.\n\n\n\nTwo.\n\n');
assert.deepStrictEqual(s.tokens.map(t => t.t), ['w', 'br', 'w']);

// abbreviations are not sentence ends
s = F.parse('Welcome Mr. Perera and Dr. Silva.');
assert.deepStrictEqual(s.tokens.map(t => t.p), [0, 0, 0, 0, 0, 2]);

// empty script warns
assert.ok(F.parse('   ').warnings.some(x => /No spoken text/.test(x)));

// timing: 130 wpm, plain words
assert.strictEqual(F.tokenSeconds({ t: 'w', s: 'a', p: 0 }, 120), 0.5);
assert.strictEqual(F.formatDuration(125), '2:05');
assert.ok(F.estimateSeconds(F.parse('One two three four.').tokens, 120) > 2);

console.log('format tests passed');
