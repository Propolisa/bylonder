// Blender's Text data-blocks (DNA_text_types.h, blenkernel/intern/text.cc) in JS: a text's lines, its cursor (curl,
// curc) and the selection's leading edge (sell, selc), with text.cc's editing functions over them. Lines are indices
// here, not a linked list. A text is one of the project's text files, saved with the project (docs/blender-boundary.md).
export const TXT_TABSIZE = 4;
const TAB_TO_SPACES = ' '.repeat(TXT_TABSIZE);
const BACK_WORDS = ['return', 'break', 'continue', 'pass', 'yield'];

// cursor_delim_type_unicode (string_cursor_utf8.cc): the class a character jumps with.
const DELIMS = [[',.\u2026\u3002\uff0c\uff61', 'punct'], ['{}[]()\u3010\u3011\uff08\uff09', 'brace'], ['+-=~%/<>^*&|\u2014\u300a\u300b\uff0f\uff5e', 'operator'],
  ['\'"`\u00b4\u2018\u2019\u201c\u201d', 'quote'], [' \t\n', 'whitespace'], ['\\@#$:;?!\u00a3\u0080\u3001\uff01\uff64\uff65\uff1a\uff1b\uff1f', 'other']];
const delimType = (ch) => DELIMS.find(([chars]) => chars.includes(ch))?.[1] ?? 'alphanumeric';

// BLI_str_cursor_step_utf8 with STRCUR_JUMP_DELIM: from `pos`, one step (with initStep), then on over characters of
// the class next to it.
export function jumpDelim(line, pos, forward, initStep = true) {
  const orig = pos;
  if (forward) {
    if (initStep) pos = Math.min(line.length, pos + 1);
    const type = pos < line.length ? delimType(line[pos]) : null;
    while (pos < line.length) if (++pos === line.length || type !== delimType(line[pos])) break;
    return pos;
  }
  if (initStep) pos = Math.max(0, pos - 1);
  const type = pos > 0 ? delimType(line[pos - 1]) : null;
  while (pos > 0) {
    const prev = pos--;
    if (type !== delimType(line[pos])) { if (orig - pos >= 1) pos = prev; break; }
  }
  return pos;
}

export class Text {
  constructor(name, content = '') {
    this.name = name;
    this.filepath = '';
    this.tabsToSpaces = true;
    this.setContent(content);
    this.undo = [];
    this.redo = [];
  }

  setContent(content) {
    this.lines = String(content).replace(/\r\n?/g, '\n').split('\n');
    this.curl = this.sell = 0;
    this.curc = this.selc = 0;
  }

  get content() { return this.lines.join('\n'); }
  get curLine() { return this.lines[this.curl]; }
  hasSel() { return this.curl !== this.sell || this.curc !== this.selc; }

  // An undo step (ED_text_undo_push_init): the state before an edit.
  snapshot() { return { lines: [...this.lines], curl: this.curl, curc: this.curc, sell: this.sell, selc: this.selc }; }
  restore(state) { Object.assign(this, { ...state, lines: [...state.lines] }); }
  pushUndo(state = this.snapshot()) { this.undo.push(state); this.redo = []; if (this.undo.length > 64) this.undo.shift(); }
  stepUndo(forward) {
    const [from, to] = forward ? [this.redo, this.undo] : [this.undo, this.redo];
    if (!from.length) return false;
    to.push(this.snapshot());
    this.restore(from.pop());
    return true;
  }

  // Cursor helpers (txt_curs_cur, txt_curs_sel as getters and setters on one of the two ends).
  end(sel) { return sel ? ['sell', 'selc'] : ['curl', 'curc']; }
  swap() { [this.curl, this.sell, this.curc, this.selc] = [this.sell, this.curl, this.selc, this.curc]; }
  popSel() { this.sell = this.curl; this.selc = this.curc; }
  popFirst() { if (this.sell < this.curl || (this.curl === this.sell && this.curc > this.selc)) this.swap(); this.popSel(); }
  popLast() { if (this.sell > this.curl || (this.curl === this.sell && this.curc < this.selc)) this.swap(); this.popSel(); }
  orderCursors(reverse = false) {
    const after = this.sell < this.curl || (this.curl === this.sell && this.curc > this.selc);
    const before = this.sell > this.curl || (this.curl === this.sell && this.curc < this.selc);
    if (reverse ? before : after) this.swap();
  }

