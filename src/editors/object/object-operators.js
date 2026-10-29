// Object Mode operators: Blender's own where the module runs them, on Main kept equal to the scene (main-sync.js), else Bylonder's actions
// (object-actions.js) as the Blender operators they name, so Blender's own 3D View menus and keymaps run them. An
// operator Bylonder runs with some properties only picks its action by them. Actions Blender lacks are `bylonder.*`
// operators, added to Blender's Object menu as an add-on would.
import { registerOperator, appendMenu, kw, invokeOperator } from '../../windowmanager/wm-operators.js';
import { runModal } from '../space_view3d/view3d-modal.js';
import { regionView3D } from '../space_view3d/view3d-project.js';
import { OPERATOR_FINISHED } from '../../bmesh/bmesh-wasm.js';

const BY_PROPS = {
  'object.select_all': ({ action }) => ({ SELECT: 'select-all', DESELECT: 'deselect', INVERT: 'invert' })[action],
  'object.hide_view_set': ({ unselected }) => (unselected ? 'hide-others' : 'hide'),
  'object.parent_clear': ({ type = 'CLEAR' }) => type === 'CLEAR' && 'unparent',
};
// Enum items Blender makes from the context (parent_set_enum_itemf in object_relations.cc); the rest are Blender's
// static items (rna-operators.json).
const ENUMS = {};
// Blender's Object Mode operators, run by Blender's code in the module (tests/objects-wasm.test.js) where Bylonder has no
// action of its own for them.
const blenderOperators = (blender) => blender.operators().filter((idname) => idname.startsWith('object.'));
const isOperator = (id) => /^[a-z0-9_]+\.[a-z0-9_]+$/.test(id);

//   host: commit() an undo step, wm() the window manager, pointer() its last pointer event, view() the 3D View under it.
// Runs an operator on Main with the selected objects' geometry given to it, as one undo step: its exec, or invoked with
// the event that ran it in the 3D View, as Blender's window manager runs it (view3d-modal.js), so a modal operator or
// a macro (object.duplicate_move) runs on with the following events, written back as it goes. An operator that
// changed the data of a light or camera, which Bylonder keeps itself, changes nothing. A popup its invoke opened runs
// it again by exec with what it chose, or, for a properties dialog, runs the operator it kept.
export function runBlenderOperator(sync, idname, props, options) {
  const { event, keying, notify, commit, wm, pointer } = options;
  if (!event) return inMain(sync, options, () => sync.blender.run(idname, props));
  const view = event.view ?? options.view();
  if (!view) return inMain(sync, options, () => sync.blender.run(idname, props));
  let invoked = {};
  const keyed = (run) => { let result; keying(() => { result = run(); }); return result; };
  const target = {
    invoke: (...args) => (invoked = keyed(() => sync.blender.invoke(...args))),
    modal: (...args) => keyed(() => sync.blender.modal(...args)),
    modalItem: (...args) => sync.blender.modalItem(...args),
    get status() { return sync.blender.status; },
  };
  sync.begin({ meshes: sync.selected() });
  sync.blender.view = regionView3D(view);
  return runModal({
    wm: wm(), view, pointer: pointer(), target, idname, props, event, notify,
    step: () => sync.writeBack(),
    end: (status) => {
      sync.end();
      if (status & OPERATOR_FINISHED) commit();
      if (invoked.menu) invokeOperator('wm.call_menu', { name: invoked.menu }, event);
      const finish = invoked.dialog
        ? (chosen) => (chosen ? inMain(sync, options, () => sync.blender.finishPopup(invoked.dialog, true)) : sync.blender.finishPopup(invoked.dialog, false))
        : (chosen) => chosen && runBlenderOperator(sync, idname, { ...invoked.values, ...chosen }, { ...options, event: null });
      if (invoked.popup) openModulePopup(sync, invoked.popup, event, { idname, finish });
    },
  }).status;
}
// Runs Blender's code on Main as one undo step, its report shown.
function inMain(sync, { transaction, notify, keying }, run) {
  let result;
  transaction(() => sync.run(() => {
    keying(() => { result = run(); });
    const unheld = sync.geometryTagged().find(({ node }) => !sync.holdsData(node));
    if (unheld) {
      sync.revert();
      result = { status: 0, report: `Bylonder does not apply this to ${unheld.type.toLowerCase()} objects yet` };
    }
  }, { meshes: sync.selected() }));
  if (result.report) notify(result.report);
  return result;
}

// Opens a popup the module's operators or menus made (wm-popups.js) at an event's pointer; its menu items are invoked
// as Blender's menus call them, with that event.
export function openModulePopup(sync, popup, event, { idname, finish = () => {} } = {}) {
  const at = { x: event?.clientX ?? event?.x ?? innerWidth / 2, y: event?.clientY ?? event?.y ?? innerHeight / 2 };
  import('../../windowmanager/wm-popups.js').then(({ openPopup }) => openPopup(popup, {
    idname, at, finish,
    run: (id, values) => invokeOperator(id, values, { type: 'NONE', value: 'NOTHING', clientX: at.x, clientY: at.y }),
    C: sync.blender.C,
    submenu: (index) => sync.blender.submenu(index),
    enumItems: (prop) => sync.blender.enumItems(idname, prop),
  }));
}
const OBJECT_MENU_EXTRAS = ['rename', 'group', 'ungroup'];

//   sync: the scene's (createMainSync); transaction(fn): an undo step around a change; notify(text): a report;
//   keying(run): runs an operator that may insert keys (auto keying), for the animation to take them.
export function registerObjectOperators(registry, { sync, transaction, notify, keying = (fn) => fn(), ...host } = {}) {
  const options = { transaction, notify, keying, ...host };
  if (sync) for (const idname of blenderOperators(sync.blender)) registerOperator(idname, {
    poll: () => { sync.flush(); return sync.blender.poll(idname); },
    run: (props, event) => runBlenderOperator(sync, idname, props, { ...options, event }),
  });
  const named = (action) => [action.blender ?? []].flat();
  for (const idname of new Set(registry.actions.flatMap(named).filter(isOperator))) {
    const pick = BY_PROPS[idname] ?? (() => registry.actions.find((action) => named(action).includes(idname)).id);
    const action = (props = {}) => registry.actions.find((a) => a.id === pick(props));
    registerOperator(idname, {
      supports: (props) => !!action(props),
      poll: (props) => action(props)?.enabled?.() ?? true,
      enumItems: (prop) => action()?.enumItems?.(prop) ?? ENUMS[idname]?.[prop],
      run: (props) => registry.invoke(action(props).id, props),
    });
  }
  const extra = (id) => registry.actions.find((action) => action.id === id);
  const bylonder = (id) => 'bylonder.' + id.replace(/-/g, '_');
  for (const id of OBJECT_MENU_EXTRAS) {
    registerOperator(bylonder(id), { poll: () => extra(id).enabled?.() ?? true, run: () => registry.invoke(id) });
  }
  // F2's panel (TOPBAR_PT_name) renames the active object.
  registerOperator('wm.call_panel', { supports: ({ name }) => name === 'TOPBAR_PT_name', poll: () => extra('rename').enabled(), run: () => registry.invoke('rename') });
  appendMenu('VIEW3D_MT_object', ({ layout }) => {
    layout.separator();
    for (const id of OBJECT_MENU_EXTRAS) layout.operator(bylonder(id), kw({ text: extra(id).label }));
  });
}
