// Opening a .blend (File > Open): Blender's reader in the module puts the file's data in Main and the scene sync makes it
// Babylon's (main-sync.js adopt), as a project's code opens it before the world starts (sdk.openBlend). A file Bylonder
// wrote opens as it was saved; a file the reference Blender made opens with the objects, transforms, data, materials,
// modifiers, keys and collections Blender reads in it (tools/blender-reference/blend-check.py).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NullEngine, Scene, Vector3, PointLight, FreeCamera, PBRMaterial, Color3 } from '@babylonjs/core';
import { BlenderMain } from '../src/bmesh/bmesh-wasm.js';
import { createBlenderIDs } from '../src/blenkernel/blender-ids.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { registerObjects } from '../src/blenkernel/animation/bindings.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createCollections } from '../src/blenkernel/scene/collections.js';
import { createMaterialLibrary } from '../src/blenkernel/material/library.js';
import { createWorlds } from '../src/blenkernel/scene/world.js';
import { createModifierSystem, addModifier, modifierStack } from '../src/modifiers/stack.js';
import { createSelection } from '../src/editors/object/selection.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { buildMesh } from '../src/editors/object/mesh-catalog.js';
import { mesh_serialize } from '../src/blenkernel/mesh/mesh.js';
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { asObject } from '../src/runtime/object-transform.js';
import { objectMesh } from '../src/editors/object/object-mesh.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const close = (a, b, tolerance = 1e-4) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < tolerance);

// A world as createWorld makes one, over its own Main: `build` makes the scene as a project's code does, then the
// world's slices and its scene sync start.
async function makeWorld(build) {
  const scene = new Scene(new NullEngine());
  const animation = createAnimationModel(() => {}, { ids: createBlenderIDs(new BlenderMain()) });
  const objects = await build(scene, animation);
  objects.scene = scene;
  const world = { scene, objects, animation };
  let camera = scene.activeCamera;
  world.sceneSettings = createSceneSettings(world, { cameras: { list: () => scene.cameras, get: () => camera, set: (c) => { camera = c; } } });
  world.renderSettings = createRenderSettings(world);
  world.collections = createCollections(world);
  world.materials = createMaterialLibrary(world);
  world.worlds = createWorlds(world);
  world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
  registerObjects(animation, objects);
  world.collections.adopt();
  const selection = createSelection(scene, objects);
  const sync = createMainSync({ rna: createRNA({ world, selection }), ids: animation.ids });
  sync.debug = true;
  return { world, sync, scene };
}
// A project's code opening a .blend into its scene (sdk.openBlend).
const opening = (bytes, report = []) => async (scene, animation) => {
  const sync = createMainSync({ rna: createRNA({ world: { scene, objects: [] } }), ids: animation.ids });
  const { nodes, warnings } = sync.readBlend(bytes, scene);
  report.push(...warnings);
  return nodes;
};
const rna = (world) => createRNA({ world });
const object = (world, name) => rna(world).pointer('Object', world.objects.find((n) => n.name === name));

// Round trip: Bylonder's scene saved and opened again.
const saved = await makeWorld(async (scene, animation) => {
  const mesh = mesh_serialize(primitive_add('mesh.primitive_cube_add'));
  const cube = buildMesh(scene, 'Cube', { mesh });
  cube.metadata = { wbId: 'cube', wbCreation: { mesh } };
  cube.position = new Vector3(1, 2, 3);
  cube.rotation = new Vector3(0.1, 0.2, 0.3);
  cube.material = Object.assign(new PBRMaterial('Red', scene), { albedoColor: new Color3(0.8, 0.1, 0.1), metallic: 0.3, roughness: 0.6 });
  addModifier(cube, 'SUBSURF', { levels: 2 });
  const light = asObject(new PointLight('Light', new Vector3(4, 6, 1), scene));
  light.metadata = { wbId: 'light' };
  const camera = asObject(new FreeCamera('Camera', new Vector3(7, 5, -7), scene));
  camera.metadata = { wbId: 'camera' };
  camera.setTarget(Vector3.Zero());
  scene.activeCamera = camera;
  void animation;
  return [cube, light, camera];
});
saved.world.animation.insert([saved.world.animation.ref('object:cube', 'position.x')], 1);
const bytes = saved.sync.writeBlend('/round.blend');
const warnings = [];
const opened = await makeWorld(opening(bytes, warnings));
assert.deepEqual(warnings, [], 'a file Bylonder wrote opens whole');
assert.deepEqual(opened.world.objects.map((n) => n.name).sort(), ['Camera', 'Cube', 'Light']);
for (const name of ['Cube', 'Light', 'Camera']) {
  const [a, b] = [object(saved.world, name), object(opened.world, name)];
  assert(close([...a.location], [...b.location]) && close([...a.rotation_euler], [...b.rotation_euler]) && close([...a.scale], [...b.scale]),
    `${name} opens where it was saved: ${[...b.location]} ${[...b.rotation_euler]}`);
}
const cube = opened.world.objects.find((n) => n.name === 'Cube');
assert.equal(objectMesh(cube).faces_num, 6, 'the geometry is Babylon\'s');
assert.deepEqual(modifierStack(cube).map((m) => [m.type, m.values.levels]), [['SUBSURF', 2]]);
assert(close(cube.material.albedoColor.asArray(), [0.8, 0.1, 0.1]) && Math.abs(cube.material.metallic - 0.3) < 1e-5, 'the material opens with its values');
assert.equal(opened.scene.activeCamera?.name, 'Camera');
opened.sync.flush();
assert.deepEqual(opened.sync.check(), [], 'Babylon and Main agree after opening');

