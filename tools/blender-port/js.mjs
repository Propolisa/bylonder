// JS side of the port generator.
// `node js.mjs exports FILE...`: each module's exports as JSON, {file: {exports: {name: {params, override}}, needs}},
// from its syntax tree: params are a function's parameter names (null for other values), override the reason in a
// leading `// port-override: <reason>` comment, needs the names it imports from the tree's other modules.
// `node js.mjs format FILE...`: generated modules get ESLint's prefer-const fix, then Prettier.
import { readFileSync, writeFileSync } from 'node:fs';
import * as espree from 'espree';
import { Linter } from 'eslint';
import * as prettier from 'prettier';

const parse = (text) => espree.parse(text, { ecmaVersion: 'latest', sourceType: 'module', comment: true, range: true });
const paramName = (p) => (p.type === 'AssignmentPattern' ? paramName(p.left) : p.type === 'Identifier' ? p.name : p.type === 'RestElement' ? `...${paramName(p.argument)}` : '{}');

function exportsOf(text, file) {
  const tree = parse(text);
  const names = {};
  // Names imported from other modules of the tree; the generator ports any that are Blender's.
  const needs = tree.body.filter((n) => n.type === 'ImportDeclaration' && n.source.value.startsWith('.')).flatMap((n) => n.specifiers.filter((s) => s.imported).map((s) => s.imported.name));
  const override = (node) => {
    const comment = tree.comments.filter((c) => c.range[1] <= node.range[0] && !text.slice(c.range[1], node.range[0]).trim()).at(-1);
    return comment?.value.match(/^\s*port-override:\s*(.*)$/)?.[1] ?? null;
  };
  for (const node of tree.body) {
    if (node.type !== 'ExportNamedDeclaration') continue;
    const add = (name, params) => { names[name] = { params, override: override(node) }; };
    const decl = node.declaration;
    if (decl?.type === 'FunctionDeclaration') add(decl.id.name, decl.params.map(paramName));
    else if (decl?.type === 'ClassDeclaration') add(decl.id.name, null);
    else if (decl?.type === 'VariableDeclaration') {
      for (const d of decl.declarations) {
        if (d.id.type !== 'Identifier') continue;
        const fn = d.init && ['ArrowFunctionExpression', 'FunctionExpression'].includes(d.init.type) ? d.init : null;
        add(d.id.name, fn ? fn.params.map(paramName) : null);
      }
    }
    for (const s of node.specifiers ?? []) add(s.exported.name, null);
  }
  return { exports: names, needs };
}

const linter = new Linter({ configType: 'flat' });
const config = [{ languageOptions: { ecmaVersion: 'latest', sourceType: 'module' }, rules: { 'prefer-const': ['error', { destructuring: 'all' }] } }];

async function format(file) {
  const fixed = linter.verifyAndFix(readFileSync(file, 'utf8'), config, { filename: file });
  const errors = fixed.messages.filter((m) => m.fatal);
  if (errors.length) throw new Error(`${file}: ${errors.map((m) => `${m.line}: ${m.message}`).join('; ')}`);
  writeFileSync(file, await prettier.format(fixed.output, { parser: 'babel', printWidth: 120, singleQuote: true }));
}

const [command, ...files] = process.argv.slice(2);
if (command === 'exports') {
  const out = {};
  for (const file of files) {
    try { out[file] = exportsOf(readFileSync(file, 'utf8'), file); } catch (error) { out[file] = { error: String(error) }; }
  }
  process.stdout.write(JSON.stringify(out));
} else if (command === 'format') {
  // Every file is tried; files that do not parse stay as written, and all their errors are reported together.
  const failed = [];
  for (const file of files) await format(file).catch((error) => failed.push(error.message));
  if (failed.length) {
    process.stderr.write(failed.join('\n') + '\n');
    process.exitCode = 1;
  }
}
