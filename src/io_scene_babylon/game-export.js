// The project's game code as a package ships it (docs/sdk-model.md, Packaging): game.js, the project's src/ bundled
// with the libraries it imports, under the project's own licence and apart from Blender's code and Bylonder's runtime;
// THIRD-PARTY.md with the notices of the libraries inlined in it; and the project's content/ the code reads through
// `assets`. The page's load() runs it as the Game area does (runtime/game/run.js).

/** The libraries game code may import, inlined into game.js: each package's entry by import path. */
export const GAME_LIBRARIES = {
  inkjs: { '': 'dist/ink.mjs', full: 'dist/ink-full.mjs' },
  '@babylonjs/gui': { '': 'index.js' },
};
const CORE = '@babylonjs/core';

/** Whether a project (`{ files, read }`, its file paths and a reader) has a game: src/game.js. */
export const hasGame = (project) => !!project?.files.includes('src/game.js');

const joined = (from, path) => {
  const parts = from.split('/').slice(0, -1);
  for (const part of path.split('/')) part === '..' ? parts.pop() : part !== '.' && parts.push(part);
  return parts.join('/');
};
/**
 * Where each of Babylon's exports is defined, by name (`Vector3`: `Maths/math.vector.js`), from its index's
 * `export *` graph read with `babylon(path)` (a file's text); made once per reader.
 */
