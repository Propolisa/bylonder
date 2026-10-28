// Curve and text objects in Bylonder's scene: a Babylon mesh whose geometry is the mesh Blender evaluates for its Curve
// data (blenkernel/curve/curve.js), held in its creation recipe (metadata.wbCreation.curve) like a mesh's Mesh data, so
// undo, saving and duplicating carry it. Objects it follows (follow_curve, bevel and taper objects, a Curve modifier's
// object) are named by name and evaluated with it; one changing evaluates those that follow it again.
import { Mesh } from '@babylonjs/core';
import { CurveObject, evaluateCurve, CURVE_TARGETS } from '../../blenkernel/curve/curve.js';
import { createMesh } from '../../blenkernel/mesh/mesh.js';
import { mesh_batch_cache_apply } from '../../draw/mesh-batch-cache.js';
import { deleted } from '../object/identity.js';

export const curveData = (node) => node?.metadata?.wbCreation?.curve ?? null;
export const isCurveObject = (node) => !!curveData(node);

// An object's world transform as Object RNA gives it in Blender's axes: (x, y, z) of Babylon's (x, z, y), and the
// quaternion (w, -x, -z, -y) of Babylon's (decision 2 of docs/blender-boundary.md). Blender reads the world matrices of
// a curve object and of what it follows.
export function blenderTransform(node) {
  node.computeWorldMatrix(true);
  const { absolutePosition: p, absoluteRotationQuaternion: q, absoluteScaling: s } = node;
  return { location: [p.x, p.z, p.y], rotation_mode: 'QUATERNION', rotation_quaternion: [q.w, -q.x, -q.z, -q.y], scale: [s.x, s.z, s.y] };
}

const EMPTY = () => createMesh({ vert_positions: new Float32Array(0), edges: new Int32Array(0), face_offsets: new Int32Array([0]),
  corner_verts: new Int32Array(0), corner_edges: new Int32Array(0) });

// The names a curve object's data and modifiers follow.
const followed = (data) => [...CURVE_TARGETS.map((name) => data.targets?.[name]), ...(data.modifiers ?? []).flatMap((m) => Object.values(m.targets ?? {}))].filter(Boolean);

export function createCurveObjects(world) {
  // The object in Edit Mode, whose data is its edit data: { node, data(), update(fn) } (editcurve.js).
  let editing = null;
  const live = () => world.objects.filter((node) => !deleted(node) && isCurveObject(node));
  const byName = (name) => live().find((node) => node.name === name);

  // The mesh Blender evaluates for a curve object, with the objects it follows (theirs as they are now).
  function evaluate(node, data = curveData(node)) {
    const targets = Object.fromEntries(followed(data).map((name) => byName(name)).filter(Boolean)
      .map((target) => [target.name, { data: curveData(target), transform: blenderTransform(target) }]));
    return evaluateCurve(data, { transform: blenderTransform(node), modifiers: data.modifiers ?? [], targets });
  }

  // Draws a curve object from its data, and the objects that follow it.
  function apply(node, seen = new Set()) {
    if (seen.has(node)) return;
    seen.add(node);
    mesh_batch_cache_apply(evaluate(node) ?? EMPTY(), node);
    for (const other of live()) if (followed(curveData(other)).includes(node.name)) apply(other, seen);
  }

  return {
    evaluate,
    apply,
    // A curve object's data as it is now (the edit data in Edit Mode).
    data: (node) => (editing?.node === node ? editing.data() : curveData(node)),
    // Changes a copy of its data with fn and sets it, as an RNA write does.
    update(node, fn) {
      if (editing?.node === node) return editing.update(fn);
      const data = structuredClone(curveData(node));
      fn(data);
      this.set(node, data);
    },
    set editing(session) { editing = session; },
    // Draws every curve object again (after undo, which restores their data).
    refresh() { live().forEach((node) => mesh_batch_cache_apply(evaluate(node) ?? EMPTY(), node)); },
    // Sets a curve object's data and draws it.
    set(node, data) {
      node.metadata = { ...node.metadata, wbCreation: { curve: data } };
      apply(node);
    },
    // A module object holding the node's data, for Edit Mode and operators; free() it after.
    object(node) {
      const object = new CurveObject(curveData(node).type, node.name);
      object.data = curveData(node);
      object.transform = blenderTransform(node);
      return object;
    },
    byName,
    // A new curve or text object of Curve data, drawn, in the scene.
    add(name, data) {
      const node = new Mesh(name, world.scene);
      node.metadata = { editable: true, wbId: crypto.randomUUID(), wbCreation: { curve: data } };
      world.objects.push(node);
      apply(node);
      return node;
    },
  };
}

export { CurveObject };
