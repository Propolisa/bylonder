import assert from 'node:assert/strict';
import fs from 'node:fs';
import { NullEngine, Scene, MeshBuilder } from '@babylonjs/core';
import { createMesh } from '../src/blenkernel/mesh/mesh.js';
import { evaluateBlenderModifiers, modifierPanel } from '../src/modifiers/blender.js';
import { blenderModule } from '../src/bmesh/bmesh-wasm.js';
import { textureDefaults, textureValue, writeTexture, readTexture, textureSettings, texturePreview, moduleTexture } from '../src/blenkernel/texture/texture.js';
import { createTextures } from '../src/blenkernel/texture/textures.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';

// Blender's textures sampled and displacing by Blender's code in the module (BKE_texture_get_value, multitex, BLI noise),
// against Blender 5.2.3 (tools/blender-reference/texture-fixtures.py).
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/textures.json', import.meta.url)));
const { exports: x } = blenderModule;
const settings = (name) => ({ ...textureDefaults(), ...fixture.textures[name] });
const close = (a, b, tolerance) => a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= tolerance);

// Texture.evaluate gives multitex's RGB (zero for an intensity texture) and intensity; the module gives what a modifier
// reads (BKE_texture_get_value): the intensity, or the mean of a color texture's RGB, then RGBA.
const failed = [];
for (const [name, expected] of Object.entries(fixture.samples)) {
  const tex = x.texture_new() >>> 0;
  writeTexture(tex, settings(name));
  fixture.points.forEach((point, i) => {
    const [tin, r, g, b] = textureValue(tex, point), color = expected[i].slice(0, 3);
    const want = color.some(Boolean) ? [...color, (color[0] + color[1] + color[2]) / 3] : [r, g, b, expected[i][3]];
    if (!close([r, g, b, tin], want, 1e-5)) failed.push(`${name} at ${point}: Blender ${want}, Bylonder ${[r, g, b, tin]}`);
  });
  x.texture_free(tex);
}
assert.deepEqual(failed, [], 'Texture samples that differ from Blender');

// The settings round trip through the Tex's DNA, and a new texture has Blender's defaults.
const tex = x.texture_new() >>> 0;
writeTexture(tex, settings('clouds-perlin'));
const float = (values) => Object.fromEntries(Object.entries(values).map(([k, v]) => [k, typeof v === 'number' ? Math.fround(v) : v]));
assert.deepEqual(readTexture(tex), { ...readTexture(tex), ...float(fixture.textures['clouds-perlin']) });
x.texture_free(tex);
assert.equal(textureDefaults().type, 'IMAGE');
assert.deepEqual(textureSettings('CLOUDS').filter((s) => !textureSettings('NONE').includes(s)), ['noise_scale', 'noise_depth', 'noise_basis', 'noise_type', 'cloud_type', 'nabla']);

// Displace on Blender's UV sphere, after Subdivision Surface where a case has one: Blender's vertex positions.
const { sphere: base } = fixture;
const sphere = createMesh({ vert_positions: Float32Array.from(base.positions.flat()), edges: Int32Array.from(base.edges.flat()),
  face_offsets: Int32Array.from(base.face_offsets), corner_verts: Int32Array.from(base.corner_verts), corner_edges: Int32Array.from(base.corner_edges) });
