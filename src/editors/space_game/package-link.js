// A package's scene.js run in the app's own module graph (docs/data-flow.md, From .blend to the game views): every module
// it imports, Babylon, the page runtime (bylonder/) and the rest of Bylonder's code a package ships, is the app's own
// (runtime-files.js appSource), never the package's copy, so a run and the app share one Babylon by construction. The
// modules the export writes (scene.js, its kernels) are linked from their text; one naming anything else throws.
import { appSource } from '../../io_scene_babylon/runtime-files.js';
import { packageHost } from '../../io_scene_babylon/runtime/package-modules.js';

const REGISTRY = Symbol.for('bylonder.appModules');
/** Each app module a linked module imports, by its src/ path. @type {Map<string, any>} */
const modules = (globalThis[REGISTRY] ??= new Map());
const moduleURL = (text) => `data:text/javascript;charset=utf-8,${encodeURIComponent(text).replaceAll("'", '%27')}`;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** A module that gives an app module's exports, by its src/ path. @param {string} source @param {any} namespace */
function appModuleURL(source, namespace) {
  modules.set(source, namespace);
  const names = Object.keys(namespace).filter((name) => IDENTIFIER.test(name));
  const from = `globalThis[Symbol.for('bylonder.appModules')].get(${JSON.stringify(source)})`;
  return moduleURL(`const m = ${from};\nexport const { ${names.join(', ')} } = m;\n${'default' in namespace ? 'export default m.default;\n' : ''}`);
}

// An import or re-export's specifier, at a line's start as the export writes them, or a dynamic import's.
const SPECIFIER = /(^\s*(?:import|export)\b[^;\n]*?\bfrom\s*|^\s*import\s*|\bimport\(\s*)(['"])([^'"\n]+)\2/gm;
const resolvePath = (specifier, from) => new URL(specifier, `file:///${from}`).pathname.slice(1);

/**
 * scene.js of a package's files linked into the app's module graph: `appModule(source)` imports the app's module of a
 * src/ path ('@babylonjs/core' for Babylon). Images and folders loaded at run time come from `base`, where the package's
 * files are served. Gives scene.js's exports.
 * @param {Record<string, string | Uint8Array>} files @param {string} base @param {(source: string) => Promise<any>} appModule
 */
export async function linkPackage(files, base, appModule) {
  const linked = new Map(), app = new Map();
  const appURL = async (source) => app.get(source) ?? app.set(source, appModuleURL(source, await appModule(source))).get(source);
  packageHost.module = async (path) => appModule(appSource(path) ?? fail(path, 'a runtime file'));
  const link = async (path) => {
    if (linked.has(path)) return linked.get(path);
    const text = String(files[path]), urls = new Map();
    for (const [, , , specifier] of text.matchAll(SPECIFIER)) {
      const babylon = specifier === '@babylonjs/core' || specifier.startsWith('@babylonjs/core/');
      const target = babylon ? null : resolvePath(specifier, path);
      urls.set(specifier, babylon ? await appURL('@babylonjs/core')
        : appSource(target) ? await appURL(appSource(target))
        : typeof files[target] === 'string' && target.endsWith('.js') ? await link(target) : fail(specifier, path));
    }
    if (/\bimport\(\s*[^'"\s]/.test(text)) fail('a module named at run time', path);
    const url = moduleURL(text.replace(SPECIFIER, (_, head, quote, specifier) => `${head}${quote}${urls.get(specifier)}${quote}`)
      .replaceAll('import.meta.url', JSON.stringify(new URL(path, base).href)));
    linked.set(path, url);
    return url;
  };
  return import(/* @vite-ignore */ await link('scene.js'));
}

/** @param {string} what @param {string} where @returns {never} */
function fail(what, where) {
  throw new Error(`${where} imports ${what}, which is not in the app's module graph`);
}