const definitions = new WeakMap();
async function babylonModules(babylon) {
  if (!definitions.has(babylon)) definitions.set(babylon, (async () => {
    const names = new Map(), seen = new Set();
    const walk = async (path) => {
      if (seen.has(path)) return;
      seen.add(path);
      const source = await babylon(path);
      for (const [, name] of source.matchAll(/^export (?:async )?(?:class|const|let|var|function\*?|enum) ([\w$]+)/gm)) if (!names.has(name)) names.set(name, path);
      for (const [, list] of source.matchAll(/^export \{([^}]*)\};?$/gm)) for (const item of list.split(',')) {
        const name = item.trim().split(/\s+as\s+/).pop();
        if (name && !names.has(name)) names.set(name, path);
      }
      await Promise.all([...source.matchAll(/^export \* from "([^"]+)"/gm)].map(([, to]) => walk(joined(path, to))));
    };
    await walk('index.js');
    return names;
  })());
  return definitions.get(babylon);
}
// `import { Vector3, Quaternion as Q } from '@babylonjs/core'`, written as an import of each from its own module, as
// Babylon's ES6 guide recommends: a page loads what the game uses, not the whole library through its index.
const BARE_IMPORT = /import\s*\{([^}]*)\}\s*from\s*(['"])@babylonjs\/core\2;?/g;
async function byModule(source, file, babylon) {
  if (!/['"]@babylonjs\/core['"]/.test(source)) return source;
  const where = await babylonModules(babylon);
  const rewritten = source.replace(BARE_IMPORT, (_, list) => {
    const byPath = new Map();
    for (const item of list.split(',').map((i) => i.trim()).filter(Boolean)) {
      const name = item.split(/\s+as\s+/)[0];
      if (!where.has(name)) throw Error(`${file} imports ${name} from @babylonjs/core, which has no such export`);
      byPath.set(where.get(name), [...(byPath.get(where.get(name)) ?? []), item]);
    }
    return [...byPath].map(([path, items]) => `import { ${items.join(', ')} } from '@babylonjs/core/${path}';`).join(' ');
  });
  if (/['"]@babylonjs\/core['"]/.test(rewritten)) throw Error(`${file} imports @babylonjs/core whole: import its classes by name (import { Vector3 } from '@babylonjs/core')`);
  return rewritten;
}
const libraryOf = (path) => Object.keys(GAME_LIBRARIES).find((name) => path === name || path.startsWith(`${name}/`));
const text = (data) => (typeof data === 'string' ? data : new TextDecoder().decode(data));

/**
 * The package's game files, by path. `esbuild`: esbuild's API; `library(name)`: a library's `{ version, license, notice,
 * read(path) }` (its package.json's licence, its licence file's text, its files' text); `babylon(path)`: the text of
 * @babylonjs/core's file at `path`, where Babylon's imports by name are found. Throws when the project states
 * no licence (package.json `license`), so a package never ships code without one.
 */
export async function gameFiles(project, { esbuild, library, babylon }) {
  const read = async (path) => text(await project.read(path));
  const manifest = project.files.includes('package.json') ? JSON.parse(await read('package.json')) : {};
  if (!manifest.license) throw Error('The project\'s game code ships under its own licence: add "license" to its package.json (for example "MIT")');
  const modules = project.files.filter((path) => /^src\/.+\.m?js$/.test(path) && path !== 'src/game.js');
  // Every module of src/ whose default export is a behaviour: behaviours are found by their names on objects.
  const entry = `import game from './src/game.js';\n${modules.map((path, i) => `import * as m${i} from './${path}';`).join('\n')}
export default { game, behaviors: [${modules.map((_, i) => `m${i}.default`).join(', ')}].filter((d) => d?.kind === 'behavior') };\n`;
  const used = new Map();
  const plugin = { name: 'game', setup(build) {
    build.onResolve({ filter: /.*/ }, async ({ path, importer, namespace, kind }) => {
      if (kind === 'entry-point') return { path: '__entry.js', namespace: 'project' };
      if (path === 'bylonder') return { path: './bylonder/game/define.js', external: true };
      // Babylon is the page's, by module path as its import map maps it ("@babylonjs/core/").
      if (path.startsWith(`${CORE}/`)) return { path, external: true };
      if (path.startsWith('.')) return namespace === 'project' ? { path: joined(importer, path), namespace } : { path: `${namespace}::${joined(importer.split('::')[1], path)}`, namespace };
      const name = libraryOf(path);
      if (!name) throw Error(`${importer} imports ${path}: game code may import Babylon.js, bylonder, ${Object.keys(GAME_LIBRARIES).join(' and ')} and its own modules`);
      if (!used.has(name)) used.set(name, await library(name));
      const sub = path.slice(name.length + 1), file = GAME_LIBRARIES[name][sub] ?? sub;
      return { path: `${name}::${file}`, namespace: name };
    });
    build.onLoad({ filter: /.*/, namespace: 'project' }, async ({ path }) => ({ contents: path === '__entry.js' ? entry : await byModule(await read(path), path, babylon), loader: 'js', resolveDir: '/' }));
    for (const name of Object.keys(GAME_LIBRARIES)) {
      build.onLoad({ filter: /.*/, namespace: name }, async ({ path }) => ({ contents: await used.get(name).read(path.split('::')[1]), loader: 'js' }));
    }
  } };
  const built = await esbuild.build({ entryPoints: ['__entry.js'], bundle: true, format: 'esm', write: false, minify: true, legalComments: 'inline', logLevel: 'silent', plugins: [plugin],
    banner: { js: `// ${manifest.name ?? 'The project'}'s game code, licensed ${manifest.license}. The libraries inlined in it, and their licences: THIRD-PARTY.md.` } });
  const files = { 'game.js': built.outputFiles[0].text };
  files['THIRD-PARTY.md'] = `# Third-party code in game.js\n\n${[...used].map(([name, { version, license, notice }]) => `## ${name} ${version} (${license})\n\n\`\`\`text\n${notice.trim()}\n\`\`\`\n`).join('\n') || 'None.\n'}`;
  for (const path of project.files.filter((p) => p.startsWith('content/'))) files[path] = await project.read(path);
  return files;
}

/** A library's sources from a folder of packages (node_modules) by `readFile(path)`. */
export const folderLibrary = (readFile) => async (name) => {
  const at = (path) => `${name}/${path}`, manifest = JSON.parse(await readFile(at('package.json')));
  const notice = await readFile(at('LICENSE.md')).catch(() => readFile(at('license.md'))).catch(() => readFile(at('LICENSE')));
  return { version: manifest.version, license: manifest.license, notice, read: (path) => readFile(at(path)) };
};
