// The Python Console's data (SpaceConsole: scrollback, history, prompt, selection) and its operators (console_ops.cc)
// by Blender's idname, on the console that is the context area. The language operators (execute, autocomplete,
// banner, copy as script) run Blender's own _console_python in CPython (python/pyodide.js); bl_operators/console.py,
// which Blender registers for them, only looks that module up by the console's language.
import { registerOperators, contextArea, runOperator } from '../../windowmanager/wm-operators.js';
import { readClipboard, setClipboard } from '../../makesrna/rna-bylonder.js';
import { consoleCall, pythonLoaded } from '../../python/pyodide.js';

// cursor_delim_type_unicode (string_cursor_utf8.cc): the class a character jumps with.
const DELIMS = [[',.\u2026\u3002\uff0c\uff61', 'punct'], ['{}[]()\u3010\u3011\uff08\uff09', 'brace'], ['+-=~%/<>^*&|\u2014\u300a\u300b\uff0f\uff5e', 'operator'],
  ['\'"`\u00b4\u2018\u2019\u201c\u201d', 'quote'], [' \t\n', 'whitespace'], ['\\@#$:;?!\u00a3\u0080\u3001\uff01\uff64\uff65\uff1a\uff1b\uff1f', 'other']];
const delimType = (ch) => DELIMS.find(([chars]) => chars.includes(ch))?.[1] ?? 'alphanumeric';

