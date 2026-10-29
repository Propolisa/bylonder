// The scene sync (blenkernel/main-sync.js) and the view (main-view.js): Main owns the scene, Babylon draws it; what
// Bylonder's editors write on Babylon's objects reaches Main, what Blender's code changes and Blender's undo restores
// is drawn, through edits from both sides, undone and redone.
import assert from 'node:assert/strict';
import { NullEngine, Scene, MeshBuilder, TransformNode, Vector3, Quaternion, PointLight, SpotLight, FreeCamera, PBRMaterial, Color3 } from '@babylonjs/core';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
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
import { OPERATOR_FINISHED } from '../src/bmesh/bmesh-wasm.js';
import { dnaGet, dnaSet } from '../src/makesrna/dna-struct.js';
import { nodeId } from '../src/editors/object/identity.js';
import { asObject } from '../src/runtime/object-transform.js';
import { createHistory } from '../src/editors/undo/storage.js';
import '../src/editors/interface/region-draw.js';
import { OutlinerArea } from '../src/editors/space_outliner/outliner-area.js';
import { shaderNodeClasses } from '../src/nodes/blender/shader-nodes.js';
import { createTextures } from '../src/blenkernel/texture/textures.js';

const scene = new Scene(new NullEngine());
const objects = [];
objects.scene = scene;
const animation = createAnimationModel();
const world = { scene, objects, animation };
world.sceneSettings = createSceneSettings(world);
world.renderSettings = createRenderSettings(world);
world.collections = createCollections(world);
world.materials = createMaterialLibrary(world);
world.worlds = createWorlds(world);
world.textures = createTextures(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
const selection = createSelection(scene, objects);
const rna = createRNA({ world, selection });
const sync = createMainSync({ rna, ids: animation.ids });
sync.debug = true;

const cubeMesh = mesh_serialize(primitive_add('mesh.primitive_cube_add'));
const box = (name, position) => {
  const node = buildMesh(scene, name, { mesh: cubeMesh });
  node.metadata = { wbId: name.toLowerCase(), wbCreation: { mesh: cubeMesh } };
  node.position = new Vector3(...position);
  objects.push(node);
  return node;
};
const cube = box('Cube', [1, 2, 3]), other = box('Other', [-2, 0, 1]);
const empty = new TransformNode('Empty', scene);
empty.metadata = { wbId: 'empty' };
objects.push(empty);
const lamp = new PointLight('Lamp', new Vector3(4, 5, 6), scene);
lamp.metadata = { wbId: 'lamp' };
asObject(lamp);
objects.push(lamp);
const spot = new SpotLight('Spot', new Vector3(0, 3, 0), new Vector3(0, -1, 0), Math.PI / 3, 2, scene);
spot.metadata = { wbId: 'spot' };
asObject(spot);
objects.push(spot);
const camera = new FreeCamera('Camera', new Vector3(7, 3, -7), scene);
camera.metadata = { wbId: 'camera' };
asObject(camera);
objects.push(camera);
const material = new PBRMaterial('Red', scene);
Object.assign(material, { albedoColor: new Color3(0.8, 0.1, 0.1), metallic: 0.2, roughness: 0.4 });
material.metadata = { wbId: 'red' };
cube.material = material;
world.materials.sync();

const { blender } = sync;
const ob = (node) => sync.objectOf(node);
const location = (node) => dnaGet('Object', ob(node), 'location');
const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-5);

// Babylon to Main: everything goes in on the first flush, and a write reaches Main by its hook at the end of the task.
sync.flush();
assert.deepEqual(sync.check(), []);
assert.deepEqual(location(cube), [1, 3, 2], "Blender's axes: Babylon's (x, y, z) is Blender's (x, z, y)");
cube.position.x = 5;
await null;
assert.equal(location(cube)[0], 5, 'a write to a Babylon vector reaches Main at the end of the task');
lamp.intensity = 2;
await null;
assert(close([dnaGet('PointLight', blender.data(ob(lamp)), 'energy')], [8 * Math.PI]), "a Babylon light's intensity is Blender's watts as the glTF exporter converts them (W / 4π)");
material.albedoColor.g = 0.5;
sync.flush();
assert(close(dnaGet('Material', sync.materialOf(material), 'diffuse_color'), [0.8, 0.5, 0.1, 1]));
assert.equal(blender.materials(ob(cube))[0], sync.materialOf(material), "the cube's slot holds its material in Main");
// Materials are Principled BSDF node trees in Main, built from the same RNA the Properties editor draws.
const tree = blender.nodeTree(sync.materialOf(material));
assert.deepEqual(tree.nodes.map((node) => node.idname), ['ShaderNodeOutputMaterial', 'ShaderNodeBsdfPrincipled']);
assert.deepEqual(tree.links, [['Principled BSDF', 'BSDF', 'Material Output', 'Surface']]);
const principled = tree.nodes[1].inputs;
assert(close(principled['Base Color'], [0.8, 0.5, 0.1, 1]) && Math.abs(principled.Metallic - 0.2) < 1e-6 && Math.abs(principled.Roughness - 0.4) < 1e-6);
material.roughness = 0.9;
sync.flush();
assert(Math.abs(blender.nodeTree(sync.materialOf(material)).nodes[1].inputs.Roughness - 0.9) < 1e-6);
assert.deepEqual(blender.nodeTree(blender.world).nodes.map((node) => node.idname), ['ShaderNodeOutputWorld', 'ShaderNodeBackground'], "the scene's world is a Background");
assert.deepEqual(sync.check(), []);

