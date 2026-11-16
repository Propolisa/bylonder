// The player: a Character that walks on the Move stick and reaches across the counter with the right hand. The mouse
// (or the right stick) moves the hand in a plane over the counter, as far as the arm and a lean reach; Blender's IK on
// the rig bends the arm and the spine to it. The palm is a Havok body that chases the hand's goal, pushes what moves and
// stops at what does not (the machine), and the IK aims the hand at that body, so the hand never goes through a solid
// thing (physical hands, as VR games do them). Holding Grab closes the hand on a cup under the palm, which goes where
// the hand goes until Grab is let go.
import { Matrix, MeshBuilder, PhysicsAggregate, PhysicsShapeType, Vector3 } from '@babylonjs/core';
import { defineBehavior, float, reach } from 'bylonder';
import Cup, { HELD } from './cup.js';
import { keepIn, playArea } from '../area.js';

/** How far the palm's body may be from the hand before it is placed there (m). */
const JUMP = 0.3;
/** How near the play area's edge his body comes (m). */
const BODY = 0.2;

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
    let pointer = null, holding = null, short = 0;
    // Scratch vectors, so a frame allocates nothing.
    const grip = new Vector3(), last = new Vector3(), out = new Vector3(), offset = new Vector3(), toAim = new Vector3(), flat = new Vector3(), velocity = new Vector3(), held = new Vector3(), top = new Vector3();
    character.add(reach({ hand: 'hand.R', target: aim, halfLife: 0.05 }));
    // The head watches the hand (the intent's look, below), not the camera above, glancing down with the head alone.
    Object.assign(character.effect('gaze'), { targets: [], turn: { yaw: 1.2, pitch: 0.3 } });
    // A walk kept in the play area, so he never walks out of the frame: a stick as the camera shows it, or a velocity.
    const kept = (move) => {
      const area = playArea(scene), at = entity.node.getAbsolutePosition();
      if (!area) return move;
      if (move instanceof Vector3) return keepIn(area, at, move, BODY);
      const right = game.camera.onGround({ x: 1, y: 0 }), up = game.camera.onGround({ x: 0, y: 1 });
      const ground = keepIn(area, at, right.scale(move.x).addInPlace(up.scale(move.y)), BODY);
      return { x: Vector3.Dot(ground, right), y: Vector3.Dot(ground, up) };
    };
    // Facing the hand when standing still: the body turns as the reach goes round it.
    character.input = () => {
      const move = input.stick('Move'), still = !move.x && !move.y;
      const toward = goal.subtract(entity.node.getAbsolutePosition());
      toward.y = 0;
      // Standing still, the body turns when the hand goes well round to a side (the chest turns for less), and steps
      // after it when the hand wants farther than the arm goes.
      if (!still) return { move: kept(move), look: goal };
      const round = Math.acos(Math.min(1, Vector3.Dot(toward.normalizeToNew(), character.movement.facing.normalizeToNew())));
      return { move: kept(short > 0.05 ? toward.normalize().scale(Math.min(0.6, short * 3)) : move), look: goal, ...(round > 0.9 && { facing: toward }) };
    };
    // The palm: a small sphere that follows the hand and pushes what it meets.
    const hand = MeshBuilder.CreateSphere('Palm', { diameter: 0.08 }, scene);
    hand.isVisible = false;
    hand.position.copyFrom(palm.getAbsolutePosition());
    // A body of its own, without gravity, driven toward the goal by its velocity: it pushes what it meets, stops at
    // what does not move (a button it slaps, the machine, the counter), and Havok knows how hard it hits. It passes
    // through the mug it holds.
    const touch = new PhysicsAggregate(hand, PhysicsShapeType.SPHERE, { mass: 2, friction: 0.2 }, scene).body;
    touch.shape.filterCollideMask = ~HELD;
    touch.setGravityFactor(0);
    touch.setAngularDamping(10);

    /** The cup nearest under the palm, over it or at its rim, if any. */
    const cupUnder = (at) => {
      let best = null, nearest = Infinity;
      for (const cup of game.all(Cup)) {
        if (!cup.entity.visible) continue;
        cup.top(top);
        const d = Math.hypot(top.x - at.x, top.z - at.z), above = at.y - top.y;
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
        } else if (stick.x || stick.y) want.addInPlace(game.camera.onGround(stick).scaleInPlace(props.speed * dt));
        want.y = props.height;
        // The goal: where the hand is wanted, as far as the arm and a lean go.
        const from = shoulder.getAbsolutePosition();
        out.set(want.x - from.x, 0, want.z - from.z);
        if (out.length() > props.reach) from.addToRef(out.normalize().scaleInPlace(props.reach), goal);
        else goal.copyFrom(want);
        goal.y = props.height;
        const at = palm.getAbsolutePosition(), s = from, e = elbow.getAbsolutePosition(), w = wrist.getAbsolutePosition();
        at.subtractToRef(w, offset);
        const arm = (Vector3.Distance(s, e) + Vector3.Distance(e, w)) * 0.98;
        goal.subtractToRef(offset, aim).subtractToRef(s, toAim);
        // Short of the goal by more than a few centimetres, the barista steps after it (input, above).
        short = toAim.length() - arm;
        // The wrist's aim within the arm's length, so the IK reaches it and its target never runs off: the chest leans
        // after the hand (Blender's constraints), which brings the shoulder, and so the hand, farther next frame.
        // Short: the aim drawn in toward the shoulder at its own height, so the hand stays over the counter.
        if (short > 0) {
          const across = Math.sqrt(Math.max(0, arm * arm - toAim.y * toAim.y)), height = toAim.y;
          flat.set(toAim.x, 0, toAim.z);
          const length = flat.length();
          s.addToRef(flat.normalize().scaleInPlace(Math.min(across, length)), aim);
          aim.y = s.y + height;
        }
        // The palm's body chases the palm's place at that aim, and the IK follows the body. A jump (the first frame, a
        // step's catch-up) is placed, not swept, so it hits nothing at a made-up speed.
        const jump = Vector3.Distance(at, hand.position) > JUMP;
        touch.disablePreStep = !jump;
        if (jump) hand.position.copyFrom(at);
        aim.addToRef(offset, velocity).subtractInPlace(hand.position).scaleInPlace(1 / Math.max(dt, 1 / 120));
        if (jump) velocity.setAll(0);
        else velocity.scaleInPlace(Math.min(1, props.slap / Math.max(velocity.length(), 1e-6)));
        hand.position.subtractToRef(offset, aim);
        touch.setLinearVelocity(velocity);
        // The cup the hand would take shows its outline.
        const under = holding ?? cupUnder(at);
        if (under !== hovered) { hovered?.hover(false); under?.hover(true); hovered = under; }
        // Grab: the hand closes on a cup under it and keeps it; letting go drops it with the hand's speed.
        if (input.held('Grab') && !holding) {
          holding = under;
          holding?.grab();
          if (holding) holding.entity.node.getAbsolutePosition().subtractToRef(at, grip);
        } else if (!input.held('Grab') && holding) {
          holding.release(at.subtract(last).scaleInPlace(1 / Math.max(dt, 1e-3)));
          holding = null;
        }
        if (holding) holding.entity.node.setAbsolutePosition(at.addToRef(grip, held));
        last.copyFrom(at);
      },
    };
  },
});
