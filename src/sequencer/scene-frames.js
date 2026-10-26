import { openRenderContext } from '../render/render-context.js';

// Frames of scene strips (KubeezCut's SceneFrameSource). Each scene renders in its own render context, from its
// saved data or the live document for the active scene. Frames are keyed by scene revision (a content hash), so
// editing a scene misses only its frames. Previews render at the proxy render size and prefetch ahead; Rebuild
// Proxy stores a strip's frames in OPFS, where they survive reloads until the scene changes.
const CACHE_BYTES = 512 * 1024 * 1024;
const PREFETCH = 12;
const IDLE_MS = 60000;
const PROXY_DIR = 'scene-proxies';

async function proxyDir(create) {
  return (await navigator.storage.getDirectory()).getDirectoryHandle(PROXY_DIR, { create });
}
const proxyName = (key) => key.replace(/[^\w.-]/g, '_') + '.webp';

export function createSceneFrames({ payload, revision }) {
  const contexts = new Map();
  const cache = new Map();
  const finals = new Map();
  const listeners = new Set();
  let bytes = 0;
  let queue = Promise.resolve();
  let latest = null;
  let proxyScale = 0.5;

  const sizeOf = ({ width, height, quality }) => {
    const scale = quality === 'final' ? 1 : proxyScale;
    return { width: Math.max(2, Math.round(width * scale)), height: Math.max(2, Math.round(height * scale)) };
  };
  const keyOf = (request) => {
    const { width, height } = sizeOf(request);
    return [request.scene, revision(request.scene), request.camera || '', width, height, request.frame].join('|');
  };
  const enqueue = (task) => {
    const job = queue.then(task);
    queue = job.catch(() => null);
    return job;
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

  const renderInContext = async (request, quality) => (await contextFor(request.scene)).renderFrame({ ...sizeOf(request), frame: request.frame, camera: request.camera, quality });

  async function readProxy(key) {
    try {
      const file = await (await (await proxyDir(false)).getFileHandle(proxyName(key))).getFile();
      return await createImageBitmap(file);
    } catch { return null; }
  }

  // Final frames are each drawn once: only the latest per scene is kept, so memory stays flat during renders.
  const renderFinal = (request) => enqueue(async () => {
    const bitmap = await renderInContext(request, 'final');
    finals.get(request.scene)?.close();
    finals.set(request.scene, bitmap);
    return bitmap;
  });

  function render(request) {
    if (request.quality === 'final') return renderFinal(request);
    const key = keyOf(request);
    if (cache.has(key)) return Promise.resolve(cache.get(key));
    return enqueue(async () => {
      if (cache.has(key)) return cache.get(key);
      const bitmap = await readProxy(key) ?? await renderInContext(request, 'preview');
      if (keyOf(request) !== key) { bitmap.close(); return null; }
      remember(key, bitmap);
      return bitmap;
    });
  }

  function prefetch(request) {
    latest = request;
    queue.then(async () => {
      for (let i = 1; i <= PREFETCH && latest === request; i++) await render({ ...request, frame: request.frame + i }).catch(() => null);
    });
  }

  const changed = () => listeners.forEach((fn) => fn());

  return {
    async getFrame(request) {
      const bitmap = await render(request).catch(() => null);
      if (request.quality === 'preview') prefetch(request);
      return bitmap;
    },
    peekFrame: (request) => cache.get(keyOf(request)) ?? null,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    changed,
    get proxyScale() { return proxyScale; },
    setProxyScale(scale) { proxyScale = scale; changed(); },
    // Blender's Rebuild Proxy: renders frames [request.frame, frameEnd] at the proxy size into OPFS.
    async bake(request, frameEnd, onProgress = () => {}) {
      const dir = await proxyDir(true);
      for (let frame = request.frame; frame <= frameEnd; frame++) {
        const key = keyOf({ ...request, frame });
        const bitmap = await enqueue(() => renderInContext({ ...request, frame }, 'preview'));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        canvas.getContext('2d').drawImage(bitmap, 0, 0);
        const writable = await (await dir.getFileHandle(proxyName(key), { create: true })).createWritable();
        await writable.write(await canvas.convertToBlob({ type: 'image/webp', quality: 0.9 }));
        await writable.close();
        if (cache.has(key)) bitmap.close(); else remember(key, bitmap);
        onProgress(frame - request.frame + 1, frameEnd - request.frame + 1);
      }
    },
    dispose() {
      for (const entry of contexts.values()) { clearTimeout(entry.idle); entry.started.then((c) => c.dispose(), () => {}); }
      contexts.clear();
      for (const bitmap of [...cache.values(), ...finals.values()]) bitmap.close();
      cache.clear();
      finals.clear();
    },
  };
}