  // A move of one end: cursor alone (the selection collapses onto it) or the selection's leading edge.
  move(sel, pop, fn) {
    if (!sel) pop?.call(this);
    const [l, c] = this.end(sel);
    fn(l, c);
    if (!sel) this.popSel();
  }
  column(line, ch) { let col = 0; for (let i = 0; i < ch; i++) col += line[i] === '\t' ? TXT_TABSIZE - (col % TXT_TABSIZE) : 1; return col; }
  fromColumn(line, column) { let col = 0, i = 0; for (; i < line.length; i++) { const next = col + (line[i] === '\t' ? TXT_TABSIZE - (col % TXT_TABSIZE) : 1); if (next > column) break; col = next; } return i; }
  moveUp(sel) {
    this.move(sel, this.popFirst, (l, c) => {
      if (this[l] > 0) { const col = this.column(this.lines[this[l]], this[c]); this[l]--; this[c] = this.fromColumn(this.lines[this[l]], col); } else this[c] = 0;
    });
  }
  moveDown(sel) {
    this.move(sel, this.popLast, (l, c) => {
      if (this[l] < this.lines.length - 1) { const col = this.column(this.lines[this[l]], this[c]); this[l]++; this[c] = this.fromColumn(this.lines[this[l]], col); } else this[c] = this.lines[this[l]].length;
    });
  }
  // txt_calc_tab_left and txt_calc_tab_right: a step over indentation spaces as one tab.
  tabLeft(line, ch) {
    if (!this.tabsToSpaces || /[^ ]/.test(line.slice(0, ch))) return 0;
    const size = Math.min(ch, TXT_TABSIZE);
    return size && ch % TXT_TABSIZE ? ch % TXT_TABSIZE : size;
  }
  tabRight(line, ch) {
    if (!this.tabsToSpaces || line[ch] !== ' ' || /[^ ]/.test(line.slice(0, ch))) return 0;
    let i = ch + 1, size = (ch % TXT_TABSIZE) + 1;
    for (; line[i] === ' ' && size < TXT_TABSIZE; i++) size++;
    return i - ch;
  }
  moveLeft(sel) {
    this.move(sel, this.popFirst, (l, c) => {
      if (this[c] === 0) { if (this[l] > 0) { this[l]--; this[c] = this.lines[this[l]].length; } } else this[c] -= this.tabLeft(this.lines[this[l]], this[c]) || 1;
    });
  }
  moveRight(sel) {
    this.move(sel, this.popLast, (l, c) => {
      const line = this.lines[this[l]];
      if (this[c] === line.length) { if (this[l] < this.lines.length - 1) { this[l]++; this[c] = 0; } } else this[c] += this.tabRight(line, this[c]) || 1;
    });
  }
  jumpLeft(sel, initStep = true) { this.move(sel, this.popFirst, (l, c) => { this[c] = jumpDelim(this.lines[this[l]], this[c], false, initStep); }); }
  jumpRight(sel, initStep = true) { this.move(sel, this.popLast, (l, c) => { this[c] = jumpDelim(this.lines[this[l]], this[c], true, initStep); }); }
  moveBol(sel) { this.move(sel, null, (l, c) => { this[c] = 0; }); }
  moveEol(sel) { this.move(sel, null, (l, c) => { this[c] = this.lines[this[l]].length; }); }
  moveBof(sel) { this.move(sel, null, (l, c) => { this[l] = 0; this[c] = 0; }); }
  moveEof(sel) { this.move(sel, null, (l, c) => { this[l] = this.lines.length - 1; this[c] = this.lines[this[l]].length; }); }
  moveTo(line, ch, sel) {
    this.move(sel, null, (l, c) => { this[l] = Math.max(0, Math.min(line, this.lines.length - 1)); this[c] = Math.max(0, Math.min(ch, this.lines[this[l]].length)); });
  }

