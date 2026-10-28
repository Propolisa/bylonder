// Object Mode operators: Blender's own where the module runs them, on Main kept equal to the scene (main-sync.js), else Bylonder's actions
// (object-actions.js) as the Blender operators they name, so Blender's own 3D View menus and keymaps run them. An
// operator Bylonder runs with some properties only picks its action by them. Actions Blender lacks are `bylonder.*`
// operators, added to Blender's Object menu as an add-on would.
import { registerOperator, appendMenu, kw } from '../../windowmanager/wm-operators.js';

const BY_PROPS = {
  'object.select_all': ({ action }) => ({ SELECT: 'select-all', DESELECT: 'deselect', INVERT: 'invert' })[action],
  'object.hide_view_set': ({ unselected }) => (unselected ? 'hide-others' : 'hide'),
  'object.parent_set': ({ type = 'OBJECT' }) => type === 'OBJECT' && 'parent',
  'object.parent_clear': ({ type = 'CLEAR' }) => type === 'CLEAR' && 'unparent',
  'object.delete': ({ use_global }) => !use_global && 'delete',
};
// Operators that ask before running from a key, as their invoke does (object_add.cc).
const CONFIRM = { 'object.delete': { title: 'Delete selected objects?', button: 'Delete' } };
// Enum items Blender makes from the context (parent_set_enum_itemf in object_relations.cc); the rest are Blender's
// static items (rna-operators.json).
const ENUMS = {
  'object.parent_set': { type: [['OBJECT', 'Object']] },
};
// Run by Blender's code in the module, matching Blender (tests/objects-wasm.test.js).
const BLENDER_OPERATORS = ['object.transform_apply', 'object.origin_set', 'object.location_clear', 'object.rotation_clear', 'object.scale_clear'];
const isOperator = (id) => /^[a-z0-9_]+\.[a-z0-9_]+$/.test(id);

// Runs an operator's exec as one undo step, with the selected objects' geometry given to it; returns its status and
// report. An operator that changed the data of a light or camera, which Bylonder keeps itself, changes nothing.
function runBlenderOperator(sync, idname, props, { transaction, notify, keying }) {
  let result;
  transaction(() => sync.run(() => {
    keying(() => { result = sync.blender.run(idname, props); });
    const unheld = sync.geometryTagged().find(({ node }) => !sync.holdsData(node));
    if (unheld) {
      sync.revert();
      result = { status: 0, report: `Bylonder does not apply this to ${unheld.type.toLowerCase()} objects yet` };
    }
  }, { meshes: sync.selected() }));
  if (result.report) notify(result.report);
  return result;
}
const keyLabel = (keys) => keys?.replace(/\+/g, ' ');
const OBJECT_MENU_EXTRAS = ['rename', 'group', 'ungroup', 'creation'];

//   sync: the scene's (createMainSync); transaction(fn): an undo step around a change; notify(text): a report;
//   keying(run): runs an operator that may insert keys (auto keying), for the animation to take them.
export function registerObjectOperators(registry, { sync, transaction, notify, keying = (fn) => fn() } = {}) {
  if (sync) for (const idname of BLENDER_OPERATORS) registerOperator(idname, {
    poll: () => { sync.flush(); return sync.blender.poll(idname); },
    run: (props) => runBlenderOperator(sync, idname, props, { transaction, notify, keying }),
  });
  const named = (action) => [action.blender ?? []].flat();
  for (const idname of new Set(registry.actions.flatMap(named).filter(isOperator))) {
    const pick = BY_PROPS[idname] ?? (() => registry.actions.find((action) => named(action).includes(idname)).id);
    const action = (props = {}) => registry.actions.find((a) => a.id === pick(props));
    registerOperator(idname, {
      supports: (props) => !!action(props),
      poll: (props) => action(props)?.enabled?.() ?? true,
      keys: (props) => keyLabel(action(props)?.keys[0]),
      enumItems: (prop) => ENUMS[idname]?.[prop],
      confirm: CONFIRM[idname],
      run: (props) => registry.invoke(action(props).id),
    });
  }
  const extra = (id) => registry.actions.find((action) => action.id === id);
  const bylonder = (id) => 'bylonder.' + id.replace(/-/g, '_');
  for (const id of OBJECT_MENU_EXTRAS) {
    registerOperator(bylonder(id), { poll: () => extra(id).enabled?.() ?? true, keys: () => keyLabel(extra(id).keys[0]), run: () => registry.invoke(id) });
  }
  appendMenu('VIEW3D_MT_object', ({ layout }) => {
    layout.separator();
    for (const id of OBJECT_MENU_EXTRAS) layout.operator(bylonder(id), kw({ text: extra(id).label }));
  });
}
