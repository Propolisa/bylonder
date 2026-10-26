// The editable document is a set of named slices. A slice owns its data and exposes:
//   capture(options) -> JSON-safe state (diff from code defaults where possible);
//                     options.save is true when writing saved scene edits rather than undo steps
//   apply(state)   -> restore from a captured state; undefined means code defaults
//   subscribe(fn)? -> notify on change, returns unsubscribe
//   dispose()?
// Undo history and saved scene edits only talk to the document, never to slices directly.
export function createDocument() {
  const slices = new Map();
  return {
    register(id, slice) {
      if (slices.has(id)) throw Error('Duplicate document slice: ' + id);
      slices.set(id, slice);
      return slice;
    },
    capture: (options = {}) => Object.fromEntries([...slices].map(([id, slice]) => [id, slice.capture(options)])),
    apply(state = {}) { for (const [id, slice] of slices) slice.apply(state[id]); },
    subscribe(fn) {
      const offs = [...slices.values()].map(slice => slice.subscribe?.(fn)).filter(Boolean);
      return () => offs.forEach(off => off());
    },
    dispose() { for (const slice of slices.values()) slice.dispose?.(); slices.clear(); },
  };
}

// Persists edits to animatable channels that no other slice owns, as a diff from their code values.
export function channelSlice(animation, owned = channel => false) {
  const persistable = ([, ch]) => !ch.transform && !owned(ch) && ch.available();
  const values = () => Object.fromEntries([...animation.channels].filter(persistable).map(([ref, ch]) => [ref, ch.get()]));
  const baseline = values();
  return {
    capture: () => Object.fromEntries(Object.entries(values()).filter(([ref, value]) => JSON.stringify(value) !== JSON.stringify(baseline[ref]))),
    apply(state = {}) {
      for (const [ref, ch] of animation.channels) {
        if (!persistable([ref, ch])) continue;
        const value = ref in state ? state[ref] : baseline[ref];
        if (value !== undefined) ch.set(value);
      }
    },
  };
}
