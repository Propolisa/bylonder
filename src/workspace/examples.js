import { binaryFile, textFile } from "./project-model.js";

// Each example is a project folder under examples/, shipped as text, and its .blend files as assets fetched when it
// opens.
const sources = import.meta.glob(["../../examples/**/*", "!**/*.blend"], { query: "?raw", import: "default", eager: true });
const blends = import.meta.glob("../../examples/**/*.blend", { query: "?url", import: "default", eager: true });
const json = (value) => textFile(JSON.stringify(value, null, 2));
const inExample = (id, all) => Object.entries(all).filter(([path]) => path.startsWith(`../../examples/${id}/`)).map(([path, value]) => [path.slice(`../../examples/${id}/`.length), value]);
const files = async (id) => ({
  "importmap.json": json({ imports: {} }),
  "types.json": json({ imports: {} }),
  ...Object.fromEntries(inExample(id, sources).map(([path, source]) => [path, textFile(source)])),
  ...Object.fromEntries(await Promise.all(inExample(id, blends).map(async ([path, url]) => [path, binaryFile(new Uint8Array(await (await fetch(url)).arrayBuffer()))]))),
});

export const examples = [
  { id: "cube", title: "Default Cube" },
  { id: "still-life", title: "Still Life" },
  { id: "island", title: "Volcanic Island" },
  { id: "coast", title: "Dusk Coast" },
  { id: "orrery", title: "Orrery" },
  { id: "lumen", title: "Lumen" },
  { id: "materials", title: "Materials & Nodes" },
  { id: "solar", title: "Solar System" },
  { id: "arrays", title: "Array Modifiers" },
  { id: "animation", title: "Keyframe Animation" },
  { id: "city", title: "Procedural City" },
  { id: "shader", title: "Shader Waves" },
  { id: "text", title: "3D Text" },
  { id: "hair", title: "Combed Hair" },
  { id: "hair-dynamics", title: "Hair Dynamics" },
  { id: "rigged-character", title: "Rigged Character" },
  { id: "lava", title: "Lava Sphere" },
].map((example) => ({ ...example, files: () => files(example.id) }));
