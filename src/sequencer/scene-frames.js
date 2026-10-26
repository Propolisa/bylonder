import { openRenderContext } from '../render/render-context.js';

// Frames of scene strips (KubeezCut's SceneFrameSource). Each scene renders in its own render context built
// from its saved data, or the live document for the active scene; frames are cached by scene revision, so an
// edit to a scene invalidates only its frames. Preview frames render at a reduced size and prefetch ahead.
const PREVIEW_SCALE = 0.5;
const CACHE_BYTES = 512 * 1024 * 1024;
const PREFETCH = 12;
const IDLE_MS = 60000;

export function createSceneFrames({ payload, revision }) {
  const contexts = new Map();
  const cache = new Map();
  const listeners = new Set();
  let bytes = 0;
  let queue = Promise.resolve();
  let latest = null;

  const sizeOf = ({ width, height, quality }) => {
    const scale = quality === 'final' ? 1 : PREVIEW_SCALE;
    return { width: Math.max(2, Math.round(width * scale)), height: Math.max(2, Math.round(height * scale)) };
  };
  const keyOf = (request) => {
    const { width, height } = sizeOf(request);
    return [request.scene, revision(request.scene), request.camera || '', width, height, request.frame].join('|');
  };

  function remember(key, bitmap) {
    cache.set(key, bitmap);
    bytes += bitmap.width * bitmap.height * 4;
    for (const [oldest, old] of cache) {
      if (bytes <= CACHE_BYTES) break;
      cache.delete(oldest);
      bytes -= old.width * old.height * 4;
      old.close();
    }
  }

  async function contextFor(scene) {
    const rev = revision(scene);
    let entry = contexts.get(scene);
    if (entry?.revision !== rev) {
      entry?.started.then((c) => c.dispose(), () => {});
      entry = { revision: rev, started: openRenderContext(payload(scene), { width: 16, height: 16 }) };
      contexts.set(scene, entry);
    }
    clearTimeout(entry.idle);
    entry.idle = setTimeout(() => { entry.started.then((c) => c.dispose(), () => {}); contexts.delete(scene); }, IDLE_MS);
    return (await entry.started).context;
  }

  // Final frames are each drawn once: only the latest per scene is kept, so memory stays flat during renders.
  const finals = new Map();
  function renderFinal(request) {
    const job = queue.then(async () => {
      const context = await contextFor(request.scene);
      const bitmap = await context.renderFrame({ ...sizeOf(request), frame: request.frame, camera: request.camera, quality: 'final' });
      finals.get(request.scene)?.close();
      finals.set(request.scene, bitmap);
      return bitmap;
    });
    queue = job.catch(() => null);
    return job;
  }

  function render(request) {
    if (request.quality === 'final') return renderFinal(request);
    const key = keyOf(request);
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    const job = queue.then(async () => {
      if (cache.has(key)) return cache.get(key);
      const context = await contextFor(request.scene);
      const bitmap = await context.renderFrame({ ...sizeOf(request), frame: request.frame, camera: request.camera });
      if (keyOf(request) !== key) { bitmap.close(); return null; }
      remember(key, bitmap);
      return bitmap;
    });
    queue = job.catch(() => null);
    return job;
  }

  function prefetch(request) {
    latest = request;
    queue.then(async () => {
      for (let i = 1; i <= PREFETCH && latest === request; i++) await render({ ...request, frame: request.frame + i }).catch(() => null);
    });
  }

  return {
    async getFrame(request) {
      const bitmap = await render(request).catch(() => null);
      if (request.quality === 'preview') prefetch(request);
      return bitmap;
    },
    peekFrame: (request) => cache.get(keyOf(request)) ?? null,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    // A scene changed: its new revision misses the cache, and previews redraw.
    changed() { listeners.forEach((fn) => fn()); },
    dispose() {
      for (const entry of contexts.values()) { clearTimeout(entry.idle); entry.started.then((c) => c.dispose(), () => {}); }
      contexts.clear();
      for (const bitmap of [...cache.values(), ...finals.values()]) bitmap.close();
      cache.clear();
      finals.clear();
    },
  };
}
