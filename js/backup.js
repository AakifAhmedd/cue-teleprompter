/* Local script backups. Import only text; never trust imported IDs or object keys. */
(function (root) {
  'use strict';
  const MAX_BYTES = 10 * 1024 * 1024;
  function encode(scripts) {
    return JSON.stringify({ format: 'cue-library', schema: 1, scripts: scripts.map(s => ({ text: s.text })) }, null, 2);
  }
  function decode(raw) {
    if (new TextEncoder().encode(raw).length > MAX_BYTES) throw new Error('Backup is too large (maximum 10 MB).');
    let value;
    try { value = JSON.parse(raw); } catch (_) { throw new Error('This is not a valid CUE backup JSON file.'); }
    if (!value || value.format !== 'cue-library' || value.schema !== 1 || !Array.isArray(value.scripts)) {
      throw new Error('Choose a CUE library backup exported by this app.');
    }
    const texts = [];
    for (const script of value.scripts) {
      if (!script || typeof script.text !== 'string' || !script.text.trim()) throw new Error('Backup contains an invalid script. Nothing was imported.');
      texts.push(script.text);
    }
    return [...new Set(texts)];
  }
  function copyText(text, title) {
    const header = text.match(/^(\s*---[ \t]*\r?\n)([\s\S]*?)(\r?\n[ \t]*---[ \t]*(?=\r?\n|$))([\s\S]*)$/);
    const line = 'title: ' + title.replace(/[\r\n]/g, ' ') + ' — copy';
    if (!header) return '---\n' + line + '\n---\n\n' + text;
    const meta = /^\s*title\s*:/im.test(header[2]) ? header[2].replace(/^\s*title\s*:.*$/im, line) : line + '\n' + header[2];
    return header[1] + meta + header[3] + header[4];
  }
  const api = { MAX_BYTES, encode, decode, copyText };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CueBackup = api;
})(typeof self !== 'undefined' ? self : this);
