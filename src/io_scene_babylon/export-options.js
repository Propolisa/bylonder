// File > Export's options: one schema, the source of their defaults and types. A value that does not parse is repaired to
// its default with a warning, as readIR repairs an IR (runtime/ir.js).
import * as z from 'zod/mini';
import { RUNTIMES } from '../runtimes/runtimes.js';

// The GPU engine a package's page is made for: [identifier, name, description], as an EnumProperty's items.
export const TARGETS = [
  ['BOTH', 'WebGPU or WebGL 2', 'The page creates a WebGPU engine where the browser has WebGPU, else a WebGL 2 one, and ships the overrides of both'],
  ['WEBGPU', 'WebGPU', 'The page creates a WebGPU engine only, with the adapter\'s limits its materials need'],
  ['WEBGL2', 'WebGL 2', 'The page creates a WebGL 2 engine only, and ships no WebGPU overrides of its own'],
];

// Where the control panel's links load Babylon's Inspector and node editors from: [identifier, name, description].
export const DEV_TOOLS = [
  ['CDN', "Babylon's CDN", "The editors load from Babylon's CDN when a link is followed; the page itself stays offline"],
  ['PACKAGE', 'In the Package', "The package ships Babylon's editors in bylonder-dev-tools/ (about 9 MB), so they open offline"],
];

// How the viewer moves the view of a package's page (runtime/control-panel-camera.js): [identifier, name, description].
export const NAVIGATION = [
  ['FIXED', 'Fixed', 'The authored camera as exported'],
  ['ORBIT', 'Orbit', "Turns around a point ahead with Babylon's ArcRotateCamera: drag to turn, wheel or pinch to zoom, right drag or two fingers to pan"],
  ['FLY', 'Fly', "Moves freely with Babylon's UniversalCamera: drag to look, W A S D or the arrows to move, E and Q up and down"],
  ['WALK', 'Walk', "Walks at eye height with gravity, stopped by the scene's meshes"],
  ['JOYSTICKS', 'Joysticks', "Flies with two virtual thumb sticks (Babylon's VirtualJoysticksCamera), offered on touch screens"],
];

// `fallback`: the default, or a function making it (a fresh object each time).
const repaired = (name, schema, fallback) => {
  const made = () => (typeof fallback === 'function' ? fallback() : fallback);
  return z.catch(z._default(schema, made), ({ value }) => {
    console.warn(`Export option ${name}: ${JSON.stringify(value)} is not valid, ${JSON.stringify(made())} used`);
    return made();
  });
};
// A runtime (runtimes.js RUNTIMES) chosen at one level of the export's tree, or null: unset, inherited from the level above.
const chosen = (name) => repaired(name, z.nullable(z.enum(Object.keys(RUNTIMES))), null);
const FeatureRuntimes = z.object({
  /** for every instance of the feature */
  runtime: chosen('runtime'),
  /** by instance name (the name of the struct the feature lives on, runtimes.js) */
  instances: repaired('instances', z.record(z.string(), chosen('instance runtime')), () => ({})),
});

// A branch of the scene (docs/features/import-export.md): run in the page, its evaluated result frozen into the package,
// or left out. [identifier, name, description], as an EnumProperty's items.
export const BRANCH_STATES = [
  ['LIVE', 'Live', 'Runs in the page, with the code it needs shipped'],
  ['BAKED', 'Baked', 'Its evaluated result frozen into the package: no code of its own shipped'],
  ['OFF', 'Off', 'Left out of the package'],
];
// The states each branch offers, by branch id.
export const BRANCHES = { geometryNodes: ['LIVE', 'BAKED'] };
const branchState = (name) => repaired(name, z.nullable(z.enum(BRANCH_STATES.map(([id]) => id))), null);
const Branch = z.object({
  /** for every instance of the branch */
  state: branchState('state'),
  /** by instance name (an object's, for a modifier stack) */
  instances: repaired('instances', z.record(z.string(), branchState('instance state')), () => ({})),
});
/** The state File > Export's options set for a branch's instance: set on the instance, else on the branch; null: its default. */
export const chosenState = (branches, id, instance) => branches?.[id]?.instances?.[instance] ?? branches?.[id]?.state ?? null;

export const ExportOptionsSchema = z.object({
  /** materials with Bylonder's EEVEE extensions, as Babylon's blocks */
  eeveeParity: repaired('eeveeParity', z.boolean(), false),
  /** a package's scene.bin uncompressed, for a host that compresses it */
  hostCompression: repaired('hostCompression', z.boolean(), false),
  /** a package's animation sampled per frame where Babylon cannot play its F-Curves, instead of run as F-Curves in the page */
  bakeAnimation: repaired('bakeAnimation', z.boolean(), false),
  /** a package's modules as one bundle with Babylon's (bundle.js), else as ES modules importing Babylon's */
  bundle: repaired('bundle', z.boolean(), true),
  /** the bundle minified */
  minify: repaired('minify', z.boolean(), true),
  /** a package's page shows a control panel of its controls (runtime/control-panel.js) */
  controlPanel: repaired('controlPanel', z.boolean(), true),
  /** how the viewer moves the view when the page opens (NAVIGATION) */
  navigation: repaired('navigation', z.enum(NAVIGATION.map(([id]) => id)), 'FIXED'),
  /** the navigation modes the panel offers, by identifier; one left out is offered */
  navigationModes: repaired('navigationModes', z.record(z.enum(NAVIGATION.map(([id]) => id)), z.boolean()), () => ({})),
  /** where the panel's links to Babylon's editors load them from (DEV_TOOLS) */
  devTools: repaired('devTools', z.enum(DEV_TOOLS.map(([id]) => id)), 'CDN'),
  /** the GPU engine a package's page creates (TARGETS) */
  target: repaired('target', z.enum(TARGETS.map(([id]) => id)), 'BOTH'),
  /** the runtime every feature instance exports with; null: each its own (docs/runtimes.md) */
  runtime: chosen('runtime'),
  /** type keys of the units the page registers itself (`modifier:SIMPLE_DEFORM`, `node:ShaderNodeMath`, a key ending in * a prefix), which the package ships none of (unit-manifest.js) */
  replace: repaired('replace', z.array(z.string()), () => []),
  /** by runtimes.js feature id, overriding `runtime` for that feature and its instances */
  runtimes: repaired('runtimes', z.record(z.string(), repaired('feature runtimes', FeatureRuntimes, () => ({ runtime: null, instances: {} }))), () => ({})),
  /** by BRANCHES id, each branch's state and its instances' (BRANCH_STATES) */
  branches: repaired('branches', z.record(z.string(), repaired('branch', Branch, () => ({ state: null, instances: {} }))), () => ({})),
});

/** The options given, with defaults filled and what does not parse repaired. */
export const exportOptions = (options = {}) => z.parse(ExportOptionsSchema, options);

