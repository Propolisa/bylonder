// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The control panel's Camera section: which of the scene's cameras the page looks through, and how the viewer moves it.
// The camera the page renders with stays the active one, so its post-processes (the view transform, the compositor)
// stay with it: another camera's view, or that of one of Babylon's navigation cameras driven by the viewer's input, is
// copied onto it each frame. Fixed is the authored camera as exported; Orbit turns around a point ahead (Babylon's
// ArcRotateCamera), Fly moves freely (UniversalCamera), Walk walks at eye height with gravity and collisions, Joysticks
// flies with two virtual thumb sticks (VirtualJoysticksCamera). Switching keeps the current view.
import '@babylonjs/core/Culling/ray.js';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera.js';
import { Ray } from '@babylonjs/core/Culling/ray.core.js';
import { UniversalCamera } from '@babylonjs/core/Cameras/universalCamera.js';
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';
import { VirtualJoysticksCamera } from '@babylonjs/core/Cameras/virtualJoysticksCamera.js';

/** @typedef {'FIXED' | 'ORBIT' | 'FLY' | 'WALK' | 'JOYSTICKS'} Navigation */

// How far ahead the eye is above the ground when walking, and how strong gravity is per frame, in meters.
const EYE_HEIGHT = 1.7, GRAVITY = -9.81 / 60;
// Keys that move a flying or walking camera besides the arrows: W A S D, and E and Q up and down.
const KEYS = { keysUp: [87], keysDown: [83], keysLeft: [65], keysRight: [68], keysUpward: [69], keysDownward: [81] };

/**
 * The scene's size and centre, from its visible meshes' bounds.
 * @param {import('@babylonjs/core').Scene} scene
 */
function extent(scene) {
  const meshes = scene.meshes.filter((m) => m.isEnabled() && m.isVisible && m.getTotalVertices() > 0);
  if (!meshes.length) return { center: Vector3.Zero(), size: 10 };
  const { min, max } = meshes.reduce((box, m) => {
    const { minimumWorld, maximumWorld } = m.getBoundingInfo().boundingBox;
    return { min: Vector3.Minimize(box.min, minimumWorld), max: Vector3.Maximize(box.max, maximumWorld) };
  }, { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) });
  return { center: min.add(max).scale(0.5), size: Math.max(Vector3.Distance(min, max), 1) };
}

/**
 * The navigation of a scene's view: `look(camera)` shows a camera's view, `navigate(mode)` moves it.
 * @param {import('@babylonjs/core').Scene} scene
 */
