# Working on this repo

Setup: `npm ci`, `npm run module` (fetches Blender's WASM module built by CI for this checkout; a local module build installs
itself instead), `npm test`, `npm run dev`. Commit and push to `main` when done. The module is not kept in git.
The workflow runs on Windows, Linux and macOS. `npm run tools` installs the dev tools into `.tools/` of the checkout
and nowhere else (delete the folder to remove them): Playwright's Chromium, which browser checks and docs recorders run
on the machine's GPU (`CHROMIUM_CDP` drives a running one instead), and the reference Blender the tests compare
against (Linux and Windows; elsewhere point `BLENDER_REFERENCE` at one). ffmpeg comes with the dev dependencies. Dev
tooling never installs onto the host outside the checkout.

Commit subjects are the app's changelog (Splash Screen > Changelog): one commit per user-visible change, its subject
saying what a user gets. No WIP commits reach `main`; branches merge with `git merge --squash`. Before pushing to
`main`: `npm test`, `npm run build` and `npm run test:prod` pass (the Pages deploy runs the same).

## Roadmap

`docs/roadmap.md` changes only with the project owner's approval: propose an entry or an edit and wait for a yes; never
add, edit, reorder or remove entries on your own.

## Writing style for docs

In all project docs (README, docs/, example READMEs, comments meant as docs): no emoji, no em
dashes or en dashes, no arrow glyphs (write menu paths as `File > Export`), and no AI-style
filler or flourishes. Keep prose short, plain and factual.

## Working with agents

When work is split across background agents, the coordinating session owns release quality:

- Each agent gets one feature area, a brief that names its files, constraints and checks, and its own worktree.
- Agents send a one-line update about every 5 minutes (finished, next, blocker or doubt), naming the paths of any
  pictures they made (renders, screenshots, GIFs). The coordinator reads code only when an update looks off, and
  steers by message.
- The owner follows along by pictures: the coordinator shows each new picture to the owner as soon as it exists
  (thumbnails, recorded media, side-by-side comparisons, bug screenshots), not only at the end.
- One build at a time on the machine (`npm run build` and module builds share memory): an agent asks for the build
  slot and says when it is done. One agent at a time holds the right to rebuild the WASM module; others write seam
  source and hand it over.
- An agent's work lands as one commit with a user-facing subject, after `npm test`, `npm run build` and
  `npm run test:prod` pass on the merged tree. Each stable increment goes to `main` and its deploy is checked.

## Feature docs

Every user-facing feature has a page in `docs/features/<id>.md`, shown by the docs viewer (`docs.html`, styled as
Blender's manual) and listed on its index page (`docs/features/README.md`, built from the pages' front matter: thumbnail,
name, Open in Bylonder link, Blender manual link). A feature is done when its page, demo project and tests exist.

- **Front matter (YAML), required, machine-indexable**: it is the source for the index, for AI context prompts and for
  mapping docs to the UI. Keys: `id`, `title`, `summary` (one sentence), `expect` (one line on what a user can expect,
  honest and specific, written from `limits`: what works as in Blender and the surprises), `blender_version` (the
  tracked version, from `tools/blender-port/manifest.json`), `blender_manual` (links into
  `https://docs.blender.org/manual/en/<major.minor>/`), `example` (the `examples/<id>` project the page recreates),
  `thumbnail` and `media` (files in `docs/media/features/`), `ui` (Blender identifiers of the spaces, modes, menus,
  panels and tools the feature uses: `VIEW3D_MT_pose`, `BONE_PT_transform`, `POSE`; an id ending in `*` stands for every
  menu, panel and header Blender names with that prefix, `VIEW3D_MT_pose*`, so `ui` lists the feature's whole Blender
  surface, not a pick), `operators` (idnames), `code` (main source files), `tests` (test files), `limits` (one line
  each). `scripts/feature-docs.mjs` checks every page and writes `docs/features/index.json`; the test suite runs it. It
  also counts each feature's coverage, as the Blender Coverage view does, over the menus, panels and headers in `ui`
  (with what is inside them) and the `operators`: "Operators: 42 complete, 3 working in part, of 57" (partial in the
  Blender Coverage view), shown on the index and the page, never hand-written. Blender's operators and classes the app
  runs are known only at run time: `node scripts/feature-docs.mjs --runtime` saves them to `src/coverage/runtime.json`,
  and `npm run test:prod` fails when they change.
- **Body**: what the feature is, an Open in Bylonder link (the live site with the example opened), then two sections:
  `## Steps`, numbered steps that recreate the demo from an empty scene with a GIF or screenshot per step (recorded
  from the app with Playwright, `tools/docs/record-*.mjs`, so they can be regenerated), and `## Project files`, the
  project files of the demo. The viewer adds Not done yet (from `limits`) and Reference (`ui`, `operators`, `code`,
  `tests`), so the body does not repeat them.
- Media: GIFs short and small (under 1 MB), screenshots cropped to what the step shows, all regenerable.

## Runtimes

A feature that exists on both sides (Blender data and a Babylon class) can offer a runtime: Blender, Babylon (mapped)
or Babylon (native), chosen per instance; `docs/runtimes.md` is the model (settings, evaluation, drawing). A feature joins through one wrapper module in `src/runtimes/`, registered
with `src/runtimes/runtimes.js`, never by changing other code; Bylonder's own panels, settings, operators and modifiers
carry the Bylonder icon (`BYLONDER`), Blender's own UI none.

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
own definition carries a `// port-override: <reason>` comment. Call the module, never port C to JS. Drawing Blender's data
reuses Blender's shaders (`docs/blender-boundary.md` Drawing); logic copied from Blender where its code cannot run carries
`blender-port: <Blender file and function>`.

The generated JS ports (`*.gen.js` and their shims, from `tools/blender-port/port.py`) are kept for tests and possible
later use, but must not ship: `node scripts/port-usage.mjs` lists which port modules the app still imports
(`tools/blender-port/build-usage.json`), and that list only shrinks. Never edit `*.gen.js`; fix the converter
(`convert.py`, `rules.py`) if a port is regenerated.

## Code style

Less is more. Write DRY, readable, self-documenting code: clear names and small functions instead of comments.
Comment only what the code cannot say (a non-obvious reason or constraint), in one line. Tidy as you go:
remove clutter, bloat, dead code and code your change replaces whenever you see it.
