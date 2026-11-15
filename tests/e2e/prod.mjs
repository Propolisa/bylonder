// Production check: the built app (dist/) boots in headless Chromium without a page error or console error, runs the
// Blender operators and classes src/coverage/runtime.json lists, its
// topbar menus, the 3D View header menus and the context menus open with items, every workspace tab shows a screen in
// its object mode, the app is cross-origin isolated (Blender's threads) without the server's headers, examples made in
// Blender open with their objects in the scene sync, an #example= link opens its
// example, an exported page draws on WebGPU and the manual (docs.html) shows its feature pages with their media. CI runs it after the build and before
// deploying, since some failures only happen in the production build.
// usage: npm run build && npm run test:prod   (E2E_URL checks a running server instead)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { POSIX, stop } from "../../scripts/process-group.mjs";
import { BOOT, chromium, openApp, runtimeCoverage, startServer } from "./app.mjs";
import { strFromU8, unzipSync } from "fflate";

// A page of an exported package: its tenth frame read back, how much of it is lit.
const WEBGPU_PAGE = `<!doctype html><canvas id="c" width="320" height="200" style="display:block"></canvas><script type="module">
import { createEngine, load } from './scene.js';
const engine = await createEngine(document.getElementById('c')), blend = await load(engine);
let frames = 0;
blend.scene.onAfterRenderObservable.add(async () => {
  if (++frames !== 10) return;
  const pixels = await engine.readPixels(0, 0, 320, 200);
  let lit = 0;
  for (let i = 0; i < pixels.length; i += 4) if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 30) lit++;
  window.drawn = { webgpu: !!engine.isWebGPU, lit: lit / (pixels.length / 4) };
});
engine.runRenderLoop(() => blend.scene.render());
</script>`;
// A page of the world-up fixture: once its world has baked, the colour near its sphere's top and bottom (the camera is
// level with the sphere, 6 m away, with a vertical field of 0.8 rad).
const WORLD_UP_PAGE = `<!doctype html><canvas id="c" width="320" height="200" style="display:block"></canvas><script type="module">
import { createEngine, load } from './scene.js';
const engine = await createEngine(document.getElementById('c')), blend = await load(engine);
let frames = 0;
blend.scene.onAfterRenderObservable.add(async () => {
  if (++frames !== 90) return;
  const w = 320, h = 200, r = (1 / 6) / Math.tan(0.4) * (h / 2), pixels = await engine.readPixels(0, 0, w, h);
  // WebGPU reads the canvas in its own format, blue first where that is bgra8unorm.
  const bgra = engine.isWebGPU && navigator.gpu.getPreferredCanvasFormat() === 'bgra8unorm';
  const at = (dy) => { const i = (Math.round(h / 2 + dy * r) * w + w / 2) * 4, rgb = Array.from(pixels.slice(i, i + 3)); return bgra ? rgb.reverse() : rgb; };
  window.sphere = { webgpu: !!engine.isWebGPU, top: at(0.75), bottom: at(-0.75) };
});
engine.runRenderLoop(() => blend.scene.render());
</script>`;
const TOPBAR = ["TOPBAR_MT_file", "TOPBAR_MT_edit", "TOPBAR_MT_render", "TOPBAR_MT_window", "TOPBAR_MT_help"];
const started = Date.now();
const steps = [];
// A step that hangs fails by its name, as CI would otherwise stop the whole check at its own limit, saying nothing.
const STEP_LIMIT = 10 * 60 * 1000;
const within = (ms, what, work) => {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} took longer than ${ms / 1000} s`)), ms); });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
};
// A node script in a process of its own, stopped with the processes it started once it runs longer than `ms`; on POSIX
// it first prints node's diagnostic report (its JavaScript stack and open handles), which says where it hung.
const REPORT = ["--report-on-signal", "--report-signal=SIGUSR2", "--report-filename=stdout", "--report-compact"];
function runNode(script, args, ms) {
  const child = spawn(process.execPath, [...(POSIX ? REPORT : []), script, ...args], { stdio: "inherit", detached: POSIX });
  const exited = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => (code === 0 ? resolve() : reject(new Error(`${script} exited with ${code ?? signal}`))));
  });
  return within(ms, script, exited).catch(async (error) => {
    if (child.exitCode !== null) throw error;
    if (POSIX) await new Promise((resolve) => { child.kill("SIGUSR2"); setTimeout(resolve, 3000); });
    stop(child);
    throw error;
  });
}
// Exported pages served from `dir`, in a browser of their own with the harness's flags that start WebGPU (this check's
// is launched with CHROMIUM_ARGS). Each browser call has its own limit, as a wedged GPU process hangs them silently.
const NO_WEBGPU = "the browser has no hardware WebGPU adapter";
async function pageBrowser(dir) {
  const { servePackages } = await import("../export-parity/look.mjs");
  writeFileSync(join(dir, "blank.html"), "<!doctype html>");
  const served = servePackages(dir), gpu = await within(60000, "chromium.launch", chromium.launch());
  const open = async (path) => {
    const page = await within(30000, "browser.newPage", gpu.newPage({ viewport: { width: 320, height: 200 } }));
    await page.goto(served.url(path), { timeout: 60000 });
    return page;
  };
  const closed = (page) => within(10000, "page.close", page.close());
  return {
    // A software adapter (SwiftShader) is none: CI's runners have no GPU, and pages drawing on WebGPU there hung the
    // check; the steps measure a GPU's drawing.
    async hardwareWebGPU() {
      const page = await open("blank.html");
      const hardware = (a) => !!a && !a.isFallbackAdapter && !a.info?.isFallbackAdapter && !/swiftshader/i.test(`${a.info?.vendor} ${a.info?.architecture}`);
      const found = await within(20000, "requestAdapter", page.evaluate(`Promise.race([navigator.gpu?.requestAdapter().then(${hardware}), new Promise((resolve) => setTimeout(resolve, 15000, false))])`));
      await closed(page);
      return found;
    },
    // What the page at `path` sets on window as `name` once drawn.
    async read(path, name) {
      const page = await open(path);
      const value = await (await page.waitForFunction((name) => window[name], name, { timeout: 180000 })).jsonValue();
      await closed(page);
      return value;
    },
    async close() {
      await within(10000, "browser.close", gpu.close()).catch((error) => console.log(`      ${error.message}`));
      served.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
const step = async (name, fn) => {
  const at = Date.now();
  await within(STEP_LIMIT, `step "${name}"`, fn());
  steps.push(name);
  console.log(`ok    ${name} (${Date.now() - at} ms)`);
};

// How many items the menu a button opens shows.
async function menuItems(where, button) {
  await where.locator(button).first().click();
  const items = where.locator(".bl-menu .bl-menu-item");
  await items.first().waitFor({ timeout: 10000 });
  return items.count();
}

// Hovers every item of the open menu, which runs its poll, and the items of the submenus that opens.
async function hoverItems(where) {
  for (const item of await where.locator(".bl-menu").first().locator(".bl-menu-item").all()) {
    if (!(await item.hover({ timeout: 3000 }).then(() => true, () => false))) continue;
    const submenu = where.locator(".bl-menu.submenu");
    if (await submenu.count()) for (const sub of await submenu.last().locator(".bl-menu-item").all()) await sub.hover({ timeout: 3000 }).catch(() => {});
  }
}

const server = await startServer({ build: false });
// CHROMIUM_ARGS reproduces CI here, e.g. --use-angle=swiftshader for its software rendering.
const browser = await chromium.launch({ args: process.env.CHROMIUM_ARGS?.split(" ") });
let app;
try {
  // The new project's scene, as a first visit opens it.
  await step("boots", async () => { app = await openApp(browser, server.url, BOOT); });
  const { page } = app;
  const noErrors = (what) => assert.deepEqual(app.errors, [], `page errors after ${what}`);
  // The feature pages' coverage counts (docs/features/index.json) are made from the saved run-time list.
  await step("run-time coverage list is saved", async () => {
    const saved = readFileSync(new URL("../../src/coverage/runtime.json", import.meta.url), "utf8");
    assert.ok(JSON.stringify(await runtimeCoverage(app), null, 1) + "\n" === saved, "the run-time coverage list changed: run node scripts/feature-docs.mjs --runtime");
  });
  noErrors("booting");
  // GitHub Pages sends no isolation headers: the site's service worker adds them, so Blender's module runs on threads.
  await step("cross-origin isolated for Blender's threads", async () => assert.ok(await app.frame().evaluate(() => crossOriginIsolated)));

  for (const id of TOPBAR) {
    await step(`topbar ${id}`, async () => {
      assert.ok(await menuItems(page, `[data-blender="${id}"]`) > 0, `${id} has items`);
      if (id === "TOPBAR_MT_file") {
        // File > New: Blender's submenu of templates.
        await page.locator(".bl-menu .bl-menu-item", { hasText: /^New/ }).first().hover();
        await page.locator(".bl-menu.submenu .bl-menu-item").first().waitFor({ timeout: 10000 });
      }
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      noErrors(id);
    });
  }

  const frame = app.frame();
  const headerMenus = await frame.locator('.bl-pulldown[data-blender^="VIEW3D_MT_"]').evaluateAll((els) => [...new Set(els.map((el) => el.dataset.blender))]);
  assert.ok(headerMenus.length >= 4, `3D View header menus: ${headerMenus}`);
  for (const id of headerMenus) {
    await step(`3D View ${id}`, async () => {
      assert.ok(await menuItems(frame, `.bl-pulldown[data-blender="${id}"]`) > 0, `${id} has items`);
      await hoverItems(frame);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      noErrors(id);
    });
  }

  // Right click opens Blender's context menus through its keymaps: the 3D View's in Object and Edit Mode and the
  // Outliner's on an object's row.
  const contextMenu = async (name, [x, y], before = async () => {}) => {
    await step(`context menu ${name}`, async () => {
      await before();
      await page.mouse.move(x, y);
      await page.mouse.click(x, y, { button: "right" });
      await frame.locator(".bl-menu .bl-menu-item").first().waitFor({ timeout: 10000 });
      await hoverItems(frame);
      await page.keyboard.press("Escape");
      await page.keyboard.press("Escape");
      noErrors(name);
    });
  };
  const view = await frame.locator(".viewport-canvas").first().boundingBox(), center = [view.x + view.width / 2, view.y + view.height / 2];
  const selected = () => app.bylonder((b) => b.editor.selection.size);
  await step("a left click in the 3D View selects the object under it", async () => {
    await page.mouse.click(view.x + view.width * 0.95, view.y + view.height * 0.9);
    await app.settled();
    assert.equal(await selected(), 0, "a click on empty space deselects");
    await page.mouse.click(...center);
    await app.settled();
    assert.equal(await selected(), 1, "a click on the object selects it");
    noErrors("a 3D View click");
  });
  const selectFirst = () => app.bylonder((b) => { b.editor.selection.replace([b.world.objects.find((n) => n.getTotalVertices?.())]); b.editor.reconcile(); });
  await contextMenu("VIEW3D_MT_object_context_menu", center, selectFirst);
  await contextMenu("VIEW3D_MT_edit_mesh_context_menu", center, async () => {
    await page.mouse.move(...center);
    await page.keyboard.press("Tab");
    await app.until((b) => b.world.editMode.active);
  });
  await page.keyboard.press("Tab");
  const outliner = await frame.locator(".bl-outliner-region").boundingBox();
  const row = await app.bylonder((b) => b.world.outliner.area.draw().draw.find((c) => c.op === "text" && c.text === b.world.objects.find((n) => n.getTotalVertices?.()).name).at);
  const rowAt = [outliner.x + row[0] + 5, outliner.y + outliner.height - row[1] - 4];
  await step("Outliner row click selects", async () => {
    await page.mouse.click(...rowAt);
    await app.settled();
    noErrors("an Outliner row click");
  });
  await contextMenu("OUTLINER_MT_object", rowAt);
  const header = await frame.locator(".dock-heading").first().boundingBox();
  await contextMenu("Header", [header.x + header.width - 40, header.y + header.height / 2]);
  await step("OBJECT_MT_move_to_collection", async () => {
    await selectFirst();
    await page.mouse.move(...center);
    await page.keyboard.press("m");
    await frame.locator(".bl-menu .bl-menu-item").first().waitFor({ timeout: 10000 });
    await hoverItems(frame);
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    noErrors("OBJECT_MT_move_to_collection");
  });

  // Each workspace tab shows its screen and puts the active mesh in the workspace's object mode where Bylonder has that
  // mode, else leaves it in its mode, as ED_workspace_change does when a mode cannot be entered. A switch is checked
  // once the app has settled: leaving a mode and compiling a view's shaders take a while on a runner without a GPU.
  const MODES = { modeling: "EDIT", sculpting: "SCULPT", "uv-editing": "EDIT", "texture-paint": "TEXTURE_PAINT", animation: "POSE" };
  const meshModes = ["OBJECT", "EDIT", "SCULPT", "TEXTURE_PAINT"];
  let expected = "OBJECT";
  const tabs = await page.locator("#workspace-tabs [data-workspace]").evaluateAll((els) => els.map((el) => el.dataset.workspace));
  assert.ok(tabs.length >= 11, `workspace tabs: ${tabs}`);
  for (const id of [...tabs, "layout"]) {
    await step(`workspace ${id}`, async () => {
      await page.click(`[data-workspace="${id}"]`);
      await page.waitForFunction((id) => document.querySelector(`[data-workspace="${id}"]`)?.classList.contains("active"), id, { timeout: 30000 });
      await app.settled();
      // Its screen draws: editors of a visible size in the workspace.
      await page.waitForFunction(() => [...document.querySelectorAll("#workspace > *")].some((el) => el.offsetWidth > 100 && el.offsetHeight > 100), null, { timeout: 30000 });
      const mode = await app.bylonder((b) => b.editor.selection.nodes.at(-1)?.metadata?.wbMode ?? "OBJECT");
      const wanted = MODES[id] ?? "OBJECT";
      if (meshModes.includes(wanted)) expected = wanted;
      assert.equal(mode, expected, `object mode in ${id}`);
      noErrors(`switching to ${id}`);
    });
  }

  // A lost WebGL context, once the module's memory has grown: its restore draws the scene as before, and Blender's
  // images' textures (a byte and a float buffer) hold their pixels again, uploaded anew from Blender.
  await step("a lost WebGL context is restored from Blender", async () => {
    const texturePixels = () => app.bylonder(async (b) => {
      const read = async (name) => Array.from(await b.modules.imageTextures.imageTexture(b.modules.bpyRna.blendData().images.get(name), b.world.scene).readPixels());
      return [await read("Byte"), await read("Float")];
    });
    await app.bylonder((b) => {
      for (const [name, float] of [["Byte", false], ["Float", true]]) b.modules.bpyRna.blendData().images.new(name, 16, 16, true, float).generated_type = "UV_GRID";
    });
    const canvas = frame.locator(".viewport-canvas").first(), pixels = await texturePixels();
    await app.bylonder((b) => { b.runOperator("mesh.primitive_grid_add", { x_subdivisions: 500, y_subdivisions: 500 }); b.runOperator("object.delete", {}); });
    await app.settled();
    const shot = await canvas.screenshot();
    await app.bylonder((b) => new Promise((restored) => {
      const engine = b.world.scene.getEngine(), lose = engine._gl.getExtension("WEBGL_lose_context");
      engine.onContextRestoredObservable.addOnce(() => restored());
      engine.onContextLostObservable.addOnce(() => setTimeout(() => lose.restoreContext(), 0));
      lose.loseContext();
    }));
    await app.settled();
    assert.deepEqual(await texturePixels(), pixels, "the images' textures hold Blender's pixels");
    assert.ok((await canvas.screenshot()).equals(shot), "the 3D View draws as before");
    noErrors("restoring the WebGL context");
  });

  // An export writes a float image's texture with straight alpha, Blender's pixels, though it is drawn premultiplied.
  await step("an export writes float images straight", async () => {
    const { written, straight, serialized } = await app.bylonder(async (b) => {
      const { blendData } = b.modules.bpyRna, { imageTexture, imageFile } = b.modules.imageTextures;
      const image = blendData().images.new("Half", 4, 4, true, true);
      image.generated_color = [1, 0.5, 0.25, 0.5];
      const texture = imageTexture(image, b.world.scene), data = imageFile(texture);
      const png = Object.assign(new Image(), { src: data }), canvas = Object.assign(document.createElement("canvas"), { width: 4, height: 4 });
      await png.decode();
      canvas.getContext("2d").drawImage(png, 0, 0);
      const buffer = texture._buffer;
      texture._buffer = data;
      const serialized = texture.serialize().base64String === data;
      texture._buffer = buffer;
      return { written: Array.from(canvas.getContext("2d").getImageData(0, 0, 1, 1).data), straight: Array.from(image.pixels).slice(0, 4), serialized };
    });
    assert.ok(serialized, "Texture.serialize writes the data");
    assert.ok(written.every((v, i) => Math.abs(v - straight[i] * 255) <= 2), `Blender's straight pixel ${straight}, written ${written}`);
  });

  // An exported page draws with WebGPU where the browser has it (tools.mjs starts Chromium's): its engine is WebGPU's
  // and its frame shows the scene, as a first frame drawn outside the engine's frame once left every page black there.
  // A browser without a hardware WebGPU adapter (CI's runners have no GPU, where the check hung the deploy) skips it.
  await step("an exported page draws on WebGPU", async () => {
    const [{ openExample }, { exportModule }, { bundledFiles }] = await Promise.all([import("../open-example.js"),
      import("../../src/io_scene_babylon/js-export.js"), import("../export-package.js")]);
    const { world, sync } = openExample("framed-print");
    sync.view();
    const files = { ...(await bundledFiles(await exportModule(world, { live: true, bundle: true }))), "index.html": WEBGPU_PAGE };
    const dir = mkdtempSync(join(tmpdir(), "bylonder-webgpu-"));
    for (const [path, data] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, "page", path)), { recursive: true });
      writeFileSync(join(dir, "page", path), data);
    }
    const pages = await pageBrowser(dir);
    try {
      if (!(await pages.hardwareWebGPU())) return console.log(`      skipped: ${NO_WEBGPU}`);
      const drawn = await pages.read("page/index.html", "drawn");
      assert.ok(drawn.webgpu, "the page's engine is WebGPU's");
      assert.ok(drawn.lit > 0.5, `its frame shows the scene (${(drawn.lit * 100).toFixed(0)}% of pixels lit)`);
    } finally {
      await pages.close();
    }
  });

  // A world lights an exported page's surfaces the right way up, on WebGL 2 and on WebGPU: a white sphere under a world
  // blue above the horizon and grey below takes the blue on its top and the grey on its bottom, as Blender lights it
  // (tests/fixtures/world-up.blend); the probe the world is baked into once swapped them.
  await step("a world lights an exported page the right way up", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bylonder-world-up-"));
    await runNode(fileURLToPath(new URL("./world-up-export.mjs", import.meta.url)), [dir], 5 * 60 * 1000);
    for (const target of ["WEBGL2", "WEBGPU"]) writeFileSync(join(dir, target, "index.html"), WORLD_UP_PAGE);
    const pages = await pageBrowser(dir);
    try {
      for (const target of ["WEBGL2", "WEBGPU"]) {
        if (target === "WEBGPU" && !(await pages.hardwareWebGPU())) { console.log(`      WebGPU skipped: ${NO_WEBGPU}`); continue; }
        const { webgpu, top, bottom } = await pages.read(`${target}/index.html`, "sphere");
        if (target === "WEBGPU" && !webgpu) { console.log("      WebGPU skipped: the browser draws with WebGL"); continue; }
        // Blue's lead over red: the sky's colour on top, the ground's grey below.
        const blueness = ([r, , b]) => b - r;
        assert.ok(blueness(top) > blueness(bottom) + 20, `${target}: the sphere's top takes the sky (top ${top}, bottom ${bottom})`);
      }
    } finally {
      await pages.close();
    }
  });

  // Examples made in Blender open with every object of Main in the scene sync, once (an armature left out of it was
  // invisible to every tool), and without a page error.
  for (const example of ["Rigged Character", "Sea Anemone"]) {
    await step(`example ${example}`, async () => {
      const opened = await openApp(browser, server.url, { example, node: example === "Rigged Character" ? "Rig" : "Tentacles" });
      try {
        await opened.settled();
        const problems = await opened.bylonder((b) => {
          const { scene, objects, mainSync } = b.world, authored = (n) => !n.name.startsWith("__");
          const nodes = [...scene.meshes, ...scene.transformNodes, ...scene.lights, ...scene.cameras].filter(authored);
          const names = nodes.map((n) => n.name);
          return [...objects.filter((n) => !mainSync.objectOf(n)).map((n) => `${n.name}: not in Main's sync`),
            ...[...new Set(names.filter((n, i) => names.indexOf(n) !== i))].map((n) => `${n}: two objects`)];
        });
        assert.deepEqual(problems, [], `${example}: objects`);
        // The rig and the body's shape keys on Babylon (mapped): Babylon morphs and skins the body (docs/runtimes.md).
        if (example === "Rigged Character") {
          const skeleton = await opened.bylonder((b) => {
            const node = (name) => b.world.objects.find((n) => n.name === name);
            b.modules.bpyRna.idStruct(b.world.mainSync.objectOf(node("Rig"))).bylonder.runtime = "MAPPED";
            // Its body's shape keys too, which Babylon morphs before it skins.
            b.modules.bpyRna.idStruct(b.world.mainSync.objectOf(node("Body"))).data.shape_keys.bylonder.runtime = "MAPPED";
            b.world.mainSync.view();
            return node("Body").skeleton?.name ?? null;
          });
          await opened.settled();
          assert.equal(skeleton, "Rig", "Rigged Character: the body skinned by Babylon");
        }
        assert.deepEqual(opened.errors, [], `${example}: page errors`);
      } finally {
        await opened.close();
      }
    });
  }
  // An exported page plays the project's game as the Game area does (docs/sdk-model.md, Game code): the Package View's
  // page, written by the app's own export with game.js built in the browser, takes the café's mouse; the barista's hand
  // takes the cup the machine brews onto its tray and sets it down on the waiting rock, which the shift counts.
  await step("an exported page plays the project's game", async () => {
    const opened = await openApp(browser, server.url, { link: "rock-hard-cafe", node: "Rock" });
    try {
      await opened.bylonder((b) => b.dock.show("package"));
      // The Package View alone, as large as the café's camera frames it.
      await opened.bylonder((b) => b.dock.maximize("package"));
      await opened.frame().getByRole("button", { name: "Reload" }).click();
      await opened.frame().locator('[data-section="package"]').getByText("Loaded").waitFor({ timeout: 300000 });
      const view = opened.frame().locator('#package-section iframe[title="Package View"]'), page = view.contentFrame();
      await page.locator("canvas").waitFor();
      await page.locator("canvas").evaluate((canvas) => new Promise((resolve) => { const wait = () => (window.blend?.game ? resolve() : setTimeout(wait, 100)); wait(); }));
      const box = await view.boundingBox();
      await opened.page.mouse.click(box.x + box.width / 2, box.y + box.height - 10);
      // The café as the page plays it, read from its game: where a place over the counter (at the hand's height) is on
      // the page, by the page's own camera (the cup, or the near side of the waiting rock's top), whether the hand is over
      // the cup (outlined) or holds it, and the rocks served. Each input waits for the game to reach the state it needs,
      // never for a time, so a slow page (CI draws in software) plays the same; a rock that leaves meanwhile is followed
      // by the next.
      const cafe = () => page.locator("canvas").evaluate((canvas) => {
        const scene = window.blend.scene, game = window.blend.game.world, instances = [...game.instances.values()];
        const cup = instances.find((i) => i.definition.name === "Cup"), rock = instances.find((i) => i.definition.name === "Rock" && i.state.mood === "waiting");
        const barista = instances.find((i) => i.definition.name === "Barista")?.handlers;
        const engine = scene.getEngine(), w = engine.getRenderWidth(), h = engine.getRenderHeight(), r = canvas.getBoundingClientRect();
        const onPage = (instance, nearSide) => {
          if (!instance) return null;
          const { min, max } = instance.entity.node.getHierarchyBoundingVectors(true), V = min.constructor;
          const at = new V((min.x + max.x) / 2, 1.08, (min.z + max.z) / 2);
          if (nearSide) {
            const toward = scene.getTransformNodeByName("Barista DEF-upper_arm.R").getAbsolutePosition().subtract(at);
            toward.y = 0;
            at.addInPlace(toward.normalize().scale(0.2));
          }
          const p = V.Project(at, scene.getTransformMatrix().constructor.Identity(), scene.getTransformMatrix(), scene.activeCamera.viewport.toGlobal(w, h));
          return [r.left + (p.x * r.width) / w, r.top + (p.y * r.height) / h];
        };
        return { cup: onPage(cup), rock: onPage(rock, true), over: !!cup?.entity.node.renderOutline, holding: !!barista?.holding,
          served: game.game.get({ name: "Shift" })?.save().served ?? 0 };
      });
      const until = async (what, done, act, seconds = 240) => {
        const end = Date.now() + seconds * 1000;
        for (let state = await cafe(); !done(state); state = await cafe()) {
          if (Date.now() > end) throw new Error(`The café's ${what}, not within ${seconds} s: ${JSON.stringify(state)}`);
          await act?.(state);
          await opened.page.waitForTimeout(250);
        }
      };
      // The game's state is what this step checks, not its pixels: drawn at a quarter of the resolution, so a software
      // renderer (CI) draws its frames many times faster. Layout and input are unchanged.
      await page.locator("canvas").evaluate(() => window.blend.scene.getEngine().setHardwareScalingLevel(4));
      const move = async (at) => at && opened.page.mouse.move(box.x + at[0], box.y + at[1], { steps: 5 });
      await until("cup on the tray, under the hand", (s) => s.over, (s) => move(s.cup));
      await opened.page.mouse.down();
      await until("cup in the hand", (s) => s.holding);
      // The rock admires, spills and leaves, which the shift counts.
      await until("cup set down on a waiting rock", (s) => s.served > 0, async (s) => {
        await move(s.rock);
        // Over the rock, let go; a cup that landed short (a rock gone meanwhile) is taken again.
        if (s.holding && s.rock) { await opened.page.waitForTimeout(1500); await opened.page.mouse.up(); }
        else if (!s.holding && s.over) await opened.page.mouse.down();
        else if (!s.holding) await move(s.cup);
      });
      await opened.page.mouse.up();
      // A project whose package.json states no licence: File > Export asks for one, writes it there and ships game.js
      // under it.
      await opened.bylonder((b) => { const { files } = b.world.project; files.splice(files.indexOf("package.json"), 1); });
      await opened.page.click('[data-blender="TOPBAR_MT_file"]');
      await opened.page.getByRole("menuitem", { name: /^Export/ }).first().hover();
      await opened.page.getByRole("menuitem", { name: "JavaScript (.zip)" }).click();
      const dialog = opened.frame().locator('[role="dialog"][aria-label^="Export"]');
      await dialog.getByRole("button", { name: "Game Code Licence: Not Stated, inherited" }).click();
      await opened.frame().getByRole("menuitem", { name: "Apache 2.0" }).click();
      const download = opened.page.waitForEvent("download", { timeout: 300000 });
      await dialog.getByRole("button", { name: "Export" }).click();
      const chunks = [];
      for await (const chunk of await (await download).createReadStream()) chunks.push(chunk);
      const zip = unzipSync(Buffer.concat(chunks));
      assert.match(strFromU8(zip["game.js"]).split("\n")[0], /licensed Apache-2\.0/, "game.js ships under the chosen licence");
      assert.match(strFromU8(zip["THIRD-PARTY.md"]), /## inkjs/);
      assert.equal(await opened.bylonder((b) => b.world.project.license()), "Apache-2.0", "the licence is written to package.json");
      assert.deepEqual(opened.errors, [], "page errors");
    } finally {
      await opened.close();
    }
  });

  // The docs' Open in Bylonder link (index.html#example=<id>) opens its example without the splash.
  await step("example link #example=lava", async () => {
    const opened = await openApp(browser, server.url, { link: "lava", node: "Sphere" });
    try {
      assert.equal(await opened.page.locator("dialog.bl-splash[open]").count(), 0, "no splash");
      assert.deepEqual(opened.errors, [], "page errors");
    } finally {
      await opened.close();
    }
  });

  // File > Open Folder (folder-repository.js), on a folder in OPFS standing in for one on disk: an empty folder takes the
  // project's files and, once the scene runs, its .blend; edits made in the folder outside the app are taken when the
  // page regains focus; a reload reopens the folder.
  await step("a project opens from a folder on disk and saves to it", async () => {
    const opened = await openApp(browser, server.url, { ...BOOT, persistent: true });
    const { page } = opened;
    const disk = (op, path, text) => page.evaluate(async ([op, path, text]) => {
      const parts = path.split("/"), name = parts.pop();
      let dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("Picked", { create: true });
      for (const part of parts) dir = await dir.getDirectoryHandle(part, { create: true });
      if (op === "list") return [...await Array.fromAsync(dir.keys())];
      const handle = await dir.getFileHandle(name, { create: op === "write" });
      if (op === "read") return (await handle.getFile()).text();
      const writer = await handle.createWritable();
      await writer.write(text);
      await writer.close();
    }, [op, path, text]);
    try {
      await page.evaluate(() => { window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle("Picked", { create: true }); });
      await page.click('[data-blender="TOPBAR_MT_file"]');
      await page.getByRole("menuitem", { name: "Open Folder..." }).click();
      await page.locator("#storage-status", { hasText: "Folder: Picked" }).waitFor();
      await page.waitForFunction(async () => {
        const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle("Picked");
        return (await Array.fromAsync(dir.keys())).some((name) => name.endsWith(".blend"));
      }, null, { timeout: 120000, polling: 500 });
      const names = await disk("list", "x");
      assert.ok(names.includes("index.js") && names.includes("bylonder.json"), `the folder holds the project: ${names}`);
      await disk("write", "content/notes.txt", "written outside");
      const edited = (await disk("read", "index.js")) + "// edited on disk\n";
      await disk("write", "index.js", edited);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      // The new folder shows in the Explorer (its file inside, once the folder is opened).
      await page.locator("#file-tree [role=treeitem]", { hasText: /^content$/ }).waitFor({ state: "attached" });
      // A scene edit (the light, under the view's centre, moved up), then File > Save (wm.save_mainfile).
      // The scene's frame, once it runs: the edit made on disk runs the project again, replacing the frame meanwhile.
      const ready = async () => {
        await page.locator("#run-status", { hasText: "Running" }).waitFor({ timeout: 120000 });
        // Asked of the page, as the 3D Viewport's frame may be gone between the old frame and the new one.
        await page.waitForFunction(() => {
          const b = document.querySelector('iframe[src*="viewport.html"]')?.contentWindow?.__bylonder;
          return !!(b?.editor && b.world.scene.getNodeByName("light"));
        }, null, { timeout: 120000 }).catch(() => { throw Error("the project did not run again with its light within 120 s"); });
      };
      const lightZ = () => opened.bylonder((b) => [...b.rna.objects()].map((ob) => b.rna.pointer("Object", ob)).find((o) => o.name === "light").location[2]);
      await ready();
      // Opened and saved there, the project has nothing unsaved until an edit.
      await page.locator("#save-status", { hasText: /^Saved to folder$/ }).waitFor({ timeout: 30000 });
      await opened.click();
      for (const key of ["g", "z", "2", "Enter"]) await page.keyboard.press(key);
      await opened.settled();
      assert.equal(await lightZ(), 2, "the light moved");
      const blendSaved = () => page.evaluate(async () => {
        for await (const [name, handle] of await (await navigator.storage.getDirectory()).getDirectoryHandle("Picked")) if (name.endsWith(".blend")) return (await handle.getFile()).lastModified;
      });
      const before = await blendSaved();
      await page.evaluate(() => document.getElementById("checkpoint").click());
      await page.waitForFunction(() => document.getElementById("save-status").textContent === "Saved to folder");
      while ((await blendSaved()) === before) await page.waitForTimeout(200);
      assert.equal(await disk("read", "index.js"), edited, "Save keeps the edit made on disk");
      await page.reload();
      await page.locator("#storage-status", { hasText: "Folder: Picked" }).waitFor({ timeout: 120000 });
      await ready();
      assert.equal(await lightZ(), 2, "the scene reopens from the folder's .blend");
      assert.deepEqual(opened.errors, [], "page errors");
    } finally {
      await opened.close();
    }
  });

  // The live demos whose packages are release assets (docs/demos/packages.json): each one's package is in the build and
  // its page loads it. A missing package fails here, naming the demo, rather than a page that loads nothing.
  await step("demo packages", async () => {
    const { demoPackages } = await import("../../scripts/module.mjs");
    for (const { demo, dir, asset } of demoPackages()) {
      const response = await fetch(new URL(`${dir}/scene.js`, server.url));
      assert.ok(response.ok, `the ${demo} demo's package (${asset}) is not in the build: run npm run module before npm run build`);
      const page = await browser.newPage(), errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(new URL(`docs/demos/${demo}/index.html?step`, server.url).href);
      await page.waitForFunction(() => window.demo, null, { timeout: 5 * 60 * 1000 });
      assert.deepEqual(errors, [], `the ${demo} demo's page errors`);
      await page.close();
    }
  });

  // The manual (docs.html): the features index shows a card per page with its thumbnail, a feature page its GIFs, and
  // its Open in Bylonder link points at this build's app.
  await step("docs", async () => {
    const docs = await browser.newPage();
    const errors = [];
    docs.on("pageerror", (error) => errors.push(error.message));
    const loaded = () => docs.evaluate(() => Promise.all([...document.querySelectorAll("#doc-body img")].map((img) => {
      img.loading = "eager";
      return img.decode().then(() => img.naturalWidth > 0, () => img.src);
    })));
    const features = (await import("../../docs/features/index.json", { with: { type: "json" } })).default;
    await docs.goto(new URL("docs.html#docs/features/README.md", server.url).href);
    await docs.locator(".feature-card").first().waitFor();
    assert.equal(await docs.locator(".feature-card").count(), features.length, "a card per feature");
    assert.ok((await loaded()).every((ok) => ok === true), "every thumbnail loads");
    await docs.goto(new URL(`docs.html#${features[0].page}`, server.url).href);
    await docs.locator(".feature-lead").waitFor();
    assert.ok((await loaded()).every((ok) => ok === true), "every figure loads");
    const open = new URL(await docs.locator(".doc-button.primary").getAttribute("href"), docs.url());
    assert.equal(open.href, new URL(`#example=${features[0].example}`, server.url).href, "Open in Bylonder opens this build");
    assert.deepEqual(errors, [], "docs page errors");
    await docs.close();
  });
  console.log(`Production check passed: ${steps.length} steps in ${Math.round((Date.now() - started) / 1000)} s`);
} catch (error) {
  const shot = `${tmpdir()}/prod-check.png`;
  await app?.page.screenshot({ path: shot }).catch(() => {});
  console.log(`FAIL  ${error.stack}\nPage errors: ${JSON.stringify(app?.errors ?? [], null, 2)}\nScreenshot: ${shot}`);
  process.exitCode = 1;
} finally {
  // A stopped step can leave its work running, or a browser that does not close: the check ends regardless.
  await within(60000, "closing the check", (async () => {
    await app?.close();
    await browser.close();
    await server.close();
  })()).catch((error) => console.log(error.message));
  process.exit();
}
