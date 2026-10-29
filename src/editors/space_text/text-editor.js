// The Text Editor (SPACE_TEXT): Blender's own (editors/screen/blender-area.js) over Main's Texts, which are the
// project's text files (blenkernel/text-files.js). Blender's text operators edit and draw them; the page runs what
// reaches outside Blender: opening and saving files, and Run Script in CPython.
import { mountBlenderArea } from '../screen/blender-area.js';
import { registerOperators, contextArea } from '../../windowmanager/wm-operators.js';
import { report } from '../../windowmanager/wm-reports.js';
import { blendData, pointerStruct, structFind } from '../../python/bpy_rna.js';
import { runText } from '../../python/pyodide.js';

const SPACE_TEXT = 9;
// The project's entry point, which the Text Editor shows first and cannot unlink.
const ENTRY = 'index.js';

export function mountTextEditor(section, { header, files, context, beforeRun = () => {} }) {
  const editor = { beforeRun, context };
  const area = mountBlenderArea(section, { spacetype: SPACE_TEXT, name: 'TEXT_EDITOR', operators: 'text.', keymaps: ['Text Generic', 'Text'], header,
    finished: () => files.flush(), report: (error) => report('ERROR', error.message ?? String(error)), context: { textEditor: editor } });
  editor.area = { space: 'TEXT_EDITOR' };
  editor.space = () => pointerStruct(structFind('Area'), 0, area.area.pointer).spaces.active;
  editor.refresh = area.refresh;
  editor.dispose = area.dispose;
  const texts = blendData().texts;
  editor.space().text = texts.get(ENTRY) ?? texts[0] ?? null;
  area.refresh();
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
async function runScript(t, e) {
  e.beforeRun();
  const result = await runText(t.name, t.as_string(), e);
  if (result.error) {
    report('ERROR', result.error);
    if (result.line > 0) { t.cursor_set(result.line - 1); e.refresh(); }
  }
  return result;
}

registerOperators({
  'text.open': { run: () => { chooseFile().then(({ name, content }) => { const t = blendData().texts.new(name); t.from_string(content); show(t); }); } },
  // Internal texts have no file of their own (text_save_poll): Save is Save As, which downloads the text.
  'text.save': { poll: () => !!text()?.filepath, run: () => download(text().name, text().as_string()) },
  'text.save_as': { poll: () => !!text(), run: () => download(text().name, text().as_string()) },
  'text.run_script': { poll: () => !!text(), run: () => { runScript(text(), editor()); } },
  'text.unlink': {
    poll: () => !!text(),
    run: () => {
      if (text().name === ENTRY) return report('ERROR', `${ENTRY} is the project's entry point and cannot be deleted`), 'CANCELLED';
      blendData().texts.remove(text());
      editor().refresh();
    },
  },
});
