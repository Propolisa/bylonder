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
  // Newest first, as the splash lists them.
  { id: "compositor", title: "Menya Akari" },
  { id: "volumes", title: "Temple Light" },
  { id: "light-probes", title: "Reading Corner" },
  { id: "bouncing-ball", title: "Bouncing Ball" },
  { id: "framed-print", title: "Framed Print" },
  { id: "tin-cans", title: "Tin Cans" },
  { id: "robot-arm", title: "Robot Arm" },
  { id: "geometry-node-editor", title: "Sunflowers" },
  { id: "sculpting", title: "Ceramic Owl" },
  { id: "desk-lamp", title: "Desk Lamp" },
  { id: "neon-sign", title: "Neon Sign" },
  { id: "blue-planet", title: "Blue Planet" },
  { id: "newtons-cradle", title: "Newton's Cradle" },
  { id: "chess", title: "Chess Endgame" },
  { id: "lotus", title: "Lotus" },
  { id: "particle-hair", title: "Grass Hill" },
  { id: "carousel", title: "Carousel" },
  { id: "mesh-modeling", title: "Rangefinder Camera" },
  { id: "drivers-and-graph-editor", title: "Steam Engine" },
  { id: "vertex-and-weight-paint", title: "Koi Pond" },
  { id: "rendering", title: "Window Light" },
  { id: "link-append", title: "Link and Append" },
  { id: "shader-gallery", title: "Shader Node Gallery" },
  { id: "python", title: "Python Scripts and Add-ons" },
  { id: "nla", title: "Nonlinear Animation" },
  { id: "shape-keys", title: "Shape Keys" },
  { id: "geometry-nodes", title: "Geometry Nodes Planet" },
  { id: "import-export", title: "Import and Export" },
  { id: "grease-pencil", title: "Dusk Lake" },
  { id: "texture-paint", title: "Texture Paint" },
  { id: "lava", title: "Lava Sphere" },
  { id: "rigged-character", title: "Rigged Character" },
  { id: "hair-dynamics", title: "Sea Anemone" },
  { id: "island", title: "Volcanic Island" },
  { id: "still-life", title: "Still Life" },
  { id: "orrery", title: "Orrery" },
  { id: "lumen", title: "Lumen" },
  { id: "coast", title: "Dusk Coast" },
  { id: "text", title: "3D Text" },
  { id: "solar", title: "Solar System" },
  { id: "shader", title: "Shader Waves" },
  { id: "materials", title: "Materials & Nodes" },
  { id: "cube", title: "Default Cube" },
  { id: "city", title: "Procedural City" },
  { id: "arrays", title: "Spiral Stair" },
  { id: "animation", title: "Keyframe Animation" },
  // An application template: its startup file and workspaces (File > New > 2D Animation).
  { id: "2d-animation", title: "2D Animation", workspaces: [["2D Animation", "PAINT_GREASE_PENCIL"], ["2D Full Canvas", "PAINT_GREASE_PENCIL"]] },
].map((example) => ({ ...example, files: () => files(example.id) }));
