// Records a feature page's media from the app (CLAUDE.md, Feature docs): PNG steps and GIFs into
// docs/media/features/<feature>/, from a dev server on port 5205 (DOCS_PORT) (started here when none runs) driven by Playwright's
// Chromium. A GIF is a CDP screencast of the page while the step runs, cropped to the step's region and encoded by
// ffmpeg (palettegen and paletteuse, 12 fps, 640 wide), smaller until it is under 1 MB. Frames are scaled to the page's
// device pixels first: a screencast under load can send smaller ones.
import { spawn, execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { chromium, openApp } from "../../tests/e2e/app.mjs";
import { fingers } from "../../tests/e2e/touch.mjs";

const root = new URL("../..", import.meta.url).pathname;
const PORT = process.env.DOCS_PORT ?? "5205", URL_ = `http://localhost:${PORT}/`;
const SIZE = { width: 1280, height: 800 };
const MAX_GIF = 1024 * 1024;

const reachable = () => fetch(URL_).then((r) => r.ok, () => false);
async function devServer() {
  if (await reachable()) return () => {};
  const server = spawn("npx", ["vite", "--port", PORT, "--strictPort"], { cwd: root, stdio: "ignore", detached: true });
  while (!(await reachable())) await new Promise((done) => setTimeout(done, 300));
  return () => process.kill(-server.pid);
}

// A pointer and the last key pressed, drawn into every frame of the page, since a screencast shows neither.
const overlay = () => {
  if (window.__showKey) return;
  const style = "position:fixed;z-index:2147483647;pointer-events:none;";
  const install = () => {
    const pointer = Object.assign(document.createElement("div"), { style: style + "width:14px;height:14px;margin:-7px;border-radius:50%;background:#fffc;box-shadow:0 0 0 2px #000a;display:none" });
    document.body.append(pointer);
    addEventListener("mousemove", (e) => Object.assign(pointer.style, { display: "block", left: e.clientX + "px", top: e.clientY + "px" }), true);
    addEventListener("mouseleave", () => { pointer.style.display = "none"; });
    addEventListener("mousedown", () => { pointer.style.background = "#ffbe33"; }, true);
    addEventListener("mouseup", () => { pointer.style.background = "#fffc"; }, true);
  };
  // Fingers down, a dot each (none: all lifted).
  window.__showFingers = (points) => {
    document.querySelectorAll("[data-finger]").forEach((dot) => dot.remove());
    for (const [x, y] of points) {
      const dot = Object.assign(document.createElement("div"), { style: style + `left:${x}px;top:${y}px;width:30px;height:30px;margin:-15px;border-radius:50%;background:#ffbe3399;box-shadow:0 0 0 2px #000a` });
      dot.dataset.finger = "";
      document.body.append(dot);
    }
  };
  if (document.body) install();
  else addEventListener("DOMContentLoaded", install);
  window.__showKey = (text, [x, y]) => {
    const key = Object.assign(document.createElement("div"), { textContent: text, style: style + `left:${x}px;top:${y}px;transform:translate(-50%,-100%);padding:6px 14px;border-radius:6px;background:#181818e6;color:#fff;font:600 20px system-ui;box-shadow:0 0 0 1px #fff3` });
    document.querySelectorAll("[data-key-overlay]").forEach((old) => old.remove());
    key.dataset.keyOverlay = "";
    document.body.append(key);
    setTimeout(() => key.remove(), 1200);
  };
};

const ffmpeg = (...args) => execFileSync("ffmpeg", ["-y", "-loglevel", "error", ...args]);

// Opens the app on `example` (its #example= link; none: the Default Cube from the splash) and returns the recorder.
// `media` is the folder under docs/media/ the files go to (default: the feature's); `touch`, a touch device, driven by
// `r.fingers` (tests/e2e/touch.mjs).
export async function recorder(feature, { example, node, size = SIZE, scale = 1, media: folder = `features/${feature}`, touch } = {}) {
  // Media are written to a temporary folder and moved in at the end: the dev server reloads the app on a change in docs/.
  const media = `${root}docs/media/${folder}/`, out = mkdtempSync(`${tmpdir()}/bylonder-${feature}-`) + "/";
  const stopServer = await devServer();
  const browser = await chromium.launch();
  const app = await openApp(browser, URL_, { ...(example ? { link: example } : {}), node, size, scale, touch });
  await app.context.addInitScript(overlay);
  for (const frame of app.page.frames()) await frame.evaluate(overlay).catch(() => {});
  await app.settled();

  // A region: a page rectangle, a locator, or a selector in the 3D Viewport frame; none is the window. `part` is the
  // fractions [left, top, right, bottom] of it to keep.
  const box = async (region, [l, t, rt, bt] = [0, 0, 1, 1]) => {
    const b = !region ? { x: 0, y: 0, ...size } : region.width ? region : await (typeof region === "string" ? app.locator(region) : region).first().boundingBox();
    const even = (v) => Math.round(v) & ~1;
    return { x: even(b.x + b.width * l), y: even(b.y + b.height * t), width: even(b.width * (rt - l)), height: even(b.height * (bt - t)) };
  };
  let keyAt = [size.width / 2, size.height - 40];

  const r = {
    app, page: app.page, out, fingers: fingers(app.page, (points) => app.page.evaluate((points) => window.__showFingers(points), points)),
    // Shows `label` (or the key) as a key cap, then presses each key.
    async keys(label, ...keys) {
      await app.page.evaluate(([text, at]) => window.__showKey(text, at), [label, keyAt]);
      for (const key of keys.length ? keys : [label]) {
        await app.page.keyboard.press(key);
        await app.settled();
      }
    },
    // A smooth drag in page coordinates.
    async drag([x0, y0], [x1, y1], { steps = 20, button = "left" } = {}) {
      await app.page.mouse.move(x0, y0, { steps: 5 });
      await app.page.mouse.down({ button });
      await app.page.mouse.move(x1, y1, { steps });
      await app.page.mouse.up({ button });
      await app.settled();
    },
    pause: (ms = 600) => app.page.waitForTimeout(ms),
    // A number field set by clicking it and typing, within `scope` (a locator): a node's button named by its label, or a
    // property row's field after its `nth` label of that text.
    async field(scope, label, value, nth = 0) {
      const button = scope.getByRole("button", { name: new RegExp(`^${label}`) }).first();
      if (await button.count()) {
        await button.click();
        await scope.locator("input:not([type])").first().fill(String(value));
      } else {
        await scope.locator(`xpath=.//*[normalize-space(text())="${label}"]/following::*[@role="spinbutton"][1]`).nth(nth).click();
        await app.page.keyboard.press("Control+A");
        await app.page.keyboard.type(String(value));
      }
      await app.page.keyboard.press("Enter");
      await app.settled();
    },
    // The current frame, typed into the Timeline's field.
    async frame(value) {
      await app.locator('[role="spinbutton"][aria-label="Current Frame"]').first().click();
      await app.page.keyboard.press("Control+A");
      await app.page.keyboard.type(String(value));
      await app.page.keyboard.press("Enter");
      await app.settled();
    },
    // Opens a menu by its Blender id or a button's name, then picks the menu path.
    async menu(opener, ...path) {
      await (typeof opener === "string" ? app.locator(`[data-blender="${opener}"]`) : opener).first().click();
      for (const [i, label] of path.entries()) {
        const item = app.frame().getByRole("menuitem", { name: label, exact: true }).last();
        await (i < path.length - 1 ? item.hover() : item.click());
      }
      await app.settled();
    },
    // A click on an Outliner row's name.
    async outliner(name) {
      await app.locator("svg.bl-outliner-region text", { hasText: new RegExp(`^${name}$`) }).first().click();
      await app.settled();
    },
    tab: async (name) => { await app.locator(`[role="tab"][aria-label="${name}"]`).click(); await app.settled(); },
    // A point of the scene in Blender's axes (Z up), in page coordinates of the 3D Viewport.
    async screenOf([x, y, z]) {
      const [fx, fy] = await app.bylonder((b, point) => {
        const view = b.views.input, { width, height } = view.canvas;
        const p = BABYLON.Vector3.Project(BABYLON.Vector3.FromArray(point), BABYLON.Matrix.Identity(), view.camera.getTransformationMatrix(), { x: 0, y: 0, width, height });
        return [p.x / width, p.y / height];
      }, [x, z, y]);
      return app.point(fx, fy);
    },
    // The middle of an armature's bone, in page coordinates.
    async boneAt(armature, bone, along = 0.5) {
      const { head, tail } = await app.bylonder((b, [armature, bone]) =>
        b.world.objects.find((n) => n.name === armature).metadata.wbCreation.armature.bones.find((x) => x.name === bone), [armature, bone]);
      return r.screenOf(head.map((h, i) => h + (tail[i] - h) * along));
    },
    box,
    // A PNG of the 3D Viewport through the scene camera in Rendered shading, without overlays, header, toolbar or the
    // pointer's dot: the canvas below the header and right of the toolbar, `part` of it (see box). The view is left as
    // it was.
    async render(name, { part = [0, 0, 1, 1], wait = 10000 } = {}) {
      const canvas = await app.frame().locator(".viewport-canvas").first().boundingBox();
      const header = await app.locator(".bl-view3d-header").first().boundingBox();
      await app.bylonder((b) => b.views.input.enterCameraView());
      const before = await app.bylonder((b) => ({ overlays: b.views.input.state.overlays, shading: b.views.input.state.shading }));
      await app.bylonder((b) => { b.views.input.state.overlays = false; b.views.input.setShading("rendered"); });
      await app.page.mouse.move(1, 1);
      for (const where of [app.page, app.frame()]) await where.evaluate(() => document.querySelectorAll("div[style*='border-radius: 50%']").forEach((d) => (d.style.display = "none")));
      await app.page.waitForTimeout(wait);
      const left = canvas.x + 56, top = Math.max(canvas.y, header.y + header.height + 30);
      const right = canvas.x + canvas.width, bottom = canvas.y + canvas.height;
      await r.shot(name, { x: left, y: top, width: right - left, height: bottom - top }, { part });
      await app.bylonder((b, before) => { b.views.input.state.overlays = before.overlays ?? true; b.views.input.setShading(before.shading); }, before);
      for (const where of [app.page, app.frame()]) await where.evaluate(() => document.querySelectorAll("div[style*='border-radius: 50%']").forEach((d) => (d.style.display = "")));
    },
    // A PNG of `region` (see box), `width` pixels wide at most.
    async shot(name, region, { part, width } = {}) {
      const file = `${out}${name}.png`;
      await app.settled();
      await app.page.evaluate(() => document.querySelectorAll("[data-key-overlay]").forEach((key) => key.remove()));
      await app.page.screenshot({ path: file, clip: await box(region, part) });
      if (width) {
        ffmpeg("-i", file, "-vf", `scale='min(${width},iw)':-2:flags=lanczos`, `${file}.tmp.png`);
        renameSync(`${file}.tmp.png`, file);
      }
      return file;
    },
    // A GIF of `region` while `steps()` runs, then `hold` ms of the result.
    async gif(name, region, steps, { part, hold = 1200 } = {}) {
      const crop = await box(region, part);
      keyAt = [crop.x + crop.width / 2, crop.y + crop.height - 24];
      const cdp = await app.page.context().newCDPSession(app.page);
      const frames = [];
      cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
        frames.push({ data, time: metadata.timestamp });
        cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
      });
      await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, everyNthFrame: 1 });
      await app.page.waitForTimeout(300);
      await steps();
      await app.settled();
      await app.page.waitForTimeout(hold);
      await cdp.send("Page.stopScreencast");
      await cdp.detach();
      const end = frames.at(-1).time + 0.1;
      const dir = mkdtempSync(`${tmpdir()}/bylonder-gif-`);
      const list = frames.map((f, i) => {
        writeFileSync(`${dir}/${i}.jpg`, Buffer.from(f.data, "base64"));
        return `file '${dir}/${i}.jpg'\nduration ${((frames[i + 1]?.time ?? end) - f.time).toFixed(3)}`;
      });
      writeFileSync(`${dir}/list.txt`, list.join("\n") + `\nfile '${dir}/${frames.length - 1}.jpg'\n`);
      const file = `${out}${name}.gif`;
      for (const [width, colors, fps] of [[640, 128, 12], [560, 96, 10], [480, 64, 10], [400, 48, 8]]) {
        ffmpeg("-f", "concat", "-safe", "0", "-i", `${dir}/list.txt`, "-vf",
          `scale=${size.width * scale}:${size.height * scale},crop=${crop.width * scale}:${crop.height * scale}:${crop.x * scale}:${crop.y * scale},fps=${fps},scale='min(${width},iw)':-2:flags=lanczos,split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
          "-loop", "0", file);
        if (statSync(file).size < MAX_GIF) break;
      }
      rmSync(dir, { recursive: true });
      console.log(`${name}.gif ${(statSync(file).size / 1024).toFixed(0)} KB, ${frames.length} frames`);
      return file;
    },
    async close() {
      if (app.errors.length) console.log("Page errors:\n" + app.errors.join("\n"));
      await app.close();
      await browser.close();
      stopServer();
      mkdirSync(media, { recursive: true });
      for (const file of readdirSync(out)) cpSync(out + file, media + file);
      rmSync(out, { recursive: true });
    },
  };
  return r;
}

// Runs `record(r)` with a recorder, closing it whatever happens; a failure leaves a screenshot in the temp folder.
export async function record(feature, options, steps) {
  const r = await recorder(feature, options);
  try {
    await steps(r);
  } catch (error) {
    const shot = `${tmpdir()}/record-${feature}.png`;
    await r.page.screenshot({ path: shot }).catch(() => {});
    console.log(`Failed; screenshot: ${shot}`);
    throw error;
  } finally {
    await r.close();
  }
}
