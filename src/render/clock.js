// Virtual clock for offline rendering. Replaces the wall-clock sources user code and Babylon read
// (performance.now, Date.now, requestAnimationFrame, Math.random) so a frame renders the same way on any
// machine and any run. Babylon's engine.getDeltaTime() follows once each render is bracketed by
// engine.beginFrame()/endFrame(), which measure time with performance.now.
export function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function installVirtualClock(target = globalThis, { epoch = Date.UTC(2000, 0, 1), seed = 1 } = {}) {
  const original = {
    now: target.performance.now.bind(target.performance),
    dateNow: target.Date.now,
    raf: target.requestAnimationFrame,
    caf: target.cancelAnimationFrame,
    random: target.Math.random,
  };
  let ms = 0;
  target.performance.now = () => ms;
  target.Date.now = () => epoch + ms;
  // Render loops started by user code never tick; the render job drives every frame itself.
  target.requestAnimationFrame = () => 0;
  target.cancelAnimationFrame = () => {};
  target.Math.random = seededRandom(seed);
  return {
    get ms() { return ms; },
    set(next) { ms = next; },
    reseed(next) { target.Math.random = seededRandom(next); },
    uninstall() {
      target.performance.now = original.now;
      target.Date.now = original.dateNow;
      target.requestAnimationFrame = original.raf;
      target.cancelAnimationFrame = original.caf;
      target.Math.random = original.random;
    },
  };
}
