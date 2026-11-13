// The character's checks, taken each frame after it is posed: how far the planted foot (the one moving least) slides
// (mm per frame), the largest frame-to-frame jump of any deform bone in its own space, and what its update costs. Used
// by the page (?measure) and tools/docs/record-character-controller.mjs.
import { Vector3 } from '@babylonjs/core/Maths/math.vector.js';

/** @param {import('./world/bylonder/character/api.js').Character} hero */
export function createChecks(hero) {
  const rig = hero.rig, world = new Float32Array(rig.names.length * 16), feet = ['foot.L', 'foot.R'].map((role) => rig.boneIndex(hero.roles[role]));
  // The bones that skin: a rig's mechanism bones hold their rest under moving parents and never draw.
  const skinning = rig.names.flatMap((n, i) => (/^DEF-/.test(n) ? [i] : []));
  const at = (i) => new Vector3(world[i * 16 + 12], world[i * 16 + 13], world[i * 16 + 14]);
  const checks = { frames: 0, cost: 0, slide: [], jumps: [] };
  // Its update's cost, timed around it.
  const update = hero.update.bind(hero);
  hero.update = (dt) => { const t = performance.now(); update(dt); checks.cost += performance.now() - t; };
  let before = null, feetBefore = null, lowest = Infinity;
  return {
    checks,
    /** Takes this frame's checks. */
    take() {
      rig.readWorld(world);
      const inverse = hero.node.getWorldMatrix().clone().invert();
      const now = skinning.map((i) => Vector3.TransformCoordinates(at(i), inverse));
      if (before) checks.jumps.push(Math.max(...now.map((p, k) => Vector3.Distance(p, before[k]))));
      before = now;
      // The planted foot: the one that moved least over the ground while one is down (within 3 cm of the lowest an
      // ankle has been); in a run's flight neither is.
      const feetNow = feet.map(at), ground = hero.movement.position.y, heights = feetNow.map((p) => p.y - ground);
      lowest = Math.min(lowest, ...heights);
      const speed = Math.hypot(hero.velocity.x, hero.velocity.z);
      if (feetBefore && speed > 0.2 && Math.min(...heights) < lowest + 0.03) checks.slide.push(Math.min(...feetNow.map((p, k) => Math.hypot(p.x - feetBefore[k].x, p.z - feetBefore[k].z))) * 1000);
      feetBefore = feetNow;
      checks.frames++;
    },
    /** The checks so far, summed up. */
    summary() {
      const { slide, jumps, frames, cost } = checks, sorted = [...slide].sort((a, b) => a - b), steady = [...jumps].sort((a, b) => a - b);
      return { frames, costMs: cost / Math.max(frames, 1), slideMeanMm: slide.reduce((a, b) => a + b, 0) / Math.max(slide.length, 1),
        slideP95Mm: sorted[Math.floor(sorted.length * 0.95)] ?? 0, jumpP99Mm: (steady[Math.floor(steady.length * 0.99)] ?? 0) * 1000,
        jumpMaxMm: (steady.at(-1) ?? 0) * 1000 };
    },
  };
}
