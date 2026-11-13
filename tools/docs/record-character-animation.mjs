// Records docs/features/character-animation.md's media: the Basic Character example's four actions on their tracks in
// the Nonlinear Animation editor and File > Export > JavaScript with Animations set to Clips, from the app; then, from
// its exported page (docs/demos/basic-character, served by the same dev server), the mannequin walking, running,
// turning, stopping and jumping on its keys, and walking up the steps with its feet planted (thumbnail.png from that walk).
//   usage: node tools/docs/record-character-animation.mjs  (STOP=<file.png>: also a still of the stop)
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { ffmpeg } from "../media.mjs";
import { record, screencastGif } from "./record.mjs";

const PAGE = "docs/demos/basic-character/", SIZE = { width: 960, height: 540 };
const SCENE = { x: 0, y: 0, ...SIZE };

await record("character-animation", { example: "basic-character", node: "Armature" }, async (r) => {
  const { app, page } = r;
  await r.timelineAs("Nonlinear Animation");
  await app.hover();
  await r.keys("A", "a");
  const nla = await app.locator("#nla-section").boundingBox();
  await page.mouse.move(nla.x + nla.width / 2, nla.y + nla.height / 2);
  await r.keys("Home");
  await r.shot("actions", { x: nla.x, y: nla.y - 26, width: nla.width, height: nla.height + 26 });
  const { dialog, choose } = await r.exportDialog();
  await choose("Animations", "Clips");
  await r.pause(300);
  await r.shot("export", dialog);

  // The exported page, on its own keys: its default input listens on the window.
  const demo = await page.context().newPage();
  await demo.setViewportSize(SIZE);
  await demo.goto(new URL(PAGE, page.url()).href);
  await demo.waitForFunction(() => window.demo?.hero, null, { timeout: 300000 });
  await demo.waitForFunction(() => window.demo.blend.scene.isReady(true), null, { timeout: 60000, polling: 100 });
  const hold = async (keys, ms) => {
    for (const key of keys) await demo.keyboard.down(key);
    await demo.waitForTimeout(ms);
    for (const key of [...keys].reverse()) await demo.keyboard.up(key);
  };
  const gif = (name, steps) => screencastGif(demo, `${r.out}${name}.gif`, steps, { crop: SCENE, size: SIZE, hold: 1000 });

  // A short walk, run and turn that stays well inside the field's rim (21 m out).
  await gif("walk", async () => {
    await hold(["KeyW"], 1500);
    await hold(["Shift", "KeyW"], 1200);
    await hold(["Shift", "KeyW", "KeyD"], 1800);
    await demo.waitForTimeout(1500);
    // The stop, a still for the basic character's own checks (STOP: where to write it), not a page medium.
    if (process.env.STOP) await demo.screenshot({ path: process.env.STOP, clip: SCENE });
    await demo.keyboard.down("KeyW");
    await demo.waitForTimeout(500);
    await demo.keyboard.press("Space");
    await demo.waitForTimeout(1200);
    await demo.keyboard.up("KeyW");
  });

  // Up the steps from their front: the side along which Step 1 reaches furthest past Step 5, the top one. The run there
  // from wherever the walk ended happens before the clip, so it shows the climb alone. A walk that never arrives gives
  // up after twice its time at a slow 1 m/s and 5 s more, rather than stalling the recording.
  const walkTo = (where, options) => demo.evaluate(async ([where, options]) => {
    const { blend, hero } = window.demo;
    const box = (name) => blend.scene.getMeshByName(name).getBoundingInfo().boundingBox;
    const low = box("Step 1"), top = box("Step 5");
    const axis = Math.abs(low.extendSizeWorld.x - top.extendSizeWorld.x) > Math.abs(low.extendSizeWorld.z - top.extendSizeWorld.z) ? "x" : "z";
    const target = where === "front" ? low.centerWorld.clone() : top.centerWorld.clone();
    if (where === "front") target[axis] -= low.extendSizeWorld[axis] + 1.5;
    const limit = (target.subtract(hero.node.position).length() * 2 + 5) * 1000;
    await Promise.race([hero.walkTo(target, options), new Promise((done) => setTimeout(done, limit))]);
  }, [where, options]);
  await walkTo("front", { run: true });
  await demo.waitForTimeout(1000);
  await gif("ground", () => walkTo("top"));
  await demo.screenshot({ path: `${r.out}frame.png`, clip: SCENE });
  execFileSync(ffmpeg, ["-y", "-loglevel", "error", "-i", `${r.out}frame.png`, "-vf", "scale=480:-2:flags=lanczos", `${r.out}thumbnail.png`]);
  rmSync(`${r.out}frame.png`);
  await demo.close();
});
