// The entries Blender's default add-ons add to File > Import and File > Export, for the rows that stand for them until
// those add-ons have registered in the module's CPython (src/editors/io/io-ops.js): drawn by Blender's own menus in the
// module once Python has started, in the order the add-ons register there (bylonder_cpython.py enables them sorted, one
// order), each checked against Blender 5.2's menus (src/coverage/blender-surface.json).
//   usage: node scripts/io-addon-menus.mjs [--check]
import { readFileSync, writeFileSync } from 'node:fs';
import { blenderMain } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { setContextPointer } from '../src/python/bpy_rna.js';
import { createTopbarArea } from '../src/editors/space_topbar/topbar-area.js';
import { loadKeyconfig } from '../src/windowmanager/wm-window.js';
import { startPython } from '../src/python/python.js';

const root = new URL('..', import.meta.url).pathname;
const OUT = 'src/editors/io/addon-menus.json';
const MENUS = ['TOPBAR_MT_file_import', 'TOPBAR_MT_file_export'];
// Blender's own importers and exporters are wm.*; the add-ons' are their own (import_scene.gltf, export_anim.bvh, ...).
const isAddon = (idname) => !idname.startsWith('wm.');

const surface = {};
const visit = (node) => {
  if (node.k === 'menu' && MENUS.includes(node.id)) surface[node.id] = node.c.filter((c) => c.k === 'op' && isAddon(c.id)).map((c) => [c.id, c.l]);
  (node.c ?? []).forEach(visit);
};
JSON.parse(readFileSync(root + 'src/coverage/blender-surface.json', 'utf8')).tree.forEach(visit);

const main = blenderMain();
setContextPointer(main.C);
loadKeyconfig(main.C);
globalThis.innerWidth ??= 1200;
await startPython();
const topbar = createTopbarArea(main, null);
const buttons = (node) => (node.kind === 'button' ? [node] : (node.children ?? []).flatMap(buttons));
const menus = Object.fromEntries(MENUS.map((name) => {
  const entries = buttons(topbar.menu(name)).filter((b) => b.operator && isAddon(b.operator)).map((b) => [b.operator, b.text]);
  const known = new Set(surface[name].map(String));
  const unknown = entries.filter((entry) => !known.has(String(entry)));
  if (unknown.length || entries.length !== surface[name].length) throw Error(`${name}: ${JSON.stringify(entries)} are not Blender's ${JSON.stringify(surface[name])}`);
  return [name, entries];
}));
const text = JSON.stringify(menus, null, 1) + '\n';
if (!process.argv.includes('--check')) writeFileSync(root + OUT, text);
else if (readFileSync(root + OUT, 'utf8') !== text) throw Error(`${OUT} is out of date: run node scripts/io-addon-menus.mjs`);
process.exit(0);
