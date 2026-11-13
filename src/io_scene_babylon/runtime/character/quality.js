// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// Quality (docs/character-animation.md Quality): the page's tier from the median of its last 2 s of frame times, one
// step down after 1 s over budget, one up after 5 s well under; and each character's schedule: off screen it advances
// only its clocks and root, and on tier C a small one updates every other frame. Allocates nothing per frame.
import { Vector3 } from '@babylonjs/core';

const TIERS = /** @type {const} */ (['A', 'B', 'C']);
/** Frame times are binned by a quarter millisecond up to 100 ms for the median; the window holds 2 s of frames. */
const BIN = 0.25, BINS = 400, FRAMES = 1024, WINDOW = 2000;
/** On screen, a character whose height covers less than this share of the view's height is small. */
const SMALL = 0.15;

/**
 * A picker fed each frame's time; it returns the tier to use. `budget`: the frame time to keep under (ms).
 * @param {{ budget?: number, down?: number, up?: number }} [options]
 */
export function createTierPicker({ budget = 1000 / 60, down = 1, up = 5 } = {}) {
  const counts = new Uint16Array(BINS), times = new Float32Array(FRAMES);
  let first = 0, count = 0, span = 0, over = 0, under = 0;
  const bin = (/** @type {number} */ ms) => Math.min(BINS - 1, Math.floor(ms / BIN));
  const median = () => {
    for (let b = 0, seen = 0; b < BINS; b++) if ((seen += counts[b]) * 2 >= count) return (b + 0.5) * BIN;
    return 0;
  };
  /** @param {import('./api.js').Tier} tier @param {number} ms */
  return (tier, ms) => {
    if (count === FRAMES) { counts[bin(times[first])]--; span -= times[first]; first = (first + 1) % FRAMES; count--; }
    times[(first + count++) % FRAMES] = ms;
    counts[bin(ms)]++;
    span += ms;
    while (span - times[first] >= WINDOW) { counts[bin(times[first])]--; span -= times[first]; first = (first + 1) % FRAMES; count--; }
    const typical = median();
    over = typical > budget * 1.1 ? over + ms : 0;
    under = typical < budget * 0.6 ? under + ms : 0;
    const at = TIERS.indexOf(tier);
    if (over >= down * 1000 && at < TIERS.length - 1) { over = 0; return TIERS[at + 1]; }
    if (under >= up * 1000 && at > 0) { under = 0; return TIERS[at - 1]; }
    return tier;
  };
}

/**
 * When a character updates and how much: `step(dt)` gives the seconds to run this frame, or -1 to skip it (tier C, a
 * small character, every other frame; the skipped time runs with the next), and `onScreen()` whether any of its meshes
 * is in the camera's view (true before the first frame is drawn, or without a camera).
 * @param {any} character
 */
export function createSchedule(character) {
  const { scene } = character.blend, meshes = scene.meshes.filter((/** @type {any} */ m) => m.skeleton && m.skeleton.id.split(' ')[0] === character.armature);
  const at = new Vector3();
  let banked = 0, odd = false;
  const onScreen = () => {
    const planes = scene.frustumPlanes;
    if (!scene.activeCamera || !planes?.length || !meshes.length) return true;
    for (const mesh of meshes) if (mesh.isInFrustum(planes)) return true;
    return false;
  };
  const small = () => {
    const camera = scene.activeCamera;
    if (!camera || !meshes.length) return false;
    const sphere = meshes[0].getBoundingInfo().boundingSphere, distance = Vector3.Distance(camera.globalPosition, at.copyFrom(sphere.centerWorld));
    return (2 * sphere.radiusWorld) / (2 * distance * Math.tan((camera.fov ?? 0.8) / 2)) < SMALL;
  };
  return {
    onScreen,
    /** @param {number} dt */
    step(dt) {
      if (character.constructor.tier !== 'C' || !small()) { const run = dt + banked; banked = 0; return run; }
      odd = !odd;
      if (odd) { banked += dt; return -1; }
      const run = dt + banked;
      banked = 0;
      return run;
    },
  };
}
