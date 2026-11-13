// Collections in an exported package (docs/ir.md, Collections): the Geometry Nodes example with a nested pair of
// collections added in Main, one object linked to two of them. The IR holds the tree from the scene collection, its
// members, color tags, custom properties and view layer flags; the SDK lists them, gives what each holds, and shows and
// hides them as the outliner's eye does: an object shows while one of its collection paths shows.
import assert from 'node:assert/strict';
import { NullEngine } from '@babylonjs/core';
import { openExample } from './open-example.js';
import { exportModule } from '../src/io_scene_babylon/js-export.js';
import { writePackage } from './export-package.js';
import { gplFiles } from '../src/io_scene_babylon/runtime-files.js';
import { blendData, pointerOf } from '../src/python/bpy_rna.js';
import { setCustomProperty } from '../src/blenkernel/animation/anim-blender.js';

const { world, sync } = openExample('geometry-nodes');
const data = blendData(), scene = data.scenes[0];
const drawn = [...scene.collection.objects].filter((ob) => ob.type === 'MESH').map((ob) => ob.name);
const [first, second] = drawn, third = 'Guide';
const props = data.collections.new('Props'), lamps = data.collections.new('Lamps');
scene.collection.children.link(props);
props.children.link(lamps);
props.color_tag = 'COLOR_04';
setCustomProperty(pointerOf(props)[2], 'Weight', 2.5);
// The first only in Lamps; the second in the scene collection, Lamps and Props.
lamps.objects.link(data.objects.get(first));
scene.collection.objects.unlink(data.objects.get(first));
lamps.objects.link(data.objects.get(second));
props.objects.link(data.objects.get(second));
// A collection Blender's render leaves out, as rigs keep their viewport-only proxies.
const guides = data.collections.new('Guides');
scene.collection.children.link(guides);
guides.hide_render = true;
guides.objects.link(data.objects.new(third, data.objects.get(first).data));
// An object Blender's render leaves out by its own Disable in Renders, as Snow's overlay shells.
const shell = data.objects.new('Shell', data.objects.get(first).data);
scene.collection.objects.link(shell);
shell.hide_render = true;
sync.view();

const files = await exportModule(world);
// The control panel's Collections view draws Blender's icons, a unit; replaced, no GPL file ships for it.
assert.deepEqual(JSON.parse(files['units.json']).units['block:icons']?.files, ['bylonder-icons/icons.js']);
assert.ok(gplFiles(files).some(([path]) => path === 'bylonder-icons/icons.js'));
assert.ok(!gplFiles(await exportModule(world, { replace: ['block:icons'] })).some(([path]) => path.startsWith('bylonder-icons/')));
const written = writePackage(files);
const { loadBlendScene } = await import(new URL('bylonder/blend-scene.js', written.url).href);
const blend = await loadBlendScene(new NullEngine(), written.url);
const { ir } = blend;

assert.equal(ir.scene.collection, 'GR:Scene Collection');
assert.equal(ir.scene.view_layer, 'ViewLayer');
assert.deepEqual(blend.collections().map((c) => [c.name, c.depth]), [['Scene Collection', 0], ['Trees', 1], ['Props', 1], ['Lamps', 2], ['Guides', 1]], 'the tree in the outliner\'s order');
const byName = Object.fromEntries(blend.collections().map((c) => [c.name, c]));
assert.equal(byName.Props.color_tag, 'COLOR_04');
assert.deepEqual(byName.Props.custom, { Weight: 2.5 });
assert.deepEqual(byName.Props.children, ['GR:Lamps']);
assert.deepEqual(byName.Trees.view_layers.ViewLayer, { exclude: true, hide_viewport: false, holdout: false, indirect_only: false }, 'Trees is excluded, as the file has it');
assert.equal(byName.Trees.visible, false);
assert.deepEqual(blend.objectsIn('Props').sort(), [`OB:${first}`, `OB:${second}`].sort(), 'all_objects: its own and its children\'s');
assert.deepEqual(blend.objectsIn('Props', { recursive: false }), [`OB:${second}`]);
assert.deepEqual(blend.collectionsOf(second).sort(), ['GR:Lamps', 'GR:Props', 'GR:Scene Collection']);

const shown = (name) => blend.nodeOf(`OB:${name}`).isVisible;
assert.deepEqual([shown(first), shown(second)], [true, true]);
assert.equal(shown(third), false, 'an object only in a collection disabled in renders does not show, as in a render of Blender');
blend.set('collections["Guides"].hide_render', false);
assert.equal(shown(third), true, 'and shows once renders take it');
assert.equal(shown('Shell'), false, 'an object disabled in renders by its own flag does not show either');
blend.showCollection('Props', false);
assert.deepEqual([shown(first), shown(second)], [false, true], 'hiding Props hides what it holds, down its children; the second still shows from the scene collection');
assert.equal(blend.get('scenes["Scene"].view_layers["ViewLayer"].layer_collection.children["Props"].hide_viewport'), true, "the eye is the LayerCollection's Hide in Viewport, by RNA path");
assert.equal(blend.isCollectionVisible('Lamps'), false, 'a collection under a hidden one does not show');
blend.showCollection('Props');
assert.deepEqual([shown(first), shown(second)], [true, true]);
blend.set('collections["Lamps"].hide_render', true);
assert.equal(shown(first), false, 'Disable in Renders hides it too');
blend.set('collections["Lamps"].hide_render', false);
blend.set(`objects["${first}"].hide_viewport`, true);
assert.equal(shown(first), false, 'its own Hide in Viewport still hides it');
blend.set(`objects["${first}"].hide_viewport`, false);
blend.showCollection('Props', false, { children: true });
assert.deepEqual(blend.collections().filter((c) => c.depth).map((c) => [c.name, c.view_layers.ViewLayer.hide_viewport, c.visible]), [['Trees', false, false], ['Props', true, false], ['Lamps', true, false], ['Guides', false, true]], 'the list gives the flags as set');
assert.equal(blend.get('scenes["Scene"].view_layers["ViewLayer"].layer_collection.children["Props"].children["Lamps"].hide_viewport'), true, 'with children, as Shift does');
const trees = () => blend.objectsIn('Trees').map((k) => blend.nodeOf(k).isEnabled() && blend.nodeOf(k).isVisible);
assert.ok(trees().every((shown) => !shown), "an excluded collection's objects are exported hidden");
blend.set('scenes["Scene"].view_layers["ViewLayer"].layer_collection.children["Trees"].exclude', false);
blend.set('collections["Trees"].hide_render', false);
assert.ok(trees().every(Boolean), 'and show once it is included');
blend.dispose();
written.remove();
console.log(`collections: the IR holds ${Object.keys(ir.collections).length} collections from the scene collection; the SDK lists them, gives their objects and hides them as the outliner does; the panel's icons are a unit`);
