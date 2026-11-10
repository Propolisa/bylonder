// Babylon's module of each name a package's code can need (src/io_scene_babylon/babylon-modules.json), so a package
// imports @babylonjs/core module by module and a page loads only what its scene uses (babylon-modules.js):
//   modules: by module file, the names @babylonjs/core exports from it (index.js's re-exports followed to where each is
//            declared), the classes it registers by name (RegisterClass, read back by Parse's customType) and the node
//            constructors it adds (node:Light_Type_<n>, node:<a camera's type>, read back by Light.Parse and Camera.Parse);
//   augments: the members a module adds to another's class (Mesh.prototype.thinInstanceSetBuffer), by name.
// usage: node scripts/babylon-modules.mjs
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE = fileURLToPath(new URL('../node_modules/@babylonjs/core/', import.meta.url)).replaceAll('\\', '/');
export const MODULES_FILE = new URL('../src/io_scene_babylon/babylon-modules.json', import.meta.url);

const read = (file) => readFileSync(CORE + file, 'utf8');
const files = (dir = '') => readdirSync(CORE + dir).flatMap((name) => {
  const path = posix.join(dir, name);
  return statSync(CORE + path).isDirectory() ? files(path) : path.endsWith('.js') ? [path] : [];
});
const exported = (list) => list.split(',').map((s) => s.trim().split(/\s+as\s+/).at(-1)).filter(Boolean);

// Each name index.js exports, at the module declaring it.
function exports() {
  const at = new Map(), seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const code = read(file), from = (path) => posix.join(posix.dirname(file), path);
    const own = (name, where = file) => at.has(name) || at.set(name, where);
    for (const [, name] of code.matchAll(/^export (?:abstract )?(?:class|function\*?|async function|const|let|var) ([\w$]+)/gm)) own(name);
    for (const [, list] of code.matchAll(/^export \{([^}]*)\};?$/gm)) exported(list).forEach((name) => own(name));
    for (const [, list, path] of code.matchAll(/^export \{([^}]*)\} from "([^"]+)";?$/gm)) {
      visit(from(path));
      // A name renamed on the way out is exported by this module.
      for (const spec of list.split(',').map((s) => s.trim()).filter(Boolean)) own(spec.split(/\s+as\s+/).at(-1), / as /.test(spec) ? file : from(path));
    }
    for (const [, path] of code.matchAll(/^export \* from "([^"]+)";?$/gm)) visit(from(path));
  };
  visit('index.js');
  return at;
}

export function babylonModules() {
  const at = exports(), augments = {};
  for (const file of files()) {
    const code = read(file);
    for (const [, name] of code.matchAll(/RegisterClass\("([^"]+)"/g)) if (!at.has(name)) at.set(name, file);
    // A constructor's name can be a class another module declares (FreeCamera's is universalCamera.js's).
    for (const [, name] of code.matchAll(/Node\.AddNodeConstructor\("([^"]+)"/g)) at.set(`node:${name}`, file);
    // What a module adds to a class declared elsewhere; the engines' own extensions come with their engine.
    if (/^(Engines|Buffers)\//.test(file)) continue;
    const declared = new Set([...code.matchAll(/^(?:export )?(?:class|let|var) (\w+)/gm)].map((m) => m[1]));
    for (const m of code.matchAll(/^(\w+)\.prototype\.([\w$]+) = |defineProperty\((\w+)\.prototype, "([\w$]+)"/gm)) {
      const [owner, name] = [m[1] ?? m[3], m[2] ?? m[4]];
      if (!declared.has(owner) && !name.startsWith('_')) augments[name] ??= file;
    }
  }
  // A method of the class's own that calls a factory another module sets.
  Object.assign(augments, { createInstance: 'Meshes/instancedMesh.js' });
  const modules = {};
  for (const [name, file] of [...at].sort(([a], [b]) => (a < b ? -1 : 1))) (modules[file] ??= []).push(name);
  const version = JSON.parse(read('package.json')).version;
  return `${JSON.stringify({ version, modules: Object.fromEntries(Object.entries(modules).sort()), augments: Object.fromEntries(Object.entries(augments).sort()) })}\n`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeFileSync(MODULES_FILE, babylonModules());
