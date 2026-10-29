// The Text Editor (SPACE_TEXT): Blender's own (editors/screen/blender-area.js) over Main's Texts, which are the
// project's text files (blenkernel/text-files.js). Blender's text operators edit and draw them; the page runs what
// reaches outside Blender: opening and saving files, and Blender's Run Script running the Text in CPython.
import { mountBlenderArea } from '../screen/blender-area.js';
import { registerOperators, contextArea } from '../../windowmanager/wm-operators.js';
import { report } from '../../windowmanager/wm-reports.js';
import { blendData, idStruct, pointerStruct, structFind } from '../../python/bpy_rna.js';
import { provided } from '../../port/wasm.js';
import { runText } from '../../python/pyodide.js';

const SPACE_TEXT = 9;
// The project's entry point, which the Text Editor shows first and cannot unlink.
const ENTRY = 'index.js';

export function mountTextEditor(section, { header, files, context, beforeRun = () => {}, afterRun = () => {} }) {
  const editor = { beforeRun, afterRun, context };
  const area = mountBlenderArea(section, { spacetype: SPACE_TEXT, name: 'TEXT_EDITOR', operators: 'text.', keymaps: ['Text Generic', 'Text'], header, footer: true,
    finished: () => files.flush(), report: (error) => report('ERROR', error.message ?? String(error)), context: { textEditor: editor } });
  editor.area = { space: 'TEXT_EDITOR' };
  editor.space = () => pointerStruct(structFind('Area'), 0, area.area.pointer).spaces.active;
  editor.refresh = area.refresh;
  // A script runs in this area's context, as Blender runs it in the Text Editor's.
  editor.inContext = area.inContext;
  editor.dispose = area.dispose;
  const texts = blendData().texts;
  editor.space().text = texts.get(ENTRY) ?? texts[0] ?? null;
  area.refresh();
  lastEditor = editor;
  return editor;
}

const editor = () => contextArea()?.textEditor ?? null;
const text = () => editor()?.space().text ?? null;
const show = (t) => { editor().space().text = t; editor().refresh(); };

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
async function runScript(t, e, jump) {
  e.beforeRun();
  const result = await runText(t.name, t.as_string(), e);
  e.afterRun();
  if (result.error) {
    report('ERROR', result.error);
    if (jump && result.line > 0) { t.cursor_set(result.line - 1); e.refresh(); }
  }
  return result;
}
// Blender's TEXT_OT_run_script (BPY_run_text, tools/blender-port/wasm/python.cc), in the last Text Editor mounted.
let lastEditor = null;
provided.bpy_run_text = (C, text, jump) => { runScript(idStruct(text), lastEditor, !!jump); };

registerOperators({
  'text.open': { run: () => { chooseFile().then(({ name, content }) => { const t = blendData().texts.new(name); t.from_string(content); show(t); }); } },
  // Internal texts have no file of their own (text_save_poll): Save is Save As, which downloads the text.
  'text.save': { poll: () => !!text()?.filepath, run: () => download(text().name, text().as_string()) },
  'text.save_as': { poll: () => !!text(), run: () => download(text().name, text().as_string()) },
  'text.unlink': {
    poll: () => !!text(),
    run: () => {
      if (text().name === ENTRY) return report('ERROR', `${ENTRY} is the project's entry point and cannot be deleted`), 'CANCELLED';
      blendData().texts.remove(text());
      editor().refresh();
    },
  },
});
