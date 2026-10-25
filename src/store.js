/** Schema-backed store. No UI or Babylon dependency. Effects return optional cleanup. */
export function createStore(
  schema,
  {
    onError = console.error,
    scheduleFrame = (cb) => requestAnimationFrame(cb),
    cancelFrame = (id) => cancelAnimationFrame(id),
  } = {},
) {
  const values = Object.fromEntries(
    Object.entries(schema).map(([key, def]) => [
      key,
      structuredClone(def.default),
    ]),
  );
  const subscribers = new Set(),
    effects = new Set();
  let disposed = false;
  const run = (effect) => {
    if (disposed || !effect.stale) return;
    effect.stale = false;
    try {
      effect.cleanup?.();
      const cleanup = effect.fn(
        { ...values },
        { changed: [...effect.changed] },
      );
      effect.cleanup = typeof cleanup === "function" ? cleanup : null;
      effect.changed.clear();
    } catch (error) {
      onError(error);
    }
  };
  const clear = (effect) => {
    if (effect.pending != null) {
      effect.mode === "frame"
        ? cancelFrame(effect.pending)
        : clearTimeout(effect.pending);
      effect.pending = null;
    }
  };
  const mark = (effect, key) => {
    effect.stale = true;
    effect.changed.add(key);
    effect.onStale?.(key);
    if (effect.mode === "manual") return;
    if (effect.mode === "immediate") {
      run(effect);
      return;
    }
    if (effect.mode === "debounce") clear(effect);
    if (effect.pending == null)
      effect.pending =
        effect.mode === "frame"
          ? scheduleFrame(() => {
              effect.pending = null;
              run(effect);
            })
          : setTimeout(() => {
              effect.pending = null;
              run(effect);
            }, effect.delay);
  };
  const api = {
    schema,
    values,
    set(key, input) {
      if (disposed) throw Error("Store is disposed");
      const def = schema[key];
      if (!def) throw Error("Unknown parameter: " + key);
      let value = input;
      if (typeof def.default === "number") {
        if (typeof value !== "number" || !Number.isFinite(value)) return false;
        value = Math.min(
          def.max ?? Infinity,
          Math.max(def.min ?? -Infinity, value),
        );
      }
      if (typeof value !== typeof def.default) return false;
      if (def.options && !Object.values(def.options).includes(value))
        return false;
      if (def.validate && !def.validate(value)) return false;
      if (Object.is(values[key], value)) return false;
      values[key] = value;
      for (const fn of subscribers) fn(key, value);
      for (const effect of effects) if (effect.keys.has(key)) mark(effect, key);
      return true;
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
    effect(keys, fn, { mode = "frame", delay = 120, onStale } = {}) {
      if (!["immediate", "frame", "debounce", "manual"].includes(mode))
        throw Error("Invalid effect mode");
      const effect = {
        keys: new Set(keys),
        fn,
        mode,
        delay,
        onStale,
        stale: true,
        changed: new Set(keys),
        pending: null,
        cleanup: null,
      };
      effects.add(effect);
      run(effect);
      return () => {
        clear(effect);
        effect.cleanup?.();
        effects.delete(effect);
      };
    },
    invalidate(key) {
      for (const effect of effects)
        if (!key || effect.keys.has(key)) mark(effect, key || "*");
    },
    flush() {
      for (const effect of effects) {
        clear(effect);
        run(effect);
      }
    },
    get stale() {
      return [...effects].some((effect) => effect.stale);
    },
    dispose() {
      for (const effect of effects) {
        clear(effect);
        effect.cleanup?.();
      }
      effects.clear();
      subscribers.clear();
      disposed = true;
    },
  };
  return api;
}
