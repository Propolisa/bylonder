// The page runtime's files made from the IR's schema (src/io_scene_babylon/runtime/ir.js): zod.js, the part of Zod's
// zod/mini that the runtime and units use, bundled so a package loads from a static server with no bundler, with its
// zod.d.ts; and ir.schema.json, the IR's JSON Schema, generated from the same schema so the two cannot drift.
// usage: node scripts/ir-runtime.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild-wasm';

const runtime = new URL('../src/io_scene_babylon/runtime/', import.meta.url);
const ZOD = JSON.parse(readFileSync(new URL('../node_modules/zod/package.json', import.meta.url), 'utf8')).version;
// What a unit's input schema is written with, and what ir.js and units.js use.
export const ZOD_EXPORTS = ['object', 'looseObject', 'strictObject', 'record', 'array', 'tuple', 'union', 'discriminatedUnion', 'literal', 'enum',
  'string', 'number', 'int', 'boolean', 'any', 'unknown', 'null', 'instanceof', 'custom', 'optional', 'nullable', '_default', 'prefault', 'catch',
  'regex', 'minimum', 'maximum', 'minLength', 'maxLength', 'refine', 'parse', 'safeParse', 'ZodMiniType'];

const HEADER = `// Zod ${ZOD} (zod/mini, https://zod.dev), the part Bylonder's page runtime uses, bundled by scripts/ir-runtime.mjs.
// Do not edit. SPDX-License-Identifier: MIT
// Copyright (c) 2025 Colin McDonnell. Permission is hereby granted, free of charge, to any person obtaining a copy of
// this software and associated documentation files (the "Software"), to deal in the Software without restriction,
// including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following
// conditions: The above copyright notice and this permission notice shall be included in all copies or substantial
// portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
// INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
// SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
`;

const values = ZOD_EXPORTS.filter((name) => name !== 'ZodMiniType');

// zod.js and zod.d.ts, by name.
export async function zodFiles() {
  const result = await build({ stdin: { contents: `export { ${values.join(', ')} } from 'zod/mini';`, resolveDir: fileURLToPath(new URL('..', import.meta.url)) },
    bundle: true, minify: true, format: 'esm', target: 'es2022', write: false, legalComments: 'none' });
  const types = `${HEADER}export { ${ZOD_EXPORTS.join(', ')} } from 'zod/mini';
export type { infer, input, output } from 'zod/mini';
`;
  return { 'zod.js': HEADER + result.outputFiles[0].text, 'zod.d.ts': types };
}

// ir.schema.json, from ir.js's schema (which imports zod.js).
export async function schemaFile() {
  const { IRSchema } = await import(new URL('ir.js', runtime).href);
  const { toJSONSchema } = await import('zod/mini');
  const schema = { ...toJSONSchema(IRSchema, { io: 'input', unrepresentable: 'any' }), $id: 'https://bylonder.dev/ir/1/schema.json', title: 'Bylonder IR, version 1 (docs/ir.md)' };
  return `${JSON.stringify(schema, null, 2)}
`;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  for (const [name, text] of Object.entries(await zodFiles())) writeFileSync(new URL(name, runtime), text);
  writeFileSync(new URL('ir.schema.json', runtime), await schemaFile());
}