export function createNavigation(scene) {
  const render = /** @type {import('@babylonjs/core').TargetCamera} */ (scene.activeCamera);
  const canvas = scene.getEngine().getRenderingCanvas();
  const authored = { parent: render.parent, position: render.position.clone(), rotation: render.rotation.clone(), quaternion: render.rotationQuaternion?.clone() ?? null,
    fov: render.fov, minZ: render.minZ, maxZ: render.maxZ, mode: render.mode };
  /** @type {import('@babylonjs/core').TargetCamera} */
  let source = render;
  /** @type {Navigation} */
  let mode = 'FIXED';
  /** @type {import('@babylonjs/core').TargetCamera | null} */
  let driver = null;
  /** @type {(() => void) | null} */
  let undoWalk = null;

  // The view the page shows now: where it is and where it looks.
  const view = () => {
    const camera = driver ?? source;
    camera.computeWorldMatrix();
    const ray = camera.getForwardRay(1);
    return { position: ray.origin.clone(), forward: ray.direction.clone() };
  };
  // The rendering camera placed at a view, unparented while it is driven.
  const place = (/** @type {Vector3} */ position, /** @type {Vector3} */ forward) => {
    render.parent = null;
    render.position.copyFrom(position);
    render.setTarget(position.add(forward));
  };
  const copy = scene.onBeforeRenderObservable.add(() => {
    if (driver) {
      driver.update();
      const { position, forward } = view();
      place(position, forward);
    } else if (source !== render) {
      const { position, forward } = view();
      place(position, forward);
      Object.assign(render, { fov: source.fov, minZ: source.minZ, maxZ: source.maxZ, mode: source.mode });
    }
  });
  const restore = () => {
    Object.assign(render, { parent: authored.parent, fov: authored.fov, minZ: authored.minZ, maxZ: authored.maxZ, mode: authored.mode });
    render.position.copyFrom(authored.position);
    render.rotation.copyFrom(authored.rotation);
    render.rotationQuaternion = authored.quaternion?.clone() ?? null;
  };

  // The ground under a point, or null.
  const ground = (/** @type {Vector3} */ at) => scene.pickWithRay(new Ray(at, new Vector3(0, -1, 0), 1e4), (m) => m.isEnabled() && m.isVisible && m.isPickable)?.pickedPoint ?? null;

  // A navigation camera of the mode at the current view, its input on the canvas.
  /** @param {Navigation} next @param {{ position: Vector3, forward: Vector3 }} at */
  function driverOf(next, { position, forward }) {
    const { center, size } = extent(scene);
    if (next === 'ORBIT') {
      const distance = Math.max(Vector3.Dot(center.subtract(position), forward), size * 0.1);
      const orbit = new ArcRotateCamera('__navigation', 0, 0, distance, position.add(forward.scale(distance)), scene);
      orbit.setPosition(position);
      Object.assign(orbit, { wheelDeltaPercentage: 0.01, pinchDeltaPercentage: 0.005, panningSensibility: 2000 / size, minZ: render.minZ, lowerRadiusLimit: size * 1e-3 });
      return orbit;
    }
    const walking = next === 'WALK';
    const camera = next === 'JOYSTICKS' ? new VirtualJoysticksCamera('__navigation', position, scene) : new UniversalCamera('__navigation', position, scene);
    camera.setTarget(position.add(forward));
    camera.speed = (walking ? 2 : size / 20) / 60;
    camera.minZ = render.minZ;
    const keys = /** @type {any} */ (camera.inputs.attached.keyboard);
    if (keys) for (const [name, codes] of Object.entries(KEYS)) keys[name] = [...keys[name], ...codes];
    if (walking) {
      const floor = ground(position);
      if (floor) camera.position.y = floor.y + EYE_HEIGHT;
      Object.assign(camera, { applyGravity: true, checkCollisions: true, ellipsoid: new Vector3(0.3, EYE_HEIGHT / 2, 0.3) });
      const was = { gravity: scene.gravity.clone(), collisions: scene.collisionsEnabled, meshes: scene.meshes.map((m) => [m, m.checkCollisions]) };
      scene.gravity = new Vector3(0, GRAVITY, 0);
      scene.collisionsEnabled = true;
      for (const m of scene.meshes) m.checkCollisions = m.isEnabled() && m.isVisible && m.getTotalVertices() > 0;
      undoWalk = () => {
        scene.gravity = was.gravity;
        scene.collisionsEnabled = was.collisions;
        for (const [m, check] of was.meshes) /** @type {any} */ (m).checkCollisions = check;
      };
    }
    return camera;
  }

  return {
    get mode() { return mode; },
    get camera() { return source; },
    /** The scene's own cameras, which the page can look through. */
    cameras: () => scene.cameras.filter((c) => c.name !== '__navigation'),
    /**
     * Moves the view by a mode, from where it is now.
     * @param {Navigation} next
     */
    navigate(next) {
      const at = view();
      driver?.dispose();
      undoWalk?.();
      driver = null;
      undoWalk = null;
      mode = next;
      if (next === 'FIXED') {
        if (source === render) {
          restore();
          render.attachControl(true);
        }
        return;
      }
      render.detachControl();
      driver = driverOf(next, at);
      driver.attachControl(true);
      canvas?.focus({ preventScroll: true });
    },
    /**
     * Looks through another of the scene's cameras, as its author placed it.
     * @param {import('@babylonjs/core').TargetCamera} camera
     */
    look(camera) {
      source = camera;
      if (camera === render) restore();
      this.navigate('FIXED');
    },
    dispose() {
      driver?.dispose();
      undoWalk?.();
      scene.onBeforeRenderObservable.remove(copy);
      restore();
    },
  };
}
