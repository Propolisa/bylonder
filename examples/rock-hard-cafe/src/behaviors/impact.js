// Whatever the hand can hit sounds as it is hit (Havok's collision events): a sound of its material, lower for larger
// things, louder and brighter for faster hits (the closing speed along the contact), never more than one every few
// hundredths of a second, and none for a thing rolling or resting. Hit hard enough, a thing that breaks swaps to its pieces (a collection made in Blender), which fly on
// from its motion. A dynamic thing that falls below the counter's top is knocked off.
import { PhysicsEventType, PhysicsMotionType, Vector3 } from '@babylonjs/core';
import { defineBehavior, enumOf, collection, float } from 'bylonder';
import { createSounds } from '../sounds.js';

/** Contacts slower than this are a thing resting or rolling, which makes no sound (m/s). */
const QUIET = 0.4;

export default defineBehavior({
  name: 'Impact',
  props: {
    material: enumOf(['ceramic', 'glass', 'wood', 'ground', 'button']),
    breaks: collection(''),
    breakSpeed: float(3, { min: 0, unit: 'm/s' }),
    knockedBelow: float(0.8, { unit: 'm' }),
  },
  events: ['hit', 'broke', 'knocked'],
  create({ entity, props, game, time }) {
    const node = entity.node, body = node?.physicsBody;
    const { min, max } = node.getHierarchyBoundingVectors(true), size = Math.max(max.x - min.x, max.y - min.y, max.z - min.z);
    const audio = game.audio, sounds = audio && createSounds(audio, time.random());
    const dynamic = () => body?.getMotionType() === PhysicsMotionType.DYNAMIC;
    const emit = (event, data) => this.emit(event, data);
    let last = -Infinity, broken = false, knocked = false, breaking = null;
    const up = () => node.getAbsolutePosition().y > props.knockedBelow;
    let wasUp = up();

    const shatter = (velocity, speed) => {
      broken = true;
      const pieces = game.spawn(props.breaks, { at: entity });
      entity.hide();
      for (const piece of pieces?.node.getChildren() ?? []) {
        const kick = new Vector3(time.random() - 0.5, time.random() * 0.6, time.random() - 0.5).scale(speed * 0.4);
        piece.physicsBody?.setLinearVelocity(velocity.add(kick));
      }
      emit('broke', { entity });
    };
    body?.setCollisionCallbackEnabled(true);
    // A hit is a contact starting; its speed the closing speed along the contact's normal just before it (from the last
    // frame's velocity), or what the impulse that stopped them says; a mug rolling or sliding along the ground closes at
    // nothing, so it is quiet.
    const freedom = (b) => (b?.getMotionType() === PhysicsMotionType.DYNAMIC ? 1 / (b.getMassProperties().mass || 1) : 0);
    const before = new Vector3();
    const contact = body?.getCollisionObservable().add(({ type, collider, collidedAgainst, impulse, normal }) => {
      if (type !== PhysicsEventType.COLLISION_STARTED) return;
      const other = collider === body ? collidedAgainst : collider;
      const velocity = body.getLinearVelocity(), closing = before.subtract(other?.getLinearVelocity() ?? Vector3.Zero());
      const speed = Math.max(impulse * (freedom(body) + freedom(other)), normal ? Math.abs(Vector3.Dot(closing, normal)) : 0);
      if (broken || breaking || speed < QUIET || time.now - last < 0.08) return;
      last = time.now;
      const breaks = !!props.breaks && dynamic() && speed > props.breakSpeed;
      sounds?.impact(audio.context.currentTime + 0.01, { size, speed, material: props.material, breaks });
      emit('hit', { entity, speed, by: other?.transformNode ?? null });
      // Broken at the next update, not inside Havok's step.
      if (breaks) breaking = { velocity: before.clone(), speed };
    });
    return {
      material: props.material,
      get broken() { return broken; },
      update() {
        // Hidden (gone, broken), it has no body any more.
        if (!entity.visible) return;
        if (body) before.copyFrom(body.getLinearVelocity());
        if (breaking) { shatter(breaking.velocity, breaking.speed); breaking = null; }
        const now = up();
        if (wasUp && !now && !knocked && !broken && dynamic()) { knocked = true; emit('knocked', { entity }); }
        wasUp = now;
      },
      dispose() { if (contact) body?.getCollisionObservable().remove(contact); },
    };
  },
});
