// A customer: rolls up from the trailhead to the stand along a path of its own, waits, shivers with delight at the
// coffee set down on it, says so in a voice of its own (at half pitch: these are rocks), spills it (a shrug of its own
// that tips the mug off, under Havok, with a splash), takes the stain and rolls back down, out of sight. Knocking a mug
// or a jar off the counter, or breaking one, angers the waiting rock: an angry wobble, a red tint, an angry line, and
// its patience cut by 40%; it waits for a retry, or leaves angry. Each rock's path, voice, shiver and spill come from
// the run's seeded random, so every serve plays out differently and a run with the same seed plays out the same.
import { Quaternion, Vector3 } from '@babylonjs/core';
import { defineBehavior, float, sound, color, knot, object } from 'bylonder';
import Subtitles from '../systems/subtitles.js';
import Impact from './impact.js';
import Cup from './cup.js';
import { createSounds } from '../sounds.js';

const next = new Vector3(), turn = new Quaternion();
/** Moves `entity` toward `to` (a point) on the ground by up to `step` metres; gives whether it got there. */
function rollToward(entity, to, step) {
  const at = entity.node.getAbsolutePosition(), dx = to.x - at.x, dz = to.z - at.z, d = Math.hypot(dx, dz);
  if (d <= step) { entity.node.setAbsolutePosition(next.set(to.x, at.y, to.z)); return true; }
  entity.node.setAbsolutePosition(next.set(at.x + (dx / d) * step, at.y, at.z + (dz / d) * step));
  return false;
}
/** `node` turned from `rest` by a yaw, pitch and roll, in place. */
const tilt = (node, rest, yaw, pitch, roll) => {
  node.rotationQuaternion ??= new Quaternion();
  rest.multiplyToRef(Quaternion.RotationYawPitchRollToRef(yaw, pitch, roll, turn), node.rotationQuaternion);
};

export default defineBehavior({
  name: 'Rock',
  props: {
    patience: float(35, { min: 1, unit: 's' }),
    voices: sound(['Voice Cute 01']),
    spills: sound(['Spill Splash 01']),
    delight: sound('Served'),
    anger: sound('Angry'),
    reaction: knot('rock_reaction'),
    angry: knot('rock_angry'),
    stain: color([0.24, 0.14, 0.07]),
    rage: color([0.7, 0.12, 0.08]),
    spot: object('Stand Spot'),
    trailhead: object('Trailhead'),
    speed: float(1.2, { min: 0.1, unit: 'm/s' }),
  },
  events: ['left'],

  create({ entity, props, game, time, state, babylon }) {
    const place = (name) => (babylon.scene.getTransformNodeByName(name) ?? babylon.scene.getMeshByName(name))?.getAbsolutePosition();
    const spot = place(props.spot), trailhead = place(props.trailhead);
    // The path: a bend off the straight line, to one side or the other, as far as 2 m.
    const bend = spot && trailhead && Vector3.Lerp(trailhead, spot, 0.5).add(new Vector3((time.random() - 0.5) * 4, 0, (time.random() - 0.5) * 2));
    // A rock placed at the stand waits there; one made at the trailhead rolls up first. State survives a code swap.
    state.mood ??= !spot || Vector3.Distance(entity.node.getAbsolutePosition(), spot) < 0.5 ? 'waiting' : 'arriving';
    state.waited ??= 0;
    state.leg ??= 0;
    const arriving = [bend, spot], leaving = [bend, trailhead];
    const rest = entity.node.rotationQuaternion?.clone() ?? Quaternion.FromEulerVector(entity.node.rotation);
    // Its voice, one of the voices; and an angry wobble of its own, faster than its delight.
    const voice = time.pick(props.voices), audio = game.audio, sounds = audio && createSounds(audio, time.random());
    const fury = { amplitude: 0.05 + time.random() * 0.05, rate: 18 + time.random() * 10 };
    let shiver = null;
    const leave = (served) => { state.mood = 'leaving'; state.leg = 0; this.emit('left', { served, angry: !!state.angry }); };
    const subtitles = () => game.get(Subtitles);

    // A mug or a jar lost while it waits: knocked off or broken, but not the mug it was served.
    const upset = ({ entity: lost }) => {
      if (state.mood !== 'waiting' || state.angry || game.all(Cup).some((cup) => cup.entity === lost && cup.served)) return;
      state.angry = true;
      state.waited = Math.max(state.waited, props.patience * 0.4);
      entity.material().set('baseColor', props.rage); // the run's copy
      game.play(props.anger, { at: entity, volume: 0.6 });
      game.play(voice, { at: entity, rate: 0.5 });
      subtitles()?.say(props.angry, { speaker: entity });
    };
    game.on(Impact, 'knocked', upset);
    game.on(Impact, 'broke', upset);
    return {
      async served({ cup }) {
        state.mood = 'admiring';
        // Its delight: a shiver of its own amplitude, pace and length.
        shiver = { amplitude: 0.06 + time.random() * 0.14, rate: 8 + time.random() * 10, length: 1.2 + time.random(), t: 0 };
        game.play(props.delight, { at: entity, volume: 0.6 });
        game.play(voice, { at: entity, rate: 0.5 });
        subtitles()?.say(props.reaction, { speaker: entity });
        await time.wait(shiver.length);
        // The spill: a shrug to a side of its own tips the mug off its top, with a splash (a recorded one, or one made).
        const side = time.random() * Math.PI * 2, top = cup?.node.getAbsolutePosition().add(new Vector3(0, 0.08, 0));
        if (top) cup.node.physicsBody?.applyImpulse(new Vector3(Math.cos(side), 0.4, Math.sin(side)).scale(0.3), top);
        if (time.random() < 0.5 && sounds) sounds.splash(audio.context.currentTime + 0.01);
        else game.play(time.pick(props.spills), { at: entity, volume: 0.7 });
        entity.material().set('baseColor', props.stain); // the run's copy: the .blend keeps a clean rock
        await time.wait(0.5);
        leave(true);
      },
      update(dt) {
        const roll = (path) => {
          const to = path[state.leg];
          if (to && rollToward(entity, to, props.speed * dt)) state.leg++;
          return state.leg >= path.length;
        };
        if (state.mood === 'arriving' && roll(arriving)) state.mood = 'waiting';
        else if (state.mood === 'waiting' && (state.waited += dt) > props.patience) leave(false);
        else if (state.mood === 'leaving' && roll(leaving)) {
          state.mood = 'gone';
          entity.hide();
        }
        if (shiver && (shiver.t += dt) < shiver.length) {
          const fade = 1 - shiver.t / shiver.length, a = shiver.amplitude * fade;
          tilt(entity.node, rest, 0, a * Math.sin(shiver.t * shiver.rate * 6.28), a * Math.cos(shiver.t * shiver.rate * 4.1));
        } else if (shiver) {
          tilt(entity.node, rest, 0, 0, 0);
          shiver = null;
        } else if (state.angry && state.mood === 'waiting') {
          const t = state.waited, a = fury.amplitude;
          tilt(entity.node, rest, a * Math.sin(t * fury.rate), 0, a * Math.cos(t * fury.rate * 1.3));
        }
      },
    };
  },
});
