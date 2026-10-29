import { createSelection } from "./selection";
import { GizmoManager, Matrix, Vector3 } from "@babylonjs/core";
import { startGestureBox } from "../../windowmanager/wm-gesture-box.js";
import { dragStart } from "../../windowmanager/wm-event-system.js";
import { boxRegion } from "../space_view3d/view3d-select.js";

// Object-mode editing shared by every 3D Viewport: one selection, one tool mode, one gizmo set (drawn in every
// view). Picking and projection use the view the gesture happens in (views.input).
export function createEditor(world, views, history, changed, capture) {
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
  let mode = "select";
  let last = { x: 0, y: 0 };
  // World point to client coordinates in a view.
  const project = (point, view = views.input) => {
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
  const emitState = () => world.onEditorState?.({ mode, count: selection.size });
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
    world.beforeSelection?.();
    selection.toggle(m, add);
    setMode(mode);
    changed();
  };
  const track = (e) => {
    if (!capture.active) last = { x: e.clientX, y: e.clientY };
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
    const target = pickIn(view, event.x, event.y);
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
  const inView = (event) => !!event.view && !event.view.state.cameraView && !world.editMode?.active;
  window.addEventListener("mousemove", track);
  setMode("select");
  return {
    get selected() {
      return selection.size ? selected : null;
    },
    selection,
    select,
    get mode() { return mode; },
    get pointer() { return last; },
    pick: (x, y, view = views.input) => pickIn(view, x, y),
    // view3d.select and view3d.select_box in Object Mode, run with the event: a box begins at a drag's press, or
    // from a key at the next press.
    selectOperator: (event, props) => (inView(event) ? selectOperator(event, props) : "PASS_THROUGH"),
    gizmoState,
    selectBox(event, { mode: op = "SET" }) {
      const view = event.view ?? views.input, dragged = /mouse$/.test(event.type);
      startGestureBox(world.wm, { begin: dragged ? dragStart(event) : null, mode: op, select: (rect, m) => selectRegion(view, boxRegion(rect), op === "SET" || op === "ADD" ? m : op, true) });
    },
    selectRegion: (view, region, op) => selectRegion(view ?? views.input, region, op),
    setMode,
    reconcile() {
      selection.sync();
      setMode(mode);
      changed();
    },
    group() {
      if (selection.group()) {
        history.commit();
        setMode(mode);
        changed();
      }
    },
    ungroup() {
      if (selection.ungroup()) {
        history.commit();
        setMode(mode);
        changed();
      }
    },
    dispose() {
      window.removeEventListener("mousemove", track);
      gizmos.dispose();
      selection.dispose();
    },
  };
}
