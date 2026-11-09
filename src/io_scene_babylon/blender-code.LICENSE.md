# License

The files of this folder are Blender's code built to WebAssembly (the `.wasm` files) and the code that runs it in the
page (the `.js` file): `bylonder-blender/` opens the package's `scene.blend` in Blender's module, `bylonder-modifiers/`
runs Blender's mesh modifiers. Blender's code, built with its libraries, is distributed under the GNU General Public
License, version 3 or later (SPDX: `GPL-3.0-or-later`), and so is this folder as a whole: its text is in `COPYING`. The
complete source is Blender's (https://projects.blender.org/blender/blender) and Bylonder's
(https://github.com/propolisa/bylonder).

The page loads this folder only when a control that needs it is set. The rest of the package, the page runtime in
`bylonder/` (MIT OR Apache-2.0) and the scene's data, does not depend on it.
