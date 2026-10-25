import { VertexData } from "@babylonjs/core";
export function bindDisplay(store, world) {
  return store.effect(["grid", "axes", "wireframe"], (v) => {
    world.grid.setEnabled(v.grid);
    world.axes.forEach((a) => a.setEnabled(v.axes));
    world.objects.forEach(
      (m) => m.material && (m.material.wireframe = v.wireframe),
    );
  });
}
export function bindLighting(store, world) {
  return store.effect(["key", "fill"], (v) => {
    world.key.intensity = v.key;
    world.fill.intensity = v.fill;
  });
}
export function bindGeometry(store, world) {
  return store.effect(
    ["detail"],
    (v) => {
      const sphere = world.objects.find((m) => m.name === "Sphere");
      VertexData.CreateSphere({
        diameter: 1.45,
        segments: Math.round(v.detail),
      }).applyToMesh(sphere);
      sphere.refreshBoundingInfo();
    },
    { mode: "debounce", delay: 150 },
  );
}
