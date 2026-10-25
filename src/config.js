/** Each reusable system owns an independent schema and namespace. */
export const displaySchema = {
  grid: { default: true, label: "Floor grid" },
  axes: { default: true, label: "World axes" },
  wireframe: { default: false, label: "Wireframe" },
};
export const lightingSchema = {
  key: { default: 2, label: "Key light", min: 0, max: 4, step: 0.05 },
  fill: { default: 0.65, label: "Fill light", min: 0, max: 2, step: 0.05 },
};
export const geometrySchema = {
  detail: { default: 48, label: "Sphere detail", min: 8, max: 64, step: 4 },
};
