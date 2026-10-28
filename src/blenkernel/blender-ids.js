// The IDs that stand for Bylonder's data in the module's Blender world (one BlenderMain per world): an object for each
// Bylonder object, by key ('object:' and its node id), whoever asks first (the Object Mode mirror, or animation data
// for an object not built yet). An object made again with another type keeps its animation.
import { BlenderMain, blenderModule } from '../bmesh/bmesh-wasm.js';

const { exports: x } = blenderModule;

export function createBlenderIDs(blender = new BlenderMain()) {
  const objects = new Map(); // key -> { ob, type }
  return {
    blender,
    get scene() { return blender.scene; },
    // The object for a key, of a type (EMPTY when not given and none exists yet).
    object(key, type, name = key) {
      const entry = objects.get(key);
      if (entry && (!type || entry.type === type)) return entry.ob;
      const ob = blender.add(type ?? 'EMPTY', name);
      if (entry) {
        x.anim_animdata_move(blender.bmain, entry.ob, ob);
        blender.remove(entry.ob);
      }
      objects.set(key, { ob, type: type ?? 'EMPTY' });
      return ob;
    },
    has: (key) => objects.has(key),
    find: (key) => objects.get(key)?.ob ?? null,
    // Removes the object for a key; one that has animation stays, hidden, as Bylonder keeps keys of objects it lost.
    remove(key) {
      const entry = objects.get(key);
      if (!entry) return;
      if (x.anim_fcurves(entry.ob, 0) > 0) blender.setBase(entry.ob, { visible: false });
      else {
        blender.remove(entry.ob);
        objects.delete(key);
      }
    },
    // Drops the object for a key that Blender's code freed (an Outliner delete).
    forget: (key) => objects.delete(key),
    entries: () => [...objects].map(([key, { ob, type }]) => ({ key, ob, type })),
  };
}