// What only Babylon has is kept as custom properties where a round trip needs it.
assert.equal(blender.property(ob(cube), 'bylonder_id'), 'cube');
assert.equal(blender.property(sync.materialOf(material), 'bylonder_material'), 'pbr');

// Main owns the geometry of Bylonder's Mesh data.
assert.equal(blender.mesh(ob(cube)).verts_num, 8, "Main's Mesh holds the cube");

// Blender to Babylon: an operator's changes come back through the same mapping.
selection.replace([cube]);
const { status } = sync.run(() => blender.run('object.location_clear'), { meshes: [cube] });
assert.equal(status, OPERATOR_FINISHED);
assert.deepEqual(cube.position.asArray(), [0, 0, 0]);
selection.replace([cube, other]);
cube.scaling = new Vector3(2, 1, 1);
sync.run(() => blender.run('object.transform_apply', { location: false, rotation: false, scale: true }), { meshes: [cube, other] });
assert.deepEqual(cube.scaling.asArray(), [1, 1, 1]);
assert.equal(JSON.parse(JSON.stringify(cube.metadata.wbCreation.mesh)).vert_positions.some((v) => Math.abs(v) === 2), true, 'the applied scale is in the geometry');
assert.deepEqual(sync.check(), []);

// A sequence of edits from both sides, each an undo step, then undone and redone: after every one the models are equal
// (sync.debug checks after each flush and run, check() once more here).
const ID_GR = 0x5247;
const history = createHistory(objects, () => world.modifiers.refresh(), { main: sync, capture: () => world.collections.capture() ?? null, restore: (state) => world.collections.apply(state ?? undefined) });
// Blender's code changing Main as its operators and buttons do: by its API, and DNA without a recalc tag.
const blenderSide = (fn) => sync.run(fn);
const steps = [
  ['move and rotate', () => { cube.position.set(1, 1, 1); other.rotation.y = 0.5; }],
  ['quaternion rotation', () => { other.rotationQuaternion = Quaternion.FromEulerAngles(0.1, 0.2, 0.3); }],
  ['parent', () => { other.parent = cube; }],
  ['rename to a taken name', () => { empty.name = 'Cube'; }],
  ['hide in renders and viewport', () => { cube.metadata = { ...cube.metadata, wbHideRender: true }; empty.setEnabled(false); }],
  ['light and camera values', () => { spot.diffuse.set(0.2, 0.4, 0.6); spot.angle = 0.8; camera.fov = 0.6; camera.maxZ = 500; }],
  ['world color', () => world.worlds.set(world.worlds.active(), 'background.color', [0.1, 0.2, 0.3], false)],
  ['new collection', () => { world.collections.create({ name: 'Props', objects: [nodeId(lamp)], move: true }); }],
  ['exclude a collection', () => { world.collections.setLayer(world.collections.state.collections.at(-1).id, { exclude: true }); }],
  ['a modifier', () => { addModifier(other, 'SUBSURF', { levels: 2 }); world.modifiers.refresh(); sync.changed(); }],
  ['Blender: clear rotation', () => { selection.replace([other]); blenderSide(() => blender.run('object.rotation_clear')); }],
  ['Blender: rename, flags and a collection flag without tags', () => blenderSide(() => {
    blender.rename(ob(lamp), 'Lamp Renamed');
    dnaSet('Object', ob(spot), 'hide_select', true);
    dnaSet('Collection', blender.ids(ID_GR).find((c) => blender.name(c) === 'Props'), 'hide_render', true);
  })],
  ['Blender: select by base', () => blenderSide(() => { blender.setBase(ob(camera), { select: true, active: true }); blender.setBase(ob(other), { select: false }); }),
    () => assert.deepEqual(selection.nodes.map((node) => node.name), ['Camera'], "the base's selection comes back")],
  ['Blender: delete an object', () => blenderSide(() => blender.remove(ob(empty)))],
  ['Blender: apply scale with geometry', () => { cube.scaling.set(1, 3, 1); selection.replace([cube]); sync.run(() => blender.run('object.transform_apply', { location: false, rotation: false, scale: true }), { meshes: [cube] }); }],
  ['add an object', () => { box('Added', [0, 0, -4]); }],
  ['scene time', () => animation.time.configure({ frameCurrent: 42, frameEnd: 120, autoKey: true })],
  ['Blender: the frame and range', () => blenderSide(() => { dnaSet('Scene', blender.scene, 'frame_current', 7); dnaSet('Scene', blender.scene, 'frame_start', 3); }),
    () => assert.deepEqual([animation.time.frame, animation.time.state.frameStart], [7, 3], "Blender's frame and range come back")],
];
// What each step leaves, as the scene shows it: undo and redo must show the same.
const round = (values) => values.map((v) => Math.round(v * 1e4) / 1e4);
const shown = () => JSON.stringify({
  objects: objects.filter((node) => !node.metadata?.wbDeleted).map((node) => [node.name, node.parent?.name ?? null, round(node.position.asArray()),
    round((node.rotationQuaternion ?? node.rotation).asArray()), round(node.scaling.asArray()), node.isEnabled(false), !!node.metadata?.wbHideRender,
    node.getTotalVertices?.() ?? 0, round([node.getVerticesData?.("position")?.reduce((sum, v) => sum + Math.abs(v), 0) ?? 0])]),
  selected: selection.nodes.map((node) => node.name),
  spot: [round(spot.diffuse.asArray()), round([spot.angle, camera.fov, camera.maxZ])],
  collections: world.collections.state.collections.map((c) => [c.name, c.objects, !!c.hideRender]),
  time: [animation.time.frame, animation.time.state.frameStart, animation.time.state.frameEnd],
});
const states = [shown()];
for (const [name, edit, expect] of steps) {
  edit();
  sync.flush();
  assert.deepEqual(sync.check(), [], `after ${name}`);
  expect?.();
  history.commit();
  states.push(shown());
}
assert.equal(lamp.name, 'Lamp Renamed', "Blender's rename comes back");
assert.equal(spot.metadata.wbLocked, true, "Blender's hide_select comes back without a tag");
assert(world.collections.state.collections.at(-1).hideRender, "a collection's flag comes back");
assert(empty.metadata.wbDeleted, 'an object Blender deleted is deleted');
assert.deepEqual(other.rotationQuaternion.asArray().map(Math.abs), [0, 0, 0, 1], 'rotation_clear comes back');
assert.equal(dnaGet('Object', ob(other), 'rotation_mode'), 'QUATERNION');

