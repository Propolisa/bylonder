// The Properties editor drawn from Blender's own panels (src/bl_ui/properties_*.js): every tab of every object type
// Bylonder has draws its panels without errors over a NullEngine scene, each property a panel shows exists in Blender's
// RNA, and bound properties read and write through.
import assert from 'node:assert/strict';
import { NullEngine, Scene, Mesh, MeshBuilder, TransformNode, Vector3, PointLight, SpotLight, DirectionalLight, FreeCamera } from '@babylonjs/core';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { createSceneSettings } from '../src/blenkernel/scene/settings.js';
import { createRenderSettings } from '../src/blenkernel/scene/render.js';
import { createWorlds } from '../src/blenkernel/scene/world.js';
import { createCollections } from '../src/blenkernel/scene/collections.js';
import { createMaterialLibrary } from '../src/blenkernel/material/library.js';
import { createModifierSystem } from '../src/modifiers/stack.js';
import { createSelection } from '../src/editors/object/selection.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { loadRNAUI, rnaProperty, INFO } from '../src/makesrna/rna.js';
import { MODULES, panelTypes, drawPanels } from '../src/editors/interface/panels.js';
import { isLayout } from '../src/editors/interface/layout.js';
import { propertiesContext, propertiesTabs, TAB_CONTEXTS } from '../src/editors/space_buttons/buttons-context.js';
import { asObject } from '../src/runtime/object-transform.js';

await loadRNAUI();
const modules = await Promise.all(MODULES.map((name) => import(`../src/bl_ui/${name}.js`).catch(() => null)));
const types = panelTypes(modules, { space: 'PROPERTIES' });

const engine = new NullEngine(), scene = new Scene(engine);
const cube = MeshBuilder.CreateBox('Cube', { size: 2 }, scene), empty = new TransformNode('Empty', scene);
const point = new PointLight('Light', new Vector3(4, 6, 1), scene), spot = new SpotLight('Spot', Vector3.Zero(), new Vector3(0, -1, 0), Math.PI / 4, 2, scene);
const sun = new DirectionalLight('Sun', new Vector3(0, -1, 0), scene), camera = new FreeCamera('Camera', new Vector3(7.3589, 4.9583, -6.9258), scene);
// Blender's default camera, as the Default Cube example builds it.
camera.rotation = new Vector3((90 - 63.559) * Math.PI / 180, -46.692 * Math.PI / 180, 0);
[point, spot, sun, camera].forEach(asObject);
// A text object and a curve, as Bylonder's text tool and curve() make them.
const text = new Mesh('Text', scene), curve = new TransformNode('Curve', scene);
const objects = [cube, empty, point, spot, sun, camera, text, curve];
objects.forEach((ob, i) => { ob.metadata = { wbId: 'ob' + i }; });
text.metadata.wbCreation = { text: { text: 'Text', size: 1, depth: 0.2, align: 'center' } };
curve.metadata.wbCurve = [{ closed: false, points: [[0, 0, 0], [1, 0, 1]] }];
objects.scene = scene;
const world = { scene, objects, animation: createAnimationModel() };
world.sceneSettings = createSceneSettings(world);
world.renderSettings = createRenderSettings(world);
world.worlds = createWorlds(world);
world.collections = createCollections(world);
world.materials = createMaterialLibrary(world);
world.modifiers = createModifierSystem(world, { notify: (message) => { throw Error(message); } });
const selection = createSelection(scene, objects);
const updates = [];
const r = createRNA({ world, selection, update: (struct, name) => updates.push(`${struct}.${name}`) });

// Every node of a drawn panel, and the properties it shows that Blender's RNA lacks.
const walk = (node, visit) => { visit(node); if (isLayout(node)) node.children.forEach((child) => walk(child, visit)); };
const missing = new Set(), errors = [];
let drawn = 0;
const check = (panel) => {
  drawn++;
  if (panel.error) errors.push(`${panel.id}: ${panel.error.stack.split('\n').slice(0, 3).join(' | ')}`);
  for (const layout of [panel.header, panel.preset, panel.body].filter(Boolean)) walk(layout, (node) => {
    if (!['prop', 'prop_enum', 'prop_search', 'prop_menu_enum'].includes(node.kind) || !node.data) return;
    const struct = node.data[INFO]?.struct;
    if (struct && !rnaProperty(struct, node.property)) missing.add(`${panel.id}: ${struct}.${node.property}`);
  });
  panel.children.forEach(check);
};

