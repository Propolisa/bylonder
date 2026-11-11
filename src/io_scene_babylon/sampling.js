// The frames an export samples animation at (export-options.js sampleRate). Main is evaluated at every whole frame of the
// scene range, which exact keys and the page's F-Curves are checked against, and on each rate's grid; a baked animation
// keys its object's grid, frameStart + k * fps / rate through frameEnd, Babylon interpolating between.
const round = (frame) => Math.round(frame * 1e6) / 1e6;
function grid(frameStart, frameEnd, step) {
  const frames = [];
  for (let k = 0; frameStart + k * step <= frameEnd + 1e-6; k++) frames.push(round(frameStart + k * step));
  // The range's last frame is keyed too, so the animation holds it rather than its last grid frame.
  if (frames.at(-1) < frameEnd) frames.push(frameEnd);
  return frames;
}

/**
 * The export's sampling over the scene range at `fps`: `rate` for every object, `instances` by object name; unset, the
 * scene's frame rate (a key per frame).
 * Returns { frames, keeps(name), rates() }: every frame Main is evaluated at, ascending; a test of whether a frame is on
 * the grid of an object whose animation is baked; and the rate of each such object, by name.
 */
export function exportSampling({ frameStart, frameEnd, fps }, { rate = null, instances = {} } = {}) {
  const rateOf = (name) => instances[name] ?? rate ?? fps;
  const grids = new Map();
  const gridOf = (r) => {
    if (!grids.has(r)) grids.set(r, new Set(grid(frameStart, frameEnd, fps / r)));
    return grids.get(r);
  };
  const frames = [...new Set([fps, rate, ...Object.values(instances)].filter((r) => r > 0).flatMap((r) => [...gridOf(r)]))].sort((a, b) => a - b);
  const baked = new Set();
  return {
    frames,
    keeps(name) {
      baked.add(name);
      const set = gridOf(rateOf(name));
      return (frame) => set.has(frame);
    },
    rates: () => Object.fromEntries([...baked].sort().map((name) => [name, rateOf(name)])),
  };
}
