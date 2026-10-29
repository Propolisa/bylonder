// The Node Editor behaves as Blender's: Blender's Add menu adds Blender's and Babylon's nodes, links drag between
// sockets of both, Ctrl right-drag cuts links, and Blender's Node Editor keymap runs M, H, X, Ctrl J and A.
import assert from 'node:assert/strict';
import { NullEngine, Scene, NodeMaterial, ArcRotateCamera, Vector3 } from '@babylonjs/core';
import { createNodeTree } from '../src/editors/space_node/node-tree.js';
import { createNodeEditorController } from '../src/editors/space_node/node-editor-controller.js';
import { addMenuEntries, addMenuItems } from '../src/editors/space_node/node-add-menu.js';
const subitems = (item) => item.items();
import { keymapHandler } from '../src/windowmanager/keyconfig.js';
import { inArea } from '../src/windowmanager/wm-operators.js';
import { blenderDefaultTree, buildMaterial } from '../src/nodes/blender/shader-nodes.js';
import { addElement, removeElement, setElementPosition } from '../src/blenkernel/colorband.js';

const engine = new NullEngine(), scene = new Scene(engine);
new ArcRotateCamera('Camera', 0, 1, 5, Vector3.Zero(), scene);
const material = new NodeMaterial('Material', scene);
material.setToDefault();
material.build();
let rebuilds = 0;
const tree = createNodeTree(material, { changed: (rebuild) => { rebuilds += rebuild; } });
const editor = createNodeEditorController(tree, { viewport: () => ({ width: 1000, height: 600 }) });
const screen = (p) => { const [x, y] = Array.isArray(p) ? p : [p.x, p.y]; return [x * editor.state.view.zoom + editor.state.view.x, y * editor.state.view.zoom + editor.state.view.y]; };
const click = (at, e = {}) => { editor.pointerDown(at, { button: 0, ...e }); editor.pointerUp(at, { button: 0, ...e }); };
const drag = (from, to, e = {}) => { editor.pointerDown(from, { button: 0, ...e }); editor.pointerMove([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]); editor.pointerMove(to); editor.pointerUp(to, { button: 0, ...e }); };
const socketOf = (block, side, name) => editor.layouts().find((l) => l.node.block === block).sockets.find((s) => s.side === side && s.socket.point.name === name);

// Blender's Add menu: Blender's categories, the nodes Bylonder runs enabled, Babylon's blocks in a Babylon sub-menu.
const menu = addMenuItems(editor);
assert.deepEqual(menu.filter((i) => i !== '-').map((i) => i.label), ['Search...', 'Input', 'Output', 'Shader', 'Displacement', 'Color', 'Texture', 'Utilities', 'Group', 'Layout']);
const mathMenu = subitems(subitems(menu.find((i) => i.label === 'Utilities')).find((i) => i.label === 'Math'));
assert.ok(mathMenu.find((i) => i.label === 'Math').enabled(), 'Math is added by Blender\'s menu entry');
assert.ok(!mathMenu.find((i) => i.label === 'Map Range').enabled(), 'a node Bylonder does not run is shown greyed out');
assert.ok(subitems(mathMenu.find((i) => i.label === 'Babylon')).some((i) => i.label === 'Cos'), 'Babylon blocks are in a Babylon sub-menu');
const search = addMenuEntries(editor);
const multiply = search.find((e) => e.item.label === 'Math ▸ Multiply');
assert.deepEqual(multiply.path, ['Utilities', 'Math'], 'searching lists the operations Blender\'s menus add in search');

// Added from the menu, a node follows the pointer until a click confirms it, with the entry's settings.
editor.state.pointer = [500, 300];
multiply.item.run();
assert.equal(editor.state.modal.type, 'move');
editor.pointerMove([540, 300]);
click([540, 300]);
const math = tree.blocks().find((b) => b.getClassName() === 'ShaderNodeMath');
assert.equal(math.properties.operation, 'MULTIPLY');
assert.deepEqual([math.values.Value, math.values.Value_001], [1, 1], 'Math Multiply comes with factors of 1, as set_math_node_default_props sets them');
editor.state.pointer = [500, 450];
editor.add('ShaderNodeMix', { data_type: 'RGBA', blend_type: 'MULTIPLY' });
click([500, 450]);
const mix = tree.blocks().find((b) => b.getClassName() === 'ShaderNodeMix');
assert.ok(editor.state.selected.has(mix.uniqueId) && editor.state.active === mix.uniqueId);

