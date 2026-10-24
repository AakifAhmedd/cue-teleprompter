/* CUE — script format.
   Turns a plain-text script into tokens the reader can time and display.

   Format (all optional except the spoken text):

     ---
     title: Opening Ceremony
     tempo: 130            (words per minute for the whole script)
     ---
     ## Welcome            (section label, shown but not spoken)
     Good evening, *everyone*. Welcome to the show.

     A blank line starts a new paragraph (a small breather).
*/
(function (root) {
  'use strict';

  const DEFAULT_TEMPO = 130;
  const MIN_TEMPO = 60;
  const MAX_TEMPO = 300;

  // Extra "beats" of silence after a word, in units of one word.
  const BEAT_COMMA = 0.25;
  const BEAT_SENTENCE = 0.5;
  const BEAT_BREAK = 1;      // paragraph break
  const BEAT_HEADING = 1;    // section label

  const ABBREVIATIONS = /^(mr|mrs|ms|dr|prof|sr|jr|st|vs)\.$/i;

  function clampTempo(n) {
    return Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, Math.round(n)));
  }

  function splitFrontMatter(text) {
    const lines = text.replace(/\r\n?/g, '\n').split('\n');
    const meta = {};
    const warnings = [];
    let start = 0;
    while (start < lines.length && lines[start].trim() === '') start++;
    if (lines[start] && lines[start].trim() === '---') {
      let end = -1;
      for (let i = start + 1; i < lines.length; i++) {
        if (lines[i].trim() === '---') { end = i; break; }
      }
      if (end !== -1) {
        for (let i = start + 1; i < end; i++) {
          const m = lines[i].match(/^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/);
          if (m) meta[m[1].toLowerCase()] = m[2];
          else if (lines[i].trim()) warnings.push('Ignored header line: ' + lines[i].trim());
        }
        return { meta, body: lines.slice(end + 1), warnings };
      }
    }
    return { meta, body: lines.slice(start), warnings };
  }

  function punctClass(word) {
    const w = word.replace(/["'’”)\]]+$/, '');
    if (/[.!?…]$/.test(w)) return ABBREVIATIONS.test(w) ? 0 : 2;
    if (/[,;:—–]$/.test(w)) return 1;
    return 0;
  }

  function parse(text) {
    const { meta, body, warnings } = splitFrontMatter(String(text || ''));
    const tokens = [];
    let inEm = false;
    let firstHeading = null;

    function pushBreak() {
      const last = tokens[tokens.length - 1];
      if (last && last.t !== 'br') tokens.push({ t: 'br' });
      inEm = false;
    }

    for (const raw of body) {
      const line = raw.trim();
      if (line === '') { pushBreak(); continue; }
      const h = line.match(/^#{1,6}\s+(.*)$/);
      if (h) {
        pushBreak();
        tokens.push({ t: 'h', s: h[1].trim() });
        if (firstHeading === null) firstHeading = h[1].trim();
        continue;
      }
      for (const piece of line.split(/\s+/)) {
        const lead = /^["'“‘(]*\*/.test(piece);
        const trail = /\*["'’”).,!?;:…]*$/.test(piece);   // closing marks may precede punctuation
        const s = piece.replace(/\*+/g, '');
        if (lead) inEm = true;
        if (s) tokens.push({ t: 'w', s, em: inEm, p: punctClass(s) });
        if (trail) inEm = false;
      }
    }
    while (tokens.length && tokens[tokens.length - 1].t === 'br') tokens.pop();

    let tempo = DEFAULT_TEMPO;
    let tempoGiven = false;
    if (meta.tempo !== undefined) {
      const n = Number(meta.tempo);
      if (Number.isFinite(n) && n >= MIN_TEMPO && n <= MAX_TEMPO) { tempo = Math.round(n); tempoGiven = true; }
      else warnings.push('tempo must be a number from ' + MIN_TEMPO + ' to ' + MAX_TEMPO + ' (using ' + DEFAULT_TEMPO + ')');
    }

    const words = tokens.reduce((n, t) => n + (t.t === 'w' ? 1 : 0), 0);
    if (words === 0) warnings.push('No spoken text yet');

    let title = (meta.title || '').trim();
    if (!title && firstHeading) title = firstHeading;
    if (!title) {
      const firstWords = tokens.filter(t => t.t === 'w').slice(0, 6).map(t => t.s).join(' ');
      title = firstWords ? firstWords + (words > 6 ? '…' : '') : 'Untitled script';
    }

    return { title, tempo, tempoGiven, tokens, words, warnings };
  }

  // Duration of one token in "beats" (one beat = one word at the current tempo).
  function beats(tok) {
    if (tok.t === 'w') return 1 + (tok.p === 2 ? BEAT_SENTENCE : tok.p === 1 ? BEAT_COMMA : 0);
    if (tok.t === 'br') return BEAT_BREAK;
    if (tok.t === 'h') return BEAT_HEADING;
    return 0;
  }

  // Token indices where a sentence begins (first word after a sentence end, break or label).
  function sentenceStarts(tokens) {
    const out = [];
    let atStart = true;
    tokens.forEach((t, i) => {
      if (t.t === 'w') {
        if (atStart) { out.push(i); atStart = false; }
        if (t.p === 2) atStart = true;
      } else atStart = true;
    });
    return out;
  }

  function tokenSeconds(tok, wpm) {
    return beats(tok) * 60 / wpm;
  }

  function estimateSeconds(tokens, wpm) {
    let total = 0;
    for (const tok of tokens) total += tokenSeconds(tok, wpm);
    return total;
  }

  function formatDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  const api = { DEFAULT_TEMPO, MIN_TEMPO, MAX_TEMPO, clampTempo, parse, beats, sentenceStarts, tokenSeconds, estimateSeconds, formatDuration };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CueFormat = api;
})(typeof self !== 'undefined' ? self : this);
