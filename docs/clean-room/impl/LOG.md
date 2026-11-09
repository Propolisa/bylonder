# Implementer log

Every file read and every URL opened, in order. Writes only inside `C:\Users\nifty\cleanroom\impl\`.

Note: the agent harness injected the text of a project instruction file (`CLAUDE.md` of the Bylonder checkout), a memory
index and the git status into the session context before any tool call. It holds repo working rules, no Blender
source. It was not opened by a tool call and was not used.

1. Listed `C:\Users\nifty\cleanroom`, `spec`, `spec\probes`, `oracle` (`ls`)
2. Read `C:\Users\nifty\cleanroom\PROCESS.md`, `oracle\README.md`, `spec\LOG.md`, `spec\AUDIT.txt`
3. Read `spec\expressions.md`, `spec\drivers.md`, `spec\fcurves.md`
4. Read `spec\probes\lib.mjs`, `chk_euler2.mjs`, `f14.mjs`, `f12b.mjs`, `chk_cycles.mjs`; ran `node --version`
5. Wrote `impl/` files: `expression.js`, `ask-oracle.mjs`, `fuzz.mjs`, `fuzz-random.mjs`, `fuzz-expression.mjs`,
   `driver.js`, `fuzz-driver.mjs`, `fuzz-driver-realistic.mjs`, `float32.js`, `rotation-reading.js`, `fcurve.js`,
   `fuzz-fcurve.mjs`, `regress.mjs`, `replay.mjs`, `show.mjs`, `package.json`, `probes/*`, `RESULTS.md`, this log.
6. `regress.mjs` reads every `C:\Users\nifty\cleanroom\spec\probes\*.req.json` and its `*.res.json` (the spec's
   recorded oracle batches, d1 to d12, e1 to e10, f1 to f16) and replays them; `data/d7.json` is a copy of d7.
7. Oracle runs: `node C:\Users\nifty\cleanroom\oracle\oracle.mjs` as a child process (stdin JSON, stdout JSON) from
   `ask-oracle.mjs`, also once directly with `echo ... |`. `oracle.mjs` and `bmesh.wasm` were never opened.
8. Scratch scripts in the session scratchpad directory (my own math checks; they read nothing outside
   `C:\Users\nifty\cleanroom`).

No URL was opened. No file outside `C:\Users\nifty\cleanroom` was read. Progress went to the coordinator by
SendMessage.
