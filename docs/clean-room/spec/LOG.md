# Log

Every file read and every URL opened, in order. Writes are only inside `C:\Users\nifty\cleanroom\spec\`.

Note: the agent harness injected the text of a project instruction file (`CLAUDE.md` of the Bylonder checkout) and
the git branch status into the session's context before any tool call. It holds working rules for that repo and no
Blender source. It was not opened by a tool call and was not used for this spec.

1. Read `C:\Users\nifty\cleanroom\PROCESS.md`
2. Read `C:\Users\nifty\cleanroom\oracle\README.md`
3. Ran `mkdir -p C:\Users\nifty\cleanroom\spec\probes`, listed `C:\Users\nifty\cleanroom` and `spec`, `node --version`
4. URL https://docs.blender.org/manual/en/latest/animation/drivers/drivers_panel.html (offsets 0, 100000, 200000, 205000)
5. URL https://docs.blender.org/manual/en/latest/editors/graph_editor/fcurves/introduction.html (offsets 0, 196000)
6. URL https://docs.blender.org/manual/en/latest/editors/graph_editor/fcurves/properties.html (offset 190000)
7. URL https://docs.blender.org/manual/en/latest/editors/graph_editor/fcurves/modifiers.html (offset 190000)

No other URL was opened and no other file outside `C:\Users\nifty\cleanroom\spec\` was read. None of the manual
pages showed source code.

## Oracle runs and own files

Every probe ran `node C:\Users\nifty\cleanroom\oracle\oracle.mjs` as a child process through `probes/lib.mjs`
(`ask(name, requests)` writes `name.req.json`, pipes it to the oracle, writes `name.res.json`). `oracle.mjs` and
`bmesh.wasm` were never opened or read.

Order of the probe scripts written and run (each under `C:\Users\nifty\cleanroom\spec\probes\`):

8. `lib.mjs` (helper), then `e1` to `e9` (expressions), `e7` length limit
9. `d1` to `d6` (drivers), `m.mjs` (own matrix helpers, inline `node -e` check of the LOCAL rule), `m2.mjs` (own
   quaternion helpers, inline swing-twist check), `chk_euler.mjs`, `d7`, `d7b.mjs` (re-reads d7 answers), `d8`,
   `d9`, `d10` to `d12`, `chk_euler2.mjs` (re-reads `d4.txt`, d8 answers)
10. `f1` to `f2`, two inline `node -e` reads of f2 answers, `fit_elastic.mjs`, `fit_elastic2.mjs`, `fit_misc.mjs` (re-read f2 answers), `f3`, `fit_bez.mjs`,
    `fit_bez_nc.mjs`, `fit_bez2.mjs`, `fit_bez3.mjs` (re-read f3 answers), `f4` to `f10`, `fit_accel.mjs`, `f11`, `f12`,
    `f12b.mjs`, inline `node -e` reads of f12 answers, `f13` to `f16`
11. `chk_cycles.mjs` (re-reads f7 and f10 answers), `e10`
12. Listed `probes\` (`ls`). Wrote `expressions.md`, `drivers.md`, `fcurves.md`, this log

Progress was reported to the coordinator with SendMessage (no attachments).
