// A project's saved scene state (docs/model.md): its .blend, Main as Blender writes it (gzipped, a binary value of the
// project, workspace/binary.js), and what Babylon owns of each object the project's code built. On opening, the code
// builds the scene first; an object whose id the .blend holds then takes Blender's state from it (main-view.js links them by id), one
// the code built that the .blend no longer holds was deleted, and objects the .blend adds are made.
import { blendValue } from './project-gzip.js';
import { bytesOf } from '../workspace/binary.js';
import { dnaGet } from '../makesrna/dna-struct.js';
import { nativeSnapshot, applyNative } from '../editors/undo/storage.js';
import { nodeId } from '../editors/object/identity.js';
import { PROPERTIES } from '../blenkernel/main-view.js';

const ID_OB = 0x424f;

// The scene's state to save: Main's .blend and every object's native data, deleted ones included (their ids).
export const projectState = (world) => ({ blend: blendValue(world.mainSync.projectBlend()), objects: nativeSnapshot(world.objects) });

// projectState's, its .blend gzipped by a worker (project-gzip-worker.js): this thread only writes the .blend.
let worker = null, requests = 0;
const replies = new Map();
export function projectStateInWorker(world) {
  const bytes = world.mainSync.projectBlend(), objects = nativeSnapshot(world.objects), id = ++requests;
  worker ??= Object.assign(new Worker(new URL('./project-gzip-worker.js', import.meta.url), { type: 'module' }), {
    onmessage: ({ data }) => { replies.get(data.id)(data.blend); replies.delete(data.id); },
  });
  return new Promise((resolve) => {
    replies.set(id, (blend) => resolve({ blend, objects }));
    worker.postMessage({ id, bytes }, [bytes.buffer]);
  });
}

// Opens a saved state over the objects the project's code built, before the scene sync starts: Main becomes the
// .blend's, its objects the ones of the ids they carry (blender-ids.js), and the saved native data is applied. A project
// saved before keeps its .blend as base64 text.
export async function openProject(world, ids, { blend, objects: rows = [] }) {
  const { blender } = ids;
  blender.readBlend(await bytesOf(blend));
  ids.clear();
  const held = new Set();
  for (const ob of blender.ids(ID_OB)) {
    const id = blender.property(ob, PROPERTIES.id);
    if (!id) continue;
    held.add(id);
    ids.adopt('object:' + id, ob, dnaGet('Object', ob, 'type'));
  }
  const saved = new Set(rows.map((row) => row.id));
  for (const node of world.objects) {
    if (!saved.has(nodeId(node)) || held.has(nodeId(node))) continue;
    node.metadata = { ...node.metadata, wbDeleted: true };
    node.setEnabled(false);
  }
  applyNative(world.objects, rows);
  ids.read = true;
}
