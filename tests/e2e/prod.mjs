// Production check: the built app (dist/) boots in headless Chromium without a page error or console error, runs the
// Blender operators and classes src/coverage/runtime.json lists, its
// topbar menus, the 3D View header menus and the context menus open with items, every workspace tab shows a screen in
// its object mode, the app is cross-origin isolated (Blender's threads) without the server's headers, examples made in
// Blender open with their objects in the scene sync, an #example= link opens its
// example, an exported page draws on WebGPU and the manual (docs.html) shows its feature pages with their media. CI runs it after the build and before
// deploying, since some failures only happen in the production build.
// usage: npm run build && npm run test:prod   (E2E_URL checks a running server instead)
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { BOOT, chromium, openApp, runtimeCoverage, startServer } from "./app.mjs";

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
const step = async (name, fn) => {
  const at = Date.now();
  await fn();
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
    const [{ openExample }, { exportModule }, { bundledFiles }, { servePackages }] = await Promise.all([import("../open-example.js"),
      import("../../src/io_scene_babylon/js-export.js"), import("../export-package.js"), import("../export-parity/look.mjs")]);
    const { world, sync } = openExample("framed-print");
    sync.view();
    const files = { ...(await bundledFiles(await exportModule(world, { live: true, bundle: true }))), "index.html": WEBGPU_PAGE, "blank.html": "<!doctype html>" };
    const dir = mkdtempSync(join(tmpdir(), "bylonder-webgpu-"));
    for (const [path, data] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, "page", path)), { recursive: true });
      writeFileSync(join(dir, "page", path), data);
    }
    // A browser of its own, with the harness's flags that start WebGPU (this check's is launched with CHROMIUM_ARGS).
    const served = servePackages(dir), gpu = await chromium.launch(), page = await gpu.newPage({ viewport: { width: 320, height: 200 } });
    try {
      await page.goto(served.url("page/blank.html"));
      // A software adapter (SwiftShader) is none: the step measures a GPU's drawing.
      const hardware = (a) => !!a && !a.isFallbackAdapter && !a.info?.isFallbackAdapter && !/swiftshader/i.test(`${a.info?.vendor} ${a.info?.architecture}`);
      const adapter = await page.evaluate(`Promise.race([navigator.gpu?.requestAdapter().then(${hardware}), new Promise((resolve) => setTimeout(resolve, 15000, false))])`);
      if (!adapter) return console.log("      skipped: the browser has no hardware WebGPU adapter");
      await page.goto(served.url("page/index.html"));
      const drawn = await (await page.waitForFunction(() => window.drawn, null, { timeout: 180000 })).jsonValue();
      assert.ok(drawn.webgpu, "the page's engine is WebGPU's");
      assert.ok(drawn.lit > 0.5, `its frame shows the scene (${(drawn.lit * 100).toFixed(0)}% of pixels lit)`);
    } finally {
      // A wedged GPU process can keep the browser from closing.
      await Promise.race([gpu.close(), new Promise((resolve) => setTimeout(resolve, 10000))]);
      served.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // A world lights an exported page's surfaces the right way up, on WebGL 2 and on WebGPU: a white sphere under a world
  // blue above the horizon and grey below takes the blue on its top and the grey on its bottom, as Blender lights it
  // (tests/fixtures/world-up.blend); the probe the world is baked into once swapped them.
  await step("a world lights an exported page the right way up", async () => {
    const { servePackages } = await import("../export-parity/look.mjs");
    const dir = mkdtempSync(join(tmpdir(), "bylonder-world-up-"));
    execFileSync(process.execPath, [fileURLToPath(new URL("./world-up-export.mjs", import.meta.url)), dir], { stdio: "inherit" });
    for (const target of ["WEBGL2", "WEBGPU"]) writeFileSync(join(dir, target, "index.html"), WORLD_UP_PAGE);
    const served = servePackages(dir), gpu = await chromium.launch();
    try {
      for (const target of ["WEBGL2", "WEBGPU"]) {
        const page = await gpu.newPage({ viewport: { width: 320, height: 200 } });
        await page.goto(served.url(`${target}/index.html`));
        const { webgpu, top, bottom } = await (await page.waitForFunction(() => window.sphere, null, { timeout: 180000 })).jsonValue();
        await page.close();
        if (target === "WEBGPU" && !webgpu) { console.log("      WebGPU skipped: the browser draws with WebGL"); continue; }
        // Blue's lead over red: the sky's colour on top, the ground's grey below.
        const blueness = ([r, , b]) => b - r;
        assert.ok(blueness(top) > blueness(bottom) + 20, `${target}: the sphere's top takes the sky (top ${top}, bottom ${bottom})`);
      }
    } finally {
      await Promise.race([gpu.close(), new Promise((resolve) => setTimeout(resolve, 10000))]);
      served.close();
      rmSync(dir, { recursive: true, force: true });
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
  await app?.close();
  await browser.close();
  await server.close();
}