  selAll() { this.curl = 0; this.curc = 0; this.sell = this.lines.length - 1; this.selc = this.lines[this.sell].length; }
  selLine() { this.curc = 0; this.sell = this.curl; this.selc = this.lines[this.sell].length; }
  // The selection as a string (txt_sel_to_buf).
  selText() {
    const [l0, c0, l1, c1] = this.ordered();
    if (l0 === l1) return this.lines[l0].slice(c0, c1);
    return [this.lines[l0].slice(c0), ...this.lines.slice(l0 + 1, l1), this.lines[l1].slice(0, c1)].join('\n');
  }
  ordered() {
    const forward = this.curl < this.sell || (this.curl === this.sell && this.curc <= this.selc);
    return forward ? [this.curl, this.curc, this.sell, this.selc] : [this.sell, this.selc, this.curl, this.curc];
  }
  deleteSel() {
    if (!this.hasSel()) return;
    this.orderCursors();
    this.lines.splice(this.curl, this.sell - this.curl + 1, this.curLine.slice(0, this.curc) + this.lines[this.sell].slice(this.selc));
    this.popSel();
  }
  // txt_insert_buf: the selection replaced by the text, line breaks splitting lines.
  insert(buffer) {
    this.deleteSel();
    const [first, ...rest] = String(buffer).replace(/\r\n?/g, '\n').split('\n');
    const line = this.curLine, before = line.slice(0, this.curc) + first, after = line.slice(this.curc);
    if (!rest.length) { this.lines[this.curl] = before + after; this.curc = before.length; }
    else {
      const last = rest.pop();
      this.lines.splice(this.curl, 1, before, ...rest, last + after);
      this.curl += rest.length + 1;
      this.curc = last.length;
    }
    this.popSel();
  }
  // txt_add_char: a tab as spaces up to the next tab stop when the text indents with spaces.
  addChar(ch) {
    if (ch === '\n') return this.splitCurline();
    if (ch === '\t' && this.tabsToSpaces) return this.insert(TAB_TO_SPACES.slice(this.curc % TXT_TABSIZE));
    this.insert(ch);
  }
  // txt_replace_char: overwrite mode.
  replaceChar(ch) {
    if (this.curc === this.curLine.length || this.hasSel() || ch === '\n') return this.addChar(ch);
    this.lines[this.curl] = this.curLine.slice(0, this.curc) + ch + this.curLine.slice(this.curc + 1);
    this.curc += ch.length;
    this.popSel();
  }
  splitCurline() { this.insert('\n'); }
  deleteChar() {
    if (this.hasSel()) return this.deleteSel();
    if (this.curc === this.curLine.length) {
      if (this.curl === this.lines.length - 1) return;
      this.lines.splice(this.curl, 2, this.curLine + this.lines[this.curl + 1]);
    } else this.lines[this.curl] = this.curLine.slice(0, this.curc) + this.curLine.slice(this.curc + 1);
    this.popSel();
  }
  backspaceChar() {
    if (this.hasSel()) return this.deleteSel();
    if (this.curc === 0) {
      if (this.curl === 0) return;
      this.curl--;
      this.curc = this.curLine.length;
      this.lines.splice(this.curl, 2, this.curLine + this.lines[this.curl + 1]);
    } else {
      this.lines[this.curl] = this.curLine.slice(0, this.curc - 1) + this.curLine.slice(this.curc);
      this.curc--;
    }
    this.popSel();
  }
  deleteWord() { this.jumpRight(true, true); this.deleteSel(); }
  backspaceWord() { this.jumpLeft(true, true); this.deleteSel(); }
  duplicateLine() { if (this.curl === this.sell) this.lines.splice(this.curl + 1, 0, this.curLine); }

