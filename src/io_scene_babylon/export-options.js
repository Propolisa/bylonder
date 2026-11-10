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
  /** the GPU engine a package's page creates (TARGETS) */
  target: repaired('target', z.enum(TARGETS.map(([id]) => id)), 'BOTH'),
  /** the runtime every feature instance exports with; null: each its own (docs/runtimes.md) */
  runtime: chosen('runtime'),
  /** type keys of the units the page registers itself (`modifier:SIMPLE_DEFORM`, `node:ShaderNodeMath`, a key ending in * a prefix), which the package ships none of (unit-manifest.js) */
  replace: repaired('replace', z.array(z.string()), () => []),
  /** by runtimes.js feature id, overriding `runtime` for that feature and its instances */
  runtimes: repaired('runtimes', z.record(z.string(), repaired('feature runtimes', FeatureRuntimes, () => ({ runtime: null, instances: {} }))), () => ({})),
});

/** The options given, with defaults filled and what does not parse repaired. */
export const exportOptions = (options = {}) => z.parse(ExportOptionsSchema, options);

