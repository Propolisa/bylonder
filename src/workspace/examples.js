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
  { id: "particle-hair", title: "Grass Hill" },
  { id: "hair-dynamics", title: "Hair Dynamics" },
  { id: "geometry-nodes", title: "Geometry Nodes Meadow" },
  { id: "rigged-character", title: "Rigged Character" },
  { id: "lava", title: "Lava Sphere" },
  { id: "shader-gallery", title: "Shader Node Gallery" },
  { id: "python", title: "Python Scripts and Add-ons" },
  { id: "texture-paint", title: "Texture Paint" },
  { id: "grease-pencil", title: "Bouncing Ball" },
  { id: "shape-keys", title: "Shape Keys" },
  { id: "nla", title: "Nonlinear Animation" },
  { id: "newtons-cradle", title: "Newton's Cradle" },
  { id: "carousel", title: "Carousel" },
  { id: "lotus", title: "Lotus" },
  { id: "desk-lamp", title: "Desk Lamp" },
  { id: "import-export", title: "Import and Export" },
  { id: "link-append", title: "Link and Append" },
  { id: "rendering", title: "Window Light" },
  { id: "mesh-modeling", title: "Rangefinder Camera" },
  { id: "sculpting", title: "Ceramic Owl" },
  { id: "drivers-and-graph-editor", title: "Steam Engine" },
  { id: "vertex-and-weight-paint", title: "Koi Pond" },
  { id: "chess", title: "Chess Endgame" },
  // An application template: its startup file and workspaces (File > New > 2D Animation).
  { id: "2d-animation", title: "2D Animation", workspaces: [["2D Animation", "PAINT_GREASE_PENCIL"], ["2D Full Canvas", "PAINT_GREASE_PENCIL"]] },
].map((example) => ({ ...example, files: () => files(example.id) }));
