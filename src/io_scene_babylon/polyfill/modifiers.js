// Bylonder's modifier kernels polyfill: Blender's modifier stacks kept live in a Babylon scene exported with Live
// modifiers. Each mesh whose metadata holds `bylonderModifiers` ({ base, stack }) is evaluated by Blender's code
// (modifiers.wasm) in a worker, and again whenever a modifier value changes (an animation group animates them in the
// stack's `values`). It imports nothing; modifiers-worker.js and modifiers.wasm sit next to it unless `url` names
// their folder.

const BUFFERS = { positions: 'position', normals: 'normal', uvs: 'uv' };
const bytes = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0)).buffer;
const TYPED = { vert_positions: Float32Array, edges: Int32Array, face_offsets: Int32Array, corner_verts: Int32Array, corner_edges: Int32Array, uvs: Float32Array };
// The base Mesh's arrays, given as typed arrays or as base64 text.
const typed = (base) => Object.fromEntries(Object.entries(base).filter(([, v]) => v).map(([k, v]) => [k, typeof v === 'string' ? new TYPED[k](bytes(v)) : v]));

function draw(mesh, buffers) {
  mesh.makeGeometryUnique();
  for (const [name, kind] of Object.entries(BUFFERS)) if (buffers[name]) mesh.setVerticesData(kind, buffers[name], false);
  mesh.setIndices(buffers.indices);
  mesh.refreshBoundingInfo();
}

// Keeps the scene's modifier stacks live. Resolves once each is drawn from its first evaluation; dispose() stops.
export async function liveModifiers(scene, { url = new URL('./', import.meta.url) } = {}) {
  const worker = new Worker(new URL('modifiers-worker.js', url), { type: 'module' });
  worker.postMessage({ wasm: new URL('modifiers.wasm', url).href });
  const pending = new Map();
  let next = 0;
  worker.onmessage = ({ data }) => {
    const { resolve, reject } = pending.get(data.id);
    pending.delete(data.id);
    if (data.error) reject(new Error(data.error));
    else resolve(data.buffers);
  };
  const evaluate = (base, stack) => new Promise((resolve, reject) => {
    const id = next++;
    pending.set(id, { resolve, reject });
    worker.postMessage({ id, base, stack });
  });

  const live = scene.meshes.filter((mesh) => mesh.metadata?.bylonderModifiers).map((mesh) => {
    const { base, stack } = mesh.metadata.bylonderModifiers;
    return { mesh, base: typed(base), stack, drawn: null, running: null };
  });
  // The settings as Blender takes them: an animated integer rounds, as Bylonder's channels do.
  const settings = (stack) => stack.map(({ type, layouts, values }) => ({
    type, layouts,
    values: Object.fromEntries(Object.entries(values).map(([path, v]) => {
      const layout = layouts[path.match(/^\w+/)[0]];
      return [path, typeof v === 'number' && layout && layout.kind !== 'float' && !layout.boolean ? Math.round(v) : v];
    })),
  }));
  const changed = (entry) => JSON.stringify(settings(entry.stack)) !== entry.drawn;
  // Evaluates an object's stack when its settings differ from what it draws; the newest settings win.
  const update = (entry) => {
    const stack = settings(entry.stack), key = JSON.stringify(stack);
    if (entry.running || key === entry.drawn) return entry.running;
    entry.running = evaluate(entry.base, stack).then((buffers) => {
      if (!entry.mesh.isDisposed()) draw(entry.mesh, buffers);
      entry.drawn = key;
    }, (error) => { entry.drawn = key; console.warn(`${entry.mesh.name}: ${error.message}`); }).finally(() => { entry.running = null; });
    return entry.running;
  };
  // Resolves once every stack is drawn with its current settings.
  const settled = async () => {
    while (live.some((entry) => entry.running || changed(entry))) await Promise.all(live.map(update));
  };
  await settled();
  const observer = scene.onBeforeRenderObservable.add(() => live.forEach(update));
  return { meshes: live.map((entry) => entry.mesh), settled, dispose() { scene.onBeforeRenderObservable.remove(observer); worker.terminate(); } };
}
