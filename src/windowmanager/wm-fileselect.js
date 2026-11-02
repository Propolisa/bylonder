// Blender's File Browser for an operator (fileselect_add: Install from Disk, an ImportHelper or ExportHelper, Open
// Image, the importers and exporters) as the browser's own dialogs (tools/blender-port/wasm/fileselect.cc). Chosen files
// go into the module's file system and the operator runs with them as the File Browser would run it; a saving
// operator writes its file there, which then goes where the user chose (the File System Access save picker) or
// downloads.
import { blenderMain, blenderModule } from '../bmesh/bmesh-wasm.js';
import { files, provided } from '../port/wasm.js';
import { tick } from './wm-areas.js';

const { exports: x, withString, cString } = blenderModule;
let chosen = 0;

// filter_glob ("*.py;*.zip") as an accept list (".py,.zip").
const accept = (glob) => glob.split(';').map((pattern) => pattern.trim().replace(/^\*/, '')).filter((ext) => ext && ext !== '.*').join(',');
const baseName = (path) => path.split(/[\\/]/).pop();

// What the user chose: { name, files: [[name, bytes]] } to open, { name, save(bytes) } to save, or null.
const browser = {
  async open({ filter_glob, files: several, directory }) {
    if (directory && globalThis.showDirectoryPicker) {
      const handle = await showDirectoryPicker().catch(() => null);
      if (!handle) return null;
      const entries = [];
      for await (const entry of handle.values()) if (entry.kind === 'file') entries.push([entry.name, new Uint8Array(await (await entry.getFile()).arrayBuffer())]);
      return { name: handle.name, files: entries };
    }
    const input = Object.assign(document.createElement('input'), { type: 'file', accept: accept(filter_glob), multiple: several || directory, webkitdirectory: directory });
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
    if (globalThis.showSaveFilePicker) {
      const handle = await showSaveFilePicker({ suggestedName, types: filter_glob ? [{ accept: { 'application/octet-stream': accept(filter_glob).split(',') } }] : undefined }).catch(() => null);
      return handle && { name: handle.name, async save(bytes) { const out = await handle.createWritable(); await out.write(bytes); await out.close(); } };
    }
    return { name: suggestedName, save(bytes) {
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([bytes])), download: suggestedName });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } };
  },
};
let chooser = browser;
// For tests: { open(settings), save(settings) } in place of the browser's dialogs.
export const setFileChooser = (replacement) => { chooser = replacement ?? browser; };

provided.fileselect_open = (op, settingsPointer) => {
  const settings = JSON.parse(cString(settingsPointer)), C = blenderMain().C, directory = `/tmp/fileselect/${++chosen}`;
  const run = (names) => {
    withString(directory, (d) => withString(names.join('\n'), (n) => x.fileselect_exec(C, op, d, n)));
    tick();
  };
  (async () => {
    if (settings.save) {
      const target = await chooser.save(settings);
      if (!target) return x.fileselect_cancel(C, op), tick();
      const path = `${directory}/${target.name}`;
      run([target.name]);
      if (files.has(path)) await target.save(files.get(path));
      files.delete(path);
      return;
    }
    const choice = await chooser.open(settings);
    if (!choice?.files.length) return x.fileselect_cancel(C, op), tick();
    for (const [name, bytes] of choice.files) files.set(`${directory}/${name}`, bytes);
    run(choice.files.map(([name]) => name));
  })();
};