// The Outliner's operators run on the same Main: a click selects, X deletes, and both come back.
{
  const area = new OutlinerArea(blender);
  area.resize(340, 600);
  sync.flush();
  const rowOf = (name) => { const row = area.draw().draw.find((c) => c.op === 'text' && c.text === name); return [row.at[0] + 5, row.at[1] + 4]; };
  area.run('outliner.item_activate', { deselect_all: true }, { type: 'LEFTMOUSE', value: 'CLICK', region: rowOf('Added'), modifier: 0 });
  sync.view();
  assert.deepEqual(selection.nodes.map((node) => node.name), ['Added'], 'an Outliner click selects');
  sync.flush();
  const event = (type, value, region) => ({ type, value, region, modifier: 0 });
  area.run('outliner.item_drag_drop', {}, event('LEFTMOUSE', 'CLICK_DRAG', rowOf('Added')));
  area.dragUpdate(event('MOUSEMOVE', 'NOTHING', rowOf('Scene Collection')));
  area.drop(event('LEFTMOUSE', 'RELEASE', rowOf('Scene Collection')));
  sync.view();
  assert(world.collections.state.scene.objects.includes('added'), 'dropping on the Scene Collection moves it there');
  sync.flush();
  // The Outliner redraws when the collections change, which writing back does.
  const unsubscribe = world.collections.subscribe(() => area.draw());
  area.run('outliner.delete', {});
  sync.view();
  assert(objects.find((node) => node.name === 'Added').metadata.wbDeleted, 'the Outliner deletes');
  assert.deepEqual(sync.check(), []);
  unsubscribe();
  area.cancel();
}