  // txt_select_prefix: `prefix` before every line from the cursor's to the selection's (blank ones skipped when asked).
  selectPrefix(prefix, skipBlank) {
    const curcOld = this.curc, selcOld = this.selc, single = this.curl === this.sell && curcOld === selcOld;
    for (let l = this.curl; l <= this.sell; l++) if (this.lines[l].length || !skipBlank) this.lines[l] = prefix + this.lines[l];
    if (this.lines[this.sell].length) this.selc += prefix.length;
    if (curcOld === 0 && !single) {
      if (this.curl === this.sell && this.curc === this.selc) this.selc = 0;
      this.curc = 0;
    } else if (this.curLine.length) this.curc = curcOld + prefix.length;
  }
  // txt_select_unprefix: `prefix` removed where lines start with it; with requireAll, only if every non-blank line does.
  selectUnprefix(prefix, requireAll) {
    const range = this.lines.slice(this.curl, this.sell + 1);
    if (requireAll && !range.every((line) => line.startsWith(prefix) || /^[ \t]*$/.test(line))) return false;
    let changed = false;
    range.forEach((line, i) => {
      if (!line.startsWith(prefix)) return;
      this.lines[this.curl + i] = line.slice(prefix.length);
      changed = true;
      if (i === 0) this.curc = Math.max(0, this.curc - prefix.length);
      if (this.curl + i === this.sell) this.selc = Math.max(0, this.selc - prefix.length);
    });
    return changed;
  }
  indentPrefix() { return this.tabsToSpaces ? TAB_TO_SPACES : '\t'; }
  indent() { this.selectPrefix(this.indentPrefix(), true); }
  unindent() { return this.selectUnprefix(this.indentPrefix(), false); }
  comment(prefix) { this.selectPrefix(prefix, this.hasSel()); }
  uncomment(prefix) { return this.selectUnprefix(prefix, true); }
  moveLines(direction) {
    this.orderCursors();
    if (direction === 'DOWN' ? this.sell === this.lines.length - 1 : this.curl === 0) return;
    const [line] = this.lines.splice(direction === 'DOWN' ? this.sell + 1 : this.curl - 1, 1);
    this.lines.splice(direction === 'DOWN' ? this.curl : this.sell, 0, line);
    const delta = direction === 'DOWN' ? 1 : -1;
    this.curl += delta;
    this.sell += delta;
  }
  // txt_setcurr_tab_spaces: the indentation a line break keeps, one level more after a colon, one less after return.
  currentIndent(space) {
    const line = this.curLine, indent = this.tabsToSpaces ? ' ' : '\t';
    let i = 0;
    while (line[i] === indent) { if (i === this.curc) return i; i++; }
    if (line.includes(':')) {
      let isIndent = false;
      for (let a = 0; a < this.curc && a < line.length; a++) {
        if (line[a] === '#') break;
        if (line[a] === ':') isIndent = true;
        else if (line[a] !== ' ' && line[a] !== '\t') isIndent = false;
      }
      if (isIndent) i += space;
    }
    const comment = line.includes('#') ? line.indexOf('#') : line.length;
    for (const word of BACK_WORDS) if (line.includes(word) && i > 0 && line.indexOf(word) < comment) i -= space;
    return i;
  }
  // txt_find_string: the next match after the selection, selected.
  find(needle, wrap, matchCase) {
    if (!needle) return false;
    this.orderCursors();
    const norm = (s) => (matchCase ? s : s.toLowerCase()), find = norm(needle);
    let l = this.sell, at = norm(this.lines[l]).indexOf(find, this.selc);
    while (at < 0) {
      if (++l === this.lines.length) { if (!wrap) return false; l = 0; }
      at = norm(this.lines[l]).indexOf(find);
      if (l === this.sell) break;
    }
    if (at < 0) return false;
    this.moveTo(l, at, false);
    this.moveTo(l, at + needle.length, true);
    return true;
  }
}

// BLI_uniquename for ID names: "Text", "Text.001", ...
export function uniqueName(name, taken) {
  if (!taken.has(name)) return name;
  const base = name.replace(/\.\d{3,}$/, '');
  for (let i = 1; ; i++) {
    const candidate = `${base}.${String(i).padStart(3, '0')}`;
    if (!taken.has(candidate)) return candidate;
  }
}

// bpy.data.texts over the project's text files: `files` is { name: content }, `save` gets every change (a text's
// name and content, or null when removed; renames as removal then addition), debounced per text.
export function createTexts({ files = {}, save = () => {}, delay = 500 } = {}) {
  const all = Object.entries(files).map(([name, content]) => new Text(name, content));
  const listeners = new Set(), timers = new Map();
  const notify = () => listeners.forEach((fn) => fn());
  const flush = (name, content) => { clearTimeout(timers.get(name)); timers.delete(name); save(name, content); };
  const texts = {
    all,
    get: (name) => all.find((text) => text.name === name) ?? null,
    new(name = 'Text', content = '') {
      const text = new Text(uniqueName(name, new Set(all.map((t) => t.name))), content);
      all.push(text);
      flush(text.name, text.content);
      notify();
      return text;
    },
    remove(text) {
      const i = all.indexOf(text);
      if (i < 0) return;
      all.splice(i, 1);
      flush(text.name, null);
      notify();
    },
    rename(text, name) {
      const next = uniqueName(name, new Set(all.filter((t) => t !== text).map((t) => t.name)));
      if (next === text.name) return;
      flush(text.name, null);
      text.name = next;
      flush(next, text.content);
      notify();
    },
    // After an edit: listeners redraw now, the project saves soon.
    edited(text) {
      clearTimeout(timers.get(text.name));
      timers.set(text.name, setTimeout(() => flush(text.name, text.content), delay));
      notify();
    },
    // A project file changed elsewhere (the Code workspace): the text follows, its cursor kept where it fits.
    load(name, content) {
      const text = texts.get(name);
      if (content === null) { if (text) all.splice(all.indexOf(text), 1); }
      else if (!text) all.push(new Text(name, content));
      else if (text.content !== content) {
        const { curl, curc } = text;
        text.setContent(content);
        text.moveTo(curl, curc, false);
      }
      notify();
    },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    flush() { for (const name of [...timers.keys()]) { const text = texts.get(name); if (text) flush(name, text.content); } },
  };
  return texts;
}
