// Setter hooks on Babylon's objects for the scene sync (main-sync.js): a write to what an object's synced RNA reads
// calls onChange, which marks the object changed for the next flush. Babylon's own setters keep running: a hook wraps
// the prototype's accessor, or holds a plain field. A vector or quaternion is watched through the dirty flag every one
// of its writes sets; a color, which has none, through its channels.

// The fields an object's synced properties read (rna-bylonder.js), those an object has.
const FIELDS = ['name', 'parent', 'metadata', 'isPickable', 'position', 'rotation', 'scaling', 'rotationQuaternion',
  'intensity', 'diffuse', 'radius', 'shadowEnabled', 'angle', 'innerAngle', 'fov', 'fovMode', 'minZ', 'maxZ', 'mode'];
const CHANNELS = ['r', 'g', 'b'];
// The fields that hold a vector, quaternion or color, whose own writes are watched too.
const VALUES = new Set(['position', 'rotation', 'scaling', 'rotationQuaternion', 'diffuse']);

const descriptor = (owner, name) => {
  for (let o = owner; o; o = Object.getPrototypeOf(o)) {
    const d = Object.getOwnPropertyDescriptor(o, name);
    if (d) return { ...d, own: o === owner };
  }
  return null;
};

// Calls onChange when owner[name] is written. Returns the undo.
function hook(owner, name, onChange, watchValue) {
  const d = descriptor(owner, name);
  if (!d || (d.own && d.get?.hooked)) return () => {};
  let stored = d.own ? d.value : undefined, watched, unwatchValue = () => {};
  const rewatch = (value) => {
    if (!watchValue || value === watched) return;
    unwatchValue();
    [watched, unwatchValue] = [value, watchValue(value)];
  };
  rewatch(owner[name]);
  // A value Babylon replaced without the setter (its own field) is watched when next read.
  const get = d.get ? function () { const value = d.get.call(this); rewatch(value); return value; } : () => stored;
  get.hooked = true;
  Object.defineProperty(owner, name, {
    configurable: true, enumerable: d.enumerable ?? true, get,
    set(value) {
      if (d.set) d.set.call(this, value);
      else stored = value;
      rewatch(value);
      onChange();
    },
  });
  return () => {
    unwatchValue();
    const value = owner[name];
    delete owner[name];
    if (!d.get) owner[name] = value;
  };
}

// A vector's, quaternion's or color's writes.
function watchValue(value, onChange) {
  if (!value || typeof value !== 'object') return () => {};
  if ('_isDirty' in value) {
    let dirty = value._isDirty;
    Object.defineProperty(value, '_isDirty', { configurable: true, get: () => dirty, set(next) { dirty = next; if (next) onChange(); } });
    return () => { delete value._isDirty; value._isDirty = dirty; };
  }
  if (CHANNELS.every((c) => typeof value[c] === 'number')) {
    const undo = CHANNELS.map((c) => hook(value, c, onChange));
    return () => undo.forEach((fn) => fn());
  }
  return () => {};
}

// Watches a Babylon node (a mesh, light, camera or transform node). Returns the unwatch.
export function watchObject(node, onChange) {
  const undo = FIELDS.filter((name) => name in node).map((name) => hook(node, name, onChange, VALUES.has(name) && ((value) => watchValue(value, onChange))));
  const enabled = node.onEnabledStateChangedObservable?.add(onChange);
  return () => {
    undo.forEach((fn) => fn());
    node.onEnabledStateChangedObservable?.remove(enabled);
  };
}
