// Moving, rotating and scaling the Edit Mode selection (transform_convert_mesh.cc, transform_mode_translate.cc,
// transform_mode_rotate.cc, transform_mode_resize.cc) about its median point. Constraint axes are Blender's
// global X, Y and Z (Z up); Shift with an axis constrains to the plane across it.
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core';
import { BM_ITER_MESH, BM_ELEM_SELECT, BM_ELEM_HIDDEN, BM_elem_flag_test } from '../../bmesh/intern/bmesh-class.js';
import { radialRatio, angleDelta, snap } from '../../windowmanager/gesture-math.js';

const AXES = { x: new Vector3(1, 0, 0), y: new Vector3(0, 0, 1), z: new Vector3(0, 1, 0) };
// Increment snapping with Ctrl: Blender's 5 degree rotation step; distance and scale steps as in Object Mode.
const SNAP = { translate: 0.1, rotate: (5 * Math.PI) / 180, resize: 0.1 };
const TRANSFORM_LABELS = { translate: 'Move', rotate: 'Rotate', resize: 'Scale' };

// `view` gives the camera and screen projection: { camera, canvas, project(world) -> {x, y} client pixels }.
export function beginMeshTransform(bm, object, view, type, mouse) {
  const world = object.computeWorldMatrix(true), inverse = Matrix.Invert(world);
  const verts = [];
  BM_ITER_MESH(bm.v, (v) => { if (BM_elem_flag_test(bm.v, v, BM_ELEM_SELECT) && !BM_elem_flag_test(bm.v, v, BM_ELEM_HIDDEN)) verts.push(v); });
  if (!verts.length) return null;
  const co = (v) => bm.v.co.subarray(v * 3, v * 3 + 3);
  const original = verts.map((v) => Vector3.TransformCoordinates(new Vector3(co(v)[0], co(v)[2], co(v)[1]), world));
  const center = original.reduce((sum, p) => sum.addInPlace(p), Vector3.Zero()).scaleInPlace(1 / original.length);
  const camera = view.camera, forward = camera.getDirection(Vector3.Forward());
  const centerScreen = view.project(center);
  const depth = camera.mode === 1 ? (camera.orthoTop - camera.orthoBottom) / 2 : Math.max(0.1, Vector3.Dot(center.subtract(camera.globalPosition), forward));
  const pixelSize = (2 * depth * (camera.mode === 1 ? 1 : Math.tan(camera.fov / 2))) / view.canvas.clientHeight;
  // Starting away from the median point keeps rotate and scale well defined.
  const start = Math.hypot(mouse.x - centerScreen.x, mouse.y - centerScreen.y) < 12 && type !== 'translate' ? { x: centerScreen.x + 60, y: centerScreen.y } : { ...mouse };
  const state = { point: { ...start }, total: { x: 0, y: 0 }, angle: 0, axis: null, plane: false, ctrl: false };

  function apply(transformPoint) {
    verts.forEach((v, i) => {
      const local = Vector3.TransformCoordinates(transformPoint(original[i]), inverse);
      bm.v.co[v * 3] = local.x;
      bm.v.co[v * 3 + 1] = local.z;
      bm.v.co[v * 3 + 2] = local.y;
    });
  }

  function translation(ctrl) {
    const axis = state.axis && AXES[state.axis];
    let offset;
    if (axis && !state.plane) {
      const end = view.project(center.add(axis)), vx = end.x - centerScreen.x, vy = end.y - centerScreen.y, len = vx * vx + vy * vy;
      offset = axis.scale(len > 4 ? (state.total.x * vx + state.total.y * vy) / len : state.total.x * pixelSize);
    } else {
      offset = camera.getDirection(Vector3.Right()).scale(state.total.x * pixelSize).add(camera.getDirection(Vector3.Up()).scale(-state.total.y * pixelSize));
      if (axis) offset.subtractInPlace(axis.scale(Vector3.Dot(offset, axis)));
    }
    if (ctrl) offset.set(snap(offset.x, SNAP.translate), snap(offset.y, SNAP.translate), snap(offset.z, SNAP.translate));
    return offset;
  }

  function refresh() {
    if (type === 'translate') {
      const offset = translation(state.ctrl);
      apply((p) => p.add(offset));
    } else if (type === 'rotate') {
      const axis = state.axis && !state.plane ? AXES[state.axis] : forward;
      const sign = state.axis && !state.plane && Vector3.Dot(axis, forward) <= 0 ? 1 : -1;
      const angle = state.ctrl ? snap(state.angle, SNAP.rotate) : state.angle;
      const rotation = Quaternion.RotationAxis(axis, angle * sign);
      apply((p) => p.subtract(center).rotateByQuaternionToRef(rotation, new Vector3()).addInPlace(center));
    } else {
      let factor = radialRatio(start, state.point, centerScreen);
      if (state.ctrl) factor = snap(factor, SNAP.resize);
      const axis = state.axis && AXES[state.axis];
      apply((p) => {
        const d = p.subtract(center);
        if (!axis) return center.add(d.scale(factor));
        const along = axis.scale(Vector3.Dot(d, axis));
        return state.plane ? center.add(along).add(d.subtract(along).scale(factor)) : center.add(d.subtract(along)).add(along.scale(factor));
      });
    }
  }

  return {
    label: TRANSFORM_LABELS[type],
    start,
    center: centerScreen,
    get axis() { return state.axis; },
    // Mouse motion in pixels.
    update(dx, dy, event) {
      const previous = { ...state.point };
      state.point.x += dx;
      state.point.y += dy;
      state.total.x += dx;
      state.total.y += dy;
      state.angle += angleDelta(previous, state.point, centerScreen);
      state.ctrl = event.ctrlKey;
      refresh();
    },
    // X, Y or Z constrains to that axis, again to none; with Shift to the plane across it.
    constrain(axis, plane) {
      const same = state.axis === axis && state.plane === plane;
      state.axis = same ? null : axis;
      state.plane = !same && plane;
      refresh();
    },
    cancel() { apply((p) => p); },
  };
}
