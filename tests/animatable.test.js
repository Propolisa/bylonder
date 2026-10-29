// Everything with a data path is animatable by Blender's animation (docs/model.md): any RNA path of an ID in Main is
// keyed by Blender's keying, and a Babylon-native value (a node material's input) is a custom property of the ID that
// stands for its owner, keyed by the same F-Curves, whose evaluated value goes back to Babylon.
import assert from 'node:assert/strict';
import { NullEngine, Scene, NodeMaterial, InputBlock, Color3 } from '@babylonjs/core';
import { createAnimationModel, address } from '../src/blenkernel/animation/model.js';
import { customProperty } from '../src/blenkernel/animation/anim-blender.js';
import { bindGraph } from '../src/nodes/bindings.js';
import '../src/python/bpy_interface.js';
import { channelButton, hoverButton, leaveButton } from '../src/editors/animation/keyframing-button.js';
import { invokeOperator } from '../src/windowmanager/wm-operators.js';

const close = (a, b, label) => assert.ok(Math.abs(a - b) < 1e-4, `${label}: ${a} != ${b}`);
const scene = new Scene(new NullEngine());
const animation = createAnimationModel(), { anim, ids } = animation, blender = ids.blender;

// Any RNA path: Material.diffuse_color keyed as keyframe_insert() keys it, every element, in Blender's default group.
const ma = blender.addMaterial('Lava');
animation.seek(1);
assert.equal(anim.keyInsert(ma, 'diffuse_color'), 4, 'every element of diffuse_color keyed');
assert.deepEqual(anim.fcurves(ma).map((f) => [f.rna_path, f.array_index]), [0, 1, 2, 3].map((i) => ['diffuse_color', i]));
assert.equal(anim.keyDelete(ma, 'diffuse_color', 0), 1, 'keyframe_delete() removes the key at the frame');
assert.equal(anim.keyClear(ma, 'diffuse_color'), 3, 'Clear Keyframes removes the F-Curves');
assert.equal(anim.fcurves(ma).length, 0);

// A Babylon-native value: a node material's uniform input, a custom property of its Material in Main.
const lava = new NodeMaterial('Lava', scene), tint = new InputBlock('Tint');
tint.value = new Color3(0, 0, 0);
lava.attachedBlocks.push(tint);
const fields = bindGraph(animation, { id: 'material:lava:graph', title: 'Lava', graph: lava, kind: 'material', owner: () => ma });
const red = address('material:lava:graph', 'Tint.r');
assert.deepEqual(fields[0].refs(), ['r', 'g', 'b'].map((c) => address('material:lava:graph', 'Tint.' + c)));
animation.insert(red, 1, 0);
animation.insert(red, 21, 1);
const [fcurve] = anim.fcurves(ma);
assert.equal(fcurve.rna_path, '["Tint.r"]', "the channel's F-Curve is on its owner's custom property");
assert.equal(fcurve.group, 'Lava');
assert.equal(customProperty(ma, 'Tint.r'), 0, 'the custom property exists in Main');
assert.equal(animation.dataPath(red), '["Tint.r"]');
animation.seek(11);
close(tint.value.r, 0.5, 'the input at the middle frame');
assert.equal(animation.state(red), 'animated');

// The same keying from the panel's button (I, its context menu): Insert Keyframe on every component at the frame.
const button = channelButton(animation, fields[0].refs);
const labels = () => button.items().filter((item) => item.label).map((item) => item.label);
assert.deepEqual(labels(), ['Insert Keyframe', 'Clear Keyframes', 'Copy Data Path']);
assert.equal(button.items()[0].keys, 'I', "the User Interface keymap's shortcut");
tint.value.g = 0.25;
// I over the row runs the User Interface keymap's operator on the hovered button.
hoverButton(button);
assert.equal(invokeOperator('anim.keyframe_insert_button', {}), 'FINISHED');
leaveButton(button);
assert.equal(invokeOperator('anim.keyframe_insert_button', {}), false, 'no button under the pointer');
assert.deepEqual(anim.fcurves(ma).map((f) => f.rna_path).sort(), ['["Tint.b"]', '["Tint.g"]', '["Tint.r"]']);
assert.equal(animation.state(red), 'keyed');
assert.deepEqual(labels(), ['Replace Keyframe', 'Delete Keyframe', 'Clear Keyframes', 'Copy Data Path']);
assert.ok(button.run('anim.keyframe_clear_button'));
assert.equal(anim.fcurves(ma).length, 0);

animation.dispose();
console.log('Keying any RNA path, and Babylon-native values as custom properties of their owner in Main, passed');
