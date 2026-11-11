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
 * Returns { range, frames, keeps(name), rates(), over(range), sample(read), evaluate(sync, current) }: the range sampled;
 * every frame Main is evaluated at, ascending; a test of whether a frame is on the grid of an object whose animation is
 * baked; the rate of each such object, by name; the same sampling over another range (an action's), whose baked
 * objects it names too; a read of Main at each frame (read(frame)), and the pass that evaluates each frame once for
 * every read, then `current` again.
 */
export function exportSampling({ frameStart, frameEnd, fps }, { rate = null, instances = {} } = {}, baked = new Set()) {
  const rateOf = (name) => instances[name] ?? rate ?? fps;
  const grids = new Map();
  const gridOf = (r) => {
    if (!grids.has(r)) grids.set(r, new Set(grid(frameStart, frameEnd, fps / r)));
    return grids.get(r);
  };
  const frames = [...new Set([fps, rate, ...Object.values(instances)].filter((r) => r > 0).flatMap((r) => [...gridOf(r)]))].sort((a, b) => a - b);
  const reads = [];
  return {
    range: { frameStart, frameEnd, fps },
    frames,
    keeps(name) {
      baked.add(name);
      const set = gridOf(rateOf(name));
      return (frame) => set.has(frame);
    },
    rates: () => Object.fromEntries([...baked].sort().map((name) => [name, rateOf(name)])),
    over: (range) => exportSampling({ fps, ...range }, { rate, instances }, baked),
    sample: (read) => reads.push(read),
    evaluate(sync, current) {
      if (!reads.length) return;
      for (const frame of frames) {
        sync.frameChanged(frame, { draw: false });
        for (const read of reads) read(frame);
      }
      reads.length = 0;
      sync.frameChanged(current);
    },
  };
}
