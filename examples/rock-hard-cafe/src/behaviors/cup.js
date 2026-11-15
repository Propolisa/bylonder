// A cup of coffee on Havok (its rigid body is Blender's): held, it goes where the hand goes; let go, it falls and slides.
// Set down on a waiting rock, it is served to that rock. It clinks where it lands.
import { PhysicsMotionType, Vector3 } from '@babylonjs/core';
import { defineBehavior, sound } from 'bylonder';
import Rock from './rock.js';

export default defineBehavior({
  name: 'Cup',
  props: { clinks: sound(['Glass Clink', 'Plate Clink']) },
  create({ entity, game, props, time }) {
    const node = entity.node, body = node.physicsBody;
    const { min, max } = node.getHierarchyBoundingVectors(true);
    const radius = (max.x - min.x) / 2, height = max.y - min.y;
    let served = false, landing = false;
    body?.setCollisionCallbackEnabled(true);
    const landed = body?.getCollisionObservable().add(({ collidedAgainst }) => {
      if (body.getMotionType() !== PhysicsMotionType.DYNAMIC) return;
      if (landing) { landing = false; game.play(time.pick(props.clinks), { at: entity, rate: 0.9 + time.random() * 0.25, volume: 0.7 }); }
      if (served) return;
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
        landing = true;
      },
      dispose() { if (landed) body?.getCollisionObservable().remove(landed); },
    };
  },
});
