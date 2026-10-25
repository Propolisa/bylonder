import { createSelection } from "./selection";
import { GizmoManager, Matrix, Quaternion, Vector3 } from "@babylonjs/core";
import { snapshot, apply } from "./storage";
import { radialRatio, angleDelta, snap, wrap } from "./gesture-math";

export function createEditor(world, canvas, history, changed, notify, capture) {
  const { scene, objects, camera, engine } = world;
  const gizmos = new GizmoManager(scene),
    bound = new WeakSet();
  gizmos.usePointerToAttachGizmos = false;
  const selection = createSelection(scene, objects);
  const selected = selection.pivot;
  let mode = "select",
    modal = null;
  let suppressContext = false;
  let last = { x: canvas.clientWidth / 2, y: canvas.clientHeight / 2 };
  const cursor = document.querySelector("#gesture-cursor");
  const guide = document.querySelector("#gesture-guide");
  const project = (point) => {
    const rect = canvas.getBoundingClientRect();
    const p = Vector3.Project(
      point,
      Matrix.Identity(),
      scene.getTransformMatrix(),
      camera.viewport.toGlobal(
        engine.getRenderWidth(),
        engine.getRenderHeight(),
      ),
    );
    return {
      x: rect.left + (p.x * rect.width) / engine.getRenderWidth(),
      y: rect.top + (p.y * rect.height) / engine.getRenderHeight(),
    };
  };
  const showCursor = () => {
    const rect = canvas.getBoundingClientRect();
    // Only the visual cursor wraps; relative coordinates and transforms are unbounded.
    cursor.style.left = wrap(modal.point.x, rect.left, rect.width) + "px";
    cursor.style.top = wrap(modal.point.y, rect.top, rect.height) + "px";
    cursor.hidden = false;
    guide.hidden = false;
    guide.style.left = modal.center.x + "px";
    guide.style.top = modal.center.y + "px";
  };
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
    if (!commit) apply(objects, modal.before);
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
    if (event.altKey) {
      // Clutch: move the virtual cursor without changing the object. Start a new
      // sweep on release, preserving the original snapshot for one-step cancel.
      const r = canvas.getBoundingClientRect();
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
        (2 * modal.depth * Math.tan(camera.fov / 2)) / canvas.clientHeight;
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
    canvas.focus();
    selected.computeWorldMatrix(true);
    setMode(type);
    const center = project(selected.getAbsolutePosition());
    // Avoid singular radial gestures when invoked exactly at the pivot.
    const point =
      Math.hypot(last.x - center.x, last.y - center.y) < 12 && type !== "move"
        ? { x: center.x + 60, y: center.y }
        : { ...last };
    modal = {
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
        camera.mode === 1
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
    if (!external) capture.begin(last, update, () => finish(false));
    showCursor();
    emitState();
    notify(
      type + " · X/Y/Z axis · Alt reposition · Enter confirm · Esc cancel",
    );
  };
  const track = (e) => {
    if (!modal && !capture.active) last = { x: e.clientX, y: e.clientY };
  };
  const down = (e) => {
    if (e.pointerType === "touch" || document.body.classList.contains("scene-mode")) return;
    canvas.focus();
    if (modal) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.button === 2) suppressContext = true;
      if (e.button === 0 || e.button === 2) finish(e.button === 0);
      return;
    }
    if (e.button === 0) {
      const rect = canvas.getBoundingClientRect();
      // Let the utility-layer gizmo consume its own click before scene selection.
      if (mode !== "select" && selection.size) {
        const hit = gizmos.utilityLayer.utilityLayerScene.pick(
          e.clientX - rect.left,
          e.clientY - rect.top,
        );
        if (hit?.hit) return;
      }
      const pick = scene.pick(
        e.clientX - rect.left,
        e.clientY - rect.top,
        (m) =>
          objects.includes(m) &&
          !m.metadata?.wbDeleted &&
          !m.metadata?.wbLocked,
      );
      if (pick?.hit) {
        let target = pick.pickedMesh;
        while (
          target.parent?.metadata?.group &&
          !target.parent.metadata.wbDeleted
        )
          target = target.parent;
        select(target, e.shiftKey);
      } else select(null, e.shiftKey);
    }
  };
  const context = (e) => {
    e.preventDefault();
    if (suppressContext) {
      suppressContext = false;
      return;
    }
    if (document.body.classList.contains("scene-mode")) return;
    const rect = canvas.getBoundingClientRect();
    const pick = scene.pick(
      e.clientX - rect.left,
      e.clientY - rect.top,
      (m) =>
        objects.includes(m) && !m.metadata?.wbDeleted && !m.metadata?.wbLocked,
    );
    let target = pick?.pickedMesh;
    while (target?.parent?.metadata?.group) target = target.parent;
    world.contextMenu?.open(e, target);
  };
  canvas.addEventListener("contextmenu", context);
  canvas.addEventListener("pointerdown", down, true);
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
    updateGesture: update,
    pick(x,y) {
      const rect=canvas.getBoundingClientRect();
      const hit=scene.pick(x-rect.left,y-rect.top,m=>objects.includes(m)&&!m.metadata?.wbDeleted&&!m.metadata?.wbLocked);
      let node=hit?.pickedMesh;while(node?.parent?.metadata?.group&&!node.parent.metadata.wbDeleted)node=node.parent;return node;
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
    axis(a) {
      if (modal) {
        modal.axis = modal.axis === a ? null : a;
        rebase();
        notify(
          modal.type +
            " · " +
            (modal.axis?.toUpperCase() || "screen") +
            " axis",
        );
      }
    },
    dispose() {
      finish(false);
      window.removeEventListener("mousemove", track);
      canvas.removeEventListener("pointerdown", down, true);
      canvas.removeEventListener("contextmenu", context);
      gizmos.dispose();
      selection.dispose();
    },
  };
}
