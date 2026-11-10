// File > Export's options: one schema, the source of their defaults and types. A value that does not parse is repaired to
// its default with a warning, as readIR repairs an IR (runtime/ir.js).
import * as z from 'zod/mini';

// The GPU engine a package's page is made for: [identifier, name, description], as an EnumProperty's items.
export const TARGETS = [
  ['BOTH', 'WebGPU or WebGL 2', 'The page creates a WebGPU engine where the browser has WebGPU, else a WebGL 2 one, and ships the overrides of both'],
  ['WEBGPU', 'WebGPU', 'The page creates a WebGPU engine only, with the adapter\'s limits its materials need'],
  ['WEBGL2', 'WebGL 2', 'The page creates a WebGL 2 engine only, and ships no WebGPU overrides of its own'],
];

const repaired = (name, schema, fallback) => z.catch(z._default(schema, fallback), ({ value }) => {
  console.warn(`Export option ${name}: ${JSON.stringify(value)} is not valid, ${JSON.stringify(fallback)} used`);
  return fallback;
});

export const ExportOptionsSchema = z.object({
  /** materials with Bylonder's EEVEE extensions, as Babylon's blocks */
  eeveeParity: repaired('eeveeParity', z.boolean(), false),
  /** a package's scene.bin uncompressed, for a host that compresses it */
  hostCompression: repaired('hostCompression', z.boolean(), false),
  /** a package's animation sampled per frame where Babylon cannot play its F-Curves, instead of run as F-Curves in the page */
  bakeAnimation: repaired('bakeAnimation', z.boolean(), false),
  /** the GPU engine a package's page creates (TARGETS) */
  target: repaired('target', z.enum(TARGETS.map(([id]) => id)), 'BOTH'),
});

/** The options given, with defaults filled and what does not parse repaired. */
export const exportOptions = (options = {}) => z.parse(ExportOptionsSchema, options);
