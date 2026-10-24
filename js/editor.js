/* CUE — visual blocks and plain text are two views of the same local script. */
(function (root) {
  'use strict';
  const names = { text: 'Speech', h: 'Section', note: 'Note', pause: 'Pause', hold: 'Hold', tempo: 'Tempo', header: 'Script details' };
  function kind(line) {
    const s = line.trim();
    if (/^#{1,6}\s+.+/.test(s)) return 'h';
    const m = s.match(/^\[(note|pause|hold|tempo)\b(.*?)\]$/i);
    if (!m) return 'text';
    const t = m[1].toLowerCase(), a = m[2].trim(), n = Number(a);
    if (t === 'hold' || (t === 'note' && a) || (t === 'pause' && n > 0 && n <= 3600) || (t === 'tempo' && (a.toLowerCase() === 'reset' || (a && n >= 60 && n <= 300)))) return t;
    return 'text';
  }
  function read(source) {
    const lines = String(source).match(/[^\r\n]*(?:\r\n|\r|\n|$)/g).filter(Boolean);
    const blocks = []; let prefix = '', i = 0;
    while (i < lines.length && !lines[i].trim()) prefix += lines[i++];
    if (lines[i] && lines[i].trim() === '---') {
      const end = lines.findIndex((line, k) => k > i && line.trim() === '---');
      if (end >= 0) { blocks.push({ type: 'header', raw: lines.slice(i, end + 1).join('') }); i = end + 1; }
    }
    let separated = true;
    for (; i < lines.length; i++) {
      const raw = lines[i];
      if (!raw.trim()) {
        if (blocks.length) blocks[blocks.length - 1].raw += raw; else prefix += raw;
        separated = true; continue;
      }
      const type = kind(raw), previous = blocks[blocks.length - 1];
      if (type === 'text' && previous && previous.type === 'text' && !separated) previous.raw += raw;
      else blocks.push({ type, raw });
      separated = false;
    }
    return { prefix, blocks };
  }
  function write(model) {
    return model.prefix + model.blocks.map((b, i) => {
      if (i === model.blocks.length - 1) return b.raw;
      let separator = /[\r\n]$/.test(b.raw) ? '' : '\n';
      if (b.type === 'text' && model.blocks[i + 1].type === 'text' && !/(?:\r\n|\r|\n)[ \t]*(?:\r\n|\r|\n)$/.test(b.raw)) separator += '\n';
      return b.raw + separator;
    }).join('');
  }
  function body(block) { return block.raw.replace(/(?:\r\n|\r|\n)+$/, ''); }
  function replace(block, value) { block.raw = value + (block.raw.match(/(?:\r\n|\r|\n)+$/) || [''])[0]; }
  function mount(ta) {
    let model = read(ta.value), last = ta.value, mode = 'visual', selected = -1, drag = null, history = [], fieldSnapshot = null, focusOffset = 0;
    const host = document.createElement('div'); host.className = 'script-composer';
    ta.before(host);
    host.innerHTML = '<div class="composer__modes" role="group" aria-label="Editor view"><button type="button" class="btn btn--small" data-mode="visual" aria-pressed="true">Visual</button><button type="button" class="btn btn--small" data-mode="text" aria-pressed="false">Text</button><button type="button" class="btn btn--small" data-undo disabled>Undo</button></div><div class="composer__visual"><div class="composer__palette" role="group" aria-label="Add script block"></div><p class="composer__help">Choose a block, then add below it. Or drag a cue to a + gap. Use the arrows to move blocks on a phone or keyboard.</p><div class="composer__blocks" aria-label="Script blocks"></div><p class="composer__empty" hidden>Add speech to begin, or switch to Text to paste a script.</p></div>';
    host.appendChild(ta); ta.hidden = true;
    const visual = host.querySelector('.composer__visual'), list = host.querySelector('.composer__blocks'), palette = host.querySelector('.composer__palette'), undo = host.querySelector('[data-undo]');
    const button = (label, run, cls = 'btn btn--small') => {
      const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.textContent = label; b.onclick = run; return b;
    };
    const remember = (source = ta.value) => { if (history[history.length - 1] !== source) history.push(source); if (history.length > 30) history.shift(); undo.disabled = false; };
    function publish() {
      ta.value = write(model); last = ta.value;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
    function refresh() {
      if (ta.value === last) return;
      history = []; undo.disabled = true;
      last = ta.value; model = read(last); selected = -1;
      if (mode === 'visual') render();
    }
    ta.addEventListener('input', refresh);
    function choose(value) {
      if (mode === 'text') focusOffset = ta.selectionStart;
      refresh(); mode = value;
      host.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === value)));
      visual.hidden = value !== 'visual'; ta.hidden = value !== 'text';
      if (value === 'visual') render();
      focusAt(focusOffset);
    }
    host.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => choose(b.dataset.mode); });
    undo.onclick = () => {
      if (!history.length) return;
      ta.value = history.pop(); undo.disabled = !history.length; last = ta.value; model = read(last); selected = -1;
      render(); ta.dispatchEvent(new Event('input', { bubbles: true }));
    };
    function focusBlock(index) {
      const node = list.querySelector('[data-block="' + index + '"]');
      if (!node) return;
      node.scrollIntoView({ block: 'nearest' });
      const field = node.querySelector('input, textarea'); if (field) field.focus({ preventScroll: true });
    }
    function focusAt(offset) {
      focusOffset = offset;
      if (mode === 'visual') {
        let start = model.prefix.length, index = model.blocks.length - 1;
        for (let k = 0; k < model.blocks.length; k++) {
          if (offset < start + model.blocks[k].raw.length) { index = k; break; }
          start += model.blocks[k].raw.length;
        }
        focusBlock(index); return;
      }
      ta.focus({ preventScroll: true }); ta.setSelectionRange(offset, offset);
      const mirror = document.createElement('div'), caret = document.createElement('span'), style = getComputedStyle(ta);
      mirror.style.cssText = 'position:absolute;visibility:hidden;white-space:pre-wrap;overflow-wrap:break-word;';
      for (const key of ['font', 'lineHeight', 'letterSpacing', 'padding', 'boxSizing', 'tabSize']) mirror.style[key] = style[key];
      mirror.style.width = ta.clientWidth + 'px'; mirror.textContent = ta.value.slice(0, offset); caret.textContent = '\u200b';
      mirror.appendChild(caret); host.appendChild(mirror);
      ta.scrollTop = Math.max(0, caret.offsetTop - ta.clientHeight / 3); mirror.remove();
    }
    function insert(type, at) {
      remember();
      const raw = { text: '\n', h: '## New section\n', note: '[note Presenter note]\n', pause: '[pause 3]\n', hold: '[hold Applause]\n', tempo: '[tempo 170]\n' }[type];
      at = Math.max(model.blocks[0] && model.blocks[0].type === 'header' ? 1 : 0, Math.min(model.blocks.length, at));
      model.blocks.splice(at, 0, { type, raw }); selected = at; publish(); render(); focusBlock(at);
    }
    function move(from, to) {
      const first = model.blocks[0] && model.blocks[0].type === 'header' ? 1 : 0;
      if (from === to || from < first || to < first || to >= model.blocks.length) return;
      remember(); const [block] = model.blocks.splice(from, 1); model.blocks.splice(to, 0, block);
      selected = to; publish(); render();
      list.querySelector('[data-block="' + to + '"] .composer__handle').focus({ preventScroll: true });
    }
    for (const type of ['text', 'h', 'note', 'pause', 'hold', 'tempo']) {
      const b = button('+ ' + names[type], () => insert(type, selected >= 0 ? selected + 1 : model.blocks.length));
      b.draggable = true; b.dataset.add = type;
      b.ondragstart = e => { drag = { type }; e.dataTransfer.setData('text/plain', names[type]); e.dataTransfer.effectAllowed = 'copy'; };
      b.ondragend = clearDrag; palette.appendChild(b);
    }
    palette.prepend(button('Title & pace', () => {
      if (!model.blocks.length || model.blocks[0].type !== 'header') {
        remember(); model.blocks.unshift({ type: 'header', raw: '---\ntitle: \n---\n\n' }); publish(); render();
      }
      focusBlock(0);
    }));
    function clearDrag() { drag = null; host.querySelectorAll('.is-drop').forEach(n => n.classList.remove('is-drop')); }
    function gap(at) {
      const g = button('+', () => insert('text', at), 'composer__gap');
      g.setAttribute('aria-label', 'Add speech at position ' + at); g.dataset.drop = at;
      g.ondragover = e => { if (drag) { e.preventDefault(); g.classList.add('is-drop'); e.dataTransfer.dropEffect = drag.type ? 'copy' : 'move'; } };
      g.ondragleave = () => g.classList.remove('is-drop');
      g.ondrop = e => {
        if (!drag) return; e.preventDefault();
        const item = drag; clearDrag();
        if (item.type) insert(item.type, at);
        else move(item.from, at > item.from ? at - 1 : at);
      };
      return g;
    }
    function field(card, title, value, change, options = {}) {
      const label = document.createElement('label'); label.textContent = title;
      const input = document.createElement(options.multiline ? 'textarea' : 'input');
      if (!options.multiline) input.type = options.number ? 'number' : 'text';
      input.value = value; input.setAttribute('aria-label', title);
      if (options.multiline) input.rows = options.rows || 3;
      for (const key of ['min', 'max', 'step', 'required']) if (key in options) input[key] = options[key];
      input.onfocus = () => { fieldSnapshot = ta.value; };
      input.oninput = () => { if (fieldSnapshot !== null) { remember(fieldSnapshot); fieldSnapshot = null; } change(input.value); publish(); };
      label.appendChild(input); card.appendChild(label); return input;
    }
    function render() {
      list.replaceChildren();
      host.querySelector('.composer__empty').hidden = model.blocks.length > 0;
      const first = model.blocks[0] && model.blocks[0].type === 'header' ? 1 : 0;
      model.blocks.forEach((block, i) => {
        if (i >= first) list.appendChild(gap(i));
        const card = document.createElement('section'); card.className = 'composer__block composer__block--' + block.type; card.dataset.block = i;
        card.onfocusin = () => { selected = i; focusOffset = model.prefix.length + model.blocks.slice(0, i).reduce((n, b) => n + b.raw.length, 0); };
        const bar = document.createElement('div'); bar.className = 'composer__block-head';
        const name = document.createElement('strong'); name.textContent = names[block.type]; bar.appendChild(name);
        if (block.type !== 'header') {
          const handle = button('⠿', null, 'btn btn--small composer__handle'); handle.draggable = true; handle.setAttribute('aria-label', 'Drag ' + names[block.type] + ' block ' + (i + 1));
          handle.ondragstart = e => { drag = { from: i }; e.dataTransfer.setData('text/plain', names[block.type]); e.dataTransfer.effectAllowed = 'move'; };
          handle.ondragend = clearDrag;
          handle.onkeydown = e => { if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); move(i, i + (e.key === 'ArrowUp' ? -1 : 1)); } };
          bar.prepend(handle);
          const up = button('↑', () => move(i, i - 1)), down = button('↓', () => move(i, i + 1));
          up.setAttribute('aria-label', 'Move block ' + (i + 1) + ' up'); down.setAttribute('aria-label', 'Move block ' + (i + 1) + ' down');
          up.disabled = i === first; down.disabled = i === model.blocks.length - 1;
          const remove = button('Remove', () => { remember(); model.blocks.splice(i, 1); selected = Math.min(i, model.blocks.length - 1); publish(); render(); });
          remove.setAttribute('aria-label', 'Remove block ' + (i + 1)); bar.append(up, down, remove);
        }
        card.appendChild(bar);
        if (block.type === 'header') {
          const property = (key, value) => {
            const re = new RegExp('^([ \\t]*' + key + '[ \\t]*:)[^\\r\\n]*', 'mi');
            if (re.test(block.raw)) block.raw = block.raw.replace(re, (_, lead) => lead + ' ' + value);
            else block.raw = block.raw.replace(/---([\r\n]*)$/, (_, end) => key + ': ' + value + '\n---' + end);
          };
          const value = key => ((block.raw.match(new RegExp('^[ \\t]*' + key + '[ \\t]*:[ \\t]*([^\\r\\n]*)', 'mi')) || [])[1] || '').trim();
          field(card, 'Title', value('title'), v => property('title', v));
          field(card, 'Base tempo (WPM)', value('tempo'), v => {
            if (v) property('tempo', v); else block.raw = block.raw.replace(/^[ \t]*tempo[ \t]*:[^\r\n]*(?:\r\n|\r|\n)?/mi, '');
          }, { number: true, min: 60, max: 300, step: 1 });
        } else if (block.type === 'pause') {
          field(card, 'Pause seconds', body(block).trim().slice(6, -1).trim(), v => replace(block, '[pause ' + v + ']'), { number: true, min: .1, max: 3600, step: .1, required: true });
        } else if (block.type === 'tempo') {
          const rawValue = body(block).trim().slice(6, -1).trim();
          const reset = document.createElement('label'); reset.className = 'composer__reset';
          const check = document.createElement('input'); check.type = 'checkbox'; check.checked = /^reset$/i.test(rawValue);
          reset.append(check, ' Use script/default tempo'); card.appendChild(reset);
          const input = field(card, 'Section tempo (WPM)', check.checked ? '170' : rawValue, v => replace(block, '[tempo ' + v + ']'), { number: true, min: 60, max: 300, step: 1, required: true });
          input.disabled = check.checked;
          check.onchange = () => { remember(); input.disabled = check.checked; replace(block, '[tempo ' + (check.checked ? 'reset' : input.value) + ']'); publish(); };
        } else {
          const type = block.type;
          const value = type === 'text' ? body(block) : type === 'h' ? body(block).trim().replace(/^#{1,6}\s+/, '') : body(block).trim().replace(/^\[\w+\s*/, '').slice(0, -1);
          field(card, type === 'text' ? 'Speech text' : type === 'h' ? 'Section title' : type === 'note' ? 'Presenter note' : 'Hold reason', value, v => {
            if (type === 'text') replace(block, v);
            else if (type === 'h') replace(block, '## ' + v.replace(/[\r\n]+/g, ' '));
            else replace(block, '[' + type + (v.trim() ? ' ' + v.replace(/[\r\n]+/g, ' ') : '') + ']');
          }, { multiline: type !== 'h', required: type === 'h' || type === 'note', rows: type === 'text' ? Math.max(3, Math.min(10, Math.ceil(value.length / 85))) : 2 });
        }
        list.appendChild(card);
      });
      list.appendChild(gap(model.blocks.length));
    }
    render();
    return {
      refresh, focusAt, mode: () => mode,
      validate() {
        if (mode === 'text') return true;
        const invalid = visual.querySelector('input:invalid, textarea:invalid');
        if (invalid) { invalid.scrollIntoView({ block: 'nearest' }); invalid.reportValidity(); return false; }
        return true;
      },
      destroy() { ta.removeEventListener('input', refresh); }
    };
  }
  const api = { read, write, mount };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CueEditor = api;
})(typeof self !== 'undefined' ? self : this);
