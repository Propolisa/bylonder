# Licensing

Bylonder's own code, docs and examples are licensed under the MIT license (`LICENSE-MIT`) or the Apache License 2.0
(`LICENSE-APACHE`), at your choice (`MIT OR Apache-2.0`). Code taken from Blender stays under Blender's license, the
GPL. `REUSE.toml` gives the license of every file by path, following the [REUSE](https://reuse.software/)
specification, and `LICENSES/` holds the texts. `npm test` checks that every file has one.

## What is GPL, and why

Blender is licensed under the GNU GPL. Its source files are GPL-2.0-or-later; Blender as a whole, built with its
Apache-2.0 libraries, is GPL-3.0-or-later. A file that copies or translates Blender's code is a derived work and keeps
Blender's license, GPL-2.0-or-later:

- files with a `blender-port:` marker, which copy logic from Blender's sources (`npm test` fails when one is not
  listed as GPL in `REUSE.toml`);
- the generated JS ports (`*.gen.js`), their shims and the hand ports beside them (`src/blenlib`, `src/bmesh/intern`,
  `src/bmesh/operators`, `src/bmesh/tools`, `src/makesdna`, and a few in `src/blenkernel`);
- Blender's Python compiled to JS (`src/bl_py`), apart from Transcrypt's runtime and library modules (Apache-2.0);
- Blender's GLSL, kept as JS modules (`src/nodes/blender/gpu-library.js`, `src/compositor/compositor-shaders.js`);
- Blender's datafiles: its icons, its default theme and color management files (`config.ocio` names an
  `ocio-license.txt` that Blender's repository does not have, and the AgX and Filmic sources carry no license of their
  own, so they stay as Blender ships them);
- data taken from Blender that carries its UI text (operator and property descriptions in `src/makesrna/rna-*.json`
  and `src/nodes/blender/node-types.json`);
- patches to Blender's files (`tools/blender-port/wasm/patches`) and the seam files with `blender-port:` markers.

Data that only lists Blender's identifiers, types and offsets (`blender-surface.json`, `dna-*.json`,
`rna-structs.json`) is taken as fact and stays under Bylonder's license.

The seams Bylonder writes in C and C++ (`tools/blender-port/wasm`) are Bylonder's own, so their source is
`MIT OR Apache-2.0` unless marked. Compiled with Blender into the WebAssembly module, they form one program with it.

## The built app and the module

The WebAssembly modules (`bmesh.wasm`, `modifiers.wasm`, `mesh-tessellate.wasm`) are Blender's code built with its
libraries, and are distributed under GPL-3.0-or-later as a whole. The built app (the site `npm run build` makes)
combines Bylonder's code with that module and the GPL files above, so it too is distributed under GPL-3.0-or-later as a
whole. Its complete source is the source archive the build includes (`SOURCE.txt`). Bylonder's own files keep their
permissive license inside it: you can take them out and reuse them under MIT or Apache-2.0.

## Exported pages

A page exported from Bylonder takes the license of the code it ships:

- a page that ships the Blender module, Blender's GLSL (for example a material's node code), or any of the GPL files
  above is under the GPL;
- a page made only of Babylon.js (Apache-2.0), Bylonder's own runtime code and your scene's data is not: data that
  Blender's code computed at export time (an evaluated mesh, sampled keys, a baked texture) is output, not code;
- your own scene, models, textures and project code stay yours, under whatever license you choose.

A JavaScript export of a scene with Geometry Nodes ships Blender's per-node kernels in `bylonder-geometry-nodes/`
(`geometry-nodes.wasm` and `kernels.js`, bundled from `src/io_scene_babylon/polyfill/geometry-nodes.js`), under
GPL-3.0-or-later with its notice and the GPL's text; its `scene.js` says so. Bylonder's evaluator that calls them
(`bylonder/geometry-nodes/`) is MIT OR Apache-2.0.

A license-free export path, which routes each feature to a form without Blender's code, is planned in
[`docs/controllable-exports.md`](docs/controllable-exports.md).

## Third-party files

| Files | License | From |
|---|---|---|
| `public/fonts/Inter.woff2` | OFL-1.1 | The Inter Project Authors |
| `public/fonts/DejaVuSansMono.woff2` | Bitstream-Vera AND LicenseRef-Arev-Fonts | Bitstream, Tavmjong Bah, DejaVu |
| `examples/compositor/fonts`, `tests/fixtures/fonts` | OFL-1.1 | Poiret One, Zen Maru Gothic, Sacramento |
| `examples/compositor/models/animated-woman.glb` | CC0-1.0 | Quaternius |
| `src/bmesh/datafiles/assets`, `src/bmesh/datafiles/studiolights` | CC0-1.0 | Blender's Essentials assets, Poly Haven |
| `src/editors/space_node/babylon`, `public/babylon-types.json` | Apache-2.0 | Babylon.js |
| `src/bl_py` Transcrypt modules | Apache-2.0 | Transcrypt |
| `docs/media/kubeezcut-*.png` | MIT | KubeezCut |

The npm dependencies are permissive (MIT, ISC, BSD, Apache-2.0) or MPL-2.0 (`mediabunny`), all compatible with both
Bylonder's license and the GPL; Font Awesome's icons in Babylon's Inspector are CC-BY-4.0, which asks for credit.
`ffmpeg-static` (GPL-3.0-or-later) is an optional dev tool that runs as its own
program and is not shipped.

Blender is a trademark of the Blender Foundation; Bylonder is not affiliated with or endorsed by it.
