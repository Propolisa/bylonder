// An example's Geometry Nodes modifiers evaluated by Bylonder's evaluator (src/io_scene_babylon/runtime/geometry-nodes/)
// on IR graphs and IR geometry, each node a call into Blender's kernels (geometry-nodes-api.cc) with no scene.blend,
// compared with what the app's Main evaluates for the same inputs: the mesh bit for bit, the instances' world matrices.
import assert from 'node:assert/strict';
import { openExample } from '../open-example.js';
import { blendData } from '../../src/python/bpy_rna.js';
import { writeGraph, idKey } from '../../src/io_scene_babylon/ir-graphs.js';
import { geometryNodesUnit } from '../../src/io_scene_babylon/runtime/geometry-nodes/index.js';
import { createKernels } from '../../src/io_scene_babylon/runtime/geometry-nodes/kernels.js';
import { ID_OB } from '../../src/blenkernel/main-evaluated.js';
import { GEOMETRY_NODES_KERNELS } from '../../src/io_scene_babylon/runtime-files.js';
import { instantiate } from '../../src/io_scene_babylon/polyfill/geometry-nodes.js';

// The Geometry Nodes kernels a package ships, loaded as an exported page loads them.
export const shippedKernels = () => instantiate(new URL(`../../src/${GEOMETRY_NODES_KERNELS}`, import.meta.url));

// Blender's 4x4 (column-major) from Babylon's layout and back: the same swap of Y and Z.
const AXIS = [0, 2, 1, 3];
const swapped = (m) => Array.from({ length: 16 }, (_, i) => m[AXIS[i >> 2] * 4 + AXIS[i & 3]]);
const multiply = (a, b) => Array.from({ length: 16 }, (_, i) => [0, 1, 2, 3].reduce((sum, k) => sum + a[k * 4 + (i % 4)] * b[Math.floor(i / 4) * 4 + k], 0));

/**
 * @param {string} id the example
 * @param {Record<string, any>[]} cases modifier inputs by interface identifier, set in turn
 * @param {object} exports the module's exports the kernels call
 */
export async function compareExample(id, cases, exports) {
  const { sync } = openExample(id);
  const { blender } = sync, data = blendData();
  sync.view();
  // Main's objects by name, those outside the view layer too (the trees a collection instances).
  const objectOf = (name) => blender.ids(ID_OB).find((ob) => blender.name(ob) === name);
  const irMesh = (mesh) => ({
    vert_positions: Float32Array.from(mesh.vert_positions), edges: Int32Array.from(mesh.edges), face_offsets: Int32Array.from(mesh.face_offsets),
    corner_verts: Int32Array.from(mesh.corner_verts), corner_edges: Int32Array.from(mesh.corner_edges),
    attributes: Object.fromEntries([...mesh.attributes].map(([name, { domain, type, data: values }]) => [name, { domain, type, data: values.slice() }])),
  });
  const resolve = (key) => {
    const [code, name] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
    if (code === 'MA') return { type: 'MATERIAL' };
    if (code === 'GR') return { type: 'COLLECTION', objects: [...data.collections.get(name).objects].map(idKey), children: [...data.collections.get(name).children].map(idKey) };
    if (code === 'OB') {
      const ob = data.objects.get(name), pointer = objectOf(name);
      return { type: 'OBJECT', matrix: Array.from(blender.transform(pointer).matrix_world), geometry: { mesh: irMesh(blender.mesh(pointer)) },
        materials: [...ob.material_slots].map((slot) => (slot.material ? { id: idKey(slot.material) } : null)) };
    }
    return null;
  };
  const kernels = createKernels(exports, resolve);

  const times = [];
  const modified = [...data.objects].filter((ob) => [...ob.modifiers].some((m) => m.type === 'NODES'));
  for (const values of cases) {
    for (const ob of modified) {
      const modifier = [...ob.modifiers].find((m) => m.type === 'NODES'), graphs = writeGraph(modifier.node_group, idKey(modifier.node_group));
      for (const [socket, value] of Object.entries(values)) modifier.properties.inputs[socket].value = value;
      sync.view();
      const pointer = objectOf(ob.name), inputs = Object.fromEntries([...graphs[idKey(modifier.node_group)].interface]
        .filter((s) => s.in_out === 'INPUT' && s.socket_type !== 'NodeSocketGeometry').map((s) => [s.identifier, modifier.properties.inputs[s.identifier].value]));
      const base = { mesh: irMesh(blender.mesh(pointer)) };
      const unit = geometryNodesUnit(graphs, { kernels: kernels.unit, resolve });
      const start = performance.now();
      const { geometry } = await unit.run({ graph: idKey(modifier.node_group), geometry: base, ...inputs }, { frame: 1 });
      times.push(performance.now() - start);

      const evaluated = blender.evaluatedMesh(pointer), at = `${ob.name} at ${JSON.stringify(values)}`;
      assert.deepEqual(Array.from(geometry.mesh?.vert_positions ?? []), Array.from(evaluated?.vert_positions ?? []), `${at}: the mesh's points are the app's`);
      assert.deepEqual(Array.from(geometry.mesh?.corner_verts ?? []), Array.from(evaluated?.corner_verts ?? []), `${at}: its faces are the app's`);
      const world = Array.from(blender.transform(pointer).matrix_world);
      const ours = geometry.instances ? Array.from({ length: geometry.instances.transforms.length / 16 }, (_, i) => ({
        ob: geometry.instances.references[geometry.instances.reference_indices[i]]?.id,
        matrix: multiply(world, Array.from(geometry.instances.transforms.slice(i * 16, i * 16 + 16))),
      })) : [];
      const theirs = blender.duplis(pointer).map((d) => ({ ob: `OB:${blender.name(d.ob)}`, matrix: swapped(d.matrix) }));
      assert.equal(ours.length, theirs.length, `${at}: as many instances as the app's`);
      ours.forEach((instance, i) => {
        assert.equal(instance.ob, theirs[i].ob, `${at}: instance ${i} is of the app's object`);
        assert.ok(instance.matrix.every((v, k) => Math.abs(v - theirs[i].matrix[k]) < 1e-5), `${at}: instance ${i} stands where the app's does`);
      });
    }
  }
  return { objects: modified.map((ob) => ob.name), milliseconds: Math.round(times.reduce((a, b) => a + b, 0) / times.length) };
}
