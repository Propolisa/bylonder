// A modifier value changed on a dense mesh, to the mesh Babylon draws: Main's depsgraph evaluating the stack, the
// evaluated Mesh's extraction, its draw buffers (Blender's draw extraction in the module, else built in JS) and their
// upload (NullEngine: Babylon's CPU side; the GPU's is bench/modifier-draw.browser.mjs). And memory with each result drawn.
// usage: node --expose-gc bench/modifier-draw.bench.js [runs] [100k|1M]
import { NullEngine, Scene, Mesh } from '@babylonjs/core';
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import * as bmesh from '../src/bmesh/bmesh-wasm.js';
import { blenderModifierDefinitions, moduleModifiers } from '../src/modifiers/blender.js';
import { mesh_batch_cache_vertex_buffers } from '../src/draw/mesh-batch-buffers.js';
import { mesh_batch_cache_apply } from '../src/draw/mesh-batch-cache.js';
import { setContextPointer, blendData } from '../src/python/bpy_rna.js';
import { __kwargtrans__ } from '../src/bl_py/org.transcrypt.__runtime__.js';

const { BlenderMain, blenderModule, ID_RECALC_GEOMETRY, DRAW_LINES = 1 } = bmesh;
const runs = Number(process.argv[2] ?? 5), sizes = process.argv[3] ? [process.argv[3]] : ['100k', '1M'];
const x = blenderModule.exports;
const grid = (n) => primitive_add('mesh.primitive_grid_add', { x_subdivisions: n, y_subdivisions: n, calc_uvs: true });
const definition = (id) => blenderModifierDefinitions.find((d) => d.id === id);

const main = new BlenderMain();
setContextPointer(main.C);
const engine = new NullEngine(), scene = new Scene(engine);

// A Geometry Nodes group subdividing its geometry (Subdivide Mesh), and that node.
function subdivideGroup() {
  const group = blendData().node_groups.new('Subdivide', 'GeometryNodeTree');
  for (const in_out of ['INPUT', 'OUTPUT']) group.interface.new_socket(__kwargtrans__({ name: 'Geometry', in_out, socket_type: 'NodeSocketGeometry' }));
  const [input, output, subdivide] = ['NodeGroupInput', 'NodeGroupOutput', 'GeometryNodeSubdivideMesh'].map((idname) => group.nodes.new(idname));
  group.links.new(input.outputs[0], subdivide.inputs[0]);
  group.links.new(subdivide.outputs[0], output.inputs[0]);
  return { group, subdivide };
}

// Each case: the grid its object starts from, its modifier, and the value changed before each timed evaluation (`from`,
// untimed) and the one timed (`to`), both giving a result of the case's size.
function cases(size) {
  const big = size === '1M', side = (faces) => Math.round(Math.sqrt(faces));
  const faces = big ? 1e6 : 1e5;
  return [
    { name: 'Subdivision', mesh: grid(side(faces / 16)), type: 'SUBSURF', values: { levels: 1 }, path: 'levels', from: 1, to: 2 },
    { name: 'Array', mesh: grid(side(faces / 10)), type: 'ARRAY', values: { count: 9 }, path: 'count', from: 9, to: 10 },
    { name: 'Displace', mesh: grid(side(faces)), type: 'DISPLACE', values: { strength: 0.5 }, texture: { type: 'CLOUDS' }, path: 'strength', from: 0.5, to: 0.6 },
    { name: 'Geometry Nodes', mesh: grid(side(faces / 16)), nodes: true, path: 'Level', from: 1, to: 2 },
  ];
}

// The object of a case, and a function setting its modifier's value as the Properties editor does: written into its
// ModifierData (or the node's input), the object tagged for the depsgraph.
function setUp(c) {
  const ob = main.add('MESH', c.name);
  main.setMesh(ob, c.mesh);
  if (c.nodes) {
    const { group, subdivide } = subdivideGroup();
    blendData().objects.get(c.name).modifiers.new('GeometryNodes', 'NODES').node_group = group;
    // RNA's update of the socket's value tags the tree, and the depsgraph its users.
    return { ob, set: (value) => { subdivide.inputs[1].default_value = value; } };
  }
  main.setModifiers(ob, moduleModifiers([{ type: c.type, values: c.values, texture: c.texture }]));
  const { md } = main.modifiers(ob)[0], { write } = definition(c.type).mesh;
  return { ob, set: (value) => { write({ [c.path]: value })(new DataView(x.memory.buffer), md); main.tag(ob, ID_RECALC_GEOMETRY); } };
}

// The draw buffers as mesh_batch_cache_apply builds them: Blender's, extracted in the module, where the Mesh has them.
const drawBuffers = (mesh) => (mesh.drawBuffers ? mesh.drawBuffers(DRAW_LINES) : mesh_batch_cache_vertex_buffers(mesh));
const median = (values) => values.sort((a, b) => a - b)[values.length >> 1];
const ms = (v) => v.toFixed(1).padStart(7);
const MB = (bytes) => `${(bytes / 2 ** 20).toFixed(0)} MB`;
const now = () => performance.now();

console.log(`${'case'.padEnd(26)} ${'faces'.padStart(8)}   evaluate  extract  buffers   upload    total  (ms, median of ${runs})`);
for (const size of sizes) {
  for (const c of cases(size)) {
    const { ob, set } = setUp(c), node = new Mesh(c.name, scene);
    set(c.from); main.evaluate(); mesh_batch_cache_apply(main.evaluatedMesh(ob), node);
    const steps = { evaluate: [], extract: [], buffers: [], upload: [], total: [] };
    let faces = 0;
    for (let i = 0; i < runs; i++) {
      set(c.from); main.evaluate(); main.evaluatedMesh(ob);
      set(c.to);
      const t0 = now(); main.evaluate();
      const t1 = now(), mesh = main.evaluatedMesh(ob);
      const t2 = now(); drawBuffers(mesh);
      const t3 = now(); mesh_batch_cache_apply(mesh, node);
      const t4 = now();
      faces = mesh.faces_num;
      // apply builds the buffers again: upload is apply less one build.
      Object.entries({ evaluate: t1 - t0, extract: t2 - t1, buffers: t3 - t2, upload: t4 - t3 - (t3 - t2), total: t4 - t0 - (t3 - t2) }).forEach(([k, v]) => steps[k].push(v));
    }
    const m = Object.fromEntries(Object.entries(steps).map(([k, v]) => [k, median(v)]));
    console.log(`${(c.name + ' ' + size).padEnd(26)} ${String(faces).padStart(8)}  ${ms(m.evaluate)}  ${ms(m.extract)}  ${ms(m.buffers)}  ${ms(m.upload)}  ${ms(m.total)}`);
    globalThis.gc?.();
    const { heapUsed, arrayBuffers } = process.memoryUsage();
    console.log(`${''.padEnd(26)} drawn: module memory ${MB(x.memory.buffer.byteLength)}, JS heap ${MB(heapUsed)}, array buffers ${MB(arrayBuffers)}`);
    node.dispose(); main.remove(ob);
  }
}
