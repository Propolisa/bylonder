// Blender's File Browser for an operator (fileselect_add: Install from Disk, an ImportHelper or ExportHelper, Open
// Image, the importers and exporters) as the browser's own dialogs (tools/blender-port/wasm/fileselect.cc). An import's
// chosen files go into the module's file system, its options (what the File Browser's sidebar shows: the operator's
// own ui) are confirmed in a dialog, and it runs as the File Browser would run it. An export's options come first, then
// where to save: the file it writes goes there (the File System Access save picker) or downloads, and the files it
// writes beside it (an OBJ's .mtl) download.
import { blenderMain, blenderModule } from '../bmesh/bmesh-wasm.js';
import { files, provided } from '../port/wasm.js';
import { tick } from './wm-areas.js';

const { exports: x, withString, cString } = blenderModule;
let chosen = 0;

// filter_glob ("*.py;*.zip") as an accept list (".py,.zip").
const accept = (glob) => glob.split(';').map((pattern) => pattern.trim().replace(/^\*/, '')).filter((ext) => ext && ext !== '.*').join(',');
const baseName = (path) => path.split(/[\\/]/).pop();
const hasButtons = (node) => node.kind === 'button' || (node.children ?? []).some(hasButtons);
// The app page, whose click opened the menu: the browser opens its file dialogs for the window that has the user's
// activation, which the scene window, a frame inside it, does not get.
const page = () => globalThis.parent ?? globalThis;

function download(name, bytes) {
  const a = Object.assign(page().document.createElement('a'), { href: URL.createObjectURL(new Blob([bytes])), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// What the user chose: { name, files: [[name, bytes]] } to open, { name, save(bytes) } to save, or null; whether they
// confirmed the operator's options ({ title, layout }); and a file to hand over beside the saved one.
const browser = {
  async open({ filter_glob, files: several, directory }) {
    if (directory && page().showDirectoryPicker) {
      const handle = await page().showDirectoryPicker().catch(() => null);
      if (!handle) return null;
      const entries = [];
      for await (const entry of handle.values()) if (entry.kind === 'file') entries.push([entry.name, new Uint8Array(await (await entry.getFile()).arrayBuffer())]);
      return { name: handle.name, files: entries };
    }
    const input = Object.assign(page().document.createElement('input'), { type: 'file', accept: accept(filter_glob), multiple: several || directory, webkitdirectory: directory });
    const picked = await new Promise((resolve) => {
      input.onchange = () => resolve([...input.files]);
      input.oncancel = () => resolve([]);
      input.click();
    });
    if (!picked.length) return null;
    return { files: await Promise.all(picked.map(async (file) => [file.name, new Uint8Array(await file.arrayBuffer())])) };
  },
  async save({ filepath, filter_glob }) {
    const suggestedName = baseName(filepath) || 'untitled';
    if (page().showSaveFilePicker) {
      const handle = await page().showSaveFilePicker({ suggestedName, types: filter_glob ? [{ accept: { 'application/octet-stream': accept(filter_glob).split(',') } }] : undefined }).catch(() => null);
      return handle && { name: handle.name, async save(bytes) { const out = await handle.createWritable(); await out.write(bytes); await out.close(); } };
    }
    return { name: suggestedName, save: (bytes) => download(suggestedName, bytes) };
  },
  async options({ title, layout }) {
    const { openPopup } = await import('./wm-popups.js');
    return new Promise((resolve) => openPopup({ type: 'PROPS', title, text: JSON.stringify({ confirm: title, layout }) }, {
      at: { x: innerWidth / 2 - 150, y: 24 }, C: blenderMain().C, finish: (confirmed) => resolve(!!confirmed),
    }));
  },
  download,
};
let chooser = browser;
// For tests: { open(settings), save(settings), options({ title, layout }), download(name, bytes) } in place of the
// browser's dialogs.
export const setFileChooser = (replacement) => { chooser = replacement ? { ...browser, ...replacement } : browser; };

// The scene window's part: runs fn, which runs the operator, with Main made current (an export's meshes filled), then
// draws what it changed and takes Blender's undo step.
let host = (fn) => fn();
export const setFileselectHost = (run) => { host = run; };

const C = () => blenderMain().C;
const cancel = (op) => { x.fileselect_cancel(C(), op); tick(); };
// The operator's options, confirmed, or none to show.
function confirmOptions(op, { title }) {
  const layout = JSON.parse(cString(x.fileselect_options(C(), op)));
  return hasButtons(layout) ? chooser.options({ title, layout }) : true;
}
function execute(op, settings, directory, names) {
  host(() => {
    withString(directory, (d) => withString(names.join('\n'), (n) => x.fileselect_exec(C(), op, d, n)));
    tick();
  }, settings);
}

async function open(op, settings, directory) {
  const choice = await chooser.open(settings);
  if (!choice?.files.length) return cancel(op);
  for (const [name, bytes] of choice.files) files.set(`${directory}/${name}`, bytes);
  if (!(await confirmOptions(op, settings))) return cancel(op);
  execute(op, settings, directory, choice.files.map(([name]) => name));
}

async function save(op, settings, directory) {
  // Out of the invoke that opened the File Browser, before laying out its options in the module.
  await null;
  if (!(await confirmOptions(op, settings))) return cancel(op);
  const target = await chooser.save(settings);
  if (!target) return cancel(op);
  execute(op, settings, directory, [target.name]);
  const path = `${directory}/${target.name}`;
  for (const [file, bytes] of [...files].filter(([file]) => file.startsWith(`${directory}/`))) {
    files.delete(file);
    await (file === path ? target.save(bytes) : chooser.download(baseName(file), bytes));
  }
}

provided.fileselect_open = (op, settingsPointer) => {
  const settings = JSON.parse(cString(settingsPointer));
  (settings.save ? save : open)(op, settings, `/tmp/fileselect/${++chosen}`);
};