// Blender numbers a subdivided mesh's edge vertices in the order its threads reach the edges, which differs from run to
// run, so after Subdivision Surface each of Blender's vertices is matched with the nearest of a different one of ours.
const distance = (a, b, i) => Math.hypot(a[0] - b[3 * i], a[1] - b[3 * i + 1], a[2] - b[3 * i + 2]);
function nearest(positions, got) {
  const used = new Set();
  return positions.reduce((max, p) => {
    let best = -1;
    for (let i = 0; i < got.length / 3; i++) if (!used.has(i) && (best < 0 || distance(p, got, i) < distance(p, got, best))) best = i;
    used.add(best);
    return Math.max(max, distance(p, got, best));
  }, 0);
}
const stacks = Object.entries(fixture.cases).map(([name, { stack, positions }]) => {
  const modifiers = stack.map(({ type, values, texture }) => ({ type, values, ...(texture && { texture: settings(texture) }) }));
  const mesh = evaluateBlenderModifiers(sphere, modifiers), got = Array.from(mesh.vert_positions);
  if (got.length !== positions.length * 3) return [name, Infinity];
  const worst = stack.some((m) => m.type === 'SUBSURF') ? nearest(positions, got) : Math.max(...positions.map((p, i) => distance(p, got, i)));
  return [name, worst];
});
const off = stacks.filter(([, worst]) => !(worst < 1e-4));
assert.deepEqual(off, [], 'Displaced positions that differ from Blender (largest difference)');
// Textures outside Main are freed once no modifier uses them.
evaluateBlenderModifiers(sphere, []);

// The Displace panel draws its texture's selector with Blender's New operator, and its coordinates active with one.
const find = (node, test) => (test(node) ? node : node.children.map((child) => find(child, test)).find(Boolean));
const panel = (texture) => modifierPanel({ type: 'DISPLACE', values: { texture: texture ? 'tex' : null } }, () => texture);
const template = find(panel(0), (n) => n.kind === 'template');
assert.deepEqual([template.text, template.prop, template.new], ['template_id', 'texture', 'texture.new']);
const coordinates = (texture) => find(panel(texture), (n) => n.kind === 'column' && n.children.some((c) => c.prop === 'texture_coords')).active;
const textures = createTextures({ objects: [] });
const lava = textures.create();
assert.equal(coordinates(0), false);
assert.equal(coordinates(moduleTexture(lava.values)), true);

// The textures slice: Blender's names, a setting as RNA writes it, undo restores it.
assert.equal(textures.create().name, 'Texture.001');
textures.set(lava, 'type', 'CLOUDS');
textures.set(lava, 'noise_depth', 4);
assert.deepEqual([lava.values.type, lava.values.noise_depth, lava.values.noise_scale], ['CLOUDS', 4, Math.fround(0.25)], 'a new type takes its DNA defaults');
const saved = textures.capture();
textures.set(lava, 'noise_depth', 1);
textures.apply(saved);
assert.equal(textures.byId(lava.id).values.noise_depth, 4);

// In the stack: a Displace modifier's texture displaces the object, and editing the texture evaluates it again.
const engine = new NullEngine(), scene = new Scene(engine), box = MeshBuilder.CreateBox('Cube', { size: 2 }, scene);
box.metadata = { wbId: 'cube', wbCreation: { operator: 'mesh.primitive_cube_add', options: {} } };
const objects = [box];
objects.scene = scene;
const world = { scene, objects, animation: createAnimationModel() };
world.textures = createTextures(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
const clouds = world.textures.create();
world.textures.set(clouds, 'type', 'CLOUDS');
const height = () => box.getVerticesData('position').reduce((sum, v) => sum + Math.abs(v), 0);
const displace = world.modifiers.add(box, 'DISPLACE', { strength: 0.5 });
const flat = height();
world.modifiers.set(box, displace.id, 'texture', clouds.id);
const clouded = height();
assert.notEqual(clouded, flat);
world.textures.set(clouds, 'noise_scale', 0.3);
assert.notEqual(height(), clouded);
assert.equal(world.textures.users(clouds), 1);
// Properties > Texture's preview samples the same Tex: the clouds' intensity as gray.
const pixels = texturePreview(settings('clouds'), 16);
assert.equal(pixels.length, 16 * 16 * 4);
const corner = x.texture_new() >>> 0;
writeTexture(corner, settings('clouds'));
assert.equal(pixels[0], Math.round(255 * textureValue(corner, [-15 / 16, 15 / 16, 0])[0]));
x.texture_free(corner);
assert.ok(new Set(pixels.filter((_, i) => i % 4 === 0)).size > 8, 'the preview shows the clouds');

console.log(`textures-wasm: ${Object.keys(fixture.samples).length} textures at ${fixture.points.length} points and ${stacks.length} displaced spheres match Blender`);
