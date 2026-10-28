// Edit Mode by the object's type, as object.mode_set enters it: the mesh editor (object-edit.js) for meshes, the curve
// and text editor (curve/editcurve.js) for curve and text objects. One is active at a time; `kind` is the edited
// object's type (MESH, CURVE or FONT).
export function createEditModes(mesh, curve) {
  const current = () => (curve.active ? curve : mesh);
  return {
    get active() { return mesh.active || curve.active; },
    get object() { return current().object; },
    get kind() { return curve.active ? curve.kind : mesh.active ? 'MESH' : null; },
    get selectmode() { return mesh.selectmode; },
    set selectmode(mode) { mesh.selectmode = mode; },
    get stats() { return current().stats; },
    get menus() { return mesh.menus; },
    enter: (node) => curve.enter(node) || mesh.enter(node),
    exit: () => current().exit(),
    toggle: () => (curve.active || mesh.active ? current().exit() : curve.enter() || mesh.enter()),
    setSelectMode: (...args) => mesh.setSelectMode(...args),
    keymap: (event) => (curve.active ? curve.keymap(event) : mesh.active ? mesh.keymap(event) : curve.keymap(event) || mesh.keymap(event)),
    transform: (...args) => current().transform(...args),
    modifiersChanged: () => mesh.modifiersChanged(),
    reload() { mesh.reload(); curve.reload(); },
    dispose() { mesh.dispose(); curve.dispose(); },
  };
}
