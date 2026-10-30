// A project's saved scene state (docs/model.md): its .blend, Main as Blender writes it (gzipped, as base64 in the
// project's JSON), and what Babylon owns of each object the project's code built. On opening, the code builds the scene
// first; an object whose id the .blend holds then takes Blender's state from it (main-view.js links them by id), one
// the code built that the .blend no longer holds was deleted, and objects the .blend adds are made.
import { gzipSync, gunzipSync } from 'fflate';
import { dnaGet } from '../makesrna/dna-struct.js';
import { nativeSnapshot, applyNative } from '../editors/undo/storage.js';
import { nodeId } from '../editors/object/identity.js';
import { PROPERTIES } from '../blenkernel/main-view.js';

const ID_OB = 0x424f;
const toBase64 = (bytes) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 32768) text += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(text);
};
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

// The scene's state to save: Main's .blend and every object's native data, deleted ones included (their ids).
// Without gzip's time stamp, the same scene saves as the same text.
export const projectState = (world) => ({ blend: toBase64(gzipSync(world.mainSync.projectBlend(), { mtime: 0 })), objects: nativeSnapshot(world.objects) });

// Opens a saved state over the objects the project's code built, before the scene sync starts: Main becomes the
// .blend's, its objects the ones of the ids they carry (blender-ids.js), and the saved native data is applied.
export function openProject(world, ids, { blend, objects: rows = [] }) {
  const { blender } = ids;
  blender.readBlend(gunzipSync(fromBase64(blend)));
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
