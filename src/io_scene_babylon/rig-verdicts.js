// What the export's rig judgement found (pose-export.js livePoseConstraints verdict), kept as derived data by the
// content it judged: the rig's description for the native runtime with its arrays and Mesh datablocks, named as
// scene.bin names arrays (contentKey), and the judge's version (pose-export.js JUDGE_VERSION), so a changed rig,
// mesh, action or judge judges again.
// The browser keeps them in its private storage (OPFS) beside the projects, so a later session's first export of an
// unchanged character skips the judgement; elsewhere (Node) they last the process. A distance no skin reaches
// (Infinity) is written as its name, which JSON has no number for.
import { contentKey } from './scene-bin.js';

const FILE = 'derived/rig-verdicts.json', KEPT = 32;
const text = new TextEncoder();
/** The verdicts by key, oldest first. @type {Map<string, any>} */
export const verdicts = new Map();
let changed = false;

/**
 * The key of a native rig's judgement: its description (packed JSON), its arrays' and its Mesh datablocks' content,
 * and `settings` (what else the judgement read: the judge's version, the frames it checked, its tolerance).
 * @param {{ description: Uint8Array, arrays: ArrayLike<number>[], data: Record<string, { description: Uint8Array, arrays: ArrayLike<number>[] }> }} native
 */
export function judgementKey(native, settings) {
  const arrays = (list) => list.map((array) => contentKey(/** @type {any} */ (array)));
  const meshes = Object.entries(native.data).sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, mesh]) => [key, contentKey(mesh.description), arrays(mesh.arrays)]);
  return contentKey(text.encode(JSON.stringify([settings, contentKey(native.description), arrays(native.arrays), meshes])));
}

export const knownVerdict = (key) => verdicts.get(key) ?? null;
export function keepVerdict(key, verdict) {
  verdicts.delete(key);
  verdicts.set(key, verdict);
  while (verdicts.size > KEPT) verdicts.delete(verdicts.keys().next().value);
  changed = true;
}

const storage = async () => (globalThis.navigator?.storage?.getDirectory ? (await import('../workspace/opfs.js')).openOPFS() : null);
/** The verdicts kept by earlier sessions, read once. */
export const loadVerdicts = (() => {
  let loading = null;
  return () => (loading ??= storage().then(async (io) => {
    const kept = io && JSON.parse((await io.read(FILE)) ?? '[]', (_, v) => (v === 'Infinity' ? Infinity : v));
    for (const [key, verdict] of kept ?? []) if (!verdicts.has(key)) verdicts.set(key, verdict);
  }).catch(() => {}));
})();
/** The verdicts written back where a judgement added one. */
export async function saveVerdicts() {
  if (!changed) return;
  changed = false;
  try { await (await storage())?.write(FILE, JSON.stringify([...verdicts], (_, v) => (v === Infinity ? 'Infinity' : v))); } catch {}
}
