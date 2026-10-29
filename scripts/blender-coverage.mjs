import ts from 'typescript';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

// Finds what Bylonder implements of Blender's surface, from Blender identifiers in the source:
// menu, panel and header ids as string literals (VIEW3D_MT_object), `blender: 'object.delete'` on operator
// entries, with their `keys` as key bindings, and the operators registerOperator(s) registers for every space. Bindings
// count in the Blender keymaps their file names in createKeymap(items, keymaps), or anywhere when it names none; every
// binding of a registered operator counts in the Blender keymaps keymapHandler(keymaps) or areaUI({ keymaps })
// dispatches, named in the call or in the module's array and object literals it refers to.
const UI_ID = /^[A-Z][A-Z0-9]*_(MT|PT|HT)_\w+$/;

async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  // Blender's own scripts (src/bl_py) name everything they could show; what Bylonder shows of them counts at
  // run time.
  const nested = await Promise.all(entries.filter((e) => e.name !== 'bl_py').map((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.(js|vue)$/.test(e.name) ? [join(dir, e.name)] : [])));
  return nested.flat();
}

const text = (node) => (ts.isStringLiteralLike(node) ? node.text : null);
const strings = (node) => (!node ? [] : ts.isArrayLiteralExpression(node) ? node.elements.map(text).filter(Boolean) : [text(node)].filter(Boolean));
const property = (object, name) => object.properties.find((p) => ts.isPropertyAssignment(p) && (p.name.text ?? p.name.escapedText) === name)?.initializer;

// The string literals in an expression, with those of the module's array and object literals it names.
function literals(node, declared, seen = new Set()) {
  const found = [];
  const visit = (n) => {
    if (ts.isStringLiteralLike(n)) found.push(n.text);
    else if (ts.isIdentifier(n) && declared.has(n.text) && !seen.has(n.text)) found.push(...literals(declared.get(n.text), declared, seen.add(n.text)));
    else ts.forEachChild(n, visit);
  };
  if (node) visit(node);
  return found;
}

export function scanSource(source, found = new Set()) {
  const file = ts.createSourceFile('x.ts', source, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  const keymaps = [], bindings = [];
  const declared = new Map(file.statements.filter(ts.isVariableStatement).flatMap((s) => s.declarationList.declarations)
    .filter((d) => ts.isIdentifier(d.name) && d.initializer && (ts.isArrayLiteralExpression(d.initializer) || ts.isObjectLiteralExpression(d.initializer)))
    .map((d) => [d.name.text, d.initializer]));
  const dispatches = (names) => literals(names, declared).forEach((keymap) => found.add('*@keymap:' + keymap));
  const visit = (node) => {
    const value = text(node);
    if (value && UI_ID.test(value)) found.add(value);
    const call = ts.isCallExpression(node) && node.expression.getText?.(file);
    if (call === 'createKeymap') keymaps.push(...strings(node.arguments[1]));
    if (call === 'keymapHandler') dispatches(node.arguments[0]);
    if (call === 'areaUI' && ts.isObjectLiteralExpression(node.arguments[0])) dispatches(property(node.arguments[0], 'keymaps'));
    // An editor that is Blender's own dispatches its keymaps and runs every operator of its prefix (`text.*`).
    if (call === 'mountBlenderArea' && ts.isObjectLiteralExpression(node.arguments[1])) {
      dispatches(property(node.arguments[1], 'keymaps'));
      strings(property(node.arguments[1], 'operators')).forEach((prefix) => found.add(prefix + '*').add(prefix + '*@registry'));
    }
    const registered = (id) => !id.startsWith('bylonder.') && found.add(id).add(id + '@registry');
    // Operators registered for a space type count at run time, in that space's editors.
    if (call === 'registerOperator' && node.arguments.length < 3) strings(node.arguments[0]).forEach(registered);
    if (call === 'registerOperators' && node.arguments.length < 2 && ts.isObjectLiteralExpression(node.arguments[0])) {
      for (const p of node.arguments[0].properties) if (p.name && ts.isStringLiteralLike(p.name)) registered(p.name.text);
    }
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
    if (/_(MT|PT|HT)_|blender:|mountBlenderArea\(/.test(source)) scanSource(source, found);
  }
  return [...found].sort();
}
