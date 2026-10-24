const assert = require('node:assert/strict');
const B = require('../js/backup.js');
const F = require('../js/format.js');
const text = '---\ntitle: Club Night\ntempo: 120\n---\n## Welcome\nHello.\n[hold Applause]';
const raw = B.encode([{ text, id: 'private-device-id', pos: 20, adj: 5 }]);
assert.deepEqual(B.decode(raw), [text]);
assert.equal(raw.includes('private-device-id'), false);
assert.deepEqual(B.decode('{"format":"cue-library","schema":1,"scripts":[{"text":"safe","id":"overwrite","__proto__":{"polluted":true}}]}'), ['safe']);
for (const invalid of ['not json', 'null', '{}', '{"format":"cue-library","schema":2,"scripts":[]}', '{"format":"cue-library","schema":1,"scripts":[{"text":"valid"},{"text":null}]}']) {
  assert.throws(() => B.decode(invalid));
}
assert.deepEqual(B.decode(B.encode([{ text }, { text }])), [text]);
const copy = B.copyText(text, F.parse(text).title);
assert.equal(F.parse(copy).title, 'Club Night — copy');
assert.equal(F.parse(copy).tempo, 120);
assert.equal(F.parse(copy).words, F.parse(text).words);
assert.equal(F.parse(B.copyText('Hello world', 'Hello world')).tempoGiven, false);
assert.equal(F.parse(B.copyText('Hello world', 'Hello world')).words, 2);
assert.equal(F.parse(B.copyText('---\ntempo: 110\n---\nHello', 'Hello')).tempo, 110);
const unusual = '---\nA spoken line\n---not a header ending\nMore words';
assert.equal(F.parse(B.copyText(unusual, 'Copy')).words, F.parse(unusual).words);
assert.equal(F.parse(B.copyText('---  \ntempo: 110\n ---  \nHello', 'Hello')).tempo, 110);
console.log('backup tests passed');
