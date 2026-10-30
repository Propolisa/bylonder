// Saving a .blend (File > Save As): Blender's writer in the module writes Main, which the scene sync keeps equal to
// the Babylon scene, and the reference Blender reads it back (tools/blender-reference/blend-check.py) with the same
// objects, transforms, materials, modifiers and animation. Without the reference Blender, only the file is checked.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NullEngine, Scene, TransformNode, Vector3, PointLight, DirectionalLight, FreeCamera, PBRMaterial, Color3 } from '@babylonjs/core';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { registerObjects } from '../src/blenkernel/animation/bindings.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createCollections } from '../src/blenkernel/scene/collections.js';
import { createMaterialLibrary } from '../src/blenkernel/material/library.js';
import { createWorlds } from '../src/blenkernel/scene/world.js';
import { createModifierSystem, addModifier } from '../src/modifiers/stack.js';
import { createSelection } from '../src/editors/object/selection.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { buildMesh } from '../src/editors/object/mesh-catalog.js';
import { mesh_serialize } from '../src/blenkernel/mesh/mesh.js';
import { primitive_add } from '../src/editors/mesh/editmesh-add.js';
import { asObject } from '../src/runtime/object-transform.js';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

// The Default Cube's scene, with a material, a modifier, a parent, keys, a sun and a collection.
const scene = new Scene(new NullEngine());
const objects = [];
objects.scene = scene;
const animation = createAnimationModel();
const world = { scene, objects, animation };
let sceneCamera = null;
world.sceneSettings = createSceneSettings(world, { cameras: { list: () => objects.filter((n) => n instanceof FreeCamera), get: () => sceneCamera, set: (c) => { sceneCamera = c; } } });
world.renderSettings = createRenderSettings(world);
world.collections = createCollections(world);
world.materials = createMaterialLibrary(world);
world.worlds = createWorlds(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
const selection = createSelection(scene, objects);
const sync = createMainSync({ rna: createRNA({ world, selection }), ids: animation.ids });
sync.debug = true;

const cubeMesh = mesh_serialize(primitive_add('mesh.primitive_cube_add'));
const cube = buildMesh(scene, 'Cube', { mesh: cubeMesh });
cube.metadata = { wbId: 'cube', wbCreation: { mesh: cubeMesh } };
cube.position = new Vector3(1, 2, 3);
cube.rotation = new Vector3(0.1, 0.2, 0.3);
const pivot = new TransformNode('Pivot', scene);
pivot.metadata = { wbId: 'pivot' };
pivot.position = new Vector3(0, 1, 0);
cube.parent = pivot;
const light = new PointLight('Light', new Vector3(4, 6, 1), scene);
light.metadata = { wbId: 'light' };
light.intensity = 1;
asObject(light);
const sun = new DirectionalLight('Sun', new Vector3(-1, -2, 1), scene);
sun.metadata = { wbId: 'sun' };
sun.intensity = 2;
asObject(sun);
const camera = new FreeCamera('Camera', new Vector3(7, 5, -7), scene);
camera.metadata = { wbId: 'camera' };
camera.setTarget(new Vector3(2, 3, 3));
asObject(camera);
objects.push(pivot, cube, light, sun, camera);
const material = new PBRMaterial('Red', scene);
Object.assign(material, { albedoColor: new Color3(0.8, 0.1, 0.1), metallic: 0.3, roughness: 0.6 });
material.metadata = { wbId: 'red' };
cube.material = material;
world.materials.sync();
addModifier(cube, 'SUBSURF', { levels: 2 });
const row = buildMesh(scene, 'Row', { mesh: cubeMesh });
row.metadata = { wbId: 'row', wbCreation: { mesh: cubeMesh } };
row.position = new Vector3(-4, 0, 0);
objects.push(row);
addModifier(row, 'ARRAY', { count: 3, 'relative_offset_displace[0]': 1.5 });
sceneCamera = camera;
registerObjects(animation, objects);
animation.insert([animation.ref('object:cube', 'position.x')], 1);
cube.position.x = 3;
animation.insert([animation.ref('object:cube', 'position.x')], 20);
world.collections.adopt();
world.collections.create({ name: 'Props', objects: ['cube'], move: true });

const bytes = sync.writeBlend('/test.blend');
// Blender 5.x's header: BLENDER, the header size, the pointer size ('_' for 4 bytes, the module's), the format version
// and Blender's file version.
const header = new TextDecoder().decode(bytes.subarray(0, 17));
assert.match(header, /^BLENDER/, `a .blend header (${header})`);
assert(bytes.length > 10000, `${bytes.length} bytes`);

// The reference Blender, by the repository's checkout (worktrees are inside it).
const reference = (() => {
  if (process.env.BLENDER_REFERENCE) return join(process.env.BLENDER_REFERENCE, 'blender-5.2.3-linux-x64/blender');
  for (let dir = root; dir !== dirname(dir); dir = dirname(dir)) {
    const path = join(dir, '.blender-reference/blender-5.2.3-linux-x64/blender');
    if (existsSync(path)) return path;
  }
  return null;
})();
if (!reference) {
  console.log(`.blend: Blender's writer wrote ${bytes.length} bytes (no reference Blender to read them)`);
} else {
  const dir = mkdtempSync(join(tmpdir(), 'blend-write-'));
  try {
    const file = join(dir, 'test.blend');
    writeFileSync(file, bytes);
    // Blender reads it and renders it with Cycles, small and with few samples.
    const out = execFileSync(reference, ['-b', '--factory-startup', file, '--python', join(root, 'tools/blender-reference/blend-check.py'), '--',
      join(dir, 'render.png'), 'CYCLES', '4', '5'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    const line = out.split('\n').find((l) => l.startsWith('BLEND-CHECK '));
    assert(line, `Blender read the file:\n${out.slice(-2000)}`);
    const read = JSON.parse(line.slice('BLEND-CHECK '.length));
    const close = (a, b, tolerance = 1e-4) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) < tolerance);
    const ob = read.objects;
    assert.deepEqual(Object.keys(ob).sort(), ['Camera', 'Cube', 'Light', 'Pivot', 'Row', 'Sun']);
    assert.deepEqual(ob.Row.modifiers.map((m) => [m.type, m.count, m.relative_offset_displace]), [['ARRAY', 3, [1.5, 0, 0]]], 'Blender\'s Array');
    // At frame 1, where Blender evaluates the location F-Curve to x = 1.
    assert(close(ob.Cube.location, [1, 3, 2]) && ob.Cube.parent === 'Pivot', `Cube in Blender's axes: ${JSON.stringify(ob.Cube)}`);
    assert.equal(ob.Cube.rotation_mode, 'YXZ');
    assert(close(ob.Cube.rotation, [-0.1, -0.3, -0.2]));
    assert.deepEqual([ob.Cube.data.verts, ob.Cube.data.faces], [8, 6], 'the geometry, filled as Main was written');
    assert.deepEqual(ob.Cube.modifiers.map((m) => [m.type, m.levels]), [['SUBSURF', 2]]);
    assert.deepEqual(ob.Cube.materials, ['Red']);
    assert.equal(ob.Cube.bylonder_id, 'cube');
    const principled = read.materials.Red.tree.nodes['Principled BSDF'];
    assert(close(principled.inputs['Base Color'], [0.8, 0.1, 0.1, 1]) && Math.abs(principled.inputs.Metallic - 0.3) < 1e-5, JSON.stringify(principled));
    assert.equal(ob.Light.data.light, 'POINT');
    assert(Math.abs(ob.Light.data.energy - 4 * Math.PI) < 1e-3, 'Babylon intensity 1 as Blender\'s glTF importer reads it (Unitless: 4π W)');
    assert.equal(ob.Camera.data.camera, 'PERSP');
    assert.equal(ob.Sun.data.light, 'SUN');
    assert.deepEqual(read.collections.Props, ['Cube']);
    // The camera looks at the cube: the middle of the render is not the world's color, which fills the corners.
    const render = JSON.parse(out.split('\n').find((l) => l.startsWith('BLEND-RENDER ')).slice('BLEND-RENDER '.length));
    assert(render.middle.some((v, i) => Math.abs(v - render.corners[i]) > 0.05), `the render shows the scene: ${JSON.stringify(render)}`);
    const keys = ob.Cube.animation?.fcurves.find((f) => f.path === 'location' && f.index === 0)?.keys;
    assert(keys && close(keys.flat(), [1, 1, 20, 3]), `location keys: ${JSON.stringify(ob.Cube.animation)}`);
    assert.equal(read.world?.tree.nodes.Background.type, 'ShaderNodeBackground');
    assert.equal(read.scene.camera, 'Camera');
    console.log(`.blend: Blender's writer wrote ${bytes.length} bytes; Blender 5.2 reads its objects, transforms, materials, modifiers, keys and collections and renders it`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
