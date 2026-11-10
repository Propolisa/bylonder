// A package's code imports @babylonjs/core module by module, so a page (from a CDN serving the package's files, or a
// bundler) loads only the Babylon modules its scene uses. babylon-modules.json (scripts/babylon-modules.mjs) names the
// module of each name Babylon exports or registers, and of each member a module adds to another's class.
import BABYLON from './babylon-modules.json' with { type: 'json' };

const MODULE = new Map(Object.entries(BABYLON.modules).flatMap(([file, names]) => names.map((name) => [name, file])));
const AUGMENTS = Object.entries(BABYLON.augments);
const CORE = '@babylonjs/core';
const IMPORT = /import\s*\{([^}]*)\}\s*from\s*(['"])@babylonjs\/core\2;?/g;

/** The module file of a name @babylonjs/core exports, registers (`BABYLON.PBRMaterial`) or constructs (`node:Light_Type_0`). */
export const babylonModule = (name) => MODULE.get(name);

const moduleOf = (name) => {
  const file = MODULE.get(name);
  if (!file) throw new Error(`@babylonjs/core ${BABYLON.version} exports no ${name}`);
  return file;
};

/** Side-effect imports of the modules of these files, each once. */
export const sideEffectImports = (files) => [...new Set(files)].map((file) => `import '${CORE}/${file}';`).join('\n');

/**
 * `code` with its imports of @babylonjs/core as imports of the modules declaring each name, and an import of each module
 * that adds a member the code uses to another's class (`mesh.thinInstanceSetBuffer`).
 */
export function deepImports(code) {
  if (!code.includes(CORE)) return code;
  const rewritten = code.replace(IMPORT, (_, list, quote) => {
    const byFile = Map.groupBy(list.split(',').map((s) => s.trim()).filter(Boolean), (spec) => moduleOf(spec.split(/\s+as\s+/)[0]));
    return [...byFile].map(([file, specs]) => `import { ${specs.join(', ')} } from ${quote}${CORE}/${file}${quote};`).join('\n');
  });
  const added = AUGMENTS.filter(([name]) => new RegExp(String.raw`\.${name}\b`).test(code)).map(([, file]) => file);
  if (!added.length) return rewritten;
  const at = Math.max(0, rewritten.search(/^import\b/m));
  return `${rewritten.slice(0, at)}${sideEffectImports(added)}\n${rewritten.slice(at)}`;
}
