// Curve and text objects in Bylonder's scene: a Babylon mesh drawn from the mesh Main's depsgraph evaluates for its
// Curve data (main-view.js), which is held in its creation recipe (metadata.wbCreation.curve) like a mesh's Mesh data,
// so undo, saving and duplicating carry it. Objects it follows (follow_curve, bevel and taper objects, a Curve
// modifier's object) are named by name; Main's depsgraph evaluates it with them.
import { Mesh } from '@babylonjs/core';
import { CurveObject } from '../../blenkernel/curve/curve.js';
import { deleted } from '../object/identity.js';

export const curveData = (node) => node?.metadata?.wbCreation?.curve ?? null;
export const isCurveObject = (node) => !!curveData(node);

export function createCurveObjects(world) {
  // The object in Edit Mode, whose data is its edit data: { node, data(), update(fn) } (editcurve.js).
  let editing = null;
  const live = () => world.objects.filter((node) => !deleted(node) && isCurveObject(node));
  const byName = (name) => live().find((node) => node.name === name);

  return {
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
    // Sets a curve object's data: Main takes it, evaluates and draws it.
    set(node, data) {
      node.metadata = { ...node.metadata, wbCreation: { curve: data } };
      world.mainSync?.objectChanged(node);
    },
    // Main's curve or text object of the node, for Edit Mode and operators.
    object(node) {
      world.mainSync.flush(false);
      return new CurveObject(curveData(node).type, node.name, world.mainSync.objectOf(node), world.mainSync.blender);
    },
    byName,
    // A new curve or text object of Curve data in the scene, which Main evaluates and draws.
    add(name, data) {
      const node = new Mesh(name, world.scene);
      node.metadata = { editable: true, wbId: crypto.randomUUID(), wbCreation: { curve: data } };
      world.objects.push(node);
      world.mainSync?.objectChanged(node);
      return node;
    },
  };
}

export { CurveObject };
