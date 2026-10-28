import { textFile } from "./project-model.js";
// A project made by opening a .blend (File > Open): its scene is the file's, read by Blender's reader.
export const blendProjectSource = (path) => `import { openBlend } from '@workbench/sdk';

// ${path}, opened with Blender's reader: its objects, materials, modifiers, animation and collections.
export async function createScene() {
  const scene = new BABYLON.Scene(engine);
  await openBlend(${JSON.stringify(path)}, scene);
  return scene;
}
`;
export const defaultSource = `export const createScene = function () {
    // This creates a basic Babylon Scene object (non-mesh)
    var scene = new BABYLON.Scene(engine);

    // This creates and positions a free camera (non-mesh)
    var camera = new BABYLON.FreeCamera("camera1", new BABYLON.Vector3(0, 5, -10), scene);

    // This targets the camera to scene origin
    camera.setTarget(BABYLON.Vector3.Zero());

    // This attaches the camera to the canvas
    camera.attachControl(canvas, true);

    // This creates a light, aiming 0,1,0 - to the sky (non-mesh)
    var light = new BABYLON.HemisphericLight("light", new BABYLON.Vector3(0, 1, 0), scene);

    // Default intensity is 1. Let's dim the light a small amount
    light.intensity = 0.7;

    // Our built-in 'sphere' shape.
    var sphere = BABYLON.MeshBuilder.CreateSphere("sphere", {diameter: 2, segments: 32}, scene);

    // Move the sphere upward 1/2 its height
    sphere.position.y = 1;

    // Our built-in 'ground' shape.
    var ground = BABYLON.MeshBuilder.CreateGround("ground", {width: 6, height: 6}, scene);

    return scene;
};
`;
const example = `// Import and call addControls(scene) from index.js to enable this module.
// This uses the same schema for defaults, validation, generated UI and effects.
import { controls } from '@workbench/sdk';

export function addControls(scene) {
  const sphere = scene.getMeshByName('sphere');
  const light = scene.getLightByName('light');
  return controls({
    id: 'scene', title: 'Scene',
    schema: {
      height: { default: 1, min: 0, max: 5, step: 0.05, label: 'Sphere height' },
      intensity: { default: 0.7, min: 0, max: 2, step: 0.05, label: 'Light' }
    },
    connect(store) {
      return store.effect(['height', 'intensity'], values => {
        sphere.position.y = values.height;
        light.intensity = values.intensity;
      });
    }
  });
}
`;
const guide = `# Project API

index.js is the required entry module. Export createScene() (async is supported).
BABYLON, engine, canvas and workbench are globals, also available via @workbench/sdk.
The returned Scene is yours: cameras, rendering, assets and Babylon APIs remain available.

## Modules and assets
Use ./relative.js, ../modules/file.ts, export ... from, dynamic import('./file.js'),
and new URL('./asset.glb', import.meta.url). Local cycles and dynamic paths use native modules.
HTTPS ESM imports work when their server allows CORS. Bare package names need a mapping
in importmap.json (for example an ESM CDN URL). CommonJS and Node APIs are not browser modules.
IntelliSense loads Babylon declarations, local modules, and recursively discovered remote types.
For custom sources, types.json may map an import name/URL to a local or remote .d.ts.
The Types panel reports unresolved dependencies and fetch failures.
JS/TS/JSX/TSX are supported; TS is transpiled, not type-checked at runtime.
JSON imports use native 'with { type: "json" }' when supported, or use '?module'.
CSS side effects: import './style.css?module'. Raw text: import './shader.glsl?raw'.
Use fetch(new URL('./data.json', import.meta.url)) for native assets.

## Reactive UI
See examples/controls.js. Each workbench.controls({id,title,schema,connect}) creates an
independent store and generated Properties section. connect(store) returns optional cleanup.
store.set(key,value) validates, updates UI and invalidates dependent effects.
Effects default to frame-coalesced execution. Options: mode 'immediate', 'frame', 'debounce',
'manual'; delay; onStale. store.invalidate(key), store.flush(), store.stale are available.
Register controls during createScene (including awaited work). Instances need unique IDs.
workbench.onDispose(fn) registers cleanup. workbench.editable(mesh,{id:'stable-id'}) provides
a stable persistence name; set editable:false in metadata to exclude a mesh.
workbench.asset('textures/image.png') resolves from the project root.

## Viewport
Edit mode uses the Blender-style camera and transform tools. Scene mode restores your scene's
active camera and native controls. Changes to objects affect the same live scene in both modes.
Scene selection, outlines, multi-selection, grouping, undo and the Inspector remain available.

## Optional overrides
Remember scene edits is a project-wide toggle. It persists transform/group changes and all
registered store values into the project's OPFS snapshots, separately from source files.
Off clears saved overrides but leaves the current live scene untouched. Clear overrides + Run
returns to code defaults. Use stable unique names/IDs. Inspector transforms/settings are captured
periodically when remembering; arbitrary material/code changes are not serialized.

## Storage
Edits autosave after 750ms idle. Run and checkpoint flush changes first. Version history can diff
files and restore any whole snapshot; restoring creates a new version, preserving later history.
Snapshots deduplicate file bodies by SHA-256. ZIP export/import is portable; export includes
.workbench.json for settings/overrides. OPFS is local to this origin/browser, not cloud sync.
Request durable storage to reduce eviction risk; the browser may decline. Export backups.
Multiple tabs use a write lock and optimistic HEAD checks; conflicts never silently overwrite.
Code executes in a fresh same-origin iframe on each Run. It has normal web permissions and
should be code you trust. Run needs service workers; external modules require a network.
`;
export const defaultFiles = () => ({
  "index.js": textFile(defaultSource),
  "examples/controls.js": textFile(example),
  "README.md": textFile(guide),
  "importmap.json": textFile(JSON.stringify({ imports: {} }, null, 2)),
  "types.json": textFile(JSON.stringify({ imports: {} }, null, 2)),
});
