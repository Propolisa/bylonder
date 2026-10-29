// Edit Mode by the object's type, as object.mode_set enters it: Blender's on Main (mesh/editmesh-mode.js) for meshes, the curve and text editor (curve/editcurve.js) for curve and text objects. One is active at a time; `kind` is the edited
// object's type (MESH, CURVE or FONT).
import { registerOperator } from '../../windowmanager/wm-operators.js';
export function createEditModes(mesh, curve) {
  const current = () => (curve.active ? curve : mesh);
  const active = () => mesh.active || curve.active;
  // Edit Mode of the meshes, curves and text Bylonder edits; Blender's object.mode_set on Main runs the other calls
  // (registerFallback): an armature's modes, Object Mode from them.
  registerOperator('object.mode_set', {
    supports: ({ mode }) => mode === 'OBJECT' || mode === 'EDIT',
    poll: ({ mode }) => active() || (mode === 'EDIT' && (mesh.editable() || curve.editable())),
    run: ({ mode, toggle }) => (mode === 'EDIT' && !(toggle && active()) ? active() || curve.enter() || mesh.enter() : current().exit()),
  });
  return {
    get active() { return mesh.active || curve.active; },
    get object() { return current().object; },
    get kind() { return curve.active ? curve.kind : mesh.active ? 'MESH' : null; },
    get selectmode() { return mesh.selectmode; },
    set selectmode(mode) { mesh.selectmode = mode; },
    get stats() { return current().stats; },
    enter: (node) => curve.enter(node) || mesh.enter(node),
    exit: () => current().exit(),
    toggle: () => (curve.active || mesh.active ? current().exit() : curve.enter() || mesh.enter()),
    setSelectMode: (...args) => mesh.setSelectMode(...args),
    keymap: (event) => (curve.active ? curve.keymap(event) : mesh.active ? mesh.keymap(event) : curve.keymap(event) || mesh.keymap(event)),
    module: (...args) => current().module(...args),
    selectOperator: (...args) => current().selectOperator(...args),
    selectBox: (...args) => current().selectBox(...args),
    selectRegion: (...args) => curve.selectRegion(...args),
    selectGesture: (...args) => mesh.selectGesture(...args),
    modifiersChanged: () => mesh.modifiersChanged(),
    // Edit Mesh's: the edited Mesh, the tools' gizmo center and normal, and a primitive added by its operator.
    get mesh() { return mesh.mesh; },
    gizmoStats: () => mesh.gizmoStats(),
    addPrimitive: (...args) => mesh.addPrimitive(...args),
    preselectEdgeRing: (...args) => mesh.preselectEdgeRing(...args),
    preselectElem: (...args) => mesh.preselectElem(...args),
    set toolGizmoGroup(idname) { mesh.toolGizmoGroup = idname; },
    get lastOperation() { return mesh.lastOperation; },
    reload() { mesh.reload(); curve.reload(); },
    dispose() { mesh.dispose(); curve.dispose(); },
  };
}
