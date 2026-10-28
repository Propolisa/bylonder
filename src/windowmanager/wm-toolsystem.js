// Blender's tool system (wm_toolsystem.cc): each space and mode has its active tool (bToolRef), which Blender's own
// Python sets (space_toolsystem_common.py's activate_by_id, transpiled) through the WorkSpaceTool RNA
// (makesrna/rna-bylonder.js). The tool's keymap and its fallback keymap run first in the 3D View's window region, with
// the operator properties the tool stores (its settings in the tool header), and its gizmo group shows.
import { activate_by_id, activate_by_id_or_cycle, item_from_flat_index, item_from_index_active, ToolSelectPanelHelper } from '../bl_ui/space_toolsystem_common.js';
import { VIEW3D_PT_tools_active } from '../bl_ui/space_toolsystem_toolbar.js';
import { useContext } from '../editors/interface/layout.js';
import { registerOperators, kw } from './wm-operators.js';
import { dict } from '../bl_ui/org.transcrypt.__runtime__.js';

// WM_toolsystem_default_tool for the 3D View's modes Bylonder has.
const DEFAULT_TOOL = 'builtin.select_box';
// The modes (context.mode) Bylonder has.
const MODES = ['OBJECT', 'EDIT_MESH'];
// The gizmo groups with WM_GIZMOGROUPTYPE_TOOL_FALLBACK_KEYMAP, whose tools drag with the fallback tool off the gizmo.
const FALLBACK_GIZMOS = new Set(['VIEW3D_GGT_xform_gizmo', 'VIEW3D_GGT_xform_gizmo_context', 'VIEW3D_GGT_xform_extrude', 'MESH_GGT_spin', 'MESH_GGT_spin_redo',
  'VIEW3D_GGT_mesh_preselect_elem', 'VIEW3D_GGT_mesh_preselect_edgering']);
const SETUP = ['idname', 'keymap', 'cursor', 'options', 'gizmo_group', 'brush_type', 'data_block', 'operator', 'index', 'idname_fallback', 'keymap_fallback'];