// Dragging from Math's output to Mix links it to the nearest socket it can take; from Babylon's color into Mix too.
drag(screen(socketOf(math, 'out', 'Value')), screen(socketOf(mix, 'in', 'Factor_Float')));
assert.equal(mix.getInputByName('Factor_Float').connectedPoint, math.getOutputByName('Value'));
const color = tree.blocks().find((b) => b.name === 'color'), output = tree.blocks().find((b) => b.getClassName() === 'FragmentOutputBlock');
drag(screen(socketOf(color, 'out', 'output')), screen(socketOf(mix, 'in', 'A_Color')));
drag(screen(socketOf(mix, 'out', 'Result_Color')), screen(socketOf(output, 'in', 'rgba')));
assert.equal(output.rgba.connectedPoint.ownerBlock, mix, 'a Blender node feeds a Babylon block');
assert.equal(mix.getInputByName('A_Color').connectedPoint.ownerBlock, color);
material.build();
assert.match(material._fragmentCompilationState._builtCompilationString, /bl_node_mix_mult\(/);

// Dragging a linked input picks its link up; dropped on empty space, the link is gone.
const empty = [980, 20];
drag(screen(socketOf(mix, 'in', 'Factor_Float')), empty);
assert.equal(mix.getInputByName('Factor_Float').connectedPoint, null);
drag(screen(socketOf(math, 'out', 'Value')), screen(socketOf(mix, 'in', 'Factor_Float')));

// Ctrl right-drag across a link cuts it (node.links_cut).
const a = socketOf(math, 'out', 'Value'), b = socketOf(mix, 'in', 'Factor_Float'), middle = screen([(a.x + b.x) / 2, (a.y + b.y) / 2]);
editor.pointerDown([middle[0], middle[1] - 40], { button: 2, ctrlKey: true });
editor.pointerMove([middle[0], middle[1]]);
editor.pointerMove([middle[0], middle[1] + 40]);
editor.pointerUp([middle[0], middle[1] + 40], { button: 2 });
assert.equal(mix.getInputByName('Factor_Float').connectedPoint, null, 'the cut link is removed');

// Blender's Node Editor keymap: M mutes, H collapses, Ctrl J frames, A selects all, X deletes.
const keys = keymapHandler(['Node Editor']), area = { nodeEditor: editor, menu: () => null };
const press = (type, mods = {}) => inArea(area, () => keys({ type, value: 'PRESS', shift: false, ctrl: false, alt: false, ...mods }));
editor.selectAll('DESELECT');
click(screen([tree.location(mix).x + 20, tree.location(mix).y + 10]));
assert.ok(press('m') && mix.mute, 'M mutes');
assert.ok(press('h') && tree.node(mix).hidden, 'H collapses');
assert.ok(press('a') && editor.state.selected.size === tree.blocks().length, 'A selects all');
press('a', { alt: true });
editor.state.selected.add(math.uniqueId);
editor.state.selected.add(mix.uniqueId);
assert.ok(press('j', { ctrl: true }) && tree.frames().some((f) => f.blocks.includes(math.uniqueId) && f.blocks.includes(mix.uniqueId)), 'Ctrl J frames the selection');
assert.ok(press('x') && !tree.blocks().includes(mix) && !tree.blocks().includes(math), 'X deletes');
assert.ok(rebuilds > 0);

// Box select: a drag on empty space selects the nodes it touches.
const fragment = editor.layouts().find((l) => l.node.block === output);
drag(screen([fragment.node.x - 10, fragment.node.y - 10]), screen([fragment.node.x + 30, fragment.node.y + 30]));
assert.deepEqual([...editor.state.selected], [output.uniqueId]);

// The lava material (docs/lava-material.md): Blender's new material, then nodes added from the Add menu's entries and
// linked by dragging between sockets. Bylonder's helper blocks (geometry inputs, Babylon's outputs) are not drawn.
const lava = new NodeMaterial('Lava', scene);
blenderDefaultTree(lava);
lava.build();
let built = 0;
lava.onBuildObservable.add(() => built++);
const lavaTree = createNodeTree(lava, { changed: (rebuild) => { if (rebuild) buildMaterial(lava); } });
const lavaEditor = createNodeEditorController(lavaTree, { viewport: () => ({ width: 1600, height: 900 }) });
const lavaScreen = (p) => [p.x * lavaEditor.state.view.zoom + lavaEditor.state.view.x, p.y * lavaEditor.state.view.zoom + lavaEditor.state.view.y];
const entries = addMenuEntries(lavaEditor);
const entry = (label) => entries.find((e) => e.item.label === label);
for (const label of ['Texture Coordinate', 'Noise Texture', 'Color Ramp', 'Bump', 'Principled BSDF', 'Emission', 'Material Output']) assert.ok(entry(label)?.item.enabled(), `${label} is added from the Add menu`);
const place = (label, at) => {
  const before = new Set(lavaTree.blocks());
  lavaEditor.state.pointer = at;
  entry(label).item.run();
  lavaEditor.pointerDown(at, { button: 0 });
  lavaEditor.pointerUp(at, { button: 0 });
  return lavaTree.blocks().find((b) => !before.has(b));
};
const coord = place('Texture Coordinate', [100, 100]), noise = place('Noise Texture', [400, 100]), ramp = place('Color Ramp', [700, 100]);
const detail = place('Noise Texture', [400, 600]), bump = place('Bump', [700, 600]);
const principled = lavaTree.blocks().find((b) => b.getClassName() === 'ShaderNodeBsdfPrincipled');
const lavaSocket = (block, side, name) => lavaEditor.layouts().find((l) => l.node.block === block).sockets.find((s) => s.side === side && s.socket.point.name === name);
const connect = (source, output, target, input) => {
  const a = lavaSocket(source, "out", output), b = lavaSocket(target, "in", input);
  const [from, to] = [lavaScreen(a), lavaScreen(b)];
  lavaEditor.pointerDown(from, { button: 0 });
  lavaEditor.pointerMove([(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]);
  lavaEditor.pointerMove(to);
  lavaEditor.pointerUp(to, { button: 0 });
  assert.equal(target.getInputByName(input).connectedPoint, source.getOutputByName(output), `${output} into ${input}`);
};
noise.properties.noise_dimensions = detail.properties.noise_dimensions = '4D';
lavaTree.moved();
connect(coord, 'Object', noise, 'Vector');
connect(coord, 'Object', detail, 'Vector');
connect(noise, 'Fac', ramp, 'Fac');
connect(ramp, 'Color', principled, 'Emission Color');
connect(noise, 'Fac', principled, 'Emission Strength');
connect(detail, 'Fac', bump, 'Height');
connect(bump, 'Normal', principled, 'Normal');
assert.ok(lavaTree.blocks().every((b) => !b.name.startsWith('blender:') && !b.isAttribute), 'helper blocks are not drawn');
assert.equal(lavaTree.links().length, 8);
// The ramp's stops, edited as its template edits them.
const band = ramp.properties.color_ramp;
addElement(band);
assert.deepEqual(band.elements.map((e) => e.position), [0, 0.5, 1]);
setElementPosition(band, 1, 0.8);
assert.deepEqual([band.elements.map((e) => e.position), band.cur], [[0, 0.8, 1], 1]);
removeElement(band);
assert.equal(band.elements.length, 2);
assert.ok(lavaEditor.layouts().find((l) => l.node.block === ramp).rows.some((r) => r.kind === 'ramp'), 'a Color Ramp draws its ramp');
// Edits rebuild the material with the nodes' code.
await new Promise((resolve) => { const check = () => (lava._buildIsInProgress ? setTimeout(check, 20) : resolve()); check(); });
buildMaterial(lava);
await new Promise((resolve) => lava.onBuildObservable.addOnce(resolve));
const code = lava._fragmentCompilationState._builtCompilationString;
for (const name of ['node_noise_tex_fbm_4d', 'valtorgb_opti_linear', 'node_bump', 'bl_tex_coord']) assert.match(code, new RegExp(name), name);
assert.ok(built > 0);

console.log('node editor: ok');
