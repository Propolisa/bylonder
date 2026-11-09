// The Blender fallback of an exported page (docs/controllable-exports.md, evaluator loader): Blender's module headless
// on the package's scene.blend. A control is set in Main by its RNA path, Main is evaluated, and what the depsgraph
// updated is drawn into the page's Babylon objects as the view draws it (main-evaluated.js): an object's evaluated mesh
// and the objects its geometry instances. Bundled with the module into a package's bylonder-blender/ (scripts/
// blender-fallback.mjs) only when the export includes its source .blend; it is GPL, as the module is.
import { BlenderMain, ID_RECALC_GEOMETRY } from '../bmesh/bmesh-wasm.js';
import { blendData, idStruct, setContextPointer } from '../python/bpy_rna.js';
import { mesh_batch_cache_apply } from '../draw/mesh-batch-cache.js';
import { Matrix } from '@babylonjs/core';
import { ID_OB, babylonMatrix, drawThinInstances } from '../blenkernel/main-evaluated.js';

// A path's owner and its last step: a property's name, an index or a quoted key.
const STEP = /^(.*?)(?:\.(\w+)|\[(\d+)\]|\["((?:[^"\\]|\\.)*)"\])$/;

// Sets an RNA path from bpy.data, as Blender's RNA sets it (its update tags what depends on it).
function setPath(data, path, value) {
  const [, owner, name, index, key] = STEP.exec(path) ?? [];
  if (owner === undefined) throw new Error(`Not an RNA path: ${path}`);
  const target = owner ? data.path_resolve(owner) : data;
  if (name !== undefined) target[name] = value;
  else target.__setitem__(index !== undefined ? Number(index) : key.replace(/\\(.)/g, '$1'), value);
}

// The meshes drawing the objects a geometry instances, by their source's name: the carriers sharing their source's
// geometry (js-export.js writes a carrier's thin instances with its source's geometry, in its instancer's space when
// it has one).
const carriers = (scene) => new Map(scene.meshes.filter((mesh) => mesh.hasThinInstances).flatMap((carrier) => {
  const source = scene.meshes.find((mesh) => mesh !== carrier && mesh.geometry && mesh.geometry === carrier.geometry);
  return source ? [[source.id, { source, carrier }]] : [];
}));

// Opens `bytes`, a .blend, beside the page's Babylon `scene`: set(path, value) and evaluate(frame) draw what changed.
export function openBlend(scene, bytes) {
  const blender = new BlenderMain();
  blender.readBlend(bytes);
  setContextPointer(blender.C);
  const data = blendData(), name = (ob) => blender.name(ob), instanced = carriers(scene);
  // A group's world matrices in its instancer's space, where its carrier is the instancer's child (js-export.js
  // parentInstances).
  const local = (group) => {
    const data = new Float32Array(group.data), inverse = babylonMatrix(blender.transform(group.instancer).matrix_world).invert();
    for (let i = 0; i < data.length; i += 16) Matrix.FromArray(data, i).multiply(inverse).copyToArray(data, i);
    return { data };
  };
  // The page draws the file as it was evaluated, at its frame: only what changes from here is drawn.
  let frame = idStruct(blender.scene).frame_current;
  blender.evaluate();
  blender.updates();
  return {
    set: (path, value) => setPath(data, path, value),
    evaluate(at) {
      if (at !== frame) blender.frame = frame = at;
      blender.evaluate();
      const updates = new Map(blender.updates().map(({ id, recalc }) => [id, recalc]));
      for (const ob of blender.ids(ID_OB)) {
        const node = scene.getNodeById(name(ob)), mesh = updates.get(ob) & ID_RECALC_GEOMETRY && node?.geometry && blender.evaluatedMesh(ob);
        if (mesh) mesh_batch_cache_apply(mesh, node);
      }
      const groups = Map.groupBy(blender.instances().filter((group) => group.shape === 'OBJECT'), (group) => name(group.ob));
      for (const [id, list] of groups) {
        const { source, carrier } = instanced.get(id) ?? {};
        if (!carrier) continue;
        if (carrier.geometry !== source.geometry) source.geometry.applyToMesh(carrier);
        drawThinInstances(carrier, carrier.parent ? list.map(local) : list);
      }
    },
  };
}
