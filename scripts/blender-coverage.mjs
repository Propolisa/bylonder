import ts from 'typescript';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Finds what Bylonder implements of Blender's surface, from Blender identifiers in the source:
// menu, panel and header ids as string literals (VIEW3D_MT_object), and `blender: 'object.delete'` on operator
// entries, with their `keys` as key bindings. Bindings count in the Blender keymaps their file names in
// createKeymap(items, keymaps), or anywhere when it names none.
const UI_ID = /^[A-Z][A-Z0-9]*_(MT|PT|HT)_\w+$/;

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  // Blender's own scripts (src/bl_ui) name everything they could show; what Bylonder shows of them counts at run time.
  const nested = await Promise.all(entries.filter((e) => e.name !== 'bl_ui').map((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(js|vue)$/.test(e.name) ? [join(dir, e.name)] : [])));
  return nested.flat();
}

const text = (node) => (ts.isStringLiteralLike(node) ? node.text : null);
const strings = (node) => (!node ? [] : ts.isArrayLiteralExpression(node) ? node.elements.map(text).filter(Boolean) : [text(node)].filter(Boolean));
const property = (object, name) => object.properties.find((p) => ts.isPropertyAssignment(p) && (p.name.text ?? p.name.escapedText) === name)?.initializer;

export function scanSource(source, found = new Set()) {
  const file = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const keymaps = [], bindings = [];
  const visit = (node) => {
    const value = text(node);
    if (value && UI_ID.test(value)) found.add(value);
    if (ts.isCallExpression(node) && node.expression.getText?.(file) === 'createKeymap') keymaps.push(...strings(node.arguments[1]));
    if (ts.isObjectLiteralExpression(node)) {
      for (const id of strings(property(node, 'blender'))) {
        found.add(id);
        for (const keys of strings(property(node, 'keys'))) bindings.push(id + '|' + keys);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  for (const binding of bindings) for (const scope of keymaps.length ? keymaps : [null]) found.add(scope ? binding + '@keymap:' + scope : binding);
  return found;
}

export async function scanImplemented(root = 'src') {
  const found = new Set();
  for (const path of await files(root)) {
    const source = await readFile(path, 'utf8');
    if (/_(MT|PT|HT)_|blender:/.test(source)) scanSource(source, found);
  }
  return [...found].sort();
}
