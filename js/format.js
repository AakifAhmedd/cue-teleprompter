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

  const DEFAULT_TEMPO = 140;
  const MIN_TEMPO = 60;
  const MAX_TEMPO = 300;

  const BEAT_BREAK = 1;      // paragraph break
  const BEAT_HEADING = 1;    // section label

  const ABBREVIATIONS = /^(mr|mrs|ms|dr|prof|sr|jr|st|vs)\.$/i;

  function clampTempo(n) {
    return Math.min(MAX_TEMPO, Math.max(MIN_TEMPO, Math.round(n)));
  }

  function pacing(value = {}) {
    if (!value || typeof value !== 'object') value = {};
    const bounded = (n, fallback, max) => typeof n === 'number' && Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : fallback;
    return {
      defaultTempo: typeof value.defaultTempo === 'number' && Number.isFinite(value.defaultTempo) ? clampTempo(value.defaultTempo) : DEFAULT_TEMPO,
      punctuation: value.punctuation !== false,
      commaPause: bounded(value.commaPause, 0.25, 2),
      sentencePause: bounded(value.sentencePause, 0.5, 5)
    };
  }

  function readerLayout(value = {}) {
    if (!value || typeof value !== 'object') value = {};
    const number = (n, fallback, min, max) => typeof n === 'number' && Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
    return {
      readingWidth: Math.round(number(value.readingWidth, 100, 50, 100)),
      lineSpacing: Math.round(number(value.lineSpacing, 1.5, 1.2, 2.2) * 10) / 10
    };
  }

  function playbackPacing(options, focusMode) {
    const value = pacing(options);
    if (focusMode === 'line') value.punctuation = false;
    return value;
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

  // Source slices, rather than rendered tokens, keep every section's text and cues together.
  function sourceSections(text) {
    const source = String(text);
    const lines = [...source.matchAll(/[^\r\n]+(?:\r\n|\r|\n|$)|(?:\r\n|\r|\n)/g)];
    let first = 0, bodyStart = 0;
    while (first < lines.length && !lines[first][0].trim()) first++;
    if (lines[first] && lines[first][0].trim() === '---') {
      const end = lines.findIndex((line, i) => i > first && line[0].trim() === '---');
      if (end >= 0) bodyStart = lines[end].index + lines[end][0].length;
    }
    const heads = lines.filter(line => line.index >= bodyStart && /^#{1,6}\s+.+$/.test(line[0].trim()));
    return {
      prefix: source.slice(0, heads.length ? heads[0].index : source.length),
      sections: heads.map((line, i) => source.slice(line.index, i + 1 < heads.length ? heads[i + 1].index : source.length))
    };
  }

  function moveSection(text, from, to) {
    const parts = sourceSections(text);
    if (![from, to].every(i => Number.isInteger(i) && i >= 0 && i < parts.sections.length)) throw new Error('Invalid section move');
    if (from === to) return text;
    const [section] = parts.sections.splice(from, 1);
    parts.sections.splice(to, 0, section);
    return parts.prefix + parts.sections.map((block, i) => i < parts.sections.length - 1 && !/[\r\n]$/.test(block) ? block + '\n\n' : block).join('');
  }

  function positionAfterEdit(before, after, index) {
    if (!after.length) return 0;
    const key = token => token.t + ':' + (token.s || '') + ':' + (token.seconds || '');
    let prefix = 0, suffix = 0;
    while (prefix < before.length && prefix < after.length && key(before[prefix]) === key(after[prefix])) prefix++;
    while (suffix < before.length - prefix && suffix < after.length - prefix && key(before[before.length - 1 - suffix]) === key(after[after.length - 1 - suffix])) suffix++;
    if (index < prefix) return index;
    if (index >= before.length - suffix) return Math.max(0, after.length - (before.length - index));
    return Math.min(prefix, after.length - 1);
  }

  function punctClass(word) {
    const w = word.replace(/["'’”)\]]+$/, '');
    if (/[.!?…]$/.test(w)) return ABBREVIATIONS.test(w) ? 0 : 2;
    if (/[,;:—–]$/.test(w)) return 1;
    return 0;
  }

  function parse(text, options) {
    const defaults = pacing(options);
    const { meta, body, warnings } = splitFrontMatter(String(text || ''));
    const tokens = [];
    let inEm = false;
    let firstHeading = null;
    let sectionTempo = null;
    function push(tok) {
      if (sectionTempo !== null) tok.tempo = sectionTempo;
      tokens.push(tok);
    }

    function pushBreak() {
      const last = tokens[tokens.length - 1];
      if (last && last.t !== 'br') push({ t: 'br' });
      inEm = false;
    }

    for (const raw of body) {
      const line = raw.trim();
      if (line === '') { pushBreak(); continue; }
      const cue = line.match(/^\[(tempo|pause|hold|note)\b(.*?)\]$/i);
      if (cue) {
        const command = cue[1].toLowerCase(), arg = cue[2].trim(), value = Number(arg);
        if (command === 'tempo' && /^reset$/i.test(arg)) sectionTempo = null;
        else if (command === 'tempo' && arg && Number.isFinite(value) && value >= MIN_TEMPO && value <= MAX_TEMPO) sectionTempo = Math.round(value);
        else if (command === 'pause' && arg && Number.isFinite(value) && value > 0 && value <= 3600) push({ t: 'pause', seconds: value });
        else if (command === 'hold') push({ t: 'hold', s: arg || 'Press Play to continue' });
        else if (command === 'note' && arg) push({ t: 'note', s: arg });
        else warnings.push('Ignored invalid cue: ' + line);
        inEm = false;
        continue;
      }
      const h = line.match(/^#{1,6}\s+(.*)$/);
      if (h) {
        pushBreak();
        push({ t: 'h', s: h[1].trim() });
        if (firstHeading === null) firstHeading = h[1].trim();
        continue;
      }
      for (const piece of line.split(/\s+/)) {
        const lead = /^["'“‘(]*\*/.test(piece);
        const trail = /\*["'’”).,!?;:…]*$/.test(piece);   // closing marks may precede punctuation
        const s = piece.replace(/\*+/g, '');
        if (lead) inEm = true;
        if (s) push({ t: 'w', s, em: inEm, p: punctClass(s) });
        if (trail) inEm = false;
      }
    }
    while (tokens.length && tokens[tokens.length - 1].t === 'br') tokens.pop();

    let tempo = defaults.defaultTempo;
    let tempoGiven = false;
    if (meta.tempo !== undefined) {
      const n = Number(meta.tempo);
      if (Number.isFinite(n) && n >= MIN_TEMPO && n <= MAX_TEMPO) { tempo = Math.round(n); tempoGiven = true; }
      else warnings.push('tempo must be a number from ' + MIN_TEMPO + ' to ' + MAX_TEMPO + ' (using ' + defaults.defaultTempo + ')');
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
    if (tok.t === 'w') return 1;
    if (tok.t === 'br') return BEAT_BREAK;
    if (tok.t === 'h' || tok.t === 'note') return BEAT_HEADING;
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

  function tokenSeconds(tok, wpm, options) {
    if (tok.t === 'pause') return tok.seconds;
    const defaults = pacing(options);
    const pause = tok.t === 'w' && defaults.punctuation ? (tok.p === 2 ? defaults.sentencePause : tok.p === 1 ? defaults.commaPause : 0) : 0;
    return beats(tok) * 60 / wpm + pause;
  }

  function tempoFor(tok, base, adj = 0) {
    return clampTempo((tok.tempo === undefined ? base : tok.tempo) + adj);
  }

  function estimateSeconds(tokens, wpm, options, adj = 0) {
    let total = 0;
    for (const tok of tokens) total += tokenSeconds(tok, tempoFor(tok, wpm, adj), options);
    return total;
  }

  function formatDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }

  const api = { DEFAULT_TEMPO, MIN_TEMPO, MAX_TEMPO, clampTempo, pacing, readerLayout, playbackPacing, sourceSections, moveSection, positionAfterEdit, parse, beats, sentenceStarts, tokenSeconds, tempoFor, estimateSeconds, formatDuration };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CueFormat = api;
})(typeof self !== 'undefined' ? self : this);
