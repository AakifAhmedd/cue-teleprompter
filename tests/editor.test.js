const assert = require('node:assert/strict');
const E = require('../js/editor.js');
const T = require('../js/tutorial.js');
for (const source of [T.text, T.legacyText, '', 'one two', '\n\n---\r\ntitle: Example\r\nx: untouched\r\n---\r\n\r\n## First\r\nLine one\r\nLine two\r\n\r\n[pause 2.5]\r\n[note <img src=x>]\r\n[hold]\r\n[tempo reset]\r\n[tempo 170]\r\n[unknown keep me]\r\n', '---\nnot a complete header\n', '[pause -1]\n[tempo 900]\n', '## One\nText\n\n## Two\nOther']) {
  assert.equal(E.write(E.read(source)), source, 'unchanged source round-trips exactly');
}
const model = E.read('## Welcome\nHello, everyone.\n\n[pause 3]\n[note Hand over mic]\n[hold Applause]\n[tempo reset]');
assert.deepEqual(model.blocks.map(b => b.type), ['h', 'text', 'pause', 'note', 'hold', 'tempo']);
const raw = E.read('---\ntitle: Name\n---\n\nSpeech\n[hold]\n').blocks;
assert.equal(raw[0].type, 'header');
assert.equal(raw[1].type, 'text');
assert.equal(E.read('[pause -2]').blocks[0].type, 'text', 'invalid cues remain editable raw text');
console.log('editor tests passed');
