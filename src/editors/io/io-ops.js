// File > Import and File > Export (editors/io in Blender): the importers and exporters are Blender's own operators in
// the module (wm.obj_import, wm.ply_export, ...) and those of the add-ons Blender enables by default (glTF 2.0, FBX,
// Motion Capture, SVG as Curves), Blender's Python in the module's CPython, drawn by Blender's TOPBAR_MT_file_import and
// TOPBAR_MT_file_export and run through the browser's file dialogs (windowmanager/wm-fileselect.js). Opening File starts
// Python; until the add-ons have registered, their rows stand at Blender's places with Blender's labels
// (addon-menus.json, from Blender's own menus), greyed out, and become theirs when they register. Alembic and USD, which
// the module does not build, are listed greyed out with the reason.
import { hasOperator } from '../../bmesh/bmesh-wasm.js';
import { registerOperator, unregisterOperator, appendMenu, prependMenu, unavailableReason, kw } from '../../windowmanager/wm-operators.js';
import { startPython, whenPythonStarts } from '../../python/python.js';
import ADDON_MENUS from './addon-menus.json' with { type: 'json' };

const ALEMBIC = 'Alembic needs C++ exceptions in the WebAssembly module (its reader catches what it throws), which a later module build adds';
const USD = 'Universal Scene Description is not in Bylonder: its library, OpenUSD, needs threads and loads its plugins at run time, which the WebAssembly module cannot';
for (const [idname, unavailable] of Object.entries({ 'wm.alembic_import': ALEMBIC, 'wm.alembic_export': ALEMBIC, 'wm.usd_import': USD, 'wm.usd_export': USD })) {
  if (!hasOperator(idname)) registerOperator(idname, { unavailable, run: () => 'CANCELLED' });
}

// The add-ons' rows until they register: greyed out, their tooltip Python's state.
let state = 'Starting Python...';
const waiting = Object.values(ADDON_MENUS).flat().map(([idname]) => idname);
for (const idname of waiting) registerOperator(idname, { get unavailable() { return state; }, run: () => 'CANCELLED' });
// An open Import or Export menu's rows become live in place, in the page's window or this one (menu.js).
const menusChanged = () => new Set([globalThis, globalThis.parent]).forEach((window) => window?.dispatchEvent?.(new Event('bl-menus-changed')));
whenPythonStarts(() => { waiting.forEach(unregisterOperator); menusChanged(); });
for (const [menu, entries] of Object.entries(ADDON_MENUS)) {
  appendMenu(menu, ({ layout }) => {
    for (const [idname, text] of entries) if (unavailableReason(idname)) layout.operator(idname, kw({ text }));
  });
}
// Opening File starts Python once the menu shows, so the add-ons have usually registered by the time Import or Export
// opens.
const start = () => startPython().catch((error) => { state = `Python did not start: ${error.message}`; menusChanged(); });
prependMenu('TOPBAR_MT_file', () => { setTimeout(start); });
