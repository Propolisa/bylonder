import { addModifier,curve,registerModifier } from '../modifiers/stack.js';
import { registerPropertiesContext,registerPropertiesPanel } from '../editors/space_buttons/registry.js';
import { createAnimationModel } from '../blenkernel/animation/model.js';
import { registerStore, bindProperties } from '../blenkernel/animation/bindings.js';
import { createText, updateText, textSchema } from "../blenkernel/text/text.js";
import { builderSchema, createPrimitive, createMesh, shadeSmooth } from "../editors/object/mesh-catalog";
import { createStore } from "./store";
import { createMainSync } from "../blenkernel/main-sync.js";
import { createRNA } from "../makesrna/rna-bylonder.js";
import { report } from "../windowmanager/wm-reports.js";
import { createLight } from "../blenkernel/light/light-home.js";
export function createSDK(base, overrides, onChange, onAnimationChange = () => {}) {
  const animation = createAnimationModel(onAnimationChange);
  const properties = [];
  const systems = [],
    cleanups = [],
    render = {};
  let dispose = false;
  const sdk = {
    addModifier,curve,registerModifier,registerPropertiesContext,registerPropertiesPanel,
    animation,
    properties,
    animate(target, definition) { const binding = bindProperties(animation, target, definition); properties.push(binding); return binding; },
    createText,
    createPrimitive,
    createLight,
    createMesh,
    shadeSmooth,
    updateText,
    textSchema,
    meshBuilders: builderSchema,
    meshToolConfig: {},
    // The scene's render settings as code sets them (Blender's scene.render, scene.eevee, scene.view_settings),
    // shaped like the render slice: the baseline that edits in Properties are saved against.
    renderSettings(patch) {
      for (const [group, values] of Object.entries(patch)) render[group] = { ...render[group], ...values };
    },
    get authoredRender() {
      return render;
    },
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
    // A .blend file of the project opened into a scene (File > Open): Blender's reader puts its data in Main and the
    // scene sync makes it Babylon's (main-sync.js readBlend). What Bylonder cannot show is reported to the Info editor.
    async openBlend(path, scene) {
      const bytes = new Uint8Array(await (await fetch(this.asset(path))).arrayBuffer());
      const sync = createMainSync({ rna: createRNA({ world: { scene, objects: [] } }), ids: animation.ids });
      const { nodes, warnings } = sync.readBlend(bytes, scene);
      for (const warning of warnings) report("WARNING", warning);
      return nodes;
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
