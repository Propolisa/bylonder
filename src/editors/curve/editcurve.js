// Edit Mode on curve and text objects (editcurve.cc, editfont.cc): the object's Curve data goes into the module, where
// Blender's own curve and font editors change it (ED_curve_editnurb_make, ED_curve_editfont_make), and comes back on
// every change to be drawn and kept as an undo step. Operators run by their exec, registered by Blender idname for
// Blender's Curve and Font keymaps and menus; transforms run Blender's transform operator for each step from the edit
// data as it was (transform_convert_curve.cc); picking is Blender's (ED_curve_editnurb_select_pick) in the 3D View's
// region, the only operator that runs with one.
import { Vector3 } from '@babylonjs/core';
import rna from '../../makesrna/rna-operators.json' with { type: 'json' };
import { hasOperator, OPERATOR_FINISHED, moduleAccess } from '../../bmesh/bmesh-wasm.js';
import { openMenu } from '../interface/menu.js';
import { CurveObject, View3DRegion, SEL_OP_SET, SEL_OP_XOR } from '../../blenkernel/curve/curve.js';
import { createEditCurveOverlay } from '../../draw/overlay-edit-curve.js';
import { createEditTextOverlay } from '../../draw/overlay-edit-text.js';
import { mesh_batch_cache_apply } from '../../draw/mesh-batch-cache.js';
import { createMesh } from '../../blenkernel/mesh/mesh.js';
import { initTransform, toBlender, toBlenderView } from '../transform/transform.js';
import { worldAxes } from '../transform/transform-mesh.js';
import { createKeymap } from '../../windowmanager/input/keymap.js';
import { startGestureBox } from '../../windowmanager/wm-gesture-box.js';
import { boxRegion, SEL_OPS } from '../space_view3d/view3d-select.js';
import { registerOperator, registerOperators } from '../../windowmanager/wm-operators.js';
import { curveData } from './curve-objects.js';

const EMPTY = () => createMesh({ vert_positions: new Float32Array(0), edges: new Int32Array(0), face_offsets: new Int32Array([0]),
  corner_verts: new Int32Array(0), corner_edges: new Int32Array(0) });
// Blender's macros: an operator, then a move of what it made.
const MACROS = { 'curve.extrude_move': 'curve.extrude', 'curve.duplicate_move': 'curve.duplicate' };

// Blender's window matrix (GL, right-handed) for a Babylon camera, as RegionView3D.winmat.
function winmat(camera, aspect) {
  const near = camera.minZ, far = camera.maxZ || 1e4;
  if (camera.mode === 1) {
    const [l, r, b, t] = [camera.orthoLeft, camera.orthoRight, camera.orthoBottom, camera.orthoTop];
    return [2 / (r - l), 0, 0, 0, 0, 2 / (t - b), 0, 0, 0, 0, -2 / (far - near), 0, -(r + l) / (r - l), -(t + b) / (t - b), -(far + near) / (far - near), 1];
  }
  const f = 1 / Math.tan(camera.fov / 2);
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) / (near - far), -1, 0, 0, (2 * far * near) / (near - far), 0];
}

// The angle and axis of a rotation matrix (columns).
function axisAngle(m) {
  const angle = Math.acos(Math.max(-1, Math.min(1, (m[0][0] + m[1][1] + m[2][2] - 1) / 2)));
  const axis = [m[1][2] - m[2][1], m[2][0] - m[0][2], m[0][1] - m[1][0]], length = Math.hypot(...axis);
  return length < 1e-9 ? [0, [0, 0, 1]] : [angle, axis.map((v) => v / length)];
}
// An orientation whose Z is the axis.
function axisMatrix(z) {
  const x = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const y = cross(z, x), ny = Math.hypot(...y), yn = y.map((v) => v / ny), xn = cross(yn, z);
  return [...xn, ...yn, ...z];
}

