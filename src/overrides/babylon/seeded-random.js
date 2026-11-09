// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of Babylon's Fast GI (SSAO2) set-up: its sample kernel and noise drawn from a fixed seed instead of Math.random, so every view and every render draw the same pattern and rendered images match the rendered viewport; goes when Babylon takes a seed.
import { seededRandom } from '../../render/clock.js';

export const withSeededRandom = (create) => {
  const random = Math.random;
  Math.random = seededRandom(1);
  try { return create(); } finally { Math.random = random; }
};
