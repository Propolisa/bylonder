# License

The files of this folder are the page's Blender fallback: Blender's WebAssembly module (`bmesh.wasm`,
`mesh-tessellate.wasm`) and the code that opens the package's `scene.blend` in it and draws what it evaluates
(`blender.js`). Blender's code, built with its libraries, is distributed under the GNU General Public License,
version 3 or later (SPDX: `GPL-3.0-or-later`), and so is this folder as a whole: its text is in `COPYING`. The
complete source is Blender's (https://projects.blender.org/blender/blender) and Bylonder's
(https://github.com/propolisa/bylonder).

The export ships this folder only with Include Source .blend. The rest of the package, the page runtime in
`bylonder/` (MIT OR Apache-2.0) and the scene's data, does not depend on it until a control only Blender evaluates is
set.
