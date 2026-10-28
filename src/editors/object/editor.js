import { createSelection } from "./selection";
import { GizmoManager, Matrix, Vector3 } from "@babylonjs/core";
import { wrap } from "../../windowmanager/gesture-math";
import { initTransform } from "../transform/transform.js";
import { createTransObject } from "../transform/transform-object.js";
import { createKeymap } from "../../windowmanager/input/keymap.js";

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
    m.isEnabled() && m.isVisible !== false && (world.collections?.selectable(m) ?? true);
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
  // Client coordinates to the selectable object under them in a view: an overlay extra (an empty) within reach, else
  // the topmost mesh. Objects in a group pick as the group.
  const pickIn = (view, clientX, clientY) => {
    const p = views.pickPoint(view, clientX, clientY);
    let node = world.pickExtra?.(p.x, p.y, view.camera, selectable);
    if (!node) { const hit = scene.pick(p.x, p.y, selectable, false, view.camera); node = hit?.hit ? owner(hit.pickedMesh) : null; }
    while (node?.parent?.metadata?.group && !node.parent.metadata.wbDeleted) node = node.parent;
    return node;
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
    gizmos.positionGizmoEnabled = value === "move";
    gizmos.rotationGizmoEnabled = value === "rotate";
    gizmos.scaleGizmoEnabled = value === "scale";
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
    document.querySelectorAll("[data-tool]").forEach((b) => {
      b.classList.toggle("active", b.dataset.tool === value);
      b.setAttribute("aria-pressed", String(b.dataset.tool === value));
    });
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
    modal = { view, type, session, point: { ...session.start }, center: session.center };
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
  // view3d.select in Object Mode: the object under the mouse, or nothing.
  const selectPick = (event, toggle) => {
    const view = event.view;
    view.canvas.focus();
    // Let the utility-layer gizmo keep its own clicks.
    if (mode !== "select" && selection.size) {
      const p = views.pickPoint(view, event.x, event.y);
      if (gizmos.utilityLayer.utilityLayerScene.pick(p.x, p.y, undefined, false, view.camera)?.hit) return;
    }
    select(pickIn(view, event.x, event.y), toggle);
  };
  const contextMenu = (event) => {
    world.contextMenu?.open(event.native, pickIn(event.view, event.x, event.y));
  };
  const inView = (event) => !!event.view && !event.view.state.cameraView && !world.editMode?.active;
  const selectKeymap = createKeymap([
    { blender: "view3d.select", keys: "LEFTMOUSE CLICK", poll: inView, run: (event) => selectPick(event, false) },
    { blender: "view3d.select", keys: "Shift LEFTMOUSE CLICK", poll: inView, run: (event) => selectPick(event, true) },
  ], ["3D View"]);
  const contextKeymap = createKeymap([
    { blender: "VIEW3D_MT_object_context_menu", keys: "RIGHTMOUSE", poll: inView, run: contextMenu },
  ], ["Object Mode"]);
  // The Transform Modal Map. Edit Mode's G during Move starts Edge Slide.
  const transformModalKeymap = createKeymap([
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
    pick: (x, y, view = views.input) => pickIn(view, x, y),
    // Object Mode keymaps: click select (3D View) and the context menu (Object Mode).
    keymap: (event) => selectKeymap(event) || contextKeymap(event),
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
