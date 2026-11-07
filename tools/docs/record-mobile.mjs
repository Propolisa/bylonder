// Records docs/features/mobile.md's media under touch emulation: the Layout workspace on a large phone, a folded area's
// drawer, navigation by gestures, on the Robot Arm in Pose Mode, the header scrolled to Rendered shading, press and hold, a value dragged with its
// readout and soft Shift, the area edge menu, an area carried by its header, and the touch bar's pie and bubbles.
// usage: node tools/docs/record-mobile.mjs
import { record } from "./record.mjs";

const PHONE = { width: 412, height: 915 };
const center = async (locator) => {
  const box = await locator.boundingBox();
  return [box.x + box.width / 2, box.y + box.height / 2];
};

await record("mobile", { example: "robot-arm", node: null, size: PHONE, touch: true }, async (r) => {
  const { app, fingers } = r;
  await r.pause(3000);
  await app.settled();
  // The arm framed: View Selected on the active bone, then zoomed out.
  await app.hover(0.5, 0.5);
  await r.page.keyboard.press("NumpadDecimal");
  await app.settled();
  for (let i = 0; i < 4; i++) await r.page.mouse.wheel(0, 120);
  await app.settled();
  await app.bylonder((b) => b.views.input.setShading("rendered"));
  await r.pause(8000);
  await r.shot("layout");
  await r.shot("thumbnail", undefined, { width: 412 });
  await app.bylonder((b) => b.views.input.setShading("solid"));

  await r.gif("drawer", undefined, async () => {
    await fingers.tap(await center(app.locator(".dock-fold").first()));
    await r.pause(1500);
    await fingers.tap(await app.point(0.25, 0.5));
    await r.pause(400);
  });

  const step = async (points) => { await fingers.send("touchMove", points); await r.pause(40); };
  await fingers.tap(await center(app.locator('.dock-fold[aria-label*="Properties"]')));
  await app.locator(".dock-drawer").waitFor();
  await r.pause(800);
  const field = app.locator('[role="spinbutton"][aria-label="Location"]:visible').first();
  await field.waitFor();
  await r.pause(1000);
  await r.gif("value", { x: 0, y: 0, width: PHONE.width, height: 600 }, async () => {
    const [x, y] = await center(field);
    await fingers.send("touchStart", [[x, y]]);
    for (let dx = 5; dx <= 60; dx += 5) await step([[x + dx, y]]);
    const shift = await center(app.locator('.bl-value-drag button[aria-label="Shift"]'));
    await fingers.send("touchStart", [[x + 60, y], shift]);
    for (let dx = 65; dx <= 120; dx += 5) await step([[x + dx, y], shift]);
    await r.pause(300);
    await fingers.send("touchEnd", []);
    await r.pause(600);
  });
  // The drag moved the rig: put it back.
  await r.page.keyboard.press("Control+z");
  await app.settled();
  const drawer = await app.locator(".dock-drawer").boundingBox();
  await fingers.tap([drawer.x / 2, drawer.y + drawer.height / 2]);
  await r.pause(600);

  const bar = app.locator(".bl-touch-bar");
  const tap = async (locator, wait = 500) => { await locator.scrollIntoViewIfNeeded(); await fingers.tap(await center(locator)); await r.pause(wait); };
  await r.gif("bubbles", undefined, async () => {
    await tap(bar.locator('button[aria-label="Keys"]'), 900);
    await tap(app.locator('[role="menuitem"][aria-label="Rotate"]'));
    await tap(bar.locator('.bl-bubble[data-item="AXIS_X"]'));
    await tap(bar.locator('button[aria-label="Numbers"]'));
    await tap(bar.locator('button[aria-label="2"]'));
    await tap(bar.locator('button[aria-label="0"]'));
    await tap(bar.locator('button[aria-label="Numbers"]'));
    await tap(bar.locator('.bl-bubble[data-item="CONFIRM"]'), 1000);
  });
  await fingers.tap(await app.point(0.5, 0.92), 2);
  await r.pause(600);

  await r.gif("navigate", { x: 0, y: 40, width: PHONE.width, height: 720 }, async () => {
    const at = await app.point(0.5, 0.55);
    await fingers.pan(at, [40, 30]);
    await r.pause(300);
    await fingers.pinch(at, 100, 140);
    await r.pause(300);
    await fingers.pan(at, [90, 0], 3);
  });

  const header = app.locator(".dock-header-content:has(.bl-view3d-header)").first();
  const rendered = app.locator('.bl-view3d-header [data-value="RENDERED"]').first();
  await r.gif("header", { x: 0, y: 0, width: PHONE.width, height: 320 }, async () => {
    const box = await header.boundingBox(), y = box.y + box.height / 2;
    await fingers.drag([box.x + box.width - 60, y], [box.x + 10, y]);
    await r.pause(500);
    await fingers.tap(await center(rendered));
    await r.pause(1500);
  });
  await fingers.tap(await center(app.locator('.bl-view3d-header [data-value="SOLID"]').first()));
  // A drawer a tap near the folded strip opened.
  if (await app.locator(".dock-drawer").isVisible()) await fingers.tap([8, PHONE.height / 2]);
  await r.pause(400);

  await r.gif("hold", { x: 0, y: 0, width: PHONE.width, height: 500 }, async () => {
    await fingers.hold(await center(app.locator('.bl-view3d-header [data-value="SOLID"]').first()), 600);
    await r.pause(1200);
    await fingers.tap(await app.point(0.3, 0.7));
    await r.pause(300);
    await fingers.hold(await app.point(0.5, 0.5), 1000);
    await r.pause(800);
  });
  await r.page.keyboard.press("Escape");
  await r.pause(400);

  const edge = await app.locator(".dock-split-tree .splitpanes--horizontal > .splitpanes__splitter:visible").first().boundingBox();
  const swap = async () => { await fingers.tap(await center(app.frame().getByRole("menuitem", { name: "Swap Areas" }))); await r.pause(1000); };
  await r.gif("edge", undefined, async () => {
    await fingers.hold([edge.x + edge.width / 2, edge.y + edge.height / 2 + 8], 1000);
    await r.pause(1200);
    await swap();
  });
  await app.bylonder((b) => b.dock.reset());
  await r.pause(1000);

  await r.gif("carry", undefined, async () => {
    const from = await center(app.locator('.dock-leaf[data-section="timeline"] > .dock-heading')), to = await app.point(0.5, 0.4);
    await fingers.send("touchStart", [from]);
    await r.pause(600);
    for (let i = 1; i <= 15; i++) await step([[from[0] + (to[0] - from[0]) * i / 15, from[1] + (to[1] - from[1]) * i / 15]]);
    await r.pause(600);
    await fingers.send("touchEnd", []);
    await r.pause(1000);
  });
  await app.bylonder((b) => b.dock.reset());
});
