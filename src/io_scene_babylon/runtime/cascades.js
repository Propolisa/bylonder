// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A cascaded sun's shadow fitted to the depth the view shows: Babylon splits the view's depth into cascades up to the
// camera's far plane, hundreds of metres for a page, so the near cascade's texels are coarse and the shadows step. Here
// the cascades end where the scene does along the view (the rays through the view's corners and middle leaving the
// scene's bounding box), worked out on the CPU when the camera moves, not with a depth pass and readback each frame.
import { CascadedShadowGenerator, Matrix, Vector3 } from '@babylonjs/core';

const POINTS = [[0, 0], [1, 0], [0, 1], [1, 1], [0.5, 0.5]], IDENTITY = Matrix.Identity();
const exit = new Vector3();

/**
 * How far along a ray it leaves a box, or null where it misses it.
 * @param {import('@babylonjs/core').Ray} ray @param {Vector3} min @param {Vector3} max
 */
function leaves(ray, min, max) {
  let near = 0, far = Infinity;
  for (const axis of /** @type {('x' | 'y' | 'z')[]} */ (['x', 'y', 'z'])) {
    const o = ray.origin[axis], d = ray.direction[axis];
    if (Math.abs(d) < 1e-9) { if (o < min[axis] || o > max[axis]) return null; continue; }
    const a = (min[axis] - o) / d, b = (max[axis] - o) / d;
    near = Math.max(near, Math.min(a, b));
    far = Math.min(far, Math.max(a, b));
  }
  return near <= far ? far : null;
}

/**
 * Fits the scene's cascaded shadow generators to the view whenever the camera's view or projection changes. Returns
 * what stops it.
 * @param {import('@babylonjs/core').Scene} scene
 */
export function fitCascades(scene) {
  /** @type {{ min: Vector3, max: Vector3 } | null} */
  let extent = null, seen = '';
  const observer = scene.onBeforeRenderObservable.add(() => {
    const camera = scene.activeCamera;
    const generators = scene.lights.map((light) => light.getShadowGenerator()).filter((g) => g instanceof CascadedShadowGenerator);
    if (!camera || !generators.length) return;
    const key = `${camera.getViewMatrix().updateFlag} ${camera.getProjectionMatrix().updateFlag}`;
    if (key === seen) return;
    seen = key;
    extent ??= scene.getWorldExtends((mesh) => mesh.isEnabled() && mesh.isVisible && mesh.getTotalVertices() > 0);
    const engine = scene.getEngine(), k = engine.getHardwareScalingLevel(), forward = camera.getDirection(Vector3.Forward());
    let depth = 0;
    for (const [x, y] of POINTS) {
      const ray = scene.createPickingRay(x * engine.getRenderWidth() * k, y * engine.getRenderHeight() * k, IDENTITY, camera);
      const t = leaves(ray, extent.min, extent.max);
      if (t !== null) depth = Math.max(depth, Vector3.Dot(ray.origin.addToRef(ray.direction.scale(t), exit).subtractInPlace(camera.globalPosition), forward));
    }
    if (depth <= camera.minZ) return;
    for (const generator of /** @type {CascadedShadowGenerator[]} */ (generators)) generator.shadowMaxZ = camera.maxZ ? Math.min(depth, camera.maxZ) : depth;
  });
  return () => scene.onBeforeRenderObservable.remove(observer);
}
