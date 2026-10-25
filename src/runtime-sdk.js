import { addModifier,curve,registerModifier } from './modifiers/stack.js';
import { registerPropertiesContext,registerPropertiesPanel } from './properties/registry.js';
import { createAnimationModel } from './animation/model.js';
import { registerStore, bindProperties } from './animation/bindings.js';
import { createText, updateText, textSchema } from "./text/text.js";
import { builderSchema } from "./objects/mesh-catalog";
import { createStore } from "./store";
export function createSDK(base, overrides, onChange, onAnimationChange = () => {}) {
  const animation = createAnimationModel(onAnimationChange);
  const properties = [];
  const systems = [],
    cleanups = [];
  let dispose = false;
  const sdk = {
    addModifier,curve,registerModifier,registerPropertiesContext,registerPropertiesPanel,
    animation,
    properties,
    animate(target, definition) { const binding = bindProperties(animation, target, definition); properties.push(binding); return binding; },
    createText,
    updateText,
    textSchema,
    meshBuilders: builderSchema,
    meshToolConfig: {},
    meshTools(config) {
      this.meshToolConfig = config;
    },
    controls({ id, title = id, schema, connect }) {
      if (!id || systems.some((s) => s.id === id))
        throw Error("Controls need a unique id: " + id);
      const store = createStore(schema, { onError: console.error });
      for (const [key, value] of Object.entries(overrides?.stores?.[id] || {}))
        if (schema[key]) store.set(key, value);
      store.ref = key => animation.ref("store:"+id, key);
      registerStore(animation, id, title, store);
      const disconnect = connect?.(store);
      const unsubscribe = store.subscribe(() => onChange());
      const system = {
        id,
        title,
        store,
        dispose() {
          unsubscribe();
          disconnect?.();
          store.dispose();
        },
      };
      systems.push(system);
      return store;
    },
    editable(node, { id } = {}) {
      if (id) node.name = id;
      node.metadata = { ...node.metadata, editable: true };
      return node;
    },
    asset(path) {
      return new URL(path, location.origin + base).href;
    },
    onDispose(fn) {
      cleanups.push(fn);
    },
    get systems() {
      return systems;
    },
    values() {
      return Object.fromEntries(
        systems.map((s) => [s.id, { ...s.store.values }]),
      );
    },
    dispose() {
      if (dispose) return;
      dispose = true;
      animation.dispose();
      systems.forEach((s) => s.dispose());
      cleanups.reverse().forEach((fn) => {
        try {
          fn();
        } catch (e) {
          console.error(e);
        }
      });
    },
  };
  return sdk;
}
