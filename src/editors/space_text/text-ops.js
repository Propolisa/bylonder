// The Text Editor's operators (text_ops.cc) by Blender's idname, on the Text Editor that is the context area: each
// edit is an undo step of the text (ED_text_undo_push_init), saves the text and scrolls the cursor into view.
import { registerOperators, contextArea } from '../../windowmanager/wm-operators.js';
import { report } from '../../windowmanager/wm-reports.js';
import { readClipboard, setClipboard } from '../../makesrna/rna-bylonder.js';
import { commentPrefix } from './text-format.js';
import { runText } from '../../python/pyodide.js';

const editor = () => contextArea()?.textEditor ?? null;
const text = () => editor()?.space.text ?? null;
// Edits of the context's text: an undo step before, then the text saved and the view following the cursor.
const edit = (fn) => ({
  poll: () => !!text(),
  run: (props, event) => {
    const t = text(), e = editor(), before = t.snapshot();
    const result = fn(t, props, event, e), changed = t.content !== before.lines.join('\n');
    if (changed) t.pushUndo(before);
    e.edited(t, { save: changed });
    return result;
  },
});
const move = edit;

// text.move and text.move_select (move_cursor in text_ops.cc), by visual lines where words wrap.
const MOVES = {
  LINE_BEGIN: (t, sel, e) => e.lineEdge(t, sel, false),
  LINE_END: (t, sel, e) => e.lineEdge(t, sel, true),
  FILE_TOP: (t, sel) => t.moveBof(sel),
  FILE_BOTTOM: (t, sel) => t.moveEof(sel),
  PREVIOUS_CHARACTER: (t, sel) => (t.hasSel() && !sel ? (t.orderCursors(), t.popSel()) : t.moveLeft(sel)),
  NEXT_CHARACTER: (t, sel) => (t.hasSel() && !sel ? (t.orderCursors(true), t.popSel()) : t.moveRight(sel)),
  PREVIOUS_WORD: (t, sel) => t.jumpLeft(sel, true),
  NEXT_WORD: (t, sel) => t.jumpRight(sel, true),
  PREVIOUS_LINE: (t, sel, e) => e.moveLines(t, sel, -1),
  NEXT_LINE: (t, sel, e) => e.moveLines(t, sel, 1),
  PREVIOUS_PAGE: (t, sel, e) => e.moveLines(t, sel, -e.visibleLines()),
  NEXT_PAGE: (t, sel, e) => e.moveLines(t, sel, e.visibleLines()),
};
// text_delete_exec: with a selection words delete as characters; Backspace in indentation spaces deletes a tab.
const DELETES = {
  NEXT_CHARACTER: (t) => t.deleteChar(),
  PREVIOUS_CHARACTER: (t) => {
    const size = !t.hasSel() && t.curc > 0 ? t.tabLeft(t.curLine, t.curc) : 0;
    if (size) { t.sell = t.curl; t.selc = t.curc - size; t.orderCursors(); }
    t.backspaceChar();
  },
  NEXT_WORD: (t) => { if (t.hasSel()) return t.deleteChar(); if (t.curc === t.curLine.length) t.deleteChar(); t.deleteWord(); },
  PREVIOUS_WORD: (t) => { if (t.hasSel()) return DELETES.PREVIOUS_CHARACTER(t); if (t.curc === 0) t.backspaceChar(); t.backspaceWord(); },
};