// BLI_str_cursor_step_utf8 with STRCUR_JUMP_DELIM: from `pos`, one step (with initStep), then on over characters of
// the class next to it.
function jumpDelim(line, pos, forward, initStep = true) {
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

const TAB_LENGTH = 4;
// U.scrollback: the lines the scrollback keeps.
const SCROLLBACK_LIMIT = 256;

// A console's lines. The selection (select_start, select_end) counts characters from the end of the console's text,
// the edit line last, lines one apart, as Blender's does.
export class ConsoleSpace {
  constructor(changed = () => {}) {
    this.settings = { font_size: 14, prompt: '', language: 'python', select_start: 0, select_end: 0 };
    this.scrollback = [];
    this.history = [];
    this.historyIndex = 0;
    this.changed = changed;
  }

  // console_history_verify: there is always an edit line, the history's last.
  get line() {
    if (!this.history.length) this.history.push({ body: '', current_character: 0 });
    return this.history.at(-1);
  }
  get hasSelection() { return this.settings.select_start !== this.settings.select_end; }
  selectOffset(offset) {
    if (!this.hasSelection) return;
    this.settings.select_start += offset;
    this.settings.select_end += offset;
  }
  setCursor(line, cursor) { line.current_character = Math.max(0, Math.min(cursor, line.body.length)); }
  // console_history_add: a copy of a line (or a new empty one) as the edit line.
  addHistory(from) { this.history.push({ body: from?.body ?? '', current_character: from?.current_character ?? 0 }); return this.history.at(-1); }
  addScrollback(body, type) {
    this.scrollback.push({ body, type });
    if (this.scrollback.length > SCROLLBACK_LIMIT) this.scrollback.splice(0, this.scrollback.length - SCROLLBACK_LIMIT);
  }
  // The console's text as Blender selects in it: the scrollback, then the prompt and edit line.
  text() { return [...this.scrollback.map((line) => line.body), this.settings.prompt + this.line.body].join('\n'); }
  selection() {
    const text = this.text(), { select_start, select_end } = this.settings;
    return text.slice(text.length - select_end, text.length - select_start);
  }
  // console_delete_editable_selection: the part of the selection in the edit line; returns how many characters went.
  deleteSelection() {
    const line = this.line, { select_start, select_end } = this.settings;
    const from = Math.max(0, line.body.length - select_end), to = Math.min(line.body.length, line.body.length - select_start);
    if (to <= from) return 0;
    line.body = line.body.slice(0, from) + line.body.slice(to);
    this.setCursor(line, from);
    this.settings.select_start = this.settings.select_end = 0;
    return to - from;
  }
  insert(text) {
    this.deleteSelection();
    const line = this.line, at = line.current_character;
    line.body = line.body.slice(0, at) + text + line.body.slice(at);
    this.setCursor(line, at + text.length);
    this.selectOffset(text.length);
  }
}

const console_ = () => contextArea()?.console ?? null;
const space = () => console_()?.space ?? null;
// An operator on the context console, which redraws it and scrolls to its edit line.
const op = (fn, poll = () => true) => ({
  poll: (props) => !!space() && poll(space(), props),
  run: (props, event) => {
    const result = fn(space(), props, event, console_());
    console_().changed({ bottom: true });
    return result;
  },
});
const MOVES = {
  LINE_BEGIN: () => 0,
  LINE_END: (line) => line.body.length,
  PREVIOUS_CHARACTER: (line) => Math.max(0, line.current_character - 1),
  NEXT_CHARACTER: (line) => Math.min(line.body.length, line.current_character + 1),
  PREVIOUS_WORD: (line) => jumpDelim(line.body, line.current_character, false),
  NEXT_WORD: (line) => jumpDelim(line.body, line.current_character, true),
};
const DELETES = {
  NEXT_CHARACTER: (line) => [line.current_character, Math.min(line.body.length, line.current_character + 1)],
  PREVIOUS_CHARACTER: (line) => [Math.max(0, line.current_character - 1), line.current_character],
  NEXT_WORD: (line) => [line.current_character, jumpDelim(line.body, line.current_character, true)],
  PREVIOUS_WORD: (line) => [jumpDelim(line.body, line.current_character, false), line.current_character],
};
// The console's language module in CPython, once loaded (it starts loading when the console opens).
const language = (name, ...args) => op((sc, props, event, c) => {
  if (!pythonLoaded()) return 'CANCELLED';
  c.beforeRun?.();
  return consoleCall(c, name, ...args.map((arg) => props[arg] ?? false));
});

export function registerConsoleOperators() {
  registerOperators({
    'console.execute': language('execute', 'interactive'),
    'console.autocomplete': language('autocomplete'),
    'console.banner': language('banner'),
    'console.copy_as_script': language('copy_as_script'),
    'console.language': op((sc, { language: name = 'python' }) => {
      sc.settings.language = name;
      runOperator('console.banner');
      runOperator('console.history_append', { text: '', current_character: 0, remove_duplicates: true });
    }),
    'console.move': op((sc, { type = 'LINE_BEGIN', select = false }) => {
      const line = sc.line, old = line.current_character, s = sc.settings;
      if (!select && sc.hasSelection) s.select_start = s.select_end;
      const had = sc.hasSelection, side = had ? (s.select_start === line.body.length - old ? -1 : s.select_end === line.body.length - old ? 1 : 0) : 0;
      const pos = MOVES[type](line);
      sc.setCursor(line, pos);
      if (!select) return;
      if (had) {
        if (side === -1) s.select_start = line.body.length - pos;
        else if (side === 1) s.select_end = line.body.length - pos;
        if (s.select_start > s.select_end) [s.select_start, s.select_end] = [s.select_end, s.select_start];
      } else if (old !== pos) [s.select_start, s.select_end] = [line.body.length - Math.max(old, pos), line.body.length - Math.min(old, pos)];
    }),
    'console.insert': op((sc, { text = '' }, event) => {
      let value = text || event?.text || '';
      if (!value) return 'PASS_THROUGH';
      value = value.replace(/\n+$/, '');
      if (value === '\t') value = ' '.repeat(TAB_LENGTH);
      if (!value || value.includes('\n')) return 'CANCELLED';
      sc.insert(value);
    }),
    'console.indent_or_autocomplete': op((sc) => runOperator(/[^ \t]/.test(sc.line.body.slice(0, sc.line.current_character)) ? 'console.autocomplete' : 'console.indent')),
    'console.indent': op((sc) => {
      const line = sc.line, spaces = line.body.match(/^ */)[0].length, len = TAB_LENGTH - (spaces % TAB_LENGTH);
      line.body = ' '.repeat(len) + line.body;
      sc.setCursor(line, line.current_character + len);
      sc.selectOffset(len);
    }),
    'console.unindent': op((sc) => {
      const line = sc.line, spaces = line.body.match(/^ */)[0].length;
      if (!spaces) return 'CANCELLED';
      const len = spaces % TAB_LENGTH || TAB_LENGTH;
      line.body = line.body.slice(len);
      sc.setCursor(line, line.current_character - len);
      sc.selectOffset(-len);
    }),
    'console.delete': op((sc, { type = 'NEXT_CHARACTER' }) => {
      const line = sc.line;
      if (!line.body.length) return 'CANCELLED';
      if (sc.hasSelection && sc.deleteSelection() > 0) return;
      const [from, to] = DELETES[type](line);
      if (to <= from) return 'CANCELLED';
      line.body = line.body.slice(0, from) + line.body.slice(to);
      sc.setCursor(line, from);
      sc.selectOffset(from - to);
    }),
    'console.clear_line': op((sc) => {
      const line = sc.line;
      if (!line.body.length) return 'CANCELLED';
      sc.addHistory(line);
      sc.addHistory(null);
      sc.selectOffset(-line.body.length);
    }),
    'console.clear': op((sc, { scrollback = true, history = false }) => {
      if (scrollback) sc.scrollback = [];
      if (history) sc.history = [];
    }),
    // console_history_cycle_exec: Up and Down step through the history; the step's copy is the edit line.
    'console.history_cycle': op((sc, { reverse = false }) => {
      let line = sc.line;
      const prevLen = line.body.length;
      let old = sc.historyIndex, next = reverse ? (old <= 0 ? 1 : old + 1) : old <= 0 ? -old : old - 1;
      let at = sc.history.length - 1;
      if (old > 0) { if (at > 0) at--; else old = 0; }
      for (let i = 0; i < next; i++) { if (at === 0) { next = i; break; } at--; }
      sc.historyIndex = next;
      const item = sc.history[at];
      if (old > 0) { sc.history.pop(); line = item; }
      if (next > 0) line = sc.addHistory(item);
      sc.selectOffset(line.body.length - prevLen);
    }),
    'console.history_append': op((sc, { text = '', current_character = 0, remove_duplicates = false }) => {
      const line = sc.line, prevLen = line.body.length;
      if (sc.historyIndex > 0) {
        if (sc.history.length > 1) sc.history.splice(-2, 1);
        sc.historyIndex = -sc.historyIndex;
      }
      if (remove_duplicates) {
        if (sc.history.length > 1 && sc.history.at(-2).body === sc.line.body) sc.history.splice(-2, 1);
        if (text === sc.line.body) return;
      }
      const added = sc.addHistory({ body: text, current_character: 0 });
      sc.selectOffset(added.body.length - prevLen);
      sc.setCursor(added, current_character);
    }),
    'console.scrollback_append': op((sc, { text = '', type = 'OUTPUT' }) => { sc.addScrollback(text, type); }),
    'console.copy': op((sc, { delete: cut = false }) => {
      setClipboard(sc.selection());
      if (cut) sc.deleteSelection();
    }, (sc) => sc.hasSelection),
    // console_paste_exec: each line break executes the line before it.
    'console.paste': op((sc, props, event, c) => {
      readClipboard().then((value) => c.run(() => {
        value.split('\n').forEach((part, i) => {
          if (i) runOperator('console.execute');
          space()?.insert(part.replace(/\r$/, ''));
        });
        c.changed({ bottom: true });
      }));
    }),
    'console.select_set': op((sc, props, event, c) => c.selectFrom(event)),
    'console.select_all': op((sc) => { sc.settings.select_start = 0; sc.settings.select_end = sc.text().length; }),
    'console.select_word': op((sc, props, event, c) => c.selectWord(event)),
  });
}
