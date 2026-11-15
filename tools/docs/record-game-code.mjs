// Records docs/features/game-code.md's media: Rock Hard Café's Behaviors panel on the waiting rock, Edit Source opening
// rock.js, and the café played in the Game area (the barista walks to the machine, pours, and serves the rock).
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
  // Play: the Game area alone, the barista walked to the machine to pour and back to serve the waiting rock.
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
    await page.mouse.click(area.x + area.width / 2, area.y + area.height / 2);
    const hold = async (key, ms) => { await page.keyboard.down(key); await r.pause(ms); await page.keyboard.up(key); };
    await hold("KeyA", 1000);
    await hold("KeyE", 120);
    await r.pause(1500);
    await hold("KeyD", 1300); // past the machine's reach, so Use serves and does not pour again
    await hold("KeyE", 120);
    await r.pause(4500);
  }, { hold: 800 });
});
