// File > Export > JavaScript's Bundle: a package's modules (packagedModules) as one bundle per package, made with esbuild.
// scene.js and each file of Blender's code (gplFiles, GPL) are entries, sharing the Babylon and runtime code they import
// as chunks in bundle/; Blender's code stays in its own files, with their notices, and no chunk holds any of it. A unit
// the package replaces is absent from its files (units.json), so from the bundle too.
import { CHUNKS, gplFiles } from './runtime-files.js';

const CORE = '@babylonjs/core/';
const LICENSE = `# License

The files of this folder are Babylon.js's modules a package's scene uses (Apache-2.0, below) bundled with the page
runtime (\`bylonder/\`, MIT OR Apache-2.0, \`bylonder/LICENSE.md\`). With WebGPU, \`webgpu/\` holds Babylon's GLSL to WGSL
compilers as Babylon.js serves them: glslang (Khronos, BSD-3-Clause and others) and twgsl (Tint, Apache-2.0).

`;
const LOADERS = { js: 'js', json: 'json' };
const extension = (path) => path.slice(path.lastIndexOf('.') + 1);
const isModule = (path) => extension(path) === 'js';

// A relative import's path from the importing file's path, both from the package's or Babylon's root.
function joined(from, path) {
  const parts = from.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (part === '..') parts.pop();
    else if (part !== '.') parts.push(part);
  }
  return parts.join('/');
}
// A file's leading comments, its license notice among them, which minifying drops.
const notice = (code) => /^(?:\/\/.*\n)*/.exec(code)[0];

// A kept import of Blender's code, by its path from the root, until the file that holds it is known (esbuild moves code
// between entries and chunks).
const KEPT = '/bylonder-kept/';
const relative = (from, to) => {
  const up = from.split('/').slice(0, -1), path = to.split('/');
  while (up.length && up[0] === path[0]) { up.shift(); path.shift(); }
  return (up.length ? '../'.repeat(up.length) : './') + path.join('/');
};

/**
 * The package's files bundled: its .js files replaced by the bundle's, the others kept. `babylon(path)`: the source of
 * @babylonjs/core's file at `path` (`Engines/engine.js`); `esbuild`: esbuild's API, initialized.
 */
export const bundlePackage = (files, options) => bundlePage({ '': files }, options);

/**
 * Packages by the folder they sit in (`world/`), with a page's own modules (`page.files`) importing them from its entry
 * `page.entry`, bundled together: one Babylon for them all, each package's Blender code kept in its own files.
 */
export async function bundlePage(packages, { minify = true, babylon, esbuild, page }) {
  const all = { ...page?.files }, gpl = new Set(), scenes = new Set();
  for (const [at, files] of Object.entries(packages)) {
    // Blender's code: every module in a folder of it, those made at export (the curves' GLSL, the nodes' kernels) too.
    const folders = new Set(gplFiles(files).map(([path]) => path.split('/')[0]));
    for (const [path, data] of Object.entries(files)) {
      all[at + path] = data;
      if (isModule(path) && folders.has(path.split('/')[0])) gpl.add(at + path);
    }
    scenes.add(`${at}scene.js`);
  }
  const plugin = { name: 'package', setup(build) {
    build.onResolve({ filter: /.*/ }, ({ path, importer, namespace, kind }) => {
      if (kind === 'entry-point') return { path, namespace: 'package' };
      if (path.startsWith('node:')) return { path, external: true };
      if (path.startsWith(CORE)) return { path: path.slice(CORE.length), namespace: 'babylon' };
      if (!path.startsWith('.')) throw Error(`${importer}: ${path} is neither the package's nor Babylon's`);
      const target = joined(importer, path);
      // A page's debugging tools outside it load as they are.
      if (namespace === 'package' && kind === 'dynamic-import' && !(target in all)) return { path, external: true };
      // A page imports scene.js, which finds its images by its own URL, as that file.
      if (namespace === 'package' && scenes.has(target) && !scenes.has(importer)) return { path: KEPT + target, external: true };
      // scene.js and Blender's code import Blender's code where it sits beside them, in the bundle too: kept as an import of that file.
      if (namespace === 'package' && gpl.has(target)) {
        if (!scenes.has(importer) && !gpl.has(importer)) throw Error(`${importer} imports ${target}: only scene.js and Blender's code import Blender's code`);
        return { path: KEPT + target, external: true };
      }
      return { path: target, namespace };
    });
    build.onLoad({ filter: /.*/, namespace: 'package' }, ({ path }) => ({ contents: all[path], loader: LOADERS[extension(path)] }));
    build.onLoad({ filter: /.*/, namespace: 'babylon' }, async ({ path }) => ({ contents: await babylon(path), loader: 'js' }));
  } };
  // The chunks go beside the page's entry, or in the package's folder.
  const chunks = page ? CHUNKS : `${Object.keys(packages)[0]}${CHUNKS}`;
  const { outputFiles } = await esbuild.build({
    entryPoints: [...page ? [page.entry] : [], ...scenes, ...gpl], bundle: true, splitting: true, format: 'esm', minify, write: false,
    outdir: 'bylonder-bundle-out', entryNames: '[dir]/[name]', chunkNames: `${chunks}/[name]-[hash]`, plugins: [plugin], logLevel: 'silent',
  });
  const bundled = Object.fromEntries(outputFiles.map(({ path, text }) => {
    const name = path.replaceAll('\\', '/').replace(/^.*\/bylonder-bundle-out\//, '');
    const code = text.replaceAll(new RegExp(`(["'])${KEPT}([^"']+)\\1`, 'g'), (_, quote, target) => quote + relative(name, target) + quote);
    return [name, name in all ? notice(String(all[name])) + code : code];
  }));
  return { ...Object.fromEntries(Object.entries(all).filter(([path]) => !isModule(path))), ...bundled,
    [`${chunks}/LICENSE.md`]: LICENSE + await babylon('license.md') };
}