// `changed(ref)` is told when a tool is set up, `context()` gives bpy.context for the 3D View the window manager acts on.
export function createToolSystem({ changed = () => {}, context }) {
  const refs = new Map();
  const key = (space_type, mode) => `${space_type}:${mode}`;
  const blank = (space_type, mode) => ({ space_type, mode, idname: '', idname_fallback: '', index: -1, keymap: '', keymap_fallback: '', gizmo_group: '',
    operator: '', options: new Set(), properties: new Map() });
  // ToolSelectPanelHelper.register, as Blender runs it when it registers the panel, for the modes Bylonder has (the
  // others' dynamic tools read paint data it lacks): the groups' memory, and the names of the keymaps tools make from
  // their label ("3D View Tool: Edit Mesh, Extrude Region"), which Blender's default key configuration holds.
  const panel = VIEW3D_PT_tools_active;
  if (!panel._tool_group_active) {
    panel._tool_group_active = dict({});
    // Under the names Transcrypt gives get, new and name.
    const keymap = (name) => ({ py_name: name }), keyconfig = { keymaps: { py_get: keymap, py_new: keymap } };
    for (const mode of MODES) {
      for (const item of ToolSelectPanelHelper._tools_flatten_with_dynamic(panel._tools[mode], kw({ context: null }))) {
        if (typeof item?.keymap?.[0] === 'function') panel._km_action_simple(keyconfig, keyconfig, mode.replace('_', ' ').title(), item.label, item.keymap);
      }
    }
  }
  const python = (fn) => { const ctx = context(); useContext(ctx); return fn(ctx); };

  const system = {
    // WorkSpace.tools.from_space_view3d_mode and its kin (WM_toolsystem_ref_find, _ensure).
    ref(space_type, mode, create = false) {
      if (create && !refs.has(key(space_type, mode))) refs.set(key(space_type, mode), blank(space_type, mode));
      return refs.get(key(space_type, mode)) ?? null;
    },
    // WorkSpaceTool.setup (WM_toolsystem_ref_set_from_runtime).
    setup(ref, fields) {
      Object.assign(ref, Object.fromEntries(SETUP.filter((name) => fields[name] !== undefined).map((name) => [name, fields[name]])));
      ref.options = new Set(fields.options ?? []);
      changed(ref);
    },
    // The tool's properties of an operator (WM_toolsystem_ref_properties_ensure_from_operator): the values set on it.
    properties: (ref, idname) => ref.properties.get(idname) ?? ref.properties.set(idname, {}).get(idname),
    // The active tool in a mode, the default one until one is set (WM_toolsystem_init).
    active(mode, space_type = 'VIEW_3D') {
      // Blender's startup file has Select Box as the tool and as the fallback tool (the tool header's Drag).
      if (!refs.get(key(space_type, mode))?.idname) {
        python((ctx) => [false, true].forEach((as_fallback) => activate_by_id(ctx, space_type, DEFAULT_TOOL, kw({ as_fallback }))));
      }
      return refs.get(key(space_type, mode)) ?? null;
    },
    // ToolSettings.workspace_tool_type: what a drag does where the tool does not act, the fallback tool (Blender's
    // startup) or the active tool.
    workspace_tool_type: 'FALLBACK',
    // The keymaps the active tool adds before the region's own (wm_event_get_keymap_from_toolsystem_ex): its own, and
    // the fallback tool's for a tool that asks for it or whose gizmo group gives it, first while the gizmo shows and
    // the pointer is not on it. `gizmo` tells { visible, highlight } for the view.
    keymaps(mode, gizmo = {}) {
      const ref = system.active(mode);
      if (!ref) return [];
      const fallback = ref.keymap_fallback && system.workspace_tool_type === 'FALLBACK' &&
        (ref.options.has('KEYMAP_FALLBACK') || FALLBACK_GIZMOS.has(ref.gizmo_group));
      const keymaps = [ref.keymap, fallback && ref.keymap_fallback].filter(Boolean);
      return FALLBACK_GIZMOS.has(ref.gizmo_group) && gizmo.visible && !gizmo.highlight ? keymaps.reverse() : keymaps;
    },
    // The stored settings a tool keymap's operator runs with (WM_toolsystem_ref_properties_init_for_keymap).
    keymapProperties(mode, keymap, idname) {
      const ref = system.active(mode);
      return ref && [ref.keymap, ref.keymap_fallback].includes(keymap) ? { ...ref.properties.get(idname) } : {};
    },
    // The 3D View's tool definitions (Blender's VIEW3D_PT_tools_active).
    panel,
    // A tool's definition by its idname, in the active mode.
    item: (idname) => python((ctx) => ToolSelectPanelHelper._tool_class_from_space_type('VIEW_3D')._tool_get_by_id(ctx, idname)[0]),
    python,
  };

  // Blender's operators setting tools (bl_operators/wm.py), on the 3D View the window manager acts on.
  const space = (ctx, { space_type }) => space_type ?? ctx.space_data.type;
  // WM_OT_tool_set_by_id.execute: a tool set as the fallback makes drags use it.
  const activate = (ctx, props, idname) => {
    if (!(props.cycle ? activate_by_id_or_cycle : activate_by_id)(ctx, space(ctx, props), idname, kw({ as_fallback: !!props.as_fallback }))) return false;
    if (props.as_fallback) system.workspace_tool_type = 'FALLBACK';
    return true;
  };
  registerOperators({
    'wm.tool_set_by_id': { run: (props) => python((ctx) => (activate(ctx, props, props.name) ? 'FINISHED' : 'CANCELLED')) },
    'wm.tool_set_by_index': {
      run: (props) => python((ctx) => {
        const item = (props.expand ?? true ? item_from_flat_index : item_from_index_active)(ctx, space(ctx, props), props.index ?? 0);
        return item && activate(ctx, props, item.idname) ? 'FINISHED' : 'CANCELLED';
      }),
    },
  });
  return system;
}
