// Object Mode operators run by Blender's own code, in the module's Blender world (BlenderMain, main-api.cc).
// Bylonder's scene owns the objects. Before an operator polls or runs, each object goes in through its RNA (Blender's
// values and axes) with its parent, mode and base, and the selected meshes when their Mesh changed. After it runs,
// what it tagged comes back the same way: transforms through RNA, a Mesh as the object's Mesh data.
import { OPERATOR_FINISHED } from '../../bmesh/bmesh-wasm.js';
import { createBlenderIDs } from '../../blenkernel/blender-ids.js';
import { nodeId } from './identity.js';
import { mesh_serialize } from '../../blenkernel/mesh/mesh.js';
import { objectMesh } from './object-mesh.js';
import { rebuildMesh } from './mesh-catalog.js';

// The object types the module holds; Bylonder's text and curves go in without their data, which Bylonder keeps.
const MIRRORED = ['MESH', 'EMPTY', 'FONT', 'CURVE'];
const OWN_DATA = ['MESH', 'EMPTY'];
const ID_RECALC_GEOMETRY = 1 << 1;
const V3D_AROUND = { BOUNDING_BOX_CENTER: 0, CURSOR: 1, INDIVIDUAL_ORIGINS: 2, MEDIAN_POINT: 3, ACTIVE_ELEMENT: 4 };
const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const isIdentity = (matrix) => matrix.every((v, i) => v === IDENTITY[i]);

//   rna: createRNA(host), whose host has the world and selection; transaction(fn): an undo step around a change;
//   ids: the world's IDs in the module (blender-ids.js), shared with its animation.
export function createBlenderObjects({ rna, transaction, notify, ids = createBlenderIDs() }) {
  const { world, selection } = rna.host;
  const blender = ids.blender;
  const key = (node) => 'object:' + nodeId(node);
  // Each node's object in the module: { ob, type, mesh (what its Mesh was made from) }.
  const mirrored = new Map();

  function sync() {
    const nodes = rna.objects().filter((node) => MIRRORED.includes(rna.pointer('Object', node).type)), live = new Set(nodes);
    const stale = [...mirrored].filter(([node, { type }]) => !live.has(node) || rna.pointer('Object', node).type !== type);
    stale.forEach(([node]) => mirrored.delete(node));
    for (const node of nodes) {
      const type = rna.pointer('Object', node).type;
      if (!mirrored.has(node)) mirrored.set(node, { ob: ids.object(key(node), type, node.name), type });
    }
    for (const [node, { ob }] of mirrored) {
      const data = rna.pointer('Object', node), status = world.collections?.status(node) ?? { visible: true, selectable: true };
      blender.setParent(ob, mirrored.get(node.parent)?.ob);
      blender.setMode(ob, data.mode);
      blender.setTransform(ob, { location: Array.from(data.location), rotation_mode: data.rotation_mode, rotation_euler: Array.from(data.rotation_euler),
        rotation_quaternion: Array.from(data.rotation_quaternion), scale: Array.from(data.scale), matrix_parent_inverse: IDENTITY });
      blender.setBase(ob, { visible: status.visible, hidden: data.hide_get(), hide_select: data.hide_select || !status.selectable,
        select: data.select_get(), active: node === selection.nodes.at(-1) });
    }
    for (const [node] of stale) if (!mirrored.has(node)) ids.remove(key(node));
    const scene = rna.pointer('Scene', world);
    blender.cursor = Array.from(scene.cursor.location);
    blender.pivotPoint = V3D_AROUND[scene.tool_settings.transform_pivot_point];
    blender.evaluate();
  }

  function syncMeshes() {
    for (const [node, entry] of mirrored) {
      const source = node.metadata?.wbCreation ?? node.geometry;
      if (entry.type !== 'MESH' || !selection.has(node) || entry.mesh === source) continue;
      blender.setMesh(entry.ob, objectMesh(node));
      entry.mesh = source;
    }
  }

  // What the operator tagged, read before evaluating clears the tags.
  function changed() {
    const tagged = [...mirrored].map(([node, entry]) => ({ node, entry, tags: blender.tags(entry.ob) })).filter(({ tags }) => tags.object || tags.data);
    blender.evaluate();
    return tagged.map(({ node, entry, tags }) => ({ node, entry, geometry: !!((tags.object | tags.data) & ID_RECALC_GEOMETRY) }));
  }

  function writeBack(objects) {
    for (const { node, entry, geometry } of objects) {
      if (!isIdentity(blender.transform(entry.ob).matrix_parent_inverse)) blender.foldParentInverse(entry.ob);
      const { location, rotation_mode, rotation_euler, rotation_quaternion, scale } = blender.transform(entry.ob), data = rna.pointer('Object', node);
      Object.assign(data, { location, scale }, rotation_mode === 'QUATERNION' ? { rotation_quaternion } : { rotation_euler });
      if (geometry && entry.type === 'MESH') {
        rebuildMesh(node, { mesh: mesh_serialize(blender.mesh(entry.ob)) });
        entry.mesh = node.metadata.wbCreation;
      }
    }
    world.modifiers?.refresh();
  }

  // Runs an operator's exec as one undo step; returns its status and report. An operator that changed the data of a
  // text or curve object, which the module does not hold, changes nothing.
  function run(idname, props = {}) {
    let result;
    transaction(() => {
      sync();
      syncMeshes();
      result = blender.run(idname, props);
      const objects = result.status & OPERATOR_FINISHED ? changed() : [];
      const unheld = objects.find(({ entry, geometry }) => geometry && !OWN_DATA.includes(entry.type));
      if (unheld) result = { status: 0, report: `Bylonder does not apply this to ${unheld.entry.type === 'FONT' ? 'text' : 'curve'} objects yet` };
      else writeBack(objects);
    });
    if (result.report) notify(result.report);
    return result;
  }

  return {
    run,
    poll(idname) {
      sync();
      return blender.poll(idname);
    },
  };
}
