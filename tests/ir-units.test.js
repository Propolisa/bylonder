// The unit registry over the IR (docs/licence-free-live.md, step 2): the Steam Engine's drivers, Live Modifiers and
// the Geometry Nodes example run each entity on the implementation their package ships, and a stand-in unit registered
// for one type key (`modifier:BEVEL`) takes over its entity with no other change, its inputs parsed with its schema.
// Each package's scene.ir.json is valid against the IR's JSON Schema.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import { NullEngine, Scene, FreeCamera, Vector3 } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { writePackage } from './export-package.js';

const schema = JSON.parse(readFileSync(new URL('../src/io_scene_babylon/runtime/ir.schema.json', import.meta.url), 'utf8'));
const validate = new Ajv2020({ strict: false }).compile(schema);
/** The package's IR, checked against the schema, and its entities of an implementation. */
function irOf(files) {
  const ir = JSON.parse(files['scene.ir.json']);
  assert.ok(validate(ir), `scene.ir.json: ${JSON.stringify(validate.errors?.slice(0, 3))}`);
  return { ir, on: (implementation) => Object.entries(ir.entities).filter(([, e]) => e.implementation === implementation) };
}
const positions = (mesh) => Array.from(mesh.getVerticesData('position'));

const SCENARIOS = {
  async drivers() {
    const { world, sync } = openExample('drivers-and-graph-editor');
    sync.view();
    const files = await exportModule(world), { on } = irOf(files);
    assert.ok(on('driver').length >= 8 && on('driver').every(([, e]) => e.type.startsWith('driver:')), 'each driver on the clean-room driver units');
    assert.ok(on('native').some(([, e]) => e.inputs.animation?.target === 'Flywheel'),'the flywheel\'s F-Curve on Babylon\'s AnimationGroup');
    const written = writePackage(files), blend = await (await import(written.url)).load(new NullEngine());
    const crosshead = blend.scene.getNodeById('Crosshead'), before = crosshead.position.clone();
    blend.set('objects["Flywheel"].rotation_euler[1]', 1.3);
    await blend.settled();
    assert.ok(!crosshead.position.equalsWithEpsilon(before, 1e-4), 'setting the flywheel moves the crosshead');
    blend.dispose();
    written.remove();
    console.log(`drivers: ${on('driver').length} driver entities run on the shipped clean-room units`);
  },

  async modifiers() {
    const { createPrimitive, shadeSmooth } = await import('../src/editors/object/mesh-catalog.js');
    const { createModifierSystem } = await import('../src/modifiers/stack.js');
    const { createAnimationModel } = await import('../src/blenkernel/animation/model.js');
    const { registerObjects } = await import('../src/blenkernel/animation/bindings.js');
    const { createRenderSettings } = await import('../src/blenkernel/scene/render.js');
    const { createSceneSettings } = await import('../src/blenkernel/scene/settings.js');
    const { asObject } = await import('../src/runtime/object-transform.js');
    const { sceneMain } = await import('./scene-main.js');
    const engine = new NullEngine(), scene = new Scene(engine), camera = new FreeCamera('Camera', new Vector3(0, 5, -20), scene);
    const cubes = ['Bevel', 'Solidify', 'Stack'].map((name, i) => {
      // Shaded smooth: the kernel takes a Mesh without its sharp faces, which Main's evaluation keeps.
      const cube = shadeSmooth(createPrimitive(name, 'mesh.primitive_cube_add', { size: 2 }, scene));
      cube.metadata.wbId = name;
      cube.position.x = i * 4;
      return cube;
    });
    const animation = createAnimationModel(), objects = Object.assign([...cubes, asObject(camera)], { scene }), world = { scene, objects, animation };
    world.sceneSettings = createSceneSettings(world, { cameras: { list: () => [camera], get: () => camera, set: () => {} } });
    world.renderSettings = createRenderSettings(world);
    world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
    sceneMain(world);
    registerObjects(animation, objects);
    world.modifiers.add(cubes[0], 'BEVEL', { width: 0.2, segments: 3 });
    const solidify = world.modifiers.add(cubes[1], 'SOLIDIFY', { thickness: 0.3 });
    // A stack whose Bevel marks its edges sharp and sets its faces' strength, which Edge Split and Weighted Normal after
    // a Subdivision read.
    const stacked = world.modifiers.add(cubes[2], 'BEVEL', { width: 0.2, segments: 2, mark_sharp: true, face_strength_mode: 'FSTR_ALL' });
    world.modifiers.add(cubes[2], 'EDGE_SPLIT', { use_edge_angle: false, use_edge_sharp: true });
    world.modifiers.add(cubes[2], 'SUBSURF', { levels: 1 });
    world.modifiers.add(cubes[2], 'WEIGHTED_NORMAL', { mode: 'FACE_AREA', use_face_influence: true });
    await world.modifiers.settled();

    const files = await exportModule(world, { live: true }), { ir, on } = irOf(files);
    assert.deepEqual(on('modifiers').map(([key, e]) => [key, e.type]), [['OB:Bevel/modifier/Bevel', 'modifier:BEVEL'], ['OB:Solidify/modifier/Solidify', 'modifier:SOLIDIFY'],
      ['OB:Stack/modifier/Bevel', 'modifier:BEVEL'], ['OB:Stack/modifier/EdgeSplit', 'modifier:EDGE_SPLIT'],
      ['OB:Stack/modifier/Subdivision', 'modifier:SUBSURF'], ['OB:Stack/modifier/WeightedNormal', 'modifier:WEIGHTED_NORMAL']]);
    assert.deepEqual(ir.entities['OB:Stack/modifier/Subdivision'].inputs.mesh, { entity: 'OB:Stack/modifier/EdgeSplit', output: 'mesh' }, 'each modifier reads the one before');
    const written = writePackage(files), blend = await (await import(written.url)).load(new NullEngine());
    // On the shipped kernel: Solidify set by path gives Bylonder's own stack's result.
    blend.set('objects["Solidify"].modifiers["Solidify"].thickness', 0.5);
    await blend.settled();
    world.modifiers.set(cubes[1], solidify.id, 'thickness', 0.5);
    await world.modifiers.settled();
    const near = (a, b) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < 1e-5);
    assert.ok(near(positions(blend.scene.getMeshById('Solidify')), positions(cubes[1])), 'Solidify on modifiers.wasm is the app\'s');
    // The stack runs in one kernel call: what Bevel writes reaches the modifiers after it, and the result is the app's.
    blend.set('objects["Stack"].modifiers["Bevel"].segments', 3);
    await blend.settled();
    world.modifiers.set(cubes[2], stacked.id, 'segments', 3);
    await world.modifiers.settled();
    const normals = (mesh) => Array.from(mesh.getVerticesData('normal')), page = blend.scene.getMeshById('Stack');
    assert.ok(near(positions(page), positions(cubes[2])) && normals(page).every((v, i) => Math.abs(v - normals(cubes[2])[i]) <= 1 / 32767 + 1e-6),
      'the stack is the app\'s, the sharp edges and face strengths Bevel writes included');

    // A stand-in for Bevel, registered with the package's own registry and schema library: it scales the mesh by
    // 1 + width. Its entity runs on it with no other change, and its mesh is drawn.
    const { register } = await import(new URL('bylonder/units.js', written.url).href);
    const z = await import(new URL('bylonder/zod.js', written.url).href), { MeshSchema } = await import(new URL('bylonder/ir.js', written.url).href);
    const { triangulate } = await import(new URL('bylonder/mesh.js', written.url).href);
    const calls = [];
    register('modifier:BEVEL', {
      inputs: z.looseObject({ mesh: MeshSchema, width: z.number(), segments: z.int(), harden_normals: z._default(z.boolean(), false) }),
      run(inputs) {
        calls.push(inputs);
        return { mesh: { ...inputs.mesh, vert_positions: inputs.mesh.vert_positions.map((v) => v * (1 + inputs.width)) } };
      },
    });
    blend.set('objects["Bevel"].modifiers["Bevel"].width', 0.25);
    await blend.settled();
    assert.equal(calls.length, 1, 'the stand-in runs once');
    const [inputs] = calls;
    assert.ok(inputs.width === 0.25 && inputs.segments === 3 && inputs.harden_normals === false && inputs.mesh.vert_positions instanceof Float32Array,
      'its inputs resolved and parsed with its schema, a default filled');
    // The stack's Bevel is a BEVEL too: the stand-in takes it over, and the rest of the stack runs on the kernel after it.
    blend.set('objects["Stack"].modifiers["Bevel"].width', 0.25);
    await blend.settled();
    assert.equal(calls.length, 2, 'the stand-in takes over the stack\'s Bevel');
    assert.ok(positions(blend.scene.getMeshById('Stack')).length > calls[1].mesh.corner_verts.length * 3, 'and the rest of the stack runs on its mesh');
    const expected = triangulate({ ...inputs.mesh, vert_positions: inputs.mesh.vert_positions.map((v) => v * 1.25) });
    assert.ok(near(positions(blend.scene.getMeshById('Bevel')), Array.from(expected.positions)), 'the stand-in\'s mesh is drawn');
    assert.deepEqual(JSON.parse(files['scene.ir.json']), ir, 'nothing of the package changed');
    blend.dispose();
    written.remove();
    console.log('modifiers: Solidify, and a four-modifier stack in one call, run on modifiers.wasm as the app does; a stand-in unit for modifier:BEVEL takes over with no other change');
  },

  async 'geometry-nodes'() {
    const { world, sync } = openExample('geometry-nodes');
    sync.view();
    const files = await exportModule(world, { sourceBlend: true }), { on } = irOf(files);
    assert.deepEqual(on('blender').map(([key, e]) => [key, e.type]), [['OB:Planet/modifier/Planet', 'modifier:NODES']], 'Geometry Nodes on the interim Blender fallback');
    const written = writePackage(files), blend = await (await import(written.url)).load(new NullEngine());
    const planet = blend.scene.getMeshById('Planet'), before = positions(planet);
    blend.set('objects["Planet"].modifiers["Planet"].properties.inputs.Socket_3.value', 0.9);
    await blend.settled();
    assert.notDeepEqual(positions(planet), before, 'setting Mountains evaluates the planet again');
    blend.dispose();
    written.remove();
    console.log('geometry nodes: the Planet\'s modifier entity runs on the Blender fallback');
  },
};

const scenario = process.argv[2];
if (scenario) await SCENARIOS[scenario]();
else {
  for (const name of Object.keys(SCENARIOS)) process.stdout.write(execFileSync(process.execPath, [fileURLToPath(import.meta.url), name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).split('\n').filter((l) => !l.startsWith('BJS')).join('\n'));
  console.log('IR units: drivers, Live Modifiers and Geometry Nodes on their shipped implementations; a stand-in unit takes over one type key');
}
