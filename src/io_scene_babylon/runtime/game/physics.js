// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A game's physics (defineGame's `physics: 'havok'`): Babylon's Havok plugin on the run's scene, stepped by the run's
// clock in fixed steps rather than by the frame, so a seed reproduces a run in the page, the Game area, a test and a
// replay alike. Game code uses Babylon's physics API unwrapped (PhysicsAggregate, PhysicsBody) on `babylon.scene`.
import { HavokPlugin, PhysicsAggregate, PhysicsMotionType, PhysicsShapeType, Vector3 } from '@babylonjs/core';

/** Blender's collision shapes as Havok's. */
const SHAPES = { BOX: PhysicsShapeType.BOX, SPHERE: PhysicsShapeType.SPHERE, CAPSULE: PhysicsShapeType.CAPSULE, CYLINDER: PhysicsShapeType.CYLINDER,
  CONE: PhysicsShapeType.CONVEX_HULL, CONVEX_HULL: PhysicsShapeType.CONVEX_HULL, MESH: PhysicsShapeType.MESH, COMPOUND: PhysicsShapeType.CONVEX_HULL };
/** Blender's rigid body defaults, which the IR leaves out. */
const RIGID_BODY = { type: 'ACTIVE', enabled: true, kinematic: false, mass: 1, collision_shape: 'CONVEX_HULL', friction: 0.5, restitution: 0 };

/**
 * A Havok body for an object's rigid body as Blender sets it (Physics properties > Rigid Body, the IR's `rigid_body`):
 * Active is dynamic with its mass, Passive static, and Animated (`kinematic`) follows its node as code or an action
 * moves it. @param {import('@babylonjs/core').TransformNode} node @param {Record<string, any>} rigid
 */
export function rigidBody(node, rigid) {
  const r = { ...RIGID_BODY, ...rigid };
  const motion = r.kinematic ? PhysicsMotionType.ANIMATED : r.type === 'ACTIVE' && r.enabled ? PhysicsMotionType.DYNAMIC : PhysicsMotionType.STATIC;
  const shape = SHAPES[/** @type {keyof typeof SHAPES} */ (r.collision_shape)] ?? PhysicsShapeType.CONVEX_HULL;
  const body = new PhysicsAggregate(node, shape, { mass: motion === PhysicsMotionType.DYNAMIC ? r.mass : 0, friction: r.friction, restitution: r.restitution }, node.getScene()).body;
  if (motion === PhysicsMotionType.ANIMATED) {
    body.setMotionType(motion);
    body.disablePreStep = false;
  }
  return body;
}

/** The fixed step, in seconds. */
export const PHYSICS_STEP = 1 / 60;
/** The Havok instances made, by the function that loads them: one per page. @type {WeakMap<Function, Promise<any>>} */
const loaded = new WeakMap();

/**
 * Havok's wasm instance from `load` (`(options) => HavokPhysics(options)`), made once per loader.
 * @param {(options?: any) => Promise<any>} load @param {any} [options]
 */
export function havokFrom(load, options) {
  if (!loaded.has(load)) loaded.set(load, load(options));
  return /** @type {Promise<any>} */ (loaded.get(load));
}

/**
 * Havok on `scene`, which the run steps (`step(dt)`), not the scene's render. `onBody` hears each body made.
 * @param {import('@babylonjs/core').Scene} scene @param {any} havok @param {(body: { dispose(): void }) => void} onBody
 */
export function enablePhysics(scene, havok, onBody) {
  scene.enablePhysics(new Vector3(0, -9.81, 0), new HavokPlugin(false, havok));
  scene.physicsEnabled = false;
  const engine = /** @type {any} */ (scene.getPhysicsEngine());
  const addBody = engine.addBody.bind(engine);
  engine.addBody = (/** @type {any} */ body) => { addBody(body); onBody(body); };
  let owed = 0;
  return {
    /** Advances by `dt` seconds of the run's clock, in whole fixed steps. @param {number} dt */
    step(dt) {
      for (owed += dt; owed >= PHYSICS_STEP - 1e-9; owed -= PHYSICS_STEP) {
        scene.onBeforePhysicsObservable.notifyObservers(scene);
        engine._step(PHYSICS_STEP);
        scene.onAfterPhysicsObservable.notifyObservers(scene);
      }
    },
    dispose() { scene.disablePhysicsEngine(); },
  };
}