const download = (name, content) => {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([content], { type: 'text/plain' })), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
};
// A local file chosen in the browser's file dialog, read as text.
const chooseFile = () => new Promise((resolve) => {
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.py,.txt,.glsl,.osl,.json,.js,text/*' });
  input.onchange = () => input.files[0]?.text().then((content) => resolve({ name: input.files[0].name, content }));
  input.click();
});

// Run Script (text_run_script, BPY_run_text): the text as Python in CPython, in the Text Editor's context; an error
// is reported with its traceback and the cursor goes to its line.
export async function runScript(t, e) {
  e.beforeRun?.();
  const result = await runText(t.name, t.content, e);
  if (result.error) {
    report('ERROR', result.error);
    if (result.line > 0) { t.moveTo(result.line - 1, 0, false); e.edited(t, { save: false }); }
  }
  return result;
}

export function registerTextOperators(texts) {
  registerOperators({
    'text.new': { run: () => editor()?.space.setText(texts.new('Text')) },
    'text.open': {
      run: () => { chooseFile().then(({ name, content }) => editor()?.space.setText(texts.new(name, content))); },
    },
    'text.unlink': {
      poll: () => !!text(),
      run: () => {
        const t = text();
        if (t.name === 'index.js') return report('ERROR', 'index.js is the project\'s entry point and cannot be deleted'), 'CANCELLED';
        editor().space.setText(texts.all.find((other) => other !== t) ?? null);
        texts.remove(t);
      },
    },
    // Internal texts have no file of their own (text_save_poll): Save is Save As, which downloads the text.
    'text.save': { poll: () => !!text()?.filepath, run: () => download(text().name, text().content) },
    'text.save_as': { poll: () => !!text(), run: () => download(text().name, text().content) },
    'text.run_script': { poll: () => !!text(), run: () => { runScript(text(), editor()); } },
    'text.cut': edit((t) => { if (!t.hasSel()) return 'CANCELLED'; setClipboard(t.selText()); t.deleteSel(); }),
    'text.copy': { poll: () => !!text()?.hasSel(), run: () => setClipboard(text().selText()) },
    'text.paste': {
      poll: () => !!text(),
      run: () => { const e = editor(), t = text(); readClipboard().then((value) => { t.pushUndo(); t.insert(value.replace(/\r\n?/g, '\n')); e.edited(t); }); },
    },
    'text.duplicate_line': edit((t) => t.duplicateLine()),
    'text.select_all': move((t) => t.selAll()),
    'text.select_line': move((t) => t.selLine()),
    'text.select_word': move((t) => { t.moveTo(t.sell, t.selc, false); t.jumpLeft(false, false); t.jumpRight(true, false); }),
    'text.move_lines': edit((t, { direction = 'DOWN' }) => t.moveLines(direction)),
    'text.move': move((t, { type = 'LINE_BEGIN' }, event, e) => MOVES[type]?.(t, false, e)),
    'text.move_select': move((t, { type = 'LINE_BEGIN' }, event, e) => MOVES[type]?.(t, true, e)),
    'text.delete': edit((t, { type = 'NEXT_CHARACTER' }) => DELETES[type]?.(t)),
    'text.overwrite_toggle': { poll: () => !!editor(), run: () => { const e = editor(); e.space.settings.overwrite = !e.space.settings.overwrite; e.space.changed(); } },
    'text.insert': edit((t, { text: value }, event, e) => {
      const chars = value || event?.text;
      if (!chars) return 'PASS_THROUGH';
      for (const ch of chars) (e.space.settings.overwrite ? t.replaceChar(ch) : t.addChar(ch));
    }),
    'text.line_break': edit((t, props, event, e) => {
      const indent = t.currentIndent(t.tabsToSpaces ? e.space.settings.tab_width : 1);
      t.splitCurline();
      t.insert((t.tabsToSpaces ? ' ' : '\t').repeat(Math.max(0, indent)));
    }),
    'text.indent': edit((t) => (t.hasSel() ? (t.orderCursors(), t.indent()) : t.addChar('\t'))),
    'text.unindent': edit((t) => { t.orderCursors(); t.unindent(); }),
    // Autocomplete is not available yet; Tab indents.
    'text.indent_or_autocomplete': edit((t) => (t.hasSel() ? (t.orderCursors(), t.indent()) : t.addChar('\t'))),
    'text.comment_toggle': edit((t, { type = 'TOGGLE' }) => {
      if (t.hasSel()) t.orderCursors();
      if (type === 'COMMENT') t.comment(commentPrefix());
      else if (type === 'UNCOMMENT') t.uncomment(commentPrefix());
      else if (!t.uncomment(commentPrefix())) t.comment(commentPrefix());
    }),
    'text.convert_whitespace': edit((t, { type = 'SPACES' }, event, e) => {
      const size = e.space.settings.tab_width;
      t.lines = t.lines.map((line) => {
        const indent = line.match(/^[ \t]*/)[0], width = [...indent].reduce((w, ch) => (ch === '\t' ? w + size - (w % size) : w + 1), 0);
        return (type === 'TABS' ? '\t'.repeat(Math.floor(width / size)) + ' '.repeat(width % size) : ' '.repeat(width)) + line.slice(indent.length);
      });
      t.moveTo(t.curl, t.curc, false);
    }),
    'text.find_set_selected': move((t, props, event, e) => { e.space.settings.find_text = t.selText(); t.find(e.space.settings.find_text, e.space.settings.use_find_wrap, e.space.settings.use_match_case); }),
    'text.find': move((t, props, event, e) => {
      const { find_text, use_find_wrap, use_match_case } = e.space.settings;
      if (!t.find(find_text, use_find_wrap, use_match_case)) return report('WARNING', `Text not found: ${find_text}`), 'CANCELLED';
    }),
    'text.replace_set_selected': move((t, props, event, e) => { e.space.settings.replace_text = t.selText(); }),
    'text.replace': edit((t, { all = false }, event, e) => {
      const { find_text, replace_text, use_find_wrap, use_match_case } = e.space.settings;
      if (!find_text) return 'CANCELLED';
      const matches = (sel) => (use_match_case ? sel === find_text : sel.toLowerCase() === find_text.toLowerCase());
      if (all) {
        t.moveBof(false);
        let count = 0;
        while (t.find(find_text, false, use_match_case) && count < 10000) { t.insert(replace_text); count++; }
        return count ? report('INFO', `Replaced ${count} instances`) : 'CANCELLED';
      }
      if (t.hasSel() && matches(t.selText())) t.insert(replace_text);
      t.find(find_text, use_find_wrap, use_match_case);
    }),
    'text.start_find': { poll: () => !!editor(), run: () => editor().startFind() },
    'text.jump': {
      poll: () => !!text(),
      run: () => {
        const e = editor(), t = text(), line = Number(prompt('Line Number', String(t.curl + 1)));
        if (Number.isInteger(line) && line > 0) { t.moveTo(line - 1, 0, false); e.edited(t, { save: false }); }
      },
    },
    'text.scroll': { poll: () => !!text(), run: ({ lines = 0 }, event) => (lines ? editor().scroll(lines * 3) : editor().dragScroll(event)) },
    'text.scroll_bar': { poll: () => !!text(), run: (props, event) => editor().scrollBar(event) },
    'text.cursor_set': move((t, props, event, e) => e.cursorAt(t, event, false)),
    'text.selection_set': move((t, props, event, e) => e.selectFrom(t, event)),
    'text.line_number': { poll: () => !!text(), run: (props, event) => editor().lineNumber(event) },
  });
  // Undo in a Text Editor undoes the text's edits (text_undo.cc), not the scene's.
  registerOperators({
    'ed.undo': { poll: () => !!text()?.undo.length, run: () => { const t = text(); t.stepUndo(false); editor().edited(t); } },
    'ed.redo': { poll: () => !!text()?.redo.length, run: () => { const t = text(); t.stepUndo(true); editor().edited(t); } },
  }, 'TEXT_EDITOR');
}
