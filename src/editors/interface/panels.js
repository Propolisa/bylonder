// Blender's panels (bpy.types.Panel subclasses in Blender's scripts, src/bl_ui) as a region draws them
// (ED_region_panels_layout_ex in area.cc, panel registration in rna_ui.cc): the panel types of a space and region in
// Blender's order, filtered by context and poll(), each drawn into layouts: draw_header, draw_header_preset and draw,
// with its sub-panels (bl_parent_id).
import { __in__ } from '../../bl_ui/org.transcrypt.__runtime__.js';
import { types as bpyTypes } from '../../bl_ui/bpy._app.js';
import { Panel } from '../../bl_ui/bpy.types.js';
import { UILayout, useContext } from './layout.js';
import { blRna } from '../../makesrna/rna.js';

// The order bl_ui/__init__.py registers Blender's script modules in.
export const MODULES = ['properties_animviz', 'properties_constraint', 'properties_data_armature', 'properties_data_bone',
  'properties_data_camera', 'properties_data_curve', 'properties_data_curves', 'properties_data_empty', 'properties_data_grease_pencil',
  'properties_data_light', 'properties_data_lattice', 'properties_data_mesh', 'properties_data_metaball', 'properties_data_modifier',
  'properties_data_pointcloud', 'properties_data_shaderfx', 'properties_data_lightprobe', 'properties_data_speaker', 'properties_data_volume',
  'properties_mask_common', 'properties_material', 'properties_material_gpencil', 'properties_object', 'properties_paint_common',
  'properties_grease_pencil_common', 'properties_particle', 'properties_physics_cloth', 'properties_physics_common',
  'properties_physics_dynamicpaint', 'properties_physics_field', 'properties_physics_geometry_nodes', 'properties_physics_rigidbody',
  'properties_physics_rigidbody_constraint', 'properties_physics_fluid', 'properties_physics_softbody', 'properties_render',
  'properties_output', 'properties_view_layer', 'properties_scene', 'properties_texture', 'properties_world', 'properties_collection',
  'properties_strip', 'properties_strip_modifier', 'space_properties', 'properties_workspace', 'properties_freestyle'];

export const hasOption = (type, option) => !!type.bl_options && __in__(option, type.bl_options);

// bpy.types as the scripts read it: the classes registered (Blender's and add-ons'), and any other name as the RNA
// struct of that name (bpy.types.Object.bl_rna.properties['type'].enum_items).
Object.setPrototypeOf(bpyTypes, new Proxy({}, { get: (target, name) => (typeof name === 'string' && !name.startsWith('__') ? { bl_rna: blRna(name) } : undefined) }));
// A module's classes in the order it registers them: its `classes`, or (a module taken in part) its classes in order.
const moduleClasses = (module) => module?.classes ?? module?._classes_in_order?.map((name) => module[name]) ?? [];
export function registerClasses(modules) {
  for (const module of modules) for (const cls of moduleClasses(module)) bpyTypes[cls.bl_idname || cls.__name__] = cls;
}

// The panel types of a space's region, as Blender registers them: per module its `classes` in order, a panel without a
// header before those with one, then by bl_order; sub-panels likewise under their parent. Add-on panels (Bylonder's,
// as plain objects with the same fields) go after, as Blender registers add-ons after its own scripts.
export function panelTypes(modules, { space, region = 'WINDOW' }) {
  registerClasses(modules);
  const classes = modules.flatMap(moduleClasses);
  // Instanced panels (a modifier's, a constraint's) are drawn by the templates that list their data.
  const panels = classes.filter((cls) => isPanel(cls) && cls.bl_space_type === space && (cls.bl_region_type ?? 'WINDOW') === region && !hasOption(cls, 'INSTANCED'));
  const byId = new Map(), roots = [];
  const insert = (list, type) => {
    let i = list.length;
    for (; i > 0; i--) {
      const other = list[i - 1].type;
      if (hasOption(type, 'HIDE_HEADER') && !hasOption(other, 'HIDE_HEADER')) continue;
      if ((other.bl_order ?? 0) <= (type.bl_order ?? 0)) break;
    }
    list.splice(i, 0, byId.get(idname(type)));
  };
  const add = (type) => {
    const parent = type.bl_parent_id && byId.get(type.bl_parent_id);
    if (type.bl_parent_id && !parent) return;
    byId.set(idname(type), { type, children: [] });
    insert(parent ? parent.children : roots, type);
  };
  panels.forEach(add);
  return { roots, byId, add };
}

// A bpy.types.Panel subclass, or an add-on's panel (a plain object with a draw).
const isPanel = (cls) => (cls.__bases__ ? cls === Panel || cls.__bases__.some(isPanel) : !!cls.draw);

export const idname = (type) => type.bl_idname || type.__name__;

// A header's layout (or a draw function's, as draw_xform_template), laid out as a header region lays it: in a row.
export function headerLayout(context, draw) {
  useContext(context);
  const layout = new UILayout('row');
  draw(layout);
  return layout;
}

// What a region shows: per panel whose context matches and whose poll() passes, its layouts. `open(panel)` tells
// whether a panel is open (the editor's state, starting from DEFAULT_CLOSED); a closed panel draws its header only.
//   { id, type, label, hideHeader, header, preset, body, children, error }
export function drawPanels(types, context, { contexts, open = () => true, panelOpen }) {
  useContext(context);
  const draw = (entry, parent) => {
    const { type } = entry, id = idname(type);
    if (!parent && type.bl_context && !contexts.includes(type.bl_context)) return null;
    let panel;
    try {
      if (type.poll && !type.poll(context)) return null;
      panel = type.__new__ ? type() : Object.create(type);
    } catch (error) {
      return { id, type, label: type.bl_label ?? id, error, children: [] };
    }
    const layout = () => new UILayout('root', null, { context: { panelOpen: (node) => panelOpen?.(id, node) } });
    const result = { id, type, label: type.bl_label ?? '', hideHeader: hasOption(type, 'HIDE_HEADER'), children: [] };
    const run = (method, key) => {
      if (!type[method]) return;
      panel.layout = result[key] = layout();
      try {
        panel[method](context);
      } catch (error) {
        result.error = error;
      }
    };
    run('draw_header', 'header');
    run('draw_header_preset', 'preset');
    result.closedByDefault = hasOption(type, 'DEFAULT_CLOSED');
    result.open = result.hideHeader || open(id, result.closedByDefault);
    if (result.open) {
      run('draw', 'body');
      result.children = entry.children.map((child) => draw(child, result)).filter(Boolean);
    }
    return result;
  };
  return types.roots.map((entry) => draw(entry, null)).filter(Boolean);
}
