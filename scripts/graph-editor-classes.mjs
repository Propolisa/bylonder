import { readFile, writeFile } from 'node:fs/promises';

const editors = ['node-editor', 'node-geometry-editor', 'node-render-graph-editor', 'node-particle-editor'];
const literal = (s, i) => {
  const quote = s[i];
  let j = i + 1, raw = '';
  while (s[j] !== quote) { if (s[j] === '\\') { raw += s.slice(j, j + 2); j += 2; } else raw += s[j++]; }
  if (quote === "'") raw = raw.replace(/\\'/g, "'").replace(/"/g, '\\"');
  return [JSON.parse('"' + raw + '"'), j + 1];
};
const unique = list => [...new Set(list)];
const modules = {};
for (const editor of editors) {
  const dir = `node_modules/@babylonjs/${editor}/dist/`;
  const file = (await import('node:fs')).readdirSync(dir).find(f => f.endsWith('.js') && !f.includes('.max.') && !f.includes('.map'));
  const source = await readFile(dir + file, 'utf8');
  for (const match of source.matchAll(/\.push\(\[e\.id,/g)) {
    try {
      const [compiled, end] = literal(source, match.index + match[0].length);
      const [path] = literal(source, source.indexOf('sources:[', end) + 9);
      const [original] = literal(source, source.indexOf('sourcesContent:[', end) + 16);
      const name = path.split('/').pop();
      if (!name.includes('.module.')) continue;
      const hashed = unique([...compiled.matchAll(/\.([A-Za-z0-9_-]{20})(?![\w-])/g)].map(m => m[1]));
      const local = unique([...original.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\([^)]*\)|\d*\.\d+/g, '').matchAll(/(?<![\w-])\.([A-Za-z_][\w-]*)/g)].map(m => m[1]));
      if (hashed.length !== local.length) continue;
      const key = name.replace('.module.scss', '');
      modules[key] ||= {};
      local.forEach((cls, i) => { modules[key][cls] = unique([...(modules[key][cls] || []), hashed[i]]); });
    } catch {}
  }
}
await writeFile('src/editors/space_node/editor-classes.json', JSON.stringify(modules, null, 1) + '\n');
console.log('Graph editor CSS modules: ' + Object.keys(modules).length);
