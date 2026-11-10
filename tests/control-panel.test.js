// An exported page's control panel (src/io_scene_babylon/runtime/control-panel*.js): its layout of a scene's controls
// (custom properties first, then materials, the author's named ones first, then the rest; vectors as one row; widgets by
// subtype), what it hides at Blender's defaults, values shown and typed in Blender's units, drag and snap steps, each
// material's colour as seen, the theme it copies from the app, a package ships it only when scene.js imports it, and
// what it weighs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { atDefault, baseColor, clamp, dragScale, formatValue, hexOf, layout, matches, parsePath, parseValue, rgbOf, seen, snapped, snapStep } from '../src/io_scene_babylon/runtime/control-panel-model.js';
import { TOKENS } from '../src/io_scene_babylon/runtime/control-panel.js';
import { PANEL_FILES, packageRuntime } from '../src/io_scene_babylon/runtime-files.js';

const runtime = (name) => readFileSync(new URL(`../src/io_scene_babylon/runtime/${name}`, import.meta.url), 'utf8');

// Paths: the ID, the struct within it and the property, a custom property's key, a vector's index.
assert.deepEqual(parsePath('objects["Cube"].location[2]'), { collection: 'objects', name: 'Cube', idPath: 'objects["Cube"]', struct: '', structName: undefined, structKind: undefined, property: 'location', custom: false, index: 2 });
assert.deepEqual(parsePath('objects["Cube"]["Glow"]'), { collection: 'objects', name: 'Cube', idPath: 'objects["Cube"]', struct: '', structName: undefined, structKind: undefined, property: 'Glow', custom: true, index: undefined });
const socket = parsePath('materials["Lava"].node_tree.nodes["Noise \\"A\\""].inputs[2].default_value');
assert.deepEqual([socket.structName, socket.structKind, socket.property, socket.index], ['Noise "A"', 'nodes', 'default_value', undefined], "a node's input, its name unquoted");
assert.equal(parsePath('objects["Rig"].pose.bones["Arm"].rotation_quaternion[0]').structKind, 'bones');

const f = (path, value, more = {}) => ({ path, type: typeof value === 'boolean' ? 'BOOLEAN' : typeof value === 'string' ? 'STRING' : 'FLOAT', default: value, ...more });
const controls = [
  f('objects["Cube"].location[0]', 0, { name: 'Location', subtype: 'TRANSLATION', unit: 'LENGTH', blender_default: 0 }),
  f('objects["Cube"].location[1]', 2, { name: 'Location', subtype: 'TRANSLATION', unit: 'LENGTH', blender_default: 0 }),
  f('objects["Cube"].location[2]', 0, { name: 'Location', subtype: 'TRANSLATION', unit: 'LENGTH', blender_default: 0 }),
  f('objects["Cube"].hide_render', false, { name: 'Disable in Renders', blender_default: false }),
  f('materials["Material.001"].node_tree.nodes["Principled BSDF"].inputs[2].default_value', 0.5, { name: 'Roughness', subtype: 'FACTOR', soft_min: 0, soft_max: 1, blender_default: 0.5 }),
  ...[0.8, 0.1, 0.1, 1].map((v, i) => f(`materials["Brick"].node_tree.nodes["Principled BSDF"].inputs[0].default_value[${i}]`, v, { name: 'Base Color', subtype: 'COLOR', blender_default: 0.8 })),
  f('materials["Brick"].node_tree.nodes["Image Texture"].image', 'images/brick.png', { name: 'Image' }),
  f('materials["Brick"].node_tree.nodes["Image Texture 2"].image', 'images/moss.png', { name: 'Image' }),
  f('objects["Cube"]["Glow"]', 0.75, { name: 'Glow', suggested: true }),
  f('scenes["Scene"].frame_current', 1, { type: 'INT', name: 'Current Frame', blender_default: 1 }),
  f('lights["Lamp"].energy', 1000, { name: 'Power', unit: 'POWER', blender_default: 10 }),
];
const sections = layout(controls, (c) => c.path.endsWith('.image'));
assert.deepEqual(sections.map((s) => s.title), ['Custom Properties', 'Materials', 'Objects', 'Lights', 'Scene'], 'custom properties, materials, then the rest');
assert.deepEqual(sections[1].groups.map((g) => g.title), ['Brick', 'Material.001'], "the author's named materials before Blender's");
const [location, hide] = sections[2].groups[0].rows;
assert.deepEqual([location.label, location.controls.length, location.widget], ['Location', 3, 'number'], 'a vector is one row');
assert.equal(hide.widget, 'check');
const brick = sections[1].groups[0];
assert.deepEqual(brick.groups.map((g) => g.title), ['Principled BSDF', 'Image Texture', 'Image Texture 2'], "a material's rows by node");
assert.equal(brick.groups[0].rows[0].widget, 'color');
assert.deepEqual(brick.groups[1].rows[0].items, ['images/brick.png', 'images/moss.png'], "an image is a choice of the package's images");
assert.equal(sections[1].groups[1].groups[0].rows[0].widget, 'slider', 'a factor is a slider');
assert.equal(sections[0].groups[0].rows[0].label, 'Glow');

