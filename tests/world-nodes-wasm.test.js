// A .blend's World node tree drawn as EEVEE draws it (main-view.js adoptWorld, world-babylon.js): a tree of more than a
// Background opens as a node material of its nodes, which the scene's world draws; a Background alone stays a color.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NullEngine, Scene } from '@babylonjs/core';
import { blenderMain } from '../src/bmesh/bmesh-wasm.js';
import '../src/python/bpy_interface.js';
import { idStruct, setContextPointer } from '../src/python/bpy_rna.js';
import { createBlenderIDs } from '../src/blenkernel/blender-ids.js';
import { createAnimationModel } from '../src/blenkernel/animation/model.js';
import { createRNA } from '../src/makesrna/rna-bylonder.js';
import { createMainSync } from '../src/blenkernel/main-sync.js';
import { worldNodes } from '../src/blenkernel/scene/world-babylon.js';

const open = (bytes) => {
  const scene = new Scene(new NullEngine());
  const animation = createAnimationModel(() => {}, { ids: createBlenderIDs(blenderMain()) });
  const sync = createMainSync({ rna: createRNA({ world: { scene, objects: [] } }), ids: animation.ids });
  sync.readBlend(bytes, scene);
  setContextPointer(sync.blender.C);
  return { scene, sync };
};

const plain = open(readFileSync(new URL('../examples/shader-gallery/shader_gallery.blend', import.meta.url)));
const world = idStruct(plain.sync.blender.world);
assert.ok(!worldNodes.get(plain.scene), 'a Background alone is the world color');

const { nodes, links } = world.node_tree;
const gradient = nodes.new('ShaderNodeTexGradient'), reroute = nodes.new('NodeReroute'), sky = nodes.new('ShaderNodeTexSky');
links.new(gradient.outputs.get('Color'), reroute.inputs[0]);
links.new(reroute.outputs[0], nodes.get('Background').inputs.get('Color'));
links.new(sky.outputs.get('Color'), gradient.inputs.get('Vector'));
const reopened = open(plain.sync.blender.writeBlend('/world.blend'));
const material = worldNodes.get(reopened.scene);
assert.ok(material?.blenderWorld, "the world's tree is a node material");
const background = material.attachedBlocks.find((block) => block.idname === 'ShaderNodeBackground');
assert.equal(background.getInputByName('Color').connectedPoint?.ownerBlock.idname, 'ShaderNodeTexGradient', 'linked as in the tree, through its reroute');
assert.ok(material.attachedBlocks.some((block) => block.idname === 'ShaderNodeOutputWorld'), 'into its World Output');
assert.deepEqual(material.blenderProbeClamp, [world.sun_threshold, idStruct(plain.sync.blender.scene).eevee.clamp_surface_indirect], "its probe clamped at the world's Sun Threshold and the scene's indirect clamp");
assert.deepEqual(material.attachedBlocks.find((block) => block.idname === 'ShaderNodeTexSky').properties.sun_direction.length, 3, "a Sky Texture's sun direction read as an array");
console.log("World node trees: a tree of more than a Background opens as the world's node material");