const space = { context: 'OBJECT', pin: null, search: '', tabs: () => propertiesTabs(context, rnaProperty('SpaceProperties', 'context').items) };
let context;
const tabsOf = () => space.tabs().filter(Boolean).map(([id]) => id);
const drawn_tabs = {};
for (const ob of objects) {
  selection.replace([ob]);
  context = propertiesContext(r, space);
  const tabs = tabsOf();
  drawn_tabs[ob.name] = tabs;
  for (const tab of tabs) {
    space.context = tab;
    drawPanels(types, context, { contexts: [TAB_CONTEXTS[tab]] }).forEach(check);
  }
}
assert.deepEqual(errors, [], 'panels draw without errors');
assert.deepEqual([...missing], [], "every property a panel shows is Blender's");
assert.deepEqual(drawn_tabs.Cube, ['TOOL', 'RENDER', 'OUTPUT', 'VIEW_LAYER', 'SCENE', 'WORLD', 'OBJECT', 'MODIFIER', 'PARTICLES', 'PHYSICS', 'CONSTRAINT', 'DATA', 'MATERIAL']);
const panelsOf = (ob, tab) => { selection.replace([ob]); context = propertiesContext(r, space); space.context = tab; return drawPanels(types, context, { contexts: [TAB_CONTEXTS[tab]] }).map((p) => p.id); };
assert.deepEqual(drawn_tabs.Text, ['TOOL', 'RENDER', 'OUTPUT', 'VIEW_LAYER', 'SCENE', 'WORLD', 'OBJECT', 'MODIFIER', 'PHYSICS', 'CONSTRAINT', 'DATA', 'MATERIAL']);
assert.ok(['DATA_PT_font', 'DATA_PT_paragraph', 'DATA_PT_text_boxes', 'DATA_PT_geometry_curve'].every((id) => panelsOf(text, 'DATA').includes(id)), "a text object's data is Blender's Font panels");
assert.equal(context.curve.align_x, 'CENTER');
assert.equal(context.curve.extrude, 0.1);
assert.ok(panelsOf(curve, 'DATA').includes('DATA_PT_shape_curve'), "a curve's data is Blender's Curve panels");
assert.deepEqual(drawn_tabs.Light, ['TOOL', 'RENDER', 'OUTPUT', 'VIEW_LAYER', 'SCENE', 'WORLD', 'OBJECT', 'PHYSICS', 'CONSTRAINT', 'DATA']);

// Light and camera data read and write through in Blender's units.
selection.replace([point]);
context = propertiesContext(r, space);
assert.equal(context.light.type, 'POINT');
assert.equal(context.light.energy, 1000);
context.light.energy = 500;
assert.equal(point.intensity, 0.5);
selection.replace([camera]);
context = propertiesContext(r, space);
context.camera.lens = 50;
const degrees = (radians) => [...radians].map((r) => Math.round(r * 180 / Math.PI * 1000) / 1000 + 0);
assert.deepEqual(degrees(context.object.rotation_euler), [63.559, 0, 46.692], "a camera's rotation is Blender's");
assert.deepEqual([...context.object.location].map((v) => Math.round(v * 1e4) / 1e4), [7.3589, -6.9258, 4.9583]);
context.object.rotation_euler = [Math.PI / 2, 0, 0];
assert.deepEqual(degrees(context.object.rotation_euler), [90, 0, 0], 'and writes back');
assert.ok(Vector3.TransformNormal(new Vector3(0, 0, 1), camera.getWorldMatrix()).subtract(new Vector3(0, 0, 1)).length() < 1e-6, 'looking along Blender +Y, Babylon +Z');
assert.ok(Math.abs(context.camera.lens - 50) < 1e-9);
assert.ok(updates.includes('PointLight.energy') && updates.includes('Camera.lens'));

world.modifiers.dispose();
scene.dispose();
engine.dispose();
console.log(`Properties: ${drawn} of Blender's panels draw for ${objects.length} objects in every tab; light and camera data read and write through`);