export function createEditCurve({ world, editor, views, history, notify, changed, curves }) {
  let ed = null;
  const region = new View3DRegion();
  const activeObject = () => editor.selection.nodes.at(-1);
  const editable = (node) => !!curveData(node) && !node.metadata?.wbLocked;

  // The 3D View's region in the module, from a view: size and matrices.
  function placeRegion(view = views.input) {
    if (!view) return null;
    const rect = view.canvas.getBoundingClientRect();
    region.set({ width: Math.round(rect.width), height: Math.round(rect.height), viewmat: toBlenderView(view.camera.getViewMatrix()),
      winmat: winmat(view.camera, rect.width / rect.height) });
    return rect;
  }

  // Draws the edit data and keeps it as the node's data; an operator's change is an undo step.
  function sync({ commit = true } = {}) {
    const { node, object } = ed;
    // Evaluating lays the text out, which places the cursor and selection the overlay draws.
    mesh_batch_cache_apply(object.evaluate() ?? EMPTY(), node);
    const data = object.data;
    node.metadata = { ...node.metadata, wbCreation: { curve: data } };
    if (ed.text) ed.text.update(data.text);
    else ed.overlay.update(data);
    if (commit) history.commit();
    changed();
    world.onModeChange?.();
  }

  function enter(node = activeObject()) {
    if (ed || !editable(node)) return false;
    editor.finish(false);
    editor.setMode('select');
    const object = curves.object(node);
    // What it follows, evaluated as they are, for the edit object to follow too.
    const followed = Object.entries(object.targets).map(([name, target]) => [name, curves.byName(target)]).filter(([, t]) => t)
      .map(([name, target]) => { const other = curves.object(target); other.evaluate(); object.target(name, other); return other; });
    object.enter();
    const text = object.type === 'FONT';
    ed = { node, object, followed, kind: object.type, overlay: text ? null : createEditCurveOverlay(node), text: text ? createEditTextOverlay(node) : null };
    node.metadata = { ...node.metadata, editing: true };
    curves.editing = { node, data: () => object.data, update(fn) { const data = object.data; fn(data); object.data = data; sync(); } };
    sync({ commit: false });
    editor.reconcile();
    return true;
  }

  function exit() {
    if (!ed) return;
    const { node, object, followed } = ed;
    curves.editing = null;
    object.exit();
    const data = object.data;
    (ed.overlay ?? ed.text).dispose();
    object.free();
    followed.forEach((other) => other.free());
    ed = null;
    node.metadata = { ...node.metadata, editing: false, wbCreation: { curve: data } };
    curves.apply(node);
    editor.reconcile();
    history.commit();
    changed();
    world.onModeChange?.();
  }

  // Runs an operator's exec as one undo step. Its context has no 3D View, as in Blender's background mode: operators
  // run by their exec take what they act on from their properties.
  function exec(idname, props = {}) {
    const { status, report } = ed.object.run(idname, props);
    if (report) notify(report);
    if (status & OPERATOR_FINISHED) sync();
    return status;
  }

  // An operator and then a move of what it made, as Blender's macros run: one undo step, kept when the move is cancelled.
  function operatorMove(idname) {
    if (!(exec(idname) & OPERATOR_FINISHED)) return;
    editor.start('move', { keep: true });
  }

  // view3d.select in Edit Mode: Blender's pick at the mouse.
  function selectPick(event, toggle) {
    const rect = placeRegion(event.view);
    if (!rect) return;
    const hit = ed.object.selectPick(region, [Math.round(event.x - rect.left), Math.round(rect.bottom - event.y)],
      { sel_op: toggle ? SEL_OP_XOR : SEL_OP_SET, deselect_all: !toggle, dist: 75 * (globalThis.devicePixelRatio ?? 1) });
    if (hit) sync();
  }

  // Box, lasso and circle select: the points Blender visits (nurbs_foreachScreenVert) inside a region of the view, in
  // client pixels (view3d-select.js), by eSelectOp.
  function selectRegion(view, shape, mode) {
    const rect = ed?.kind === 'CURVE' && placeRegion(view ?? views.input);
    if (!rect) return;
    const inside = (x, y) => shape.point([rect.left + x, rect.bottom - y]);
    if (ed.object.selectRegion(region, inside, { sel_op: SEL_OPS[mode] ?? SEL_OPS.SET, circle: !!shape.circle })) sync();
  }
  // view3d.select_box: a box gesture, begun at the drag's press or (from B) at the next press.
  const selectBox = (event, { mode = 'SET' }) => startGestureBox(wm(), {
    begin: /mouse$/.test(event.type) ? { x: event.x, y: event.y } : null,
    mode,
    select: (rect, m) => selectRegion(event.view, boxRegion(rect), m),
  });

  // font.selection_set: a click puts the text cursor where Blender's layout has the character under the mouse, and a
  // drag selects up to where it is released.
  function textClick(event) {
    const rect = placeRegion(event.view);
    if (!rect) return;
    const at = (e) => ({ x: e.x - rect.left, y: rect.bottom - e.y });
    if (!(ed.object.invoke(region, 'font.selection_set', { type: 'LEFTMOUSE', value: 'PRESS', ...at(event) }) & 1)) return;
    sync({ commit: false });
    const end = wm().addModal({
      mousemove: (e) => { placeRegion(event.view); ed?.object.modal(region, { type: 'MOUSEMOVE', value: 'NOTHING', ...at(e) }); if (ed) sync({ commit: false }); },
      keymap: (e) => {
        if (e.type !== 'leftmouse' || e.value !== 'RELEASE') return true;
        placeRegion(event.view);
        ed?.object.modal(region, { type: 'LEFTMOUSE', value: 'RELEASE', ...at(e) });
        end();
        if (ed) sync();
        return true;
      },
    });
  }
  const wm = () => world.wm;

  // The selected points' median in world space (Blender's axes), from their transform data's centers.
  function median() {
    const world_m = ed.node.computeWorldMatrix(true), centers = [];
    for (const spline of ed.object.data.splines) {
      for (const p of spline.bezier_points ?? []) {
        if (p.hide) continue;
        if (p.select_control_point) centers.push(p.co, p.co, p.co);
        else {
          if (p.select_left_handle) centers.push(p.handle_left);
          if (p.select_right_handle) centers.push(p.handle_right);
        }
      }
      for (const p of spline.points ?? []) if (p.select && !p.hide) centers.push(p.co);
    }
    if (!centers.length) return null;
    const sum = centers.reduce((s, c) => s.add(Vector3.TransformCoordinates(new Vector3(c[0], c[2], c[1]), world_m)), Vector3.Zero());
    return toBlender(sum.scale(1 / centers.length));
  }

  // A modal transform: each step runs Blender's transform operator, from the edit data as it was, with the step's
  // values (world space): translate by the translation, rotate by the matrix's angle about its axis, scale by its
  // diagonal, about the transform's center.
  function transform(type, view, mouse, { keep } = {}) {
    if (!ed || ed.kind === 'FONT') return null;
    const center = median();
    if (!center) return null;
    ed.object.snapshot();
    const step = (idname, props) => { ed.object.restore(); ed.object.run(idname, props); sync({ commit: false }); };
    const data = {
      center,
      local: worldAxes(ed.node.computeWorldMatrix(true)),
      apply(mat, c, translation, mode) {
        if (mode === 'translate') return step('transform.translate', { value: translation });
        if (mode === 'rotate') {
          const [angle, axis] = axisAngle(mat);
          return step('transform.rotate', { value: angle, orient_axis: 'Z', orient_matrix: axisMatrix(axis), center_override: c });
        }
        return step('transform.resize', { value: [mat[0][0], mat[1][1], mat[2][2]], center_override: c });
      },
      restore() { ed.object.restore(); sync({ commit: false }); },
    };
    const session = initTransform(type, data, view, mouse);
    return Object.assign(Object.create(session), { keep, finish(commit) { if (!commit) session.cancel(); sync({ commit: commit || keep }); } });
  }

  // Typing in Edit Text: a key with a character inserts it, as Blender's TEXTINPUT event does (font.text_insert).
  function typed(event) {
    const key = event.native?.key;
    if (ed?.kind !== 'FONT' || !key || [...key].length !== 1 || event.ctrl || event.alt || event.native?.metaKey) return false;
    exec('font.text_insert', { text: key });
    event.native.preventDefault?.();
    return true;
  }

  const inEdit = (idname) => () => !!ed && ed.object.poll(idname);
  // Blender's curve and font operators the module has, by idname; transforms are the Object Mode operators, which start
  // the modal transform here; primitives are add operators (registerCurveAddOperators).
  // An operator whose invoke is a menu of its enum (WM_menu_invoke: V for handle types) opens it when a key runs it
  // without that property.
  const invoke = (idname) => {
    let menu;
    return (props, event) => {
      menu ??= event ? moduleAccess.operatorMenuProperty(idname) : null;
      if (!menu || props[menu] !== undefined || !event) return exec(idname, props);
      const items = ed.object.enumItems(idname, menu);
      openMenu(items.map(([id, label]) => ({ label, run: () => exec(idname, { ...props, [menu]: id }) })), editor.pointer, rna[idname].name);
    };
  };
  for (const idname of Object.keys(rna).filter((id) => /^(curve|font)\./.test(id) && !id.startsWith('curve.primitive_') && hasOperator(id))) {
    registerOperator(idname, { poll: inEdit(idname), run: invoke(idname), enumItems: (prop) => ed?.object.enumItems(idname, prop) });
  }
  registerOperators(Object.fromEntries(Object.entries(MACROS).map(([macro, idname]) => [macro, { poll: inEdit(idname), run: () => operatorMove(idname) }])));
  // The text clipboard is the browser's: copy and cut write the selection (BKE_vfont_select_get) to it, paste inserts
  // what it holds, as editfont.cc does with the window manager's clipboard.
  const selection = () => {
    const { body, selstart, selend } = ed.object.text;
    if (!selstart) return '';
    const [start, end] = selstart <= selend ? [selstart - 1, selend - 1] : [selend, selstart - 2];
    return [...body].slice(start, end + 1).join('');
  };
  const inText = () => ed?.kind === 'FONT';
  const copy = () => globalThis.navigator?.clipboard?.writeText(selection());
  registerOperators({
    'font.text_copy': { poll: inText, run: copy },
    'font.text_cut': { poll: inText, run: () => { copy(); exec('font.delete', { type: 'PREVIOUS_OR_SELECTION' }); } },
    'font.text_paste': { poll: inText, run: async () => { const text = await globalThis.navigator?.clipboard?.readText(); if (text && ed) exec('font.text_insert', { text }); } },
  });

  registerOperator('font.selection_set', { poll: (props, event) => !!event?.view && inText(), run: (props, event) => textClick(event) });
  const modeKeys = createKeymap([
    { blender: 'object.mode_set', keys: 'Tab', poll: () => !!ed || editable(activeObject()), run: () => (ed ? exit() : enter()) },
  ], ['Object Non-modal']);

  return {
    get active() { return !!ed; },
    get object() { return ed?.node ?? null; },
    // CURVE or FONT while editing.
    get kind() { return ed?.kind ?? null; },
    editable,
    enter,
    exit,
    toggle: () => (ed ? exit() : enter()),
    exec,
    keymap: (event) => modeKeys(event) || (!!ed && typed(event)),
    transform,
    // view3d.select, view3d.select_box and the other region selects, as the tools' and 3D View's keymaps run them.
    selectOperator(event, { toggle, select_passthrough }) {
      if (ed?.kind === 'CURVE') selectPick(event, !!toggle);
      return select_passthrough ? 'PASS_THROUGH' : 'FINISHED';
    },
    selectBox,
    selectRegion,
    // Selected and total control points, as the status bar counts them.
    get stats() {
      if (!ed || ed.kind === 'FONT') return null;
      const points = ed.object.data.splines.flatMap((s) => s.bezier_points ?? s.points);
      const selected = points.filter((p) => p.select ?? p.select_control_point).length;
      return { verts: [selected, points.length] };
    },
    // After undo or redo: the node's restored data becomes the edit data again.
    reload() {
      if (!ed) return;
      if (!curveData(ed.node) || ed.node.metadata?.wbDeleted) { exit(); return; }
      ed.object.data = curveData(ed.node);
      sync({ commit: false });
    },
    dispose() {
      if (ed) exit();
    },
  };
}

