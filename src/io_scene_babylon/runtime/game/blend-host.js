// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// A run's scene as game/world.js reads it, from a package's controller (BlendScene): the objects with behaviours (the
// IR's `["behaviors"]` custom property group of each), their props live from the controls (an edit in Blender reaches
// them at once), ID pointers by their IDs' names, and Blender's own transforms for `entity.authored`.

const key = (/** @type {string} */ name) => `["${name.replace(/["\\]/g, (c) => '\\' + c)}"]`;
const GROUP = key('behaviors');

/**
 * @param {import('../blend-scene.js').BlendScene<any>} blend
 * @returns {import('./world.js').Host}
 */
export function blendHost(blend) {
  const ids = /** @type {Record<string, { type: string, name: string, path: string | null, data: any }>} */ (blend.ir.ids);
  /** A spawned copy's key to the object it copies, whose props it reads. @type {Map<string, string>} */
  const sources = new Map();
  let spawned = 0;
  const source = (/** @type {string} */ object) => sources.get(object) ?? object;
  const behaviorsOf = (/** @type {string} */ object) => ids[source(object)]?.data?.[GROUP] ?? null;
  /** How a path reads: a control, three controls of a colour, or the IR's data. @type {Map<string, 'control' | 'array' | 'data'>} */
  const kinds = new Map();
  const has = (/** @type {string} */ path) => { try { blend.get(path); return true; } catch { return false; } };
  /** @param {string} path */
  const kindOf = (path) => {
    let kind = kinds.get(path);
    if (!kind) kinds.set(path, (kind = has(path) ? 'control' : has(`${path}[0]`) ? 'array' : 'data'));
    return kind;
  };
  return {
    scene: blend.scene,
    blend,
    // The scene's objects with behaviours, those of prefab collections (excluded or hidden) left for spawn().
    objects: () => {
      const shown = new Set(blend.collections().filter((c) => c.visible).flatMap((c) => c.objects));
      return Object.keys(ids).filter((object) => ids[object].type === 'OBJECT' && behaviorsOf(object) && shown.has(object))
        .map((object) => ({ key: object, name: ids[object].name, node: /** @type {any} */ (blend.nodeOf(object)), behaviors: Object.keys(behaviorsOf(object)) }));
    },
    value(object, behavior, prop) {
      object = source(object);
      const path = `${ids[object]?.path}${GROUP}${key(behavior)}${key(prop)}`;
      switch (kindOf(path)) {
        case 'control': return blend.get(path);
        case 'array': { const values = []; for (let i = 0; has(`${path}[${i}]`); i++) values.push(blend.get(`${path}[${i}]`)); return values; }
        default: {
          const raw = behaviorsOf(object)?.[behavior]?.[prop];
          const named = (/** @type {any} */ v) => (v && typeof v === 'object' && 'id' in v ? ids[v.id]?.name ?? null : v);
          // Several IDs (sounds to pick from) are a group of them by their place.
          return raw && typeof raw === 'object' && !('id' in raw) && !Array.isArray(raw) ? Object.values(raw).map(named) : named(raw);
        }
      }
    },
    play: (action) => { blend.play(action); },
    // A collection's objects copied for the run, as a prefab: each object's node cloned with its children (geometry and
    // materials shared, read-only to game code), shown, and reading its source's props.
    spawn(collection) {
      const objects = blend.objectsIn(collection), within = new Set(objects);
      const roots = objects.filter((object) => !within.has(ids[object]?.data?.parent?.id));
      /** @type {import('./world.js').HostObject[]} */
      const made = [];
      for (const object of roots) {
        const node = /** @type {any} */ (blend.nodeOf(object));
        if (!node) continue;
        const copy = node.instantiateHierarchy(node.parent, { doNotInstantiate: true }, (/** @type {any} */ from, /** @type {any} */ to) => {
          const original = objects.find((o) => blend.nodeOf(o) === from);
          if (!original) return;
          const copyKey = `${original}~${++spawned}`;
          sources.set(copyKey, original);
          // Shown: a prefab's collection is excluded or hidden, which hid the original, not its copies.
          to.setEnabled(true);
          if ('isVisible' in to) to.isVisible = true;
          made.push({ key: copyKey, name: to.name, node: to, behaviors: Object.keys(behaviorsOf(original) ?? {}) });
        });
        copy?.setEnabled(true);
      }
      return made;
    },
  };
}
