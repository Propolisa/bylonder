// A mug of coffee on Havok (its rigid body is Blender's): held, it goes where the hand goes; let go, it falls and
// slides. Set down on a waiting rock, it is served to that rock. Its sounds and its breaking are its Impact's.
import { PhysicsMotionType, Vector3 } from '@babylonjs/core';
import { defineBehavior } from 'bylonder';
import Rock from './rock.js';

export default defineBehavior({
  name: 'Cup',
  create({ entity, game }) {
    const node = entity.node, body = node.physicsBody;
    const { min, max } = node.getHierarchyBoundingVectors(true);
    const radius = (max.x - min.x) / 2, height = max.y - min.y;
    let served = false;
    body?.setCollisionCallbackEnabled(true);
    const landed = body?.getCollisionObservable().add(({ collidedAgainst }) => {
      if (served || body.getMotionType() !== PhysicsMotionType.DYNAMIC) return;
      const rock = game.all(Rock).find((r) => r.entity.node === collidedAgainst.transformNode && r.state.mood === 'waiting');
      if (!rock) return;
      served = true;
      game.emit(rock, 'served', { cup: entity });
    });
    return {
      radius,
      get served() { return served; },
      /** The middle of its rim, in the scene. */
      top: () => node.getAbsolutePosition().add(new Vector3(0, height, 0)),
      /** Outlined while the hand is over it, or holds it. @param {boolean} on */
      hover(on) {
        node.renderOutline = on;
        node.outlineWidth = 0.008;
      },
      /** Held: moved by the hand, pushing what it meets. */
      grab() {
        body?.setMotionType(PhysicsMotionType.ANIMATED);
        if (body) body.disablePreStep = false;
      },
      /** Let go with the hand's velocity. @param {Vector3} velocity */
      release(velocity) {
        if (!body) return;
        body.disablePreStep = true;
        body.setMotionType(PhysicsMotionType.DYNAMIC);
        body.setLinearVelocity(velocity);
      },
      dispose() { if (landed) body?.getCollisionObservable().remove(landed); },
    };
  },
});
