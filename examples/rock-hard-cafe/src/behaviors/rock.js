// A customer: rolls up from the trailhead to the stand along a path of its own, waits, shivers with delight at the
// coffee it is served, spills it on itself and rolls back down, out of sight. Each rock's path and shiver come from the
// run's seeded random, so every serve plays out differently and a run with the same seed plays out the same.
import { Quaternion, Vector3 } from '@babylonjs/core';
import { defineBehavior, float, sound, color, knot, object } from 'bylonder';
import Subtitles from '../systems/subtitles.js';

/** Moves `entity` toward `to` (a point) on the ground by up to `step` metres; gives whether it got there. */
function rollToward(entity, to, step) {
  const at = entity.node.getAbsolutePosition(), dx = to.x - at.x, dz = to.z - at.z, d = Math.hypot(dx, dz);
  if (d <= step) { entity.node.setAbsolutePosition(new Vector3(to.x, at.y, to.z)); return true; }
  entity.node.setAbsolutePosition(new Vector3(at.x + (dx / d) * step, at.y, at.z + (dz / d) * step));
  return false;
}

export default defineBehavior({
  name: 'Rock',
  props: {
    patience: float(12, { min: 1, unit: 's' }),
    noises: sound(['Grind', 'Rumble', 'Clack']),
    reaction: knot('rock_reaction'),
    stain: color([0.24, 0.14, 0.07]),
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
    const rest = entity.node.rotationQuaternion?.clone() ?? Quaternion.FromEulerVector(entity.node.rotation);
    let shiver = null;
    const leave = (served) => { state.mood = 'leaving'; state.leg = 0; this.emit('left', { served }); };
    return {
      async served({ cup }) {
        state.mood = 'admiring';
        // Its delight: a shiver of its own amplitude, pace and length.
        shiver = { amplitude: 0.06 + time.random() * 0.14, rate: 8 + time.random() * 10, length: 1.2 + time.random(), t: 0 };
        const subtitles = game.get(Subtitles);
        game.play(subtitles?.tell('rock_noise') ?? time.pick(props.noises), { at: entity });
        subtitles?.say(props.reaction, { speaker: entity });
        await time.wait(shiver.length);
        entity.material().set('baseColor', props.stain); // the run's copy: the .blend keeps a clean rock
        cup?.hide();
        await time.wait(0.5);
        leave(true);
      },
      update(dt) {
        const roll = (path) => {
          const to = path[state.leg];
          if (to && rollToward(entity, to, props.speed * dt)) state.leg++;
          return state.leg >= path.length;
        };
        if (state.mood === 'arriving' && roll([bend, spot])) state.mood = 'waiting';
        else if (state.mood === 'waiting' && (state.waited += dt) > props.patience) leave(false);
        else if (state.mood === 'leaving' && roll([bend, trailhead])) {
          state.mood = 'gone';
          entity.hide();
        }
        if (shiver && (shiver.t += dt) < shiver.length) {
          const fade = 1 - shiver.t / shiver.length, a = shiver.amplitude * fade;
          entity.node.rotationQuaternion = rest.multiply(Quaternion.RotationYawPitchRoll(0, a * Math.sin(shiver.t * shiver.rate * 6.28), a * Math.cos(shiver.t * shiver.rate * 4.1)));
        } else if (shiver) {
          entity.node.rotationQuaternion = rest.clone();
          shiver = null;
        }
      },
    };
  },
});