// The mesh an exporter writes: Blender's modifiers applied, from Main's stack.
assert.equal(sync.evaluatedMesh(other).faces_num, 6 * 16, 'Subdivision Surface at level 2');

// Writing back does not echo: the flush after it writes nothing more into Main.
const writes = sync.writes;
sync.flush();
assert.equal(sync.writes, writes, 'no echo into Main');

// Blender's undo: each step loads Main's state of that step and the view draws it (what the Outliner did after the
// last step was not one, and is undone with it).
for (let i = 0; i < steps.length; i++) {
  history.undo();
  sync.flush();
  assert.deepEqual(sync.check(), [], `after undoing ${steps.at(-1 - i)[0]}`);
  assert.equal(shown(), states.at(-2 - i), `undoing ${steps.at(-1 - i)[0]} shows the step before`);
}
for (const [i, [name]] of steps.entries()) {
  history.redo();
  sync.flush();
  assert.deepEqual(sync.check(), [], `after redoing ${name}`);
  assert.equal(shown(), states[i + 1], `redoing ${name} shows its step`);
}

// docs/lava-material.md: a node material's Blender nodes are its node tree in Main, with their values and links; a
// Displace modifier's texture is Main's Tex.
const lava = box('Lava', [0, 6, 0]);
const lavaMaterial = world.materials.newMaterial(lava, 0, 'node');
const noise = new shaderNodeClasses.ShaderNodeTexNoise();
noise.values.W = 1.3;
lavaMaterial.attachedBlocks.push(noise);
noise.getOutputByName('Fac').connectTo(lavaMaterial.attachedBlocks.find((b) => b.getClassName() === 'ShaderNodeBsdfPrincipled').getInputByName('Emission Strength'));
const clouds = world.textures.create();
world.textures.set(clouds, 'type', 'CLOUDS');
const displace = world.modifiers.add(lava, 'DISPLACE');
world.modifiers.set(lava, displace.id, 'texture', clouds.id);
sync.flush();
const lavaTree = blender.nodeTree(sync.materialOf(lavaMaterial));
assert.deepEqual(lavaTree.nodes.map((node) => node.idname).sort(), ['ShaderNodeBsdfPrincipled', 'ShaderNodeOutputMaterial', 'ShaderNodeTexNoise']);
assert.deepEqual(lavaTree.links.sort(), [['Noise Texture', 'Fac', 'Principled BSDF', 'Emission Strength'], ['Principled BSDF', 'BSDF', 'Material Output', 'Surface']]);
assert(Math.abs(lavaTree.nodes.find((node) => node.idname === 'ShaderNodeTexNoise').inputs.W - 1.3) < 1e-6);
assert.deepEqual(sync.check(), []);
// Main's Tex and the texture's record stay equal: an edit and its undo reach the Tex, and what Blender's code writes
// into the Tex comes back to the record, which project saves and undo carry.
const tex = sync.textureOf(clouds.id);
assert.equal(dnaGet('Texture', tex, 'type'), 'CLOUDS');
world.textures.set(clouds, 'noise_depth', 5);
const before = world.textures.capture();
world.textures.subscribe(() => sync.changed());
world.textures.set(clouds, 'noise_depth', 1);
await null;
assert.equal(dnaGet('CloudsTexture', tex, 'noise_depth'), 1, 'an edit reaches Main by the end of the task');
world.textures.apply(before);
await null;
assert.equal(dnaGet('CloudsTexture', tex, 'noise_depth'), 5);
dnaSet('CloudsTexture', tex, 'noise_depth', 3);
sync.view();
assert.equal(world.textures.byId(clouds.id).values.noise_depth, 3);
assert.deepEqual(sync.check(), []);

// Hooks keep a transform drag cheap: one changed object among many reaches Main without the others being read.
for (let i = 0; i < 300; i++) box('Many ' + i, [i, 0, 0]);
sync.flush();
const start = performance.now();
for (let i = 0; i < 100; i++) { cube.position.x = i; await null; }
const perEdit = (performance.now() - start) / 100;
assert.equal(location(cube)[0], 99);
assert(perEdit < 10, `an edit takes ${perEdit.toFixed(2)} ms to reach Main`);

console.log(`Scene sync: Babylon and Main stay equal through ${steps.length} edits from both sides, undone and redone; an edit reaches Main in ${perEdit.toFixed(2)} ms among ${objects.length} objects`);
