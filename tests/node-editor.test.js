// The Node Editor behaves as Blender's: Blender's Add menu adds Blender's and Babylon's nodes, links drag between
// sockets of both, Ctrl right-drag cuts links, and Blender's Node Editor keymap runs M, H, X, Ctrl J and A.
import assert from 'node:assert/strict';
import { NullEngine, Scene, NodeMaterial, ArcRotateCamera, Vector3 } from '@babylonjs/core';
import { createNodeTree } from '../src/editors/space_node/node-tree.js';
import { createNodeEditorController } from '../src/editors/space_node/node-editor-controller.js';
import { addMenuEntries, addMenuItems } from '../src/editors/space_node/node-add-menu.js';
import { subitems } from '../src/editors/interface/ui-layout.js';
import { keymapHandler } from '../src/windowmanager/keyconfig.js';
import { inArea } from '../src/windowmanager/wm-operators.js';

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

console.log('node editor: ok');
