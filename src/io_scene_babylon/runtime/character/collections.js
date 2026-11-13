// SPDX-License-Identifier: MIT OR Apache-2.0
// An armature's bone collections from the IR: each collection's bones, a parent collection's including its children's
// (as Blender's "select bones of collection and its children"). The IR writes each bone's collections on its pose
// bone, a collection met again as a reference to where it was first written.

const NAME = /collections\["((?:[^"\\]|\\.)*)"\](\.parent)*$/;
/** The collection a reference path names, and how many parents above it. @param {string} path */
const named = (path) => {
  const m = NAME.exec(path);
  if (!m) return null;
  return { name: JSON.parse(`"${m[1]}"`), up: (path.slice(m.index).match(/\.parent/g) ?? []).length };
};

/**
 * Bone names by collection name for armature object `armature` (null when the IR has none).
 * @param {any} ir @param {string} armature @returns {Map<string, string[]> | null}
 */
export function boneCollections(ir, armature) {
  const bones = ir?.ids?.[`OB:${armature}`]?.data?.pose?.bones;
  if (!Array.isArray(bones)) return null;
  /** @type {Map<string, string | null>} */ const parents = new Map();
  /** @type {[string, string][]} parent links that name a collection by reference, resolved once all are known */
  const pending = [];
  /** @type {(c: any) => string | null} the collection's name, learning its parents on the way */
  const learn = (c) => {
    if (!c) return null;
    if (typeof c.struct === 'string') return named(c.struct)?.name ?? null;
    if (!parents.has(c.name)) parents.set(c.name, null);
    if (c.parent?.name) { parents.set(c.name, c.parent.name); learn(c.parent); } else if (typeof c.parent?.struct === 'string') pending.push([c.name, c.parent.struct]);
    return c.name;
  };
  const own = bones.map((b) => [b.name, (b.bone?.collections ?? []).map(learn).filter(Boolean)]);
  // A reference to a parent: the collection it names, then that many parents up.
  for (const [name, path] of pending) {
    const ref = named(path);
    let at = ref?.name ?? null;
    for (let k = 0; at && k < (ref?.up ?? 0); k++) at = parents.get(at) ?? null;
    if (at) parents.set(name, at);
  }
  /** @type {Map<string, string[]>} */ const members = new Map();
  for (const [bone, names] of own) {
    const seen = new Set();
    for (let name of names) for (; name && !seen.has(name); name = parents.get(name) ?? null) seen.add(name);
    for (const name of seen) members.set(name, [...(members.get(name) ?? []), bone]);
  }
  return members;
}
