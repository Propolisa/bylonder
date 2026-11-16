// The player: a Character that walks on the Move stick and reaches across the counter with the right hand. The mouse
// (or the right stick) moves the hand in a plane over the counter, as far as the arm and a lean reach; Blender's IK on
// the rig bends the arm and the spine to it. The palm is a Havok body that pushes what it meets, and holding Grab closes
// the hand on a cup under the palm, which goes where the hand goes until Grab is let go.
import { Matrix, MeshBuilder, PhysicsAggregate, PhysicsShapeType, Vector3 } from '@babylonjs/core';
import { defineBehavior, float, reach } from 'bylonder';
import Cup from './cup.js';

/** Where the ray through a point of the screen meets the level plane at `height`, or null. */
function onPlane(scene, pointer, height) {
  const ray = scene.createPickingRay(pointer.x, pointer.y, Matrix.Identity(), scene.activeCamera);
  if (Math.abs(ray.direction.y) < 1e-4) return null;
  const t = (height - ray.origin.y) / ray.direction.y;
  return t > 0 ? ray.origin.add(ray.direction.scale(t)) : null;
}

export default defineBehavior({
  name: 'Barista',
  requires: ['Character'],
  props: {
    height: float(1.12, { unit: 'm', description: 'The height the hand moves at, over the counter and the mugs' }),
    reach: float(0.9, { min: 0.2, unit: 'm', description: 'How far the hand goes from the shoulder, leaning' }),
    speed: float(1.2, { min: 0.1, unit: 'm/s', description: 'How fast the right stick moves the hand' }),
    slap: float(5, { min: 0.5, unit: 'm/s', description: 'The fastest the palm hits what it meets' }),
  },
  create({ entity, input, game, props, babylon }) {
    const scene = babylon.scene, character = entity.character;
    const shoulder = character.bone('DEF-upper_arm.R'), elbow = character.bone('DEF-forearm.R'), wrist = character.bone('DEF-hand.R'), palm = character.bone('DEF-f_middle.01.R');
    // Where the palm should be (the goal), and where the wrist goes for it (the IK's aim).
    // At first a little in front of the body, on the right hand's side, as the barista stands facing the counter.
    const goal = entity.node.getAbsolutePosition().add(new Vector3(0.15, 0, 0.35)), aim = goal.clone(), want = goal.clone();
    let pointer = null, holding = null, grip = new Vector3(), last = new Vector3(), short = 0;
    character.add(reach({ hand: 'hand.R', target: aim, halfLife: 0.05 }));
    // The head watches the hand (the intent's look, below), not the camera above, glancing down with the head alone.
    Object.assign(character.effect('gaze'), { targets: [], turn: { yaw: 1.2, pitch: 0.3 } });
    // Facing the hand when standing still: the body turns as the reach goes round it.
    character.input = () => {
      const move = input.stick('Move'), still = !move.x && !move.y;
      const toward = goal.subtract(entity.node.getAbsolutePosition());
      toward.y = 0;
      // Standing still, the body turns when the hand goes well round to a side (the chest turns for less), and steps
      // after it when the hand wants farther than the arm goes.
      if (!still) return { move, look: goal };
      const round = Math.acos(Math.min(1, Vector3.Dot(toward.normalizeToNew(), character.movement.facing.normalizeToNew())));
      return { move: short > 0.05 ? toward.normalize().scale(Math.min(0.6, short * 3)) : move, look: goal, ...(round > 0.9 && { facing: toward }) };
    };
    // The palm: a small sphere that follows the hand and pushes what it meets.
    const hand = MeshBuilder.CreateSphere('Palm', { diameter: 0.08 }, scene);
    hand.isVisible = false;
    hand.position.copyFrom(palm.getAbsolutePosition());
    // A body of its own, without gravity, driven toward the hand by its velocity: it pushes what it meets, stops at
    // what does not move (a button it slaps, the counter), and Havok knows how hard it hits.
    const touch = new PhysicsAggregate(hand, PhysicsShapeType.SPHERE, { mass: 2, friction: 0.2 }, scene).body;
    touch.setGravityFactor(0);
    touch.setAngularDamping(10);

    /** The cup nearest under the palm, over it or at its rim, if any. */
    const cupUnder = (at) => {
      let best = null, nearest = Infinity;
      for (const cup of game.all(Cup).filter((c) => c.entity.visible)) {
        const top = cup.top(), d = Math.hypot(top.x - at.x, top.z - at.z), above = at.y - top.y;
        if (d < cup.radius + 0.06 && above > -0.05 && above < 0.2 && d < nearest) [best, nearest] = [cup, d];
      }
      return best;
    };
    let hovered = null;
    // The Play Area's box, which the hand stays in when a finger drags it, so the barista never walks out of frame.
    const area = scene.getTransformNodeByName('Play Area');
    const inArea = (point) => {
      if (!area) return point;
      const local = Vector3.TransformCoordinates(point, area.computeWorldMatrix(true).clone().invert());
      local.x = Math.max(-1, Math.min(1, local.x));
      local.z = Math.max(-1, Math.min(1, local.z));
      return Vector3.TransformCoordinates(local, area.getWorldMatrix());
    };
    return {
      get holding() { return holding; },
      /** The palm's body, which touch controls show the hand by. */
      palm: hand,
      /** The hand moved as a finger drags from one point of the screen to another (CSS pixels), as a trackpad moves a
       * cursor; past its reach, the barista walks after it. */
      drag(from, to) {
        const a = onPlane(scene, from, props.height), b = onPlane(scene, to, props.height);
        if (a && b) want.copyFrom(inArea(want.add(b.subtract(a))));
      },
      update(dt) {
        // The hand's goal: the pointer's place over the counter, or moved by the right stick, within reach.
        const stick = input.stick('Reach');
        if (input.pointer && input.pointer !== pointer) {
          pointer = input.pointer;
          want.copyFrom(onPlane(scene, pointer, props.height) ?? want);
        } else if (stick.x || stick.y) want.addInPlace(game.camera.onGround(stick).scale(props.speed * dt));
        want.y = props.height;
        // The goal: where the hand is wanted, as far as the arm and a lean go.
        const from = shoulder.getAbsolutePosition(), out = new Vector3(want.x - from.x, 0, want.z - from.z);
        goal.copyFrom(out.length() > props.reach ? from.add(out.normalize().scale(props.reach)) : want).y = props.height;
        const at = palm.getAbsolutePosition();
        aim.copyFrom(goal).subtractInPlace(at.subtract(wrist.getAbsolutePosition()));
        // The wrist's aim within the arm's length, so the IK reaches it and its target never runs off: the chest leans
        // after the hand (Blender's constraints), which brings the shoulder, and so the hand, farther next frame.
        const s = shoulder.getAbsolutePosition(), e = elbow.getAbsolutePosition(), w = wrist.getAbsolutePosition();
        const arm = (Vector3.Distance(s, e) + Vector3.Distance(e, w)) * 0.98, toAim = aim.subtract(s);
        // Short of the goal by more than a few centimetres, the barista steps after it (input, below).
        short = toAim.length() - arm;
        // Short: the aim drawn in toward the shoulder at its own height, so the hand stays over the counter.
        if (short > 0) {
          const across = Math.sqrt(Math.max(0, arm * arm - toAim.y * toAim.y)), flat = new Vector3(toAim.x, 0, toAim.z);
          aim.copyFrom(s.add(flat.normalize().scale(Math.min(across, flat.length())))).y = s.y + toAim.y;
        }
        // A jump (the first frame, a step's catch-up) is placed, not swept, so it hits nothing at a made-up speed.
        const jump = Vector3.Distance(at, hand.position) > 0.3;
        touch.disablePreStep = !jump;
        if (jump) hand.position.copyFrom(at);
        const toward = at.subtract(hand.position).scale(1 / Math.max(dt, 1 / 120));
        touch.setLinearVelocity(jump ? Vector3.Zero() : toward.scale(Math.min(1, props.slap / Math.max(toward.length(), 1e-6))));
        // The cup the hand would take shows its outline.
        const under = holding ?? cupUnder(at);
        if (under !== hovered) { hovered?.hover(false); under?.hover(true); hovered = under; }
        // Grab: the hand closes on a cup under it and keeps it; letting go drops it with the hand's speed.
        if (input.held('Grab') && !holding) {
          holding = under;
          holding?.grab();
          if (holding) grip = holding.entity.node.getAbsolutePosition().subtract(at);
        } else if (!input.held('Grab') && holding) {
          holding.release(at.subtract(last).scale(1 / Math.max(dt, 1e-3)));
          holding = null;
        }
        holding?.entity.node.setAbsolutePosition(at.add(grip));
        last.copyFrom(at);
      },
    };
  },
});
