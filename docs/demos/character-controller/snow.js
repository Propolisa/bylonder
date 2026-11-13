// Snow as a character (docs/character-animation.md): its actions mapped to locomotion's gaits, moved by input over the
// ground, and its Bar Scene performance with its dialogue, handed over to input (the guide's example 15). The page (game.js) and
// recordings make it here.
import { Quaternion } from '@babylonjs/core/Maths/math.vector.js';
import { Color3 } from '@babylonjs/core/Maths/math.color.js';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode.js';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder.js';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder.js';
import { PBRMaterial } from '@babylonjs/core/Materials/PBR/pbrMaterial.js';
import { Character } from './world/bylonder/character/api.js';
import { feet, gaze, lean, springs } from './world/bylonder/character/effects/index.js';

export const ARMATURE = 'RIG-Snow';
// What Snow stands on and bumps into: the field, and the Bar Scene's props.
const GROUND = ['Ground', 'Slope', /^Step /, /^(Bar|Stool) /];

/**
 * Snow in a loaded package. `manual`: updated by hand (`hero.update(seconds)`, a recording's clock). `input`: its
 * intent ('default': keys and the touch stick).
 * @param {any} blend @param {{ manual?: boolean, input?: 'default' | (() => import('./world/bylonder/character/api.js').Intent) | null }} [options]
 */
export function createSnow(blend, { manual = false, input = 'default' } = {}) {
  const hero = new Character(blend, ARMATURE, { manual, input, ground: GROUND });
  hero.locomotion.actions = { idle: 'Idle', walk: 'Walk', run: 'Jog', sprint: 'Sprint', jump: 'Jump_Start', fall: 'Jump_Loop', land: 'Jump_Land' };
  hero.body.play(hero.locomotion, { blend: 0 });
  hero.add(feet());
  hero.add(lean());
  // Its ponytail swings.
  if (hero.rig.boneIndex('DEF-Ponytail1') >= 0) hero.add(springs({ bones: ['DEF-Ponytail1'] }));
  // It glances at the lanterns it passes, and at the camera otherwise.
  const lanterns = blend.scene.transformNodes.filter((n) => /^Look Target/.test(n.name));
  hero.add(gaze({ targets: [...lanterns, blend.scene.activeCamera], near: 6 }));
  // Its performance from Blender Studio's Snow Bar Scene (animation by Rik Schutte), with the scene's dialogue.
  const acting = hero.action('Acting', { sound: 'Dialogue', loop: 1.5, waitForSound: true });
  /**
   * The guide's example 15: Snow acts, its face on its own layer and its head's gestures held back; `takeOver` hands
   * the body to its input while the face keeps talking, the gestures at 60%, its feet and gaze faded in.
   */
  let bar = null;
  const act = () => {
    bar ??= setBar(blend.scene, hero.node);
    const own = hero.input;
    hero.input = null;
    hero.body.play(acting, { blend: 0 });
    hero.layer('face', { group: 'Face' }).play(acting);
    const gesture = hero.layer('gesture', { roles: ['neck', 'head'], add: true, weight: 0 }).play(acting);
    const fit = [hero.effect('feet'), hero.effect('gaze')];
    for (const effect of fit) effect.weight = 0;
    return () => {
      hero.input = own;
      hero.body.play(hero.locomotion, { blend: 0.8 });
      gesture.fade(0.6, 0.8);
      for (const effect of fit) effect.fade(1, 0.8);
    };
  };
  return { hero, act };
}

/**
 * The Bar Scene's bar and stool where Snow acts, as plain shapes where its armature is now (they stay put as Snow moves
 * on, and stop it): its counter, top and stool, placed and sized as the shot has them in its armature's space
 * (Blender's axes, metres).
 * @param {import('@babylonjs/core').Scene} scene @param {import('@babylonjs/core').TransformNode} armature
 */
function setBar(scene, armature) {
  // Matte, as the Blender side's Principled BSDF of roughness 1 (base colors given in sRGB).
  const matte = (name, srgb) => Object.assign(new PBRMaterial(name, scene), { albedoColor: srgb.toLinearSpace(), metallic: 0, roughness: 1 });
  const root = new TransformNode('Bar Scene', scene);
  armature.computeWorldMatrix(true).decompose(root.scaling, (root.rotationQuaternion = new Quaternion()), root.position);
  const wood = matte('Bar', new Color3(0.33, 0.2, 0.13)), seat = matte('Stool', new Color3(0.25, 0.25, 0.27));
  const piece = (mesh, [x, y, z], material) => Object.assign(mesh, { parent: root, material }).position.set(x, z, y);
  piece(CreateBox('Bar Counter', { width: 2.89, height: 1.04, depth: 0.56 }, scene), [-0.605, -0.5, 0.51], wood);
  piece(CreateBox('Bar Top', { width: 3.58, height: 0.08, depth: 0.91 }, scene), [-0.42, -0.615, 1.05], wood);
  piece(CreateCylinder('Stool Seat', { diameter: 0.4, height: 0.2 }, scene), [0, 0.125, 0.77], seat);
  piece(CreateCylinder('Stool Leg', { diameter: 0.06, height: 0.67 }, scene), [0, 0.125, 0.335], seat);
  return root;
}
