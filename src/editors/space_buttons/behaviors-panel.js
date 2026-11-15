// Object properties > Behaviors, Bylonder's panel as an add-on registers one: the active object's behaviours in their
// order, each a box with its name (Edit Source opens its defineBehavior call in the code editor), its user count (the
// objects that carry it, as a datablock's) and its props drawn as Blender properties of its custom property group; Add
// Behavior lists the project's behaviours with their user counts. Its operators are Bylonder's (`bylonder.behavior_*`).
import { __class__, __kwargtrans__, set } from '../../bl_py/org.transcrypt.__runtime__.js';
import { registerClass, blendData, idStruct, pointerOf } from '../../python/bpy_rna.js';
import { registerEditSource, registerOperatorTip } from '../../windowmanager/wm-operators.js';
import { addBehavior, behaviorNames, removeBehavior, label as propLabel, BEHAVIORS } from '../../blenkernel/behaviors.js';

const kw = (keywords) => __kwargtrans__(keywords);
const types = () => globalThis.__py_modules['_bpy.types'];
const props = () => globalThis.__py_modules['_bpy.props'];
const FINISHED = () => set(['FINISHED']), CANCELLED = () => set(['CANCELLED']);

/** The behaviour whose props group a button's RNA pointer is (`[type, id, data]`), on its object. */
const behaviorOfGroup = ([, id, data]) => {
  const ob = id && idStruct(id);
  return ob?.bl_rna?.identifier === 'Object' ? behaviorNames(ob).find((name) => pointerOf(ob.get(BEHAVIORS).get(name))?.[2] === data) : undefined;
};

/** The objects carrying a behaviour, as a datablock's users: by name. */
export const behaviorUsers = (name) => [...blendData().objects].filter((ob) => behaviorNames(ob).includes(name));

/**
 * Registers the panel, the Add Behavior menu and their operators as Blender's types.
 * `code()` gives the project's behaviours (game-code.js: behaviors, sourceOf), `editSource(path, name)` opens a file at a
 * behaviour's definition, `select(ob)` makes an object the selected, active one, and `changed()` follows an edit (an undo
 * step, the run's update).
 */
export function registerBehaviorTypes({ icon, code, editSource, select, changed }) {
  const definition = (name) => code()?.behaviors.find((b) => b.name === name);
  const named = (description) => ({ __annotations__: { name: props().StringProperty(kw({ name: 'Behavior', description, options: new Set(['HIDDEN', 'SKIP_SAVE']) })) } });
  const operator = (idname, label, description, body, extra = {}) => __class__(`BYLONDER_OT_${idname.split('.')[1]}`, [types().Operator], {
    bl_idname: idname, bl_label: label, bl_description: description, bl_options: new Set(['REGISTER', 'UNDO']), ...named(description), ...extra,
    execute(context) { return body.call(this, context) === false ? CANCELLED() : FINISHED(); },
  });
  const users = (name) => behaviorUsers(name).map((ob) => ob.name);
  const classes = [
    operator('bylonder.behavior_add', 'Add Behavior', 'Add this behaviour to the active object, with its props at their defaults', function (C) {
      const def = definition(this.name);
      if (!C.object || !def || !addBehavior(C.object, def)) return false;
      changed();
    }),
    operator('bylonder.behavior_remove', 'Remove Behavior', 'Remove this behaviour and its props from the active object', function (C) {
      if (!C.object || !removeBehavior(C.object, this.name)) return false;
      changed();
    }),
    operator('bylonder.behavior_edit_source', 'Edit Source', 'Open the code of this behaviour in the code editor, at its defineBehavior', function () {
      const path = code()?.sourceOf(this.name);
      if (!path) return false;
      editSource(path, this.name);
    }),
    // The user count's button: its tooltip lists the objects, and a click lists them to select one.
    operator('bylonder.behavior_users', 'Users', 'The objects that carry this behaviour', function () {}, {
      invoke(C) {
        const name = this.name;
        C.window_manager.popup_menu((menu) => { for (const ob of users(name)) menu.layout.operator('bylonder.behavior_select_user', kw({ text: ob, icon: 'OBJECT_DATA' })).name = ob; }, kw({ title: `${name} users` }));
        return FINISHED();
      },
    }),
    __class__('BYLONDER_OT_behavior_select_user', [types().Operator], {
      bl_idname: 'bylonder.behavior_select_user', bl_label: 'Select User', bl_description: 'Select this object', bl_options: new Set(['REGISTER', 'UNDO']),
      ...named('The object to select'),
      execute() { const ob = blendData().objects.get(this.name); if (!ob) return CANCELLED(); select(ob); return FINISHED(); },
    }),
    __class__('OBJECT_MT_bylonder_behavior_add', [types().Menu], {
      bl_idname: 'OBJECT_MT_bylonder_behavior_add', bl_label: 'Add Behavior',
      draw(C) {
        const list = code()?.behaviors ?? [];
        if (!list.length) this.layout.label(kw({ text: 'No behaviours in the project: defineBehavior in src/', icon: 'INFO' }));
        for (const def of list) {
          const carried = C.object && behaviorNames(C.object).includes(def.name), count = behaviorUsers(def.name).length;
          const row = this.layout.row();
          row.enabled = !carried && (!def.requires || def.requires.every((r) => behaviorNames(C.object).includes(r)));
          row.operator('bylonder.behavior_add', kw({ text: `${def.name}${count ? `  ${count}` : ''}`, icon: 'TEXT' })).name = def.name;
        }
      },
    }),
    __class__('OBJECT_PT_bylonder_behaviors', [types().Panel], {
      bl_label: 'Behaviors', bl_space_type: 'PROPERTIES', bl_region_type: 'WINDOW', bl_context: 'object',
      poll: (C) => !!C.object,
      draw_header() { this.layout.label(kw({ text: '', icon_value: icon })); },
      draw(C) {
        const { layout } = this, ob = C.object;
        layout.menu('OBJECT_MT_bylonder_behavior_add', kw({ text: 'Add Behavior', icon: 'ADD' }));
        for (const name of behaviorNames(ob)) {
          const box = layout.box(), header = box.row(kw({ align: true }));
          header.operator('bylonder.behavior_edit_source', kw({ text: name, icon: 'TEXT', emboss: false })).name = name;
          header.operator('bylonder.behavior_users', kw({ text: String(behaviorUsers(name).length) })).name = name;
          header.operator('bylonder.behavior_remove', kw({ text: '', icon: 'X', emboss: false })).name = name;
          const group = ob.get(BEHAVIORS).get(name), column = box.column();
          column.use_property_split = true;
          column.use_property_decorate = true;
          if (!definition(name)) column.label(kw({ text: 'Not defined in the project\'s code', icon: 'ERROR' }));
          // Each prop a Blender property of the group: an enum Blender's dropdown, a colour its picker.
          for (const prop of group.keys()) column.prop(group, `["${prop}"]`, kw({ text: propLabel(prop) }));
        }
      },
    }),
  ];
  for (const cls of classes) registerClass(cls);
  // Edit Source on a behaviour's name or on one of its props opens its code at its defineBehavior.
  registerEditSource((b) => {
    const name = b.operator === 'bylonder.behavior_edit_source' ? b.properties?.name : b.rna && behaviorOfGroup(b.rna.pointer);
    const path = name && code()?.sourceOf(name);
    if (path) editSource(path, name);
    return !!path;
  });
  registerOperatorTip('bylonder.behavior_users', ({ name }) => `Used by ${users(name).join(', ') || 'no object'}. Click to select one`);
}
