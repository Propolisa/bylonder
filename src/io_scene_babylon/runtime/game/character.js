// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Character, the built-in behaviour of an armature that walks (runtime/character: movement, locomotion, effects),
// added like any behaviour in Object properties > Behaviors. Game code drives it through `entity.character`: its
// `input` gives the move this frame (a stick, `{ x, y }`, or a velocity), and `game.camera.follow(entity)` follows it.
// It updates after the other behaviours (phase 'late'), on the run's clock.
import { Vector3 } from '@babylonjs/core';
import { defineBehavior, bool, float } from './define.js';
// The character runtime through its entry: core.js and its effects import each other, and api.js orders them.
import { Character as Rig, followCamera } from '../character/api.js';
import { feet } from '../character/effects/feet.js';
import { gaze } from '../character/effects/gaze.js';
import { lean } from '../character/effects/lean.js';

/** A stick's `{ x, y }` (right and forward) as a velocity in the scene, else the velocity given. @param {any} move @param {number} speed */
const velocity = (move, speed) => (move instanceof Vector3 ? move : new Vector3(move?.x ?? 0, 0, move?.y ?? 0).scale(speed));

export default defineBehavior({
  name: 'Character',
  phase: 'late',
  props: { speed: float(2.5, { min: 0, unit: 'm/s' }), feet: bool(true), gaze: bool(true), lean: bool(true) },
  create({ entity, props, blend }) {
    const character = new Rig(blend, entity.name, { input: null, manual: true });
    character.body.play(character.locomotion);
    if (props.feet) character.add(feet());
    if (props.gaze && blend.scene.activeCamera) character.add(gaze({ targets: [blend.scene.activeCamera] }));
    if (props.lean) character.add(lean());
    /** @type {(() => any) | null} */
    let drive = null;
    // Game code's input: whatever it gives as the move, the character takes as a velocity.
    const handle = Object.create(character, {
      follow: { value: () => followCamera(character) },
      input: { get: () => drive, set: (fn) => { drive = fn; character.input = fn && (() => { const intent = fn(); return { ...intent, move: velocity(intent?.move, props.speed) }; }); } },
    });
    Object.defineProperty(entity, 'character', { value: handle, configurable: true });
    return {
      update(/** @type {number} */ dt) { character.update(dt); },
      dispose() { character.dispose(); },
    };
  },
});
