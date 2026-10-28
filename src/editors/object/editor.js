import { createSelection } from "./selection";
import { GizmoManager, Matrix, Vector3 } from "@babylonjs/core";
import { wrap } from "../../windowmanager/gesture-math";
import { initTransform } from "../transform/transform.js";
import { createTransObject } from "../transform/transform-object.js";
import { createKeymap } from "../../windowmanager/input/keymap.js";
import { startGestureBox } from "../../windowmanager/wm-gesture-box.js";
import { boxRegion } from "../space_view3d/view3d-select.js";

// Object-mode editing shared by every 3D Viewport: one selection, one tool mode, one gizmo set (drawn in every
// view). Picking, projection and modal transforms use the view the gesture happens in (views.input).
export function createEditor(world, views, history, changed, notify, capture) {
  const { scene, objects } = world;
  const gizmos = new GizmoManager(scene),
    bound = new WeakSet();
  gizmos.usePointerToAttachGizmos = false;
  const selection = createSelection(scene, objects);
  // Draw helpers (loose edge wires) stand for the object that owns them.
  const owner = (m) => m?.metadata?.drawOwner ?? m;
  // One rule for what a click can select: live, unlocked, visible, and selectable through its collections.
  const selectable = (m) =>
    (m = owner(m), objects.includes(m)) && !m.metadata?.wbDeleted && !m.metadata?.wbLocked &&
    m.isEnabled() && m.isVisible && (world.collections?.selectable(m) ?? true);
  const selected = selection.pivot;
  let mode = "select",
    modal = null;
  let last = { x: 0, y: 0 };
  const cursor = document.querySelector("#gesture-cursor");
  const guide = document.querySelector("#gesture-guide");
  // World point to client coordinates in a view.
  const project = (point, view = modal?.view || views.input) => {
    const rect = view.canvas.getBoundingClientRect(), width = view.canvas.width, height = view.canvas.height;
    const p = Vector3.Project(point, Matrix.Identity(), view.camera.getTransformationMatrix(), { x: 0, y: 0, width, height });
    return { x: rect.left + (p.x * rect.width) / width, y: rect.top + (p.y * rect.height) / height };
  };
  // Client coordinates to the topmost selectable object in a view.
  const pickIn = (view, clientX, clientY, predicate = selectable) => {
    const p = views.pickPoint(view, clientX, clientY);
    return scene.pick(p.x, p.y, predicate, false, view.camera);
  };
  const showCursor = () => {
    const rect = modal.view.canvas.getBoundingClientRect();
    // Only the visual cursor wraps; relative coordinates and transforms are unbounded.
    cursor.style.left = wrap(modal.point.x, rect.left, rect.width) + "px";
    cursor.style.top = wrap(modal.point.y, rect.top, rect.height) + "px";
    cursor.hidden = false;
    guide.hidden = false;
    guide.style.left = modal.center.x + "px";
    guide.style.top = modal.center.y + "px";
  };
  const COMPONENT_TYPES = { move: "translate", rotate: "rotate", scale: "resize", edge_slide: "edge_slide" };
  const emitState = () => world.onEditorState?.({mode, count:selection.size, modal:!!modal});
  const setMode = (value) => {
    mode = value;
    // The Transform tool shows all three.
    gizmos.positionGizmoEnabled = value === "move" || value === "transform";
    gizmos.rotationGizmoEnabled = value === "rotate" || value === "transform";
    gizmos.scaleGizmoEnabled = value === "scale" || value === "transform";
    gizmos.attachToNode(selection.size ? selected : null);
    for (const g of Object.values(gizmos.gizmos)) {
      if (!g || bound.has(g)) continue;
      g.updateGizmoRotationToMatchAttachedMesh = false;
      g.onDragStartObservable?.add(() => selection.begin());
      g.onDragObservable?.add(() => selection.update());
      g.onDragEndObservable?.add(() => {
        selection.update();
        if (selected.rotationQuaternion) {
          selected.rotation.copyFrom(
            selected.rotationQuaternion.toEulerAngles(),
          );
          selected.rotationQuaternion = null;
        }
        history.commit();
        selection.sync();
        changed();
      });
      bound.add(g);
    }
    emitState();
  };
  const select = (m, add = false) => {
    if (modal) return;
    world.beforeSelection?.();
    selection.toggle(m, add);
    setMode(mode);
    changed();
  };
  const finish = (commit) => {
    if (!modal) return;
    modal.removeHandler?.();
    modal.session.finish(commit);
    modal = null;
    selection.sync();
    capture.release();
    cursor.hidden = true;
    guide.hidden = true;
    notify("");
    setMode(mode);
    changed();
  };
  const report = () => notify(modal.session.header || modal.session.label);
  const update = (dx, dy, event) => {
    if (!modal) return;
    const fine = event.shiftKey ? 0.1 : 1;
    modal.point.x += dx * fine;
    modal.point.y += dy * fine;
    modal.session.update(dx * fine, dy * fine, event);
    showCursor();
    report();
  };
  // Object Mode: the selection pivot carries every selected object.
  const objectTransform = (type, view) => {
    selected.computeWorldMatrix(true);
    selection.begin();
    const data = createTransObject(selected);
    const moved = (fn) => (...args) => { fn(...args); selection.update(); changed(); };
    const session = initTransform(type, { ...data, apply: moved(data.apply), restore: moved(data.restore) }, view, last);
    return Object.assign(Object.create(session), { finish: (commit) => (commit ? history.commit() : session.cancel()) });
  };
  const start = (type, options = {}) => {
    const external = options.external ?? matchMedia("(pointer:coarse)").matches;
    if (options.point) last = {x:options.point.x,y:options.point.y};
    if (!selection.size) return;
    if (capture.active && !modal) return;
    if (modal) finish(false);
    const view = options.view || views.input;
    if (!view) return;
    view.canvas.focus();
    const target = { camera: view.camera, canvas: view.canvas, project: (p) => project(p, view) };
    const session = world.editMode?.active ? world.editMode.transform(COMPONENT_TYPES[type], target, last, options) : objectTransform(COMPONENT_TYPES[type], target);
    if (!session) return;
    if (!world.editMode?.active) {
      setMode(type);
      gizmos.attachToNode(null);
    }
    modal = { view, type, session, point: { ...session.start }, center: session.center, releaseConfirm: !!options.releaseConfirm };
    modal.removeHandler = world.wm?.addModal({ keymap: modalKeymap });
    if (!external) capture.begin(last, update, () => finish(false), view.canvas);
    showCursor();
    emitState();
    report();
  };
  // TRANSLATE, ROTATE and RESIZE start over in another mode; Edge Slide, a session of its own, starts a new one.
  const switchMode = (type) => {
    if (modal.session.setMode && type !== "edge_slide") {
      modal.type = type;
      modal.session.setMode(COMPONENT_TYPES[type]);
      if (!world.editMode?.active) {
        setMode(type);
        gizmos.attachToNode(null);
      }
      report();
      return;
    }
    modal.session.cancel();
    const { view, session } = modal;
    modal.removeHandler?.();
    capture.release();
    modal = null;
    start(type, { view, point: last, keep: session.keep });
  };
  // A Transform Modal Map item that changes the transform, then the header.
  const act = (fn) => () => { if (!modal) return; fn(modal.session); report(); };
  const track = (e) => {
    if (!modal && !capture.active) last = { x: e.clientX, y: e.clientY };
  };
  // view3d.select in Object Mode (ed_object_select_pick): the object under the mouse, made the only selected and
  // active one, toggled or added to the selection; nothing under it deselects all when asked. With
  // select_passthrough (the Tweak tool's press) an object already selected stays so, and the event goes on to start
  // a drag.
  // Whether the tool's gizmo shows, and is under the event's pointer (wm_gizmomap_highlight_get).
  const gizmoState = (event) => {
    const visible = mode !== "select" && selection.size > 0 && !world.editMode?.active && !!event?.view;
    if (!visible) return { visible };
    const p = views.pickPoint(event.view, event.x, event.y);
    return { visible, highlight: !!gizmos.utilityLayer.utilityLayerScene.pick(p.x, p.y, undefined, false, event.view.camera)?.hit };
  };
  const selectOperator = (event, { toggle, extend, deselect, deselect_all, select_passthrough }) => {
    const view = event.view;
    view.canvas.focus();
    // Let the utility-layer gizmo keep its own clicks.
    if (gizmoState(event).highlight) return "PASS_THROUGH";
    const pick = pickIn(view, event.x, event.y);
    let target = pick?.hit ? owner(pick.pickedMesh) : null;
    while (target?.parent?.metadata?.group && !target.parent.metadata.wbDeleted) target = target.parent;
    const passed = select_passthrough ? "PASS_THROUGH" : "FINISHED";
    if (!target) {
      if (deselect_all && selection.size) select(null);
      return passed;
    }
    if (select_passthrough && selection.has(target)) return "PASS_THROUGH";
    const others = selection.nodes.filter((n) => n !== target);
    const active = selection.nodes.at(-1) === target;
    if (toggle) selectList(active ? others : [...others, target]);
    else if (extend) selectList([...others, target]);
    else if (deselect) selectList(others);
    else selectList([target]);
    return passed;
  };
  const selectList = (list) => {
    if (modal) return;
    world.beforeSelection?.();
    selection.replace(list);
    setMode(mode);
    changed();
  };
  // view3d.select_box in Object Mode (do_object_box_select): objects drawn inside the box, by eSelectOp. An object
  // counts when one of its vertices (or its origin, without any) projects inside; Blender reads its select buffer.
  const OPS = {
    SET: (was, inside) => inside, ADD: (was, inside) => was || inside, SUB: (was, inside) => was && !inside,
    XOR: (was, inside) => was !== inside, AND: (was, inside) => was && inside,
  };
  // Box select counts an object when one of its vertices (or its origin, without any) projects inside; lasso and
  // circle select test its origin, as do_lasso_select_objects and object_circle_select do.
  const selectRegion = (view, region, op, vertices = false) => {
    const inside = (p) => region.point([p.x, p.y]);
    const drawnInside = (node) => {
      const positions = vertices && node.getVerticesData?.("position"), m = node.computeWorldMatrix(true);
      if (!positions?.length) return inside(project(node.getAbsolutePosition(), view));
      for (let i = 0; i < positions.length; i += 3) {
        if (inside(project(Vector3.TransformCoordinates(Vector3.FromArray(positions, i), m), view))) return true;
      }
      return false;
    };
    const candidates = objects.filter((n) => selectable(n) && n.isEnabled());
    selectList(candidates.filter((n) => OPS[op](selection.has(n), drawnInside(n))));
  };
  const contextMenu = (event) => {
    const pick = pickIn(event.view, event.x, event.y);
    let target = owner(pick?.pickedMesh);
    while (target?.parent?.metadata?.group) target = target.parent;
    world.contextMenu?.open(event.native, target);
  };
  const inView = (event) => !!event.view && !event.view.state.cameraView && !world.editMode?.active;
  const contextKeymap = createKeymap([
    { blender: "VIEW3D_MT_object_context_menu", keys: "RIGHTMOUSE", poll: inView, run: contextMenu },
  ], ["Object Mode"]);
  // The Transform Modal Map. Edit Mode's G during Move starts Edge Slide.
  const transformModalKeymap = createKeymap([
    // release_confirm: a transform a drag started (a tool's) ends where the button is let go.
    { blender: "CONFIRM", keys: "Any LEFTMOUSE RELEASE", poll: () => !!modal?.releaseConfirm, run: () => finish(true) },
    { blender: "CONFIRM", keys: ["Any LEFTMOUSE", "Any RET", "Any NUMPAD_ENTER", "Any SPACE"], run: () => finish(true) },
    { blender: "CANCEL", keys: ["Any RIGHTMOUSE", "Any ESC"], run: () => finish(false) },
    ...["X", "Y", "Z"].flatMap((a) => [
      { blender: "AXIS_" + a, keys: a, poll: () => !!modal?.session.constrain, run: act((s) => s.constrain("AXIS_" + a)) },
      { blender: "PLANE_" + a, keys: "Shift " + a, poll: () => !!modal?.session.constrain, run: act((s) => s.constrain("PLANE_" + a)) },
    ]),
    { blender: "CONS_OFF", keys: "C", poll: () => !!modal?.session.constrained, run: act((s) => s.unconstrain()) },
    { blender: "TRANSLATE", keys: "G", poll: () => modal?.type !== "move", run: () => switchMode("move") },
    { blender: "VERT_EDGE_SLIDE", keys: "G", poll: () => !!world.editMode?.active && modal?.type === "move", run: () => switchMode("edge_slide") },
    { blender: "ROTATE", keys: "R", poll: () => modal?.type !== "rotate", run: () => switchMode("rotate") },
    { blender: "RESIZE", keys: "S", poll: () => modal?.type !== "scale", run: () => switchMode("scale") },
    { blender: "SNAP_INV_ON", keys: ["Any LEFT_CTRL", "Any RIGHT_CTRL"], poll: () => !!modal?.session.setSnap, run: act((s) => s.setSnap(true)) },
    { blender: "SNAP_INV_OFF", keys: ["Any LEFT_CTRL RELEASE", "Any RIGHT_CTRL RELEASE"], poll: () => !!modal?.session.setSnap, run: act((s) => s.setSnap(false)) },
  ], ["Transform Modal Map"]);
  // transformEvent's order: typed values while they are being typed, the modal map, the tool's own keys, then any
  // key that starts typing a value.
  const modalKeymap = (event) => {
    const session = modal?.session;
    if (!session) return false;
    if (session.numinput?.(event, true) || transformModalKeymap(event) || session.keymap?.(event) || session.numinput?.(event)) {
      event.native?.preventDefault();
      if (modal) report();
      return true;
    }
    return false;
  };
  // X, Y or Z from the touch toolbar.
  const axis = (a) => modal?.session.constrain && (modal.session.constrain("AXIS_" + a.toUpperCase()), report());
  window.addEventListener("mousemove", track);
  setMode("select");
  return {
    get selected() {
      return selection.size ? selected : null;
    },
    selection,
    get modal() {
      return modal;
    },
    select,
    get mode() { return mode; },
    get pointer() { return last; },
    updateGesture: update,
    pick(x,y,view=views.input) {
      const hit=pickIn(view,x,y);
      let node=owner(hit?.pickedMesh);while(node?.parent?.metadata?.group&&!node.parent.metadata.wbDeleted)node=node.parent;return node;
    },
    // Object Mode's context menu (Object Mode keymap).
    keymap: (event) => contextKeymap(event),
    // view3d.select and view3d.select_box in Object Mode, run with the event: a box begins at a drag's press, or
    // from a key at the next press.
    selectOperator: (event, props) => (inView(event) ? selectOperator(event, props) : "PASS_THROUGH"),
    gizmoState,
    selectBox(event, { mode: op = "SET" }) {
      const view = event.view ?? views.input, dragged = /mouse$/.test(event.type);
      startGestureBox(world.wm, { begin: dragged ? { x: event.x, y: event.y } : null, mode: op, select: (rect, m) => selectRegion(view, boxRegion(rect), op === "SET" || op === "ADD" ? m : op, true) });
    },
    selectRegion: (view, region, op) => selectRegion(view ?? views.input, region, op),
    // A view going away ends a transform running in it.
    attach(view) {
      return () => { if (modal?.view === view) finish(false); };
    },
    setMode,
    start,
    finish,
    reconcile() {
      selection.sync();
      setMode(mode);
      changed();
    },
    group() {
      if (modal) return;
      if (selection.group()) {
        history.commit();
        setMode(mode);
        changed();
      }
    },
    ungroup() {
      if (modal) return;
      if (selection.ungroup()) {
        history.commit();
        setMode(mode);
        changed();
      }
    },
    axis,
    dispose() {
      finish(false);
      window.removeEventListener("mousemove", track);
      gizmos.dispose();
      selection.dispose();
    },
  };
}
