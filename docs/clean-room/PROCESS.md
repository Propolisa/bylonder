# Clean-room process

The clean-room implementers write MIT-licensed JavaScript for driver expressions, driver variables and F-Curve
evaluation. They never see Blender's source or Bylonder's code derived from it. They learn Blender's behavior only
from published documentation and from the oracle.

## The oracle

`oracle/` answers requests with Blender's own results. Blender's C/C++, compiled to WebAssembly (`oracle/bmesh.wasm`),
does the work; `oracle/oracle.mjs` passes requests to it and returns the answers. Implementers run it and compare
their results with its answers. `oracle/README.md` documents the requests and answers and is the only file in the
folder meant to be read.

The oracle exposes behavior only: inputs go in, numbers come out. The folder contains no readable Blender or
Blender-derived source:

- `bmesh.wasm` is compiled machine code, without debug information or a name section.
- `oracle.mjs` is one minified bundle of Bylonder's glue code that drives the module. It contains no generated ports
  of Blender's code (the build fails if one would be bundled). Implementers run it but do not read it.
- There is no Blender source, no `*.gen.js` and no unbundled Bylonder source in the folder.

The folder is built from Bylonder's repository by `node scripts/cleanroom-oracle.mjs`. Its test,
`tests/cleanroom-oracle.test.js`, keeps the oracle working as Blender's module changes.
