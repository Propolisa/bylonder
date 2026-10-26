import { createSelection } from "./selection";
import { GizmoManager, Matrix, Quaternion, Vector3 } from "@babylonjs/core";
import { snapshot, apply } from "../undo/storage";
import { radialRatio, angleDelta, snap, wrap } from "../../windowmanager/gesture-math";
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
    if (modal.session) modal.session.finish(commit);
    else if (!commit) apply(objects, modal.before);
    else history.commit();
    modal = null;
    selection.sync();
    capture.release();
    cursor.hidden = true;
    guide.hidden = true;
    setMode(mode);
    changed();
  };
  const rebase = () => {
    modal.base = snapshot(objects);
    modal.pivotBase = {
      p: selected.position.clone(),
      r: selected.rotation.clone(),
      s: selected.scaling.clone(),
    };
    selection.begin();
    modal.start = { ...modal.point };
    modal.total = { x: 0, y: 0 };
    modal.angle = 0;
    modal.center = project(selected.getAbsolutePosition());
  };
  const update = (dx, dy, event) => {
    if (!modal) return;
    const fine = event.shiftKey ? 0.1 : 1,
      previous = { ...modal.point };
    modal.point.x += dx * fine;
    modal.point.y += dy * fine;
    if (modal.session) {
      modal.session.update(dx * fine, dy * fine, event);
      showCursor();
      return;
    }
    if (event.altKey) {
      // Clutch: move the virtual cursor without changing the object. Start a new
      // sweep on release, preserving the original snapshot for one-step cancel.
      const r = modal.view.canvas.getBoundingClientRect();
      modal.point.x = wrap(modal.point.x, r.left, r.width);
      modal.point.y = wrap(modal.point.y, r.top, r.height);
      rebase();
      showCursor();
      return;
    }
    modal.total.x += dx * fine;
    modal.total.y += dy * fine;
    modal.angle += angleDelta(previous, modal.point, modal.center);
    apply(objects, modal.base);
    selected.position.copyFrom(modal.pivotBase.p);
    selected.rotation.copyFrom(modal.pivotBase.r);
    selected.scaling.copyFrom(modal.pivotBase.s);
    selected.rotationQuaternion = null;
    const axis = modal.axis;
    if (modal.type === "move") {
      const scale =
        (2 * modal.depth * Math.tan(modal.view.camera.fov / 2)) / modal.view.canvas.clientHeight;
      if (axis) {
        const direction =
          Vector3[axis === "x" ? "Right" : axis === "y" ? "Up" : "Forward"]();
        const end = project(selected.position.add(direction));
        const vx = end.x - modal.center.x,
          vy = end.y - modal.center.y,
          len = vx * vx + vy * vy;
        let amount =
          len > 4
            ? (modal.total.x * vx + modal.total.y * vy) / len
            : modal.total.x * scale;
        if (event.ctrlKey) amount = snap(amount, 0.1);
        selected.position[axis] += amount;
      } else {
        const offset = modal.right
          .scale(modal.total.x * scale)
          .add(modal.up.scale(-modal.total.y * scale));
        if (event.ctrlKey) {
          offset.x = snap(offset.x, 0.1);
          offset.y = snap(offset.y, 0.1);
          offset.z = snap(offset.z, 0.1);
        }
        selected.position.addInPlace(offset);
      }
    } else if (modal.type === "scale") {
      let factor = radialRatio(modal.start, modal.point, modal.center);
      if (event.ctrlKey) factor = snap(factor, 0.1);
      for (const a of axis ? [axis] : ["x", "y", "z"])
        selected.scaling[a] = Math.max(0.001, selected.scaling[a] * factor);
    } else {
      let angle = modal.angle;
      if (event.ctrlKey) angle = snap(angle, Math.PI / 12);
      // Screen coordinates have Y down: negative rotation about camera forward
      // follows the visible pointer. Premultiply for a world-space axis.
      let rotationAxis = modal.forward,
        sign = -1;
      if (axis) {
        rotationAxis =
          Vector3[axis === "x" ? "Right" : axis === "y" ? "Up" : "Forward"]();
        sign = Vector3.Dot(rotationAxis, modal.forward) > 0 ? -1 : 1;
      }
      const initial = Quaternion.FromEulerVector(selected.rotation);
      const result = Quaternion.RotationAxis(
        rotationAxis,
        angle * sign,
      ).multiply(initial);
      selected.rotation.copyFrom(result.toEulerAngles());
    }
    selection.update();
    showCursor();
    changed();
  };
  const start = (type, options = {}) => {
    const external = options.external ?? matchMedia("(pointer:coarse)").matches;
    if (options.point) last = {x:options.point.x,y:options.point.y};
    if (!selection.size) return;
    if (capture.active && !modal) return;
    if (modal) finish(false);
    const view = options.view || views.input;
    if (!view) return;
    const camera = view.camera;
    view.canvas.focus();
    if (world.editMode?.active) return startComponents(type, view, external, options);
    selected.computeWorldMatrix(true);
    setMode(type);
    const center = project(selected.getAbsolutePosition(), view);
    // Avoid singular radial gestures when invoked exactly at the pivot.
    const point =
      Math.hypot(last.x - center.x, last.y - center.y) < 12 && type !== "move"
        ? { x: center.x + 60, y: center.y }
        : { ...last };
    modal = {
      view,
      type,
      before: snapshot(objects),
      base: snapshot(objects),
      start: { ...point },
      point,
      center,
      axis: null,
      total: { x: 0, y: 0 },
      angle: 0,
      depth:
        camera.mode === 1 && camera.radius
          ? camera.radius
          : Math.max(
              0.1,
              Vector3.Dot(
                selected.position.subtract(camera.position),
                camera.getDirection(Vector3.Forward()),
              ),
            ),
      right: camera.getDirection(Vector3.Right()),
      up: camera.getDirection(Vector3.Up()),
      forward: camera.getDirection(Vector3.Forward()),
    };
    modal.pivotBase = {
      p: selected.position.clone(),
      r: selected.rotation.clone(),
      s: selected.scaling.clone(),
    };
    selection.begin();
    gizmos.attachToNode(null);
    modal.removeHandler = world.wm?.addModal({ keymap: transformModalKeymap });
    if (!external) capture.begin(last, update, () => finish(false), view.canvas);
    showCursor();
    emitState();
    notify(
      type + " · X/Y/Z axis · Alt reposition · Enter confirm · Esc cancel",
    );
  };
  // Edit Mode: G, R and S transform the selected components.
  const startComponents = (type, view, external, options) => {
    const session = world.editMode.transform(COMPONENT_TYPES[type], { camera: view.camera, canvas: view.canvas, project: (p) => project(p, view) }, last, options);
    if (!session) return;
    modal = { view, type, session, point: { ...session.start }, center: session.center };
    modal.removeHandler = world.wm?.addModal({ keymap: (event) => transformModalKeymap(event) || !!session.keymap?.(event) });
    if (!external) capture.begin(last, update, () => finish(false), view.canvas);
    showCursor();
    emitState();
    notify(session.label + " · X/Y/Z axis · Shift X/Y/Z plane · Enter confirm · Esc cancel");
  };
  // X, Y or Z constrains to that axis (again: none); with a plane, to the plane across it.
  function axis(a, plane = false) {
    if (modal?.session) {
      modal.session.constrain(a, plane);
      notify(modal.session.label + " · " + (modal.session.axis ? (plane ? "Shift " : "") + modal.session.axis.toUpperCase() : "screen"));
    } else if (modal) {
      modal.axis = modal.axis === a ? null : a;
      rebase();
      notify(modal.type + " · " + (modal.axis?.toUpperCase() || "screen") + " axis");
    }
  }
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
    const pick = pickIn(view, event.x, event.y);
    let target = pick?.hit ? owner(pick.pickedMesh) : null;
    while (target?.parent?.metadata?.group && !target.parent.metadata.wbDeleted) target = target.parent;
    select(target, toggle);
  };
  const contextMenu = (event) => {
    const pick = pickIn(event.view, event.x, event.y);
    let target = owner(pick?.pickedMesh);
    while (target?.parent?.metadata?.group) target = target.parent;
    world.contextMenu?.open(event.native, target);
  };
  const inView = (event) => !!event.view && !event.view.state.cameraView && !world.editMode?.active;
  const selectKeymap = createKeymap([
    { blender: "view3d.select", keys: "LEFTMOUSE CLICK", poll: inView, run: (event) => selectPick(event, false) },
    { blender: "view3d.select", keys: "Shift LEFTMOUSE CLICK", poll: inView, run: (event) => selectPick(event, true) },
  ], ["3D View"]);
  const contextKeymap = createKeymap([
    { blender: "VIEW3D_MT_object_context_menu", keys: "RIGHTMOUSE", poll: inView, run: contextMenu },
  ], ["Object Mode"]);
  // The Transform Modal Map: confirm, cancel, axis and plane constraints, and G again for vertex or edge slide.
  const transformModalKeymap = createKeymap([
    { blender: "CONFIRM", keys: ["Any LEFTMOUSE", "Any RET", "Any NUMPAD_ENTER", "Any SPACE"], run: () => finish(true) },
    { blender: "CANCEL", keys: ["Any RIGHTMOUSE", "Any ESC"], run: () => finish(false) },
    ...["X", "Y", "Z"].flatMap((a) => [
      { blender: "AXIS_" + a, keys: a, run: () => axis(a.toLowerCase(), false) },
      { blender: "PLANE_" + a, keys: "Shift " + a, run: () => axis(a.toLowerCase(), true) },
    ]),
    { blender: "VERT_EDGE_SLIDE", keys: "G", poll: () => !!world.editMode?.active && modal?.type === "move", run: () => start("edge_slide") },
  ], ["Transform Modal Map"]);
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
