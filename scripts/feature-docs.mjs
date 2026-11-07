// Checks every feature page (docs/features/<id>.md, CLAUDE.md Feature docs) and writes from their front matter the
// machine-readable index (docs/features/index.json) and the index page (docs/features/README.md), with each feature's
// coverage of Blender's surface as the Blender Coverage view counts it.
// usage: node scripts/feature-docs.mjs [--check] [--links] [--runtime]   (--check fails when a page is invalid or the
// index is out of date; --links fetches every Blender manual link; --runtime first saves what the built app runs of
// Blender's own code, which the source scan cannot see, to src/coverage/runtime.json, which npm run test:prod checks)
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { coverageText, frontMatter, LIMITS, MEDIA, openLink, REFERENCE, SECTIONS } from "../src/feature-docs.js";
import { computeCoverage, runtimeAvailable, STATUS } from "../src/coverage/coverage.js";
import { scanImplemented } from "./blender-coverage.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const DIR = "docs/features/";
const read = (path) => readFileSync(root + path, "utf8");
const exists = (path) => existsSync(root + path);

const SCALARS = ["id", "title", "summary", "expect", "blender_version", "example", "thumbnail"];
const LISTS = ["blender_manual", "media", "ui", "operators", "code", "tests", "limits"];
const blenderVersion = JSON.parse(read("tools/blender-port/manifest.json")).blender.replace(/^v/, "");
const manual = `https://docs.blender.org/manual/en/${blenderVersion.split(".").slice(0, 2).join(".")}/`;
const examples = new Map([...read("src/workspace/examples.js").matchAll(/\{ id: "([\w-]+)", title: "([^"]+)" \}/g)].map(([, id, title]) => [id, title]));
// Blender's identifiers: the interface Blender reports (tools/blender-reference/surface.py), its object modes
// (rna_enum_object_mode_items) and its tools' idnames (space_toolsystem_toolbar.py).
const surface = JSON.parse(read("src/coverage/blender-surface.json"));
const blenderIds = new Set(surface.ids);
const walk = (nodes) => nodes.forEach((node) => { blenderIds.add(node.id.split(":")[0]); walk(node.c ?? []); });
walk(surface.tree);
const MODES = ["OBJECT", "EDIT", "POSE", "SCULPT", "VERTEX_PAINT", "WEIGHT_PAINT", "TEXTURE_PAINT", "PARTICLE_EDIT", "SCULPT_CURVES",
  "PAINT_GREASE_PENCIL", "SCULPT_GREASE_PENCIL", "WEIGHT_GREASE_PENCIL", "VERTEX_GREASE_PENCIL"];
// CLAUDE.md Writing style for docs: no en or em dashes, arrows or emoji.
const GLYPHS = /[\u2013\u2014\u2190-\u21ff\u27f0-\u27ff\u2900-\u297f\u2b00-\u2bff]|\p{Extended_Pictographic}/u;
// A ui entry ending in * stands for Blender's menus, panels and headers whose id starts with the rest (VIEW3D_MT_pose*).
const UI_TYPES = [...blenderIds].filter((id) => /_(MT|PT|HT)_/.test(id));
const expand = (ids) => ids.flatMap((id) => (id.endsWith("*") ? UI_TYPES.filter((type) => type.startsWith(id.slice(0, -1))) : [id]));
const isUi = (id) => blenderIds.has(id) || MODES.includes(id) || /^builtin(_brush)?\.\w+$/.test(id) || (id.endsWith("*") && expand([id]).length > 0);

const RUNTIME = "src/coverage/runtime.json";
if (process.argv.includes("--runtime")) {
  const { chromium, openApp, runtimeCoverage, startServer, BOOT } = await import("../tests/e2e/app.mjs");
  const server = await startServer({ build: false }), browser = await chromium.launch();
  try {
    writeFileSync(root + RUNTIME, JSON.stringify(await runtimeCoverage(await openApp(browser, server.url, BOOT)), null, 1) + "\n");
  } finally {
    await browser.close();
    await server.close();
  }
}
// Each Blender id's places in the surface with their status, as the Blender Coverage view has them with the app's
// run-time list. An id counts unless every place of it is not applicable; its best place's score makes it supported
// (1) or partial (0.5); one the surface does not place is supported when the source or the app runs it (an editor's
// operators by prefix: `uv.*`).
const runtime = JSON.parse(read(RUNTIME)), implemented = await scanImplemented(root + "src");
const places = new Map();
const index = (node) => { (places.get(node.id) ?? places.set(node.id, []).get(node.id)).push(node); node.c?.forEach(index); };
computeCoverage(surface, implemented, read("docs/blender-coverage.md"), runtimeAvailable(runtime)).tree.forEach(index);
const elsewhere = new Set([...implemented, ...runtime.operators, ...runtime.classes]);
const prefixes = implemented.filter((id) => id.endsWith(".*")).map((id) => id.slice(0, -1));
const counted = (id) => !places.get(id)?.every((node) => node.status === "skip");
const score = (id) => (places.has(id) ? Math.max(...places.get(id).map((node) => STATUS[node.status]?.score ?? 0))
  : Number(elsewhere.has(id) || prefixes.some((prefix) => id.startsWith(prefix))));
const count = (ids) => {
  const scores = [...ids].filter(counted).map(score);
  return { supported: scores.filter((s) => s === 1).length, partial: scores.filter((s) => s > 0 && s < 1).length, total: scores.length };
};
// A feature's share of Blender's surface: the menus, panels and headers its ui names, with the menus, panels and
// operators inside them, and the operators it names. Spaces and modes are where it happens, not what it covers; a
// menu found in several spaces (NODE_MT_add) counts in the ones the page names.
function coverage(data) {
  const ui = expand(data.ui), menus = new Set(ui.filter((id) => /_(MT|PT|HT)_/.test(id))), ops = new Set(data.operators);
  const collect = (node) => {
    if (node.k === "menu" || node.k === "panel") menus.add(node.id);
    if (node.k === "op") ops.add(node.id);
    node.c?.forEach(collect);
  };
  const named = (node) => node.ancestors.some((a) => ui.includes(a.id));
  for (const id of [...menus]) {
    const all = places.get(id) ?? [], here = all.filter(named);
    for (const node of here.length ? here : all) node.c?.forEach(collect);
  }
  return { operators: count(ops), ui: count(menus) };
}

function check(file) {
  const path = DIR + file, text = read(path), { data, body } = frontMatter(text), errors = [];
  const fail = (message) => errors.push(`${path}: ${message}`);
  // Pages written before expect replaced status only warn, until their owners update them.
  const legacy = "status" in data && !("expect" in data);
  if (legacy) warnings.push(`${path}: status is replaced by expect (CLAUDE.md Feature docs)`);
  for (const key of SCALARS) if ((typeof data[key] !== "string" || !data[key]) && !(legacy && key === "expect")) fail(`${key} is required`);
  for (const key of LISTS) if (!Array.isArray(data[key]) || !data[key].length) fail(`${key} must be a list`);
  for (const key of Object.keys(data)) if (![...SCALARS, ...LISTS, ...(legacy ? ["status"] : [])].includes(key)) fail(`unknown key ${key}`);
  if (errors.length) return { errors };
  if (data.id !== file.replace(/\.md$/, "")) fail(`id ${data.id} is not the file's name`);
  if (data.blender_version !== blenderVersion) fail(`blender_version ${data.blender_version} is not the tracked ${blenderVersion}`);
  for (const url of data.blender_manual) if (!url.startsWith(manual)) fail(`blender_manual ${url} is not in ${manual}`);
  if (!examples.has(data.example) || !exists(`examples/${data.example}`)) fail(`example ${data.example} is not in examples/ and src/workspace/examples.js`);
  for (const file of [data.thumbnail, ...data.media]) if (!exists(MEDIA + file)) fail(`media ${MEDIA + file} is missing`);
  for (const file of [...data.code, ...data.tests]) if (!exists(file)) fail(`${file} is missing`);
  for (const id of data.ui) if (!isUi(id)) fail(`ui ${id} is not a Blender identifier`);
  for (const id of data.operators) if (!blenderIds.has(id)) fail(`operator ${id} is not Blender's`);
  if (!body.includes(openLink(data.example))) fail(`no Open in Bylonder link (${openLink(data.example)})`);
  const shown = [...body.matchAll(/!\[[^\]]*\]\(\.\.\/media\/features\/([^)\s]+)/g)].map((m) => m[1]);
  for (const file of shown) if (!data.media.includes(file)) fail(`${file} is shown but not listed in media`);
  for (const file of data.media) if (!shown.includes(file)) fail(`${file} is listed in media but not shown`);
  const own = MEDIA + data.id + "/";
  for (const file of exists(own) ? readdirSync(root + own) : []) if (![data.thumbnail, ...data.media].includes(data.id + "/" + file)) fail(`${own + file} is not used`);
  text.split("\n").forEach((line, i) => GLYPHS.test(line) && fail(`line ${i + 1} has ${line.match(GLYPHS)[0]}, forbidden in docs`));
  const sections = [...body.matchAll(/^## (.+)$/gm)].map((m) => m[1].trim());
  for (const title of sections.filter((title, i) => sections.indexOf(title) < i)) fail(`section ${title} is there twice`);
  for (const title of sections.filter((title) => [LIMITS, REFERENCE].includes(title))) fail(`section ${title} repeats what the viewer makes from the front matter`);
  if (sections.join() !== SECTIONS.join()) fail(`sections are ${sections.join(", ")}, not ${SECTIONS.join(", ")}`);
  for (const [, href] of body.matchAll(/\]\(([^)\s]+)\)/g)) if (!/^(\w+:|#)/.test(href) && !exists(join(dirname(path), href.split("#")[0]))) fail(`link ${href} does not resolve`);
  return { errors, entry: { ...data, page: path, open: openLink(data.example), example_title: examples.get(data.example), coverage: coverage(data) } };
}

const indexPage = (entries) => `# Features

Each user-facing feature of Bylonder, with a page that recreates its demo project step by step. Generated by
\`scripts/feature-docs.mjs\` from the pages' front matter.

| | Feature | What to expect | Coverage | Open | Blender manual |
|---|---|---|---|---|---|
${entries.map((e) => `| <img src="../media/features/${e.thumbnail}" alt="" width="160"> | [${e.title}](${e.id}.md): ${e.summary} | ${e.expect ?? ""} | ${coverageText(e.coverage).join("; ")} | [Open in Bylonder](${e.open}) | [Manual](${e.blender_manual[0]}) |`).join("\n")}
`;

const warnings = [];
const results = readdirSync(root + DIR).filter((f) => f.endsWith(".md") && f !== "README.md").sort().map(check);
const errors = results.flatMap((r) => r.errors);
const entries = results.map((r) => r.entry).filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
const outputs = { [DIR + "index.json"]: JSON.stringify(entries, null, 1) + "\n", [DIR + "README.md"]: indexPage(entries) };
const checking = process.argv.includes("--check");
for (const [path, text] of Object.entries(outputs)) {
  if (!checking) writeFileSync(root + path, text);
  else if (!exists(path) || read(path) !== text) errors.push(`${path} is out of date: run node scripts/feature-docs.mjs`);
}
// The manual answers a missing page with a 404 page titled Not Found.
if (process.argv.includes("--links")) for (const url of new Set(entries.flatMap((e) => e.blender_manual))) {
  const page = await fetch(url).then((r) => r.text(), (e) => e.message);
  if (!/<title>(?!Not Found)[^<]*Manual/.test(page)) errors.push(`${url} is not a page of the manual`);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log([`${entries.length} feature pages`, ...warnings].join("\n"));
