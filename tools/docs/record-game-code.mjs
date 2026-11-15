// Records docs/features/game-code.md's media: Rock Hard Café's Behaviors panel on the waiting rock, Edit Source opening
// rock.js, and the café played in the Game area (the hand takes the cup from the machine's tray and sets it on the rock).
// usage: node tools/docs/record-game-code.mjs
import { record } from "./record.mjs";

await record("game-code", { example: "rock-hard-cafe", node: "Rock", size: { width: 1600, height: 950 } }, async (r) => {
  const { app, page } = r;
  const frame = app.frame();
  await r.pause(3000);
  // The rock selected, Object properties shown: its Behaviors panel.
  await app.bylonder((b) => { const node = b.world.objects.find((n) => n.name === "Rock"); b.editor.selection.replace([node]); b.editor.reconcile(); });
  await frame.locator('[role="tab"][aria-label="Object"]').first().click();
  const panel = frame.locator('[data-blender="OBJECT_PT_bylonder_behaviors"]').first();
  await panel.scrollIntoViewIfNeeded();
  await r.pause(800);
  await r.shot("behaviors", panel);
  await r.shot("thumbnail", panel);
  // Edit Source: the code beside the scene, at the behaviour's defineBehavior.
  await panel.getByRole("button", { name: "Rock", exact: true }).first().click();
  await page.locator(".bl-file-tree").waitFor();
  await r.pause(1500);
  const code = await page.locator("#code-pane").boundingBox();
  await r.shot("edit-source", { x: code.x, y: code.y, width: Math.min(code.width, 760), height: 420 });
  await page.click('[data-blender="TOPBAR_MT_window"]');
  await page.getByRole("menuitem", { name: "Toggle Project Code" }).click();
  // Play: the Game area alone, the hand reaching for the cup on the machine's tray and setting it down on the rock.
  await app.bylonder((b) => b.dock.show("game"));
  await app.settled();
  await app.bylonder((b) => b.dock.maximize("game"));
  await app.settled();
  const play = app.locator('button[title^="Play the scene"]'), header = play.locator("xpath=..");
  await play.click();
  await header.locator("text=Playing").waitFor({ timeout: 180000 });
  await r.pause(1500);
  const top = await header.boundingBox(), area = await app.locator("#game-section").boundingBox();
  await r.gif("play", { x: area.x, y: top.y, width: area.width, height: area.y + area.height - top.y }, async () => {
    // Where a place over the counter (at the hand's height) is on screen, by the game's own camera: the cup on the tray
    // once brewed, or the near side of the waiting rock's top.
    const canvas = await app.locator("#game-section canvas").boundingBox();
    const where = async (what) => {
      for (let tries = 0; tries < 100; tries++) {
        const at = await app.bylonder((b, what) => {
          const world = b.game.world, scene = b.game.blend?.scene;
          const found = world && [...world.instances.values()].find((i) => (what === "cup" ? i.definition.name === "Cup" : what === "button" ? i.entity.name === "Machine Button"
            : i.definition.name === "Rock" && i.state.mood === "waiting"));
          if (!found) return null;
          const { min, max } = found.entity.node.getHierarchyBoundingVectors(true), V = min.constructor;
          const point = new V((min.x + max.x) / 2, 1.12, (min.z + max.z) / 2);
          if (what === "rock") {
            const toward = scene.getTransformNodeByName("Barista DEF-upper_arm.R").getAbsolutePosition().subtract(point);
            toward.y = 0;
            point.addInPlace(toward.normalize().scale(0.2));
          }
          const engine = scene.getEngine(), M = scene.getTransformMatrix().constructor, w = engine.getRenderWidth(), h = engine.getRenderHeight();
          const p = V.Project(point, M.Identity(), scene.getTransformMatrix(), scene.activeCamera.viewport.toGlobal(w, h));
          return [p.x / w, p.y / h];
        }, what);
        if (at) return [canvas.x + canvas.width * at[0], canvas.y + canvas.height * at[1]];
        await r.pause(100);
      }
      throw new Error(`No ${what} in the café`);
    };
    await page.mouse.click(canvas.x + canvas.width / 2, canvas.y + canvas.height - 10);
    // A slap on the machine's button, the hand swung in from its side; the mug comes as the brew pours.
    const button = await where("button");
    await page.mouse.move(button[0] + canvas.width * 0.12, button[1], { steps: 20 });
    await r.pause(2500);
    await page.mouse.move(button[0] - canvas.width * 0.03, button[1], { steps: 6 });
    await r.pause(4000);
    await page.mouse.move(...(await where("cup")), { steps: 20 });
    await r.pause(2000);
    await page.mouse.down();
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height * 0.75, { steps: 15 });
    await page.mouse.move(...(await where("rock")), { steps: 20 });
    await r.pause(1500);
    await page.mouse.up();
    await r.pause(4000);
  }, { hold: 800 });
});
