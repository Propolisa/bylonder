// Blender's Python (bpy_interface.cc): Blender's scripts, transpiled whole (src/bl_py, tools/blender-ui/tree.py), loaded
// and started as Blender starts them, which registers their classes. Bylonder draws and runs those classes by name.
import { loadRNAUI } from '../makesrna/rna.js';

// Blender's scripts read RNA's enums as they load. Vite serves JSON as a module, without Node's import attribute.
await loadRNAUI(import.meta.env ? () => import('../makesrna/rna-ui.json') : undefined);
await import('../bl_py/__main__.js');
const _bpy = globalThis.__py_modules._bpy;

// Registered classes by Blender's idname (VIEW3D_MT_object, PROPERTIES_PT_context_object, OBJECT_OT_...).
export const registered = _bpy.registered;
const ofKind = (kind) => Object.fromEntries(Object.entries(registered).filter(([idname]) => idname.includes(kind)));
export const menus = ofKind('_MT_');
export const panels = ofKind('_PT_');
export const headers = ofKind('_HT_');

// bpy.context (and bpy.data) for what is drawn or run next, as Blender sets the window manager's context.
export const setContext = (context) => _bpy._context_set(context, context.blend_data ?? null);
