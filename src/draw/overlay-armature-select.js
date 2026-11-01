// Bone selection on the CPU, in place of Blender's GPU selection buffer (port-override: the module has no GPU): the
// overlay synced for selection (armature-draw.cc armature_draw with DRAW.SELECTING) gives each drawn part its select
// id (the bone's index << 16 | BONESEL_*), and its shape as the overlay draws it (overlay-shape.js BONE_SHAPES) is
// projected into the view. A part is hit when it is drawn within a radius of the pointer, as Blender's selection
// rectangle catches its pixels; the nearest of the hits is the part's depth.
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { Viewport } from '@babylonjs/core/Maths/math.viewport.js';
import { BONE_SHAPES, SHAPES } from './overlay-shape.js';
import { armatureDraw, armatureShapeMesh, armatureData, DRAW } from '../blenkernel/armature/armature.js';
import { dnaGet } from '../makesrna/dna-struct.js';

// ED_armature.hh BONESEL_*.
const BONESEL = { ROOT: 1 << 29, TIP: 1 << 30, BONE: 2 ** 31 };
const PARTS = [[BONESEL.ROOT, 'head'], [BONESEL.TIP, 'tail'], [BONESEL.BONE, 'body']];
const STICK_SIZE = 5;

// A view's projection of Blender world points: client-free pixels (as scene.pick takes them) and depth (0 to 1).
function projector(camera) {
  const engine = camera.getEngine(), transform = camera.getViewMatrix().multiply(camera.getProjectionMatrix());
  const region = new Viewport(0, 0, engine.getRenderWidth() * camera.viewport.width, engine.getRenderHeight() * camera.viewport.height);
  const right = camera.getDirection(Vector3.Right());
  const project = ([x, y, z]) => { const p = Vector3.Project(new Vector3(x, z, y), Matrix.IdentityReadOnly, transform, region); return [p.x, p.y, p.z]; };
  // A world radius at a point, in pixels.
  const pixels = (co, radius) => { const [x, y] = project(co), [rx, ry] = project([co[0] + right.x * radius, co[1] + right.z * radius, co[2] + right.y * radius]); return Math.hypot(rx - x, ry - y); };
  return { project, pixels };
}

const transform = (m, [x, y, z]) => [0, 1, 2].map((i) => m[i] * x + m[4 + i] * y + m[8 + i] * z + m[12 + i]);
// An instance's matrix without the colors packed in its fourth row (overlay_common_lib.glsl extract_matrix_packed_data).
const unpacked = (data, at) => { const m = Array.from(data.subarray(at, at + 16)); m[3] = m[7] = m[11] = 0; m[15] = 1; return m; };
const triangles = (positions) => Array.from({ length: positions.length / 9 }, (_, t) => [0, 1, 2].map((v) => positions.slice((t * 3 + v) * 3, (t * 3 + v) * 3 + 3)));
const SOLIDS = { octahedral_fill: triangles(BONE_SHAPES.bone_octahedron().positions), bbones_fill: triangles(BONE_SHAPES.bone_box().positions) };