// Hidden at Blender's defaults: every component at it; a custom property, whose default is not known, never is.
const at = (path) => controls.find((c) => c.path === path).default;
assert.equal(atDefault(location, at), false, 'a location away from the origin shows');
assert.equal(atDefault(hide, at), true);
assert.equal(atDefault(sections[0].groups[0].rows[0], at), false);
assert.equal(matches(location, ['Objects', 'Cube'], 'cube loc'), true, 'search words match labels, titles and paths');
assert.equal(matches(location, ['Objects', 'Cube'], 'rough'), false);

// Values in Blender's units, typed with units and arithmetic.
const rotation = { path: 'r', type: 'FLOAT', default: 0, subtype: 'EULER', unit: 'ROTATION' }, length = { path: 'l', type: 'FLOAT', default: 0, unit: 'LENGTH', precision: 5 };
assert.equal(formatValue(Math.PI / 2, rotation), '90°');
assert.equal(formatValue(1.2000000476837158, length), '1.2 m');
assert.equal(formatValue(5, { path: 's', type: 'FLOAT', default: 5 }), '5.000');
assert.equal(formatValue(1000, { path: 'p', type: 'FLOAT', default: 0, unit: 'POWER' }), '1000 W');
assert.equal(parseValue('90', rotation), Math.PI / 2, 'a rotation is typed in degrees');
assert.equal(parseValue('1 rad', rotation), 1);
assert.equal(parseValue('20cm + 1', length), 1.2);
assert.equal(parseValue('(2 + 3) * 2 ^ 2', { path: 'x', type: 'FLOAT', default: 0 }), 20);
assert.equal(parseValue('2 +', length), null, 'what does not read is null');
assert.equal(parseValue('1.6', { path: 'f', type: 'FLOAT', default: 0, hard_min: 0, hard_max: 1 }), 1, 'clamped to the hard range');
assert.equal(clamp(2.6, { path: 'i', type: 'INT', default: 0 }), 3);

// Drag and snap: a factor's span over a field's travel, Ctrl snapping to tenths (hundredths with Shift), 5 degrees.
const factor = { path: 'f', type: 'FLOAT', default: 0, subtype: 'FACTOR', soft_min: 0, soft_max: 1 };
assert.ok(Math.abs(dragScale(factor) - 1 / 300) < 1e-12);
assert.equal(snapStep(factor, false), 0.1);
assert.equal(snapStep(factor, true), 0.01);
assert.equal(snapped(0.4567, 0.1), 0.5);
assert.ok(Math.abs(snapStep(rotation, false) - Math.PI / 36) < 1e-12);
assert.equal(snapStep({ path: 'l', type: 'FLOAT', default: 0, unit: 'LENGTH', step: 1 }, false), 1, 'a length snaps to meters');

// Colors: linear in Blender, display encoded in a swatch.
assert.equal(hexOf([1, 0.2158605, 0], false), '#ff8000');
assert.deepEqual(rgbOf('#ff8000', true).map((v) => v.toFixed(3)), ['1.000', '0.502', '0.000']);

// Each material's icon: the colour it shows on screen, averaged as light mixes, from the coverage pass's ids and the
// frame read at the same size; where it is not seen, its Base Color (or Color), else the plain icon.
const ids = [1, 0, 0, 255, 1, 0, 0, 255, 2, 0, 0, 255, 0, 0, 0, 0], shown = [0, 0, 0, 255, 255, 255, 255, 255, 255, 128, 0, 255, 9, 9, 9, 255];
assert.deepEqual(seen(ids, shown), new Map([[1, { share: 0.5, colour: 'rgb(188 188 188)' }], [2, { share: 0.25, colour: 'rgb(255 128 0)' }]]), 'black and white seen as half light, not mid grey');
assert.equal(baseColor(brick)?.label, 'Base Color');
assert.equal(baseColor(sections[1].groups[1]), undefined, 'a material without a color keeps the plain icon');

// The theme the panel draws with is the app's (src/theme.css).
const theme = Object.fromEntries([...readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8').matchAll(/(--bl-[\w-]+):([^;}]+)/g)].map(([, name, value]) => [name, value.trim()]));
for (const [, name, value] of TOKENS.matchAll(/(--bl-[\w-]+):([^;]+)/g)) assert.equal(value.trim(), theme[name], `${name} is the app's`);

// A package ships the panel only when its scene.js imports it.
const shipped = (scene) => packageRuntime({ 'scene.js': scene }).map(([path]) => path);
assert.ok(PANEL_FILES.every((name) => shipped("import { controlPanel } from './bylonder/control-panel.js';").includes(`bylonder/${name}`)));
assert.ok(!shipped('').some((path) => path.includes('control-panel')));

// What a page loads: the button at once, the panel when first opened; both small.
const kb = (...names) => gzipSync(names.map(runtime).join('')).length / 1024;
assert.ok(kb('control-panel.js') < 3, `the button: ${kb('control-panel.js').toFixed(1)} KB gzipped`);
assert.ok(kb('control-panel-ui.js', 'control-panel-model.js') < 20, `the panel: ${kb('control-panel-ui.js', 'control-panel-model.js').toFixed(1)} KB gzipped`);
console.log(`control panel: layout, defaults, units, drag steps, material colours, theme and shipping ok; ${kb('control-panel.js').toFixed(1)} KB, then ${kb('control-panel-ui.js', 'control-panel-model.js').toFixed(1)} KB gzipped`);
