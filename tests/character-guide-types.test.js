// The character animation guide's examples compile against the runtime's types (docs/character-animation.md): each
// ```js block is type-checked as a module of its own against the character .d.ts files, with what it takes as given
// declared (the loaded scene, the hero, the scene's objects), so a renamed API or a typo in the guide fails here.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/\\/g, '/');
const guide = readFileSync(`${root}docs/character-animation.md`, 'utf8');
const RUNTIME = '../../src/io_scene_babylon/runtime/character';
const DIR = `${root}tests/__guide__/`;

// What the examples take as given, by name: declared unless the example makes it.
const GIVEN = {
  engine: 'unknown',
  blend: 'Blend',
  hero: 'Character',
  guard: 'Character', a: 'Character', b: 'Character', enemy: 'Character', villain: 'Character',
  post: 'TransformNode', chair: 'TransformNode', cup: 'TransformNode', ledge: 'TransformNode', bowl: 'TransformNode',
  sword: 'TransformNode',
  step: 'Sound', slap: 'Sound',
};
// The package's scene.js (js-export.js): load, and the character API and effects it re-exports.
const SCENE = `export * from '${RUNTIME}/api.js';
export * from '${RUNTIME}/effects/index.js';
export declare function load(engine: unknown): Promise<import('./prelude.js').Blend>;
`;
const PRELUDE = `import type { Scene } from '@babylonjs/core';
export type Blend = { scene: Scene; [key: string]: any };
export type Sound = { setPosition(position: import('@babylonjs/core').Vector3): void; play(): void };
`;
// What a page imports: the character API and effects from the scene, and Babylon's Vector3.
const IMPORTS = `import { Character, Layer, followCamera, defineEffect, defineSource, feet, gaze, lean, reach, impact, springs, breathe, eyes } from './scene.js';
import { Vector3, TransformNode } from '@babylonjs/core';
import type { Blend, Sound } from './prelude.js';
`;

const examples = [...guide.matchAll(/^```js\n([\s\S]*?)^```/gm)].map((m) => ({ code: m[1], line: guide.slice(0, m.index).split('\n').length + 1 }));
assert.ok(examples.length >= 15, `the guide's examples: ${examples.length}`);

const files = new Map([[`${DIR}scene.ts`, SCENE], [`${DIR}prelude.ts`, PRELUDE]]);
for (const [i, { code }] of examples.entries()) {
  // A package's scene.js, whatever its folder; names the example imports are not imported again.
  const body = code.replace(/from '\.\/[\w-]+\/scene\.js'/g, "from './scene.js'");
  const imported = new Set([...body.matchAll(/^import \{([^}]*)\}/gm)].flatMap((m) => m[1].split(',').map((n) => n.trim())));
  const made = new Set([...body.matchAll(/\b(?:const|let|var|function|class)\s+(\w+)/g)].map((m) => m[1]));
  const prelude = IMPORTS.split('\n').map((line) => line.replace(/\{([^}]*)\}/, (_, names) => `{ ${names.split(',').map((n) => n.trim()).filter((n) => !imported.has(n) && !made.has(n)).join(', ')} }`))
    .filter((line) => !/\{\s*\}/.test(line)).join('\n');
  const given = Object.entries(GIVEN).filter(([name]) => !made.has(name) && !imported.has(name)).map(([name, type]) => `declare const ${name}: ${type};`).join('\n');
  files.set(`${DIR}example-${i}.ts`, `${prelude}\n${given}\n${body}\nexport {};\n`);
}

const options = { strict: true, noImplicitAny: false, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
  lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], types: [], skipLibCheck: true, noEmit: true };
const host = ts.createCompilerHost(options);
const { getSourceFile, fileExists, readFile, directoryExists } = host;
// Paths as the compiler gives them: either slash, any case on a file system that ignores it.
const key = (name) => name.replace(/\\/g, '/').toLowerCase();
const virtual = new Map([...files].map(([name, text]) => [key(name), text]));
Object.assign(host, {
  fileExists: (name) => virtual.has(key(name)) || fileExists(name),
  directoryExists: (name) => key(DIR).startsWith(key(name).replace(/\/?$/, '/')) || directoryExists(name),
  readFile: (name) => virtual.get(key(name)) ?? readFile(name),
  getSourceFile: (name, version, ...rest) => virtual.has(key(name)) ? ts.createSourceFile(name, virtual.get(key(name)), version) : getSourceFile(name, version, ...rest),
});
const program = ts.createProgram([...files.keys()].filter((f) => f.includes('example-')), options, host);
const failures = [];
for (const [i, { line }] of examples.entries()) {
  const file = program.getSourceFile(`${DIR}example-${i}.ts`);
  const messages = ts.getPreEmitDiagnostics(program, file).map((d) => {
    const at = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start) : null;
    const source = at ? d.file.text.split('\n')[at.line].trim() : '';
    return `${ts.flattenDiagnosticMessageText(d.messageText, ' ')} [${source}]`;
  });
  if (messages.length) failures.push(`example at docs/character-animation.md:${line}:\n  ${messages.join('\n  ')}`);
}
assert.equal(failures.length, 0, `${failures.length} of ${examples.length} guide examples do not compile:\n${failures.join('\n')}`);
console.log(`character guide: all ${examples.length} examples compile against the runtime's types`);