// Each part the overlay draws for selection, projected into a camera's view: { id, bone (its index), part ('head',
// 'tail' or 'body'), triangles, segments ([a, b, half width]), circles ([center, radius]) in view pixels, depth },
// for clicks and for box, circle and lasso selection. C: Main's context; ob: the armature's Object in Main. Outside
// Edit and Pose Mode the bones select their object: every part drawn is the object's, its id 0.
export function armatureParts(C, ob, camera, { bones = true } = {}) {
  const { buffers, customs } = armatureDraw(C, ob, bones ? DRAW.SELECTING : 0), { project, pixels } = projector(camera);
  const parts = new Map();
  const part = (id) => {
    if (!parts.has(id)) parts.set(id, { id, bone: (id & 0x1fffffff) >>> 16, part: PARTS.find(([bit]) => id & bit)?.[1] ?? 'body', triangles: [], segments: [], circles: [], depth: Infinity });
    return parts.get(id);
  };
  const add = (id, kind, shape, points) => {
    if (!bones) id = 0;
    else if (id === 0xffffffff) return;
    const p = part(id);
    p[kind].push(shape);
    p.depth = Math.min(p.depth, ...points.map((q) => q[2]));
  };
  for (const [name, solid] of Object.entries(SOLIDS)) {
    const { data, ids } = buffers[name];
    ids.forEach((id, i) => { const m = unpacked(data, i * 16); for (const tri of solid) { const t = tri.map((v) => project(transform(m, v))); add(id, 'triangles', t, t); } });
  }
  {
    const { data, ids } = buffers.sphere_fill;
    ids.forEach((id, i) => {
      const m = unpacked(data, i * 16), center = transform(m, [0, 0, 0]), c = project(center);
      add(id, 'circles', [c, pixels(center, 0.05 * Math.hypot(m[0], m[1], m[2]))], [c]);
    });
  }
  {
    const { data, ids } = buffers.envelope_fill;
    ids.forEach((id, i) => {
      const head = data.subarray(i * 20, i * 20 + 4), tail = data.subarray(i * 20 + 4, i * 20 + 8), h = project(head), t = project(tail);
      const [rh, rt] = [pixels(head, head[3]), pixels(tail, tail[3])];
      add(id, 'circles', [h, rh], [h]);
      add(id, 'circles', [t, rt], [t]);
      add(id, 'segments', [h, t, Math.min(rh, rt)], [h, t]);
    });
  }
  {
    const { data, ids } = buffers.stick;
    ids.forEach((id, i) => {
      const at = i * 24, start = project(data.subarray(at, at + 3)), end = project(data.subarray(at + 4, at + 7)), color = (k) => data[at + k * 4 + 3];
      // overlay_armature_stick_vert.glsl: thinner without a wire color; the body is a band, the ends discs.
      const scale = (color(2) > 0 ? 1 : 0.5) * STICK_SIZE / 2;
      if (color(3) > 0) add(id, 'segments', [start, end, scale], [start, end]);
      if (color(4) > 0) add(id, 'circles', [start, 2 * scale], [start]);
      if (color(5) > 0) add(id, 'circles', [end, 2 * scale], [end]);
    });
  }
  {
    const { data, ids } = buffers.wire;
    ids.forEach((id, i) => { const a = project(data.subarray(i * 16, i * 16 + 3)), b = project(data.subarray(i * 16 + 8, i * 16 + 11)); add(id, 'segments', [a, b, 1], [a, b]); });
  }
  for (const { pass, mesh, geometry, data, ids } of customs) {
    if (pass === 'outline' || !ids.length) continue;
    const empty = SHAPES[geometry]?.();
    const shape = empty ? null : armatureShapeMesh(mesh, geometry);
    ids.forEach((id, i) => {
      const m = unpacked(data, i * 16), point = (v) => project(transform(m, v));
      if (empty) for (let v = 0; v < empty.length; v += 2) { const [a, b] = [point(empty[v]), point(empty[v + 1])]; add(id, 'segments', [a, b, 1], [a, b]); }
      else if (geometry === 'surface') for (let t = 0; t < shape.indices.length; t += 3) { const tri = [0, 1, 2].map((k) => point(shape.positions.subarray(shape.indices[t + k] * 3, shape.indices[t + k] * 3 + 3))); add(id, 'triangles', tri, tri); }
      else for (let e = 0; e < shape.indices.length; e += 2) { const [a, b] = [0, 1].map((k) => point(shape.positions.subarray(shape.indices[e + k] * 3, shape.indices[e + k] * 3 + 3))); add(id, 'segments', [a, b, 1], [a, b]); }
    });
  }
  return [...parts.values()];
}

const distanceToSegment = ([px, py], [ax, ay], [bx, by]) => {
  const dx = bx - ax, dy = by - ay, length2 = dx * dx + dy * dy;
  const t = length2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
const inside = ([px, py], [a, b, c]) => {
  const side = (p, q) => (q[0] - p[0]) * (py - p[1]) - (q[1] - p[1]) * (px - p[0]);
  const [s0, s1, s2] = [side(a, b), side(b, c), side(c, a)];
  return (s0 >= 0 && s1 >= 0 && s2 >= 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0);
};
// Whether a projected part is drawn within `radius` pixels of a point.
export function partHit(part, point, radius) {
  return part.triangles.some((tri) => inside(point, tri) || [0, 1, 2].some((i) => distanceToSegment(point, tri[i], tri[(i + 1) % 3]) <= radius))
    || part.segments.some(([a, b, width]) => distanceToSegment(point, a, b) <= width + radius)
    || part.circles.some(([c, r]) => Math.hypot(point[0] - c[0], point[1] - c[1]) <= r + radius);
}

// The bone part a click at (x, y) in a camera's view picks in Edit or Pose Mode, or null: { index, part (0 body, 1
// head, 2 tail) }. blender-port: armature_select.cc get_nearest_editbonepoint (the hits within 12 pixels, then 5 when
// several; joints before bodies, unselected before selected, the nearest of equals) and, in Pose Mode,
// ed_armature_pick_bone_from_selectbuffer_impl (an unselected bone before a selected one, the nearest of each).
export function pickBone(C, ob, { x, y, camera, xray = false }) {
  const parts = armatureParts(C, ob, camera), point = [x, y];
  const within = (radius) => parts.filter((p) => partHit(p, point, radius));
  let hits = within(12);
  if (hits.length > 1) { const near = within(5); if (near.length) hits = near; }
  if (!hits.length) return null;
  const { bones } = armatureData(ob), editing = dnaGet('Object', ob, 'mode') === 'EDIT';
  const bias = (hit) => {
    const bone = bones[hit.bone];
    if (!editing) return bone.pose.select ? 1 : 2;
    if (hit.part === 'head') return bone.select_head ? 3 : 4;
    if (hit.part === 'tail') return bone.select_tail ? 3 : 4;
    return bone.select ? 1 : 2;
  };
  const best = hits.reduce((a, b) => (bias(b) > bias(a) || (bias(b) === bias(a) && !xray && b.depth < a.depth) ? b : a));
  return { index: best.bone, part: editing ? { body: 0, head: 1, tail: 2 }[best.part] : 0 };
}

// The depth at which a click at (x, y) in a camera's view hits an armature's bones in Object Mode, or null.
export function pickArmature(C, ob, { x, y, camera }) {
  const hits = armatureParts(C, ob, camera, { bones: false }).filter((p) => partHit(p, [x, y], 5));
  return hits.length ? Math.min(...hits.map((p) => p.depth)) : null;
}
