# Working on this repo

Setup: `npm ci`, `npm test`, `npm run dev`. Commit and push to `main` when done.

## Writing style for docs

In all project docs (README, docs/, example READMEs, comments meant as docs): no emoji, no em
dashes or en dashes, no arrow glyphs (write menu paths as `File > Export`), and no AI-style
filler or flourishes. Keep prose short, plain and factual.

## UI components

New UI is Vue single-file components built from shadcn-vue (reka-ui primitives), in
`src/editors/interface/components/ui/` (`components.json` is set up for the shadcn-vue CLI). Style them with
Tailwind utilities on the semantic tokens in `src/editors/interface/components/tailwind.css`, which map to the design
tokens in `src/theme.css`. Never hard-code colors, sizes or fonts in components: add or reuse a token. Component
roots carry the `bl-ui` class, which scopes the reset. Icons are Blender's (`BlIcon`).

## Blender identifiers

Name what mirrors Blender with Blender's identifiers so the Blender Coverage view (Splash Screen) counts it:
menu, panel and header ids (`VIEW3D_MT_object`) as strings, `blender: 'object.delete'` on operator entries, and the
Blender keymap names in `createKeymap(items, keymaps)`. Design decisions and equivalents go in
`docs/blender-coverage.md`. Regenerate Blender's side with `tools/blender-reference/surface.py`.

## Ports of Blender code

Blender's algorithm code (bmesh, blenlib, geometry, mesh parts of blenkernel) is generated, not hand-ported:
`tools/blender-port/port.py` follows `manifest.json` roots through Clang's AST and writes `*.gen.js` modules mirroring
Blender's files, pinned to one Blender tag. Never edit `*.gen.js`. Bylonder diverges only in shims: the public module
(`bmesh-query.js`) exports a Blender name to replace its generated port and re-exports the rest. `status.json` states the
overlap: generated, shimmed (with signature differences), excluded (with a reason) and missing.

- Fix wrong output in the converter (`convert.py`, mapping tables in `rules.py`), never by hand, and keep improving it
  without regressions, preferring what Clang or JS tooling states exactly over text matching.
- A shim that deviates from what the converter would produce on purpose (performance, Bylonder's design) carries a
  `// port-override: <reason>` comment, so overrides can be found and rechecked as Blender changes.
- Goal: the same module boundaries can also be built to WASM from Blender's sources, selectable per subsystem at
  build or run time.

## Code style

Less is more. Write DRY, readable, self-documenting code: clear names and small functions instead of comments.
Comment only what the code cannot say (a non-obvious reason or constraint), in one line. Tidy as you go:
remove clutter, bloat, dead code and code your change replaces whenever you see it.
