// Blender's tool system (wm_toolsystem.cc) in the module: the workspace's tools (bToolRef, WorkSpace.tools), set by
// Blender's own Python (space_toolsystem_common.py's activate_by_id, transpiled) and read here for Bylonder's event
// handling: the active tool's keymap and fallback keymap run first in the 3D View's window region, with the operator
// properties the tool stores (its settings in the tool header), and its gizmo group shows.
import { module, registered } from '../python/bpy_interface.js';
import { blenderModule } from '../bmesh/bmesh-wasm.js';
import { contextStruct, inPythonContext, pointerOf } from '../python/bpy_rna.js';
import { registerOperators, kw } from './wm-operators.js';

const { exports: x, cString } = blenderModule;
// WM_toolsystem_default_tool for the 3D View's modes Bylonder has (OBJECT, EDIT_MESH, EDIT_CURVE, EDIT_TEXT), and
// whether Blender's startup file also has it as the fallback tool (Select Text is in no select group, so has none).
const defaultTool = (mode) => (mode === 'EDIT_TEXT' ? ['builtin.select_text', [false]] : ['builtin.select_box', [false, true]]);
// The gizmo groups with WM_GIZMOGROUPTYPE_TOOL_FALLBACK_KEYMAP, whose tools drag with the fallback tool off the gizmo
// (wm_toolsystem.cc keeps a fallback keymap only for those, by the flag editor-context.cc gives them).
const FALLBACK_GIZMOS = new Set(['VIEW3D_GGT_xform_gizmo', 'VIEW3D_GGT_xform_gizmo_context', 'VIEW3D_GGT_xform_cage', 'VIEW3D_GGT_xform_shear', 'VIEW3D_GGT_xform_extrude', 'MESH_GGT_spin', 'MESH_GGT_spin_redo',
  'VIEW3D_GGT_mesh_preselect_elem', 'VIEW3D_GGT_mesh_preselect_edgering', 'VIEW3D_GGT_tool_generic_handle_normal', 'VIEW3D_GGT_tool_generic_handle_free']);
const { activate_by_id, activate_by_id_or_cycle, item_from_flat_index, item_from_index_active, ToolSelectPanelHelper } = module('bl_ui.space_toolsystem_common');
const { VIEW3D_PT_tools_active } = registered;

// A struct's set properties as values (a tool's stored operator settings), nested groups as objects, enum flags as
// lists of their items.
const plain = (value) => (pointerOf(value) && typeof value.keys === 'function' ? Object.fromEntries(value.keys().map((key) => [key, plain(value.get(key))]))
  : value?.__class__?.__name__ === 'set' ? [...value] : value);

//   inContext(fn(C), view): fn in the context of a 3D View's window region (the given view's toolbar region with one);
//   mode(): the mode Bylonder edits in (context.mode, which Main has once Edit Mode is Main's); changed(ref): a tool was
//   set.
export function createToolSystem({ inContext, mode: editMode, changed = () => {} }) {
  // The context the scripts read the tools in: the window's, in the mode Bylonder edits in.
  const python = (fn, view) => inContext((C) => inPythonContext(C, () => {
    const context = contextStruct();
    return fn(new Proxy(context, { get: (target, key) => (key === 'mode' ? editMode() : Reflect.get(target, key)) }));
  }), view);
  // A mode's tool as its setup left it (bToolRef_Runtime), or null.
  const ref = (mode) => python((context) => {
    const tool = context.workspace.tools.from_space_view3d_mode(mode, kw({ create: false }));
    const runtime = tool && JSON.parse(cString(x.bpy_tool_runtime(pointerOf(tool)[2])));
    return runtime && { tool, idname: tool.idname, idname_fallback: tool.idname_fallback, mode, ...runtime };
  });

  const system = {
    // The active tool in a mode, the default one until one is set (WM_toolsystem_init).
    active(mode) {
      if (!ref(mode)?.idname) {
        // Blender's startup file has the mode's default tool as the tool and as the fallback tool (the tool header's Drag).
        const [idname, fallbacks] = defaultTool(mode);
        python((context) => fallbacks.forEach((as_fallback) => activate_by_id(context, 'VIEW_3D', idname, kw({ as_fallback }))));
        changed();
      }
      return ref(mode);
    },
    // The settings a tool stores for an operator or a gizmo group (WorkSpaceTool.operator_properties,
    // gizmo_group_properties), as values.
    properties: (tool, idname) => python(() => plain(idname.includes('_GGT_') ? tool.tool.gizmo_group_properties(idname) : tool.tool.operator_properties(idname))),
    // ToolSettings.workspace_tool_type: what a drag does where the tool does not act, the fallback tool (Blender's
    // startup) or the active tool.
    get workspace_tool_type() { return python((context) => context.scene.tool_settings.workspace_tool_type); },
    // The keymaps the active tool adds before the region's own (wm_event_get_keymap_from_toolsystem_ex): its own, and
    // the fallback tool's where Blender kept it (a tool asking for it, or its gizmo group), first while the gizmo shows and
    // the pointer is not on it. `gizmo` tells { visible, highlight } for the view.
    keymaps(mode, gizmo = {}) {
      const tool = system.active(mode);
      if (!tool) return [];
      const fallback = tool.keymap_fallback && system.workspace_tool_type === 'FALLBACK';
      const keymaps = [tool.keymap, fallback && tool.keymap_fallback].filter(Boolean);
      return FALLBACK_GIZMOS.has(tool.gizmo_group) && gizmo.visible && !gizmo.highlight ? keymaps.reverse() : keymaps;
    },
    // The stored settings a tool keymap's operator runs with (WM_toolsystem_ref_properties_init_for_keymap).
    keymapProperties(mode, keymap, idname) {
      const tool = system.active(mode);
      return tool && [tool.keymap, tool.keymap_fallback].includes(keymap) ? system.properties(tool, idname) : {};
    },
    // The 3D View's tool definitions (Blender's VIEW3D_PT_tools_active).
    panel: VIEW3D_PT_tools_active,
    // A tool's definition by its idname, in the active mode.
    item: (idname) => python((context) => ToolSelectPanelHelper._tool_class_from_space_type('VIEW_3D')._tool_get_by_id(context, idname)[0]),
    python,
  };

  // Blender's operators setting tools (bl_operators/wm.py's WM_OT_tool_set_by_id and _by_index), in the mode Bylonder
  // edits in: a tool set as the fallback makes drags use it.
  const space = ({ space_type }) => space_type ?? 'VIEW_3D';
  const activate = (context, props, idname) => {
    if (!(props.cycle ? activate_by_id_or_cycle : activate_by_id)(context, space(props), idname, kw({ as_fallback: !!props.as_fallback }))) return false;
    if (props.as_fallback) context.scene.tool_settings.workspace_tool_type = 'FALLBACK';
    return true;
  };
  const set = (find) => (props) => {
    const done = python((context) => { const idname = find(context, props); return !!idname && activate(context, props, idname); });
    if (done) changed();
    return done ? 'FINISHED' : 'CANCELLED';
  };
  registerOperators({
    'wm.tool_set_by_id': { run: set((context, props) => props.name) },
    'wm.tool_set_by_index': { run: set((context, props) => ((props.expand ?? true) ? item_from_flat_index : item_from_index_active)(context, space(props), props.index ?? 0)?.idname) },
  });
  return system;
}
