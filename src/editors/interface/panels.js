// Blender's panels (bpy.types.Panel subclasses in Blender's scripts, python/bpy_interface.js) as a region draws them
// (ED_region_panels_layout_ex in area.cc, panel registration in rna_ui.cc): the panel types of a space and region in
// Blender's order, filtered by context and poll(), each drawn into layouts: draw_header, draw_header_preset and draw,
// with its sub-panels (bl_parent_id).
import { __in__ } from '../../bl_py/org.transcrypt.__runtime__.js';
import { UILayout, useContext } from './layout.js';

export const hasOption = (type, option) => !!type.bl_options && __in__(option, type.bl_options);

// A module's classes in the order it registers them: its `classes`, or (a module taken in part) its classes in order.
const moduleClasses = (module) => module?.classes ?? module?._classes_in_order?.map((name) => module[name]) ?? [];

// The panel types of a space's region, as Blender registers them: per module its `classes` in order, a panel without a
// header before those with one, then by bl_order; sub-panels likewise under their parent. Add-on panels (Bylonder's,
// as plain objects with the same fields) go after, as Blender registers add-ons after its own scripts.
export function panelTypes(modules, { space, region = 'WINDOW' }) {
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
const isPanel = (cls) => (cls.__bases__ ? cls.__name__ === 'Panel' || cls.__bases__.some(isPanel) : !!cls.draw);

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
