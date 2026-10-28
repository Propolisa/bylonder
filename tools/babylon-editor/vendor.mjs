// Babylon's node editors' block catalog, forked from their sources (Apache-2.0; the npm bundles carry them in their
// source maps): per editor, its blockTools (a block from its menu name, configured as Babylon's editor configures
// it), transpiled to JS against @babylonjs/core, and its node list (the menu's categories, block names and
// tooltips). Writes src/editors/space_node/babylon/<editor>-blocks.js.
// usage: node tools/babylon-editor/vendor.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import ts from 'typescript';

// Babylon's source folders as the npm packages that export them.
const PACKAGES = { core: '@babylonjs/core', gui: '@babylonjs/gui' };

const EDITORS = {
  material: { pkg: 'node-editor', map: 'babylon.nodeEditor.js.map', src: 'tools/nodeEditor/src' },
  'render-graph': { pkg: 'node-render-graph-editor', map: 'babylon.nodeRenderGraphEditor.js.map', src: 'tools/nodeRenderGraphEditor/src' },
};
const OUT = new URL('../../src/editors/space_node/babylon/', import.meta.url);
const version = JSON.parse(readFileSync('node_modules/@babylonjs/core/package.json', 'utf8')).version;

const sources = (pkg, map) => {
  const { sources, sourcesContent } = JSON.parse(readFileSync(`node_modules/@babylonjs/${pkg}/dist/${map}`, 'utf8'));
  return (suffix) => sourcesContent[sources.findIndex((s) => s.endsWith(suffix))];
};

// The BlockTools class as JS, importing from Babylon's packages what it uses.
async function blockTools(source) {
  const file = ts.createSourceFile('blockTools.ts', source, ts.ScriptTarget.ES2022, true);
  const imports = file.statements.filter(ts.isImportDeclaration), names = new Map();
  for (const node of imports) {
    const pkg = PACKAGES[node.moduleSpecifier.text.split('/')[0]];
    if (!pkg) throw Error(`blockTools imports ${node.moduleSpecifier.text}`);
    if (node.importClause?.isTypeOnly) continue;
    for (const element of node.importClause?.namedBindings?.elements ?? []) if (!element.isTypeOnly) names.set(element.name.text, pkg);
  }
  const code = imports.reduceRight((text, node) => text.slice(0, node.getFullStart()) + text.slice(node.getEnd()), source);
  const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  const lines = [];
  for (const pkg of new Set(names.values())) {
    const exported = await import(pkg), used = [...names].filter(([n, p]) => p === pkg && new RegExp(`\\b${n}\\b`).test(js)).map(([n]) => n).sort();
    const missing = used.filter((n) => !(n in exported));
    if (missing.length) throw Error(`${pkg} lacks ${missing.join(', ')}`);
    if (used.length) lines.push(`import { ${used.join(', ')} } from '${pkg}';`);
  }
  return `${lines.join('\n')}\n${js}`;
}

// A literal assigned to `name` in the source (an object of strings and string arrays).
function literal(source, name) {
  const file = ts.createSourceFile('list.tsx', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let found;
  const visit = (node) => {
    if ((ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) && node.name.getText() === name && node.initializer) found = node.initializer;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(file);
  const value = Function('customFrameNames', 'customBlockNames', `return (${found.getText()});`)([], []);
  return Object.fromEntries(Object.entries(value).filter(([, v]) => !(Array.isArray(v) && !v.length)));
}

mkdirSync(OUT, { recursive: true });
for (const [id, { pkg, map, src }] of Object.entries(EDITORS)) {
  const read = sources(pkg, map), list = read(`${src}/components/nodeList/nodeListComponent.tsx`);
  const header = `// Forked by tools/babylon-editor/vendor.mjs from Babylon.js ${version} (${src}, Apache-2.0); do not edit.\n`;
  const catalog = `export const categories = ${JSON.stringify(literal(list, 'allBlocks'), null, 1)};\nexport const tooltips = ${JSON.stringify(literal(list, '_Tooltips'), null, 1)};\n`;
  writeFileSync(new URL(`${id}-blocks.js`, OUT), header + await blockTools(read(`${src}/blockTools.ts`)) + '\n' + catalog);
  console.log(`wrote src/editors/space_node/babylon/${id}-blocks.js`);
}
