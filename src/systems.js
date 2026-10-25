import { createStore } from "./store";
import { displaySchema, lightingSchema, geometrySchema } from "./config";
import { bindDisplay, bindLighting, bindGeometry } from "./effects";
/** Factory instances are isolated: reuse a definition with different dependencies. */
export function createSystem({ id, title, schema, connect }, context, onError) {
  const store = createStore(schema, { onError });
  const disconnect = connect(store, context);
  return {
    id,
    title,
    store,
    dispose() {
      disconnect?.();
      store.dispose();
    },
  };
}
export const systemDefinitions = [
  {
    id: "display",
    title: "Display",
    schema: displaySchema,
    connect: bindDisplay,
  },
  {
    id: "lighting",
    title: "Lighting",
    schema: lightingSchema,
    connect: bindLighting,
  },
  {
    id: "geometry",
    title: "Geometry",
    schema: geometrySchema,
    connect: bindGeometry,
  },
];
export const createSystems = (world, onError) =>
  systemDefinitions.map((def) => createSystem(def, world, onError));
