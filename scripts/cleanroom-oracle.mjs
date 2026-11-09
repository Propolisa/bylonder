// Builds the clean-room oracle (tools/cleanroom/oracle.js) into a folder that runs on its own: oracle.mjs, one
// minified bundle, beside Blender's compiled module. node scripts/cleanroom-oracle.mjs [folder], by default
// ~/cleanroom/oracle. The folder's README is written by hand there and kept.
import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const out = resolve(process.argv[2] ?? join(homedir(), 'cleanroom', 'oracle'));
mkdirSync(out, { recursive: true });

// The oracle reads no datafiles (asset libraries, color management) and makes no meshes, so neither is shipped: the
// bundle holds no generated port (*.gen.js) and loads no file but Blender's module.
const STUBS = {
  'src/bmesh/datafiles.js': 'export const DATAFILES = [];',
  'src/blenkernel/mesh/mesh.js': "export function createMesh() { throw new Error('The oracle makes no meshes'); }",
};
const stubs = {
  name: 'stubs',
  setup(b) {
    for (const [path, contents] of Object.entries(STUBS)) {
      b.onLoad({ filter: new RegExp(path.replaceAll('/', '[\\\\/]').replaceAll('.', '\\.') + '$') }, () => ({ contents, loader: 'js' }));
    }
  },
};

const { metafile } = await build({
  entryPoints: ['tools/cleanroom/oracle-cli.js'],
  outfile: join(out, 'oracle.mjs'),
  bundle: true,
  minify: true,
  legalComments: 'none',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  plugins: [stubs],
  metafile: true,
  logLevel: 'error',
});
const ports = Object.keys(metafile.inputs).filter((input) => input.endsWith('.gen.js'));
if (ports.length) throw new Error(`The oracle bundles generated ports: ${ports.join(', ')}`);
copyFileSync('src/bmesh/bmesh.wasm', join(out, 'bmesh.wasm'));
console.log(`Clean-room oracle built in ${out}`);
