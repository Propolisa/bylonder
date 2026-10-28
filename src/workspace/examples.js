import { textFile } from "./project-model.js";

// Each example is a project folder under examples/, shipped as text.
const sources = import.meta.glob("../../examples/**/*", { query: "?raw", import: "default", eager: true });
const json = (value) => textFile(JSON.stringify(value, null, 2));
const files = (id) => {
  const prefix = `../../examples/${id}/`;
  return {
    "importmap.json": json({ imports: {} }),
    "types.json": json({ imports: {} }),
    ...Object.fromEntries(Object.entries(sources).filter(([path]) => path.startsWith(prefix)).map(([path, source]) => [path.slice(prefix.length), textFile(source)])),
  };
};

export const examples = [
  { id: "cube", title: "Default Cube" },
  { id: "still-life", title: "Still Life" },
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
].map((example) => ({ ...example, files: () => files(example.id) }));