// A file the reference Blender made.
const reference = (() => {
  if (process.env.BLENDER_REFERENCE) return join(process.env.BLENDER_REFERENCE, 'blender-5.2.3-linux-x64/blender');
  for (let dir = root; dir !== dirname(dir); dir = dirname(dir)) {
    const path = join(dir, '.blender-reference/blender-5.2.3-linux-x64/blender');
    if (existsSync(path)) return path;
  }
  return null;
})();
if (!reference) console.log('.blend: a file Bylonder wrote opens again (no reference Blender to make a user\'s file)');
else {
  const dir = mkdtempSync(join(tmpdir(), 'blend-read-'));
  try {
    const file = join(dir, 'user.blend');
    const run = (args) => execFileSync(reference, ['-b', '--factory-startup', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    run(['--python', join(root, 'tools/blender-reference/user-file.py'), '--', file]);
    const line = run([file, '--python', join(root, 'tools/blender-reference/blend-check.py')]).split('\n').find((l) => l.startsWith('BLEND-CHECK '));
    const expected = JSON.parse(line.slice('BLEND-CHECK '.length));
    const report = [];
    const user = await makeWorld(opening(readFileSync(file), report));
    assert.deepEqual(user.world.objects.map((n) => n.name).sort(), Object.keys(expected.objects).sort());
    for (const [name, ob] of Object.entries(expected.objects)) {
      const node = user.world.objects.find((n) => n.name === name), r = rna(user.world).pointer('Object', node);
      assert(close([...r.location], ob.location) && close([...r.scale], ob.scale), `${name} opens where Blender has it`);
      // The same rotation in Bylonder's rotation order.
      const matrix = (n) => n.computeWorldMatrix(true).getRotationMatrix().asArray();
      assert(node.computeWorldMatrix(true) && matrix(node).every(Number.isFinite));
      if (ob.data?.type === 'Mesh') assert.equal(objectMesh(node).faces_num, ob.data.faces, `${name}'s faces`);
      if (ob.type === 'MESH') assert.deepEqual(modifierStack(node).map((m) => m.type), ob.modifiers.map((m) => m.type), `${name}'s modifiers`);
      if (ob.type === 'LIGHT') assert(Math.abs(r.data.energy - ob.data.energy) < 1e-3, `${name}'s energy ${r.data.energy}`);
    }
    const red = user.world.objects.find((n) => n.name === 'Cube').material;
    assert(close(red.albedoColor.asArray(), [0.8, 0.05, 0.05]) && Math.abs(red.roughness - 0.3) < 1e-5, 'the Principled BSDF inputs');
    assert.deepEqual(user.world.collections.state.collections.map((c) => c.name).sort(), Object.keys(expected.collections).sort());
    assert.equal(user.scene.activeCamera?.name, expected.scene.camera);
    const keys = user.world.animation.serialize().action.tracks.find((t) => t.id === 'object:Cube' && t.path === 'position.y');
    assert.deepEqual(keys?.keys.map((k) => [k.frame, k.value]), [[1, 0], [40, 2]], 'the location keys, in Babylon\'s axes');
    user.sync.flush();
    assert.deepEqual(user.sync.check(), [], 'Babylon and Main agree after opening');
    console.log(`.blend: a file Bylonder wrote opens again; a user's file from Blender 5.2 opens with ${user.world.objects.length} objects` +
      (report.length ? `; reported: ${report.join('; ')}` : ''));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