// Adding curve and text objects (curvesurf_prim_add, object.text_add): in Object Mode a new object, whose Curve
// Blender's operator fills in Edit Mode as it does for a new object; in Edit Curve mode the primitive joins the edit
// object. A new curve is a 3D curve with a path: curvesurf_prim_add sets both when `type & CU_PRIM_PATH`, which every
// primitive's type passes (CU_PRIM_PATH is 0x700).
const PRIMITIVES = {
  'curve.primitive_bezier_curve_add': 'BézierCurve', 'curve.primitive_bezier_circle_add': 'BézierCircle', 'curve.primitive_nurbs_curve_add': 'NurbsCurve',
  'curve.primitive_nurbs_circle_add': 'NurbsCircle', 'curve.primitive_nurbs_path_add': 'NurbsPath',
};
const NEW_OBJECT = { use_path: true, dimensions: '3D' };

export function registerCurveAddOperators({ editor, history, commands, curves, editCurve }) {
  const create = (type, name, fill) => {
    editor.finish(false);
    const object = new CurveObject(type, name);
    try {
      fill?.(object);
      editor.selection.replace([curves.add(commands.unique(name), object.data)]);
      editor.reconcile();
      history.commit();
    } finally {
      object.free();
    }
  };
  for (const [idname, name] of Object.entries(PRIMITIVES)) {
    registerOperator(idname, {
      poll: () => !editCurve.active || editCurve.kind === 'CURVE',
      run: (props) => {
        if (editCurve.active) return editCurve.exec(idname, props);
        create('CURVE', name, (object) => {
          object.enter();
          object.run(idname, props);
          object.exit();
          object.settings = NEW_OBJECT;
        });
      },
    });
  }
  registerOperator('object.text_add', { poll: () => !editCurve.active, run: () => create('FONT', 'Text') });
}
