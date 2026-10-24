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

// sentence starts: after sentence ends, breaks and labels
s = F.parse('## Intro\nHello there, friends. Welcome!\n\nSecond part here');
assert.deepStrictEqual(F.sentenceStarts(s.tokens), [1, 4, 6]);
assert.strictEqual(s.tokens[1].s, 'Hello');
assert.strictEqual(s.tokens[4].s, 'Welcome!');
assert.strictEqual(s.tokens[6].s, 'Second');

// Defaults and punctuation are seconds, independent of words per minute.
assert.strictEqual(F.parse('Hello').tempo, 140);
assert.strictEqual(F.parse('Hello', { defaultTempo: 155 }).tempo, 155);
assert.strictEqual(F.parse('---\ntempo: 120\n---\nHello', { defaultTempo: 155 }).tempo, 120);
assert.strictEqual(F.tokenSeconds({ t: 'w', p: 2 }, 120), 1);
assert.strictEqual(F.tokenSeconds({ t: 'w', p: 2 }, 240), 0.75);
assert.strictEqual(F.tokenSeconds({ t: 'w', p: 1 }, 120), 0.75);
assert.strictEqual(F.tokenSeconds({ t: 'w', p: 2 }, 120, { punctuation: false }), 0.5);
assert.strictEqual(F.tokenSeconds({ t: 'w', p: 2 }, 120, { sentencePause: 1.2 }), 1.7);
assert.strictEqual(F.pacing(null).defaultTempo, F.DEFAULT_TEMPO);
assert.strictEqual(F.pacing({ defaultTempo: NaN, commaPause: Infinity }).commaPause, 0.25);
s = F.parse('---\ntempo: 120\n---\none\n[tempo 180]\ntwo three\n[tempo reset]\nfour');
assert.strictEqual(s.words, 4);
assert.deepStrictEqual(s.tokens.map(t => F.tempoFor(t, s.tempo)), [120, 180, 180, 120]);
assert.ok(Math.abs(F.estimateSeconds(s.tokens, s.tempo) - 5 / 3) < 1e-10);
assert.deepStrictEqual(s.tokens.map(t => F.tempoFor(t, s.tempo, 5)), [125, 185, 185, 125]);
assert.strictEqual(F.tempoFor({ tempo: 300 }, 120, 5), 300);
s = F.parse('one\n[pause 3]\n[hold Applause]\n[note Hand over mic]\ntwo');
assert.strictEqual(s.words, 2);
assert.deepStrictEqual(s.tokens.map(t => t.t), ['w', 'pause', 'hold', 'note', 'w']);
assert.strictEqual(F.estimateSeconds(s.tokens, 120), 4.5);
assert.strictEqual(F.estimateSeconds(s.tokens, 240), 3.75);
assert.strictEqual(F.tokenSeconds(F.parse('[pause 0.25]').tokens[0], 120), 0.25);
for (const cue of ['[tempo 0]', '[tempo 301]', '[tempo fast]', '[pause -1]', '[pause 0]', '[pause Infinity]', '[note]']) {
  s = F.parse('one\n' + cue + '\ntwo');
  assert.strictEqual(s.words, 2, cue);
  assert.ok(s.warnings.some(w => /invalid cue/.test(w)), cue);
}
assert.strictEqual(F.parse('Say [hold] aloud').words, 3);
console.log('format tests passed');
