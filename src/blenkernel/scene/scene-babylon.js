import { Vector3 } from '@babylonjs/core';
// Babylon adapter for Scene settings: gravity goes to scene.gravity and the physics engine, when one is enabled.
export function renderSceneSettings(scene, settings) {
  scene.gravity = settings.useGravity ? Vector3.FromArray(settings.gravity) : Vector3.Zero();
  scene.getPhysicsEngine?.()?.setGravity(scene.gravity);
}
