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
menu, panel and header ids (`VIEW3D_MT_object`) as strings, and operators registered by idname
(`registerOperator('object.delete', ...)` in `src/windowmanager/wm-operators.js`). Keys come only from Blender's own
keymaps (`keymapHandler` in `src/windowmanager/keyconfig.js`); `createKeymap(items, keymaps)` is for modal maps and
Bylonder's own keys. The shared foundations every subsystem builds on are in `docs/blender-boundary.md`; design
decisions and equivalents go in `docs/blender-coverage.md` and `docs/blender-boundary.md`. Regenerate Blender's side
with `tools/blender-reference/surface.py`.

## Blender's code in the app

Blender's C/C++ runs in the WASM module (`tools/blender-port/blender_build.py`, `manifest.json`), built from Blender's
sources; Bylonder's hand-written C is limited to seams in `tools/blender-port/wasm/`, and a seam that replaces Blender's
own definition carries a `// port-override: <reason>` comment. Call the module, never port C to JS.

The generated JS ports (`*.gen.js` and their shims, from `tools/blender-port/port.py`) are kept for tests and possible
later use, but must not ship: `node scripts/port-usage.mjs` lists which port modules the app still imports
(`tools/blender-port/build-usage.json`), and that list only shrinks. Never edit `*.gen.js`; fix the converter
(`convert.py`, `rules.py`) if a port is regenerated.

## Code style

Less is more. Write DRY, readable, self-documenting code: clear names and small functions instead of comments.
Comment only what the code cannot say (a non-obvious reason or constraint), in one line. Tidy as you go:
remove clutter, bloat, dead code and code your change replaces whenever you see it.
