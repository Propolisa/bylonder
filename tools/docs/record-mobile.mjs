// Records docs/features/mobile.md's media under touch emulation: the Layout workspace on a large phone, a folded area's
// drawer, navigation by gestures, the header scrolled to Rendered shading, and press and hold.
// usage: node tools/docs/record-mobile.mjs
import { record } from "./record.mjs";

const PHONE = { width: 412, height: 915 };
const center = async (locator) => {
  const box = await locator.boundingBox();
  return [box.x + box.width / 2, box.y + box.height / 2];
};

await record("mobile", { example: "cube", node: "Cube", size: PHONE, touch: true }, async (r) => {
  const { app, fingers } = r;
  await r.shot("layout");
  await r.shot("thumbnail", undefined, { width: 412 });

  await r.gif("drawer", undefined, async () => {
    await fingers.tap(await center(app.locator(".dock-fold").first()));
    await r.pause(1500);
    await fingers.tap(await app.point(0.25, 0.5));
    await r.pause(400);
  });

  await r.gif("navigate", undefined, async () => {
    const at = await app.point(0.5, 0.55);
    await fingers.pan(at, [60, 60]);
    await r.pause(300);
    await fingers.pinch(at, 80, 220);
    await r.pause(300);
    await fingers.pan(at, [120, 0], 3);
  });

  const header = app.locator(".dock-header-content:has(.bl-view3d-header)").first();
  const rendered = app.locator('.bl-view3d-header [data-value="RENDERED"]').first();
  await r.gif("header", { x: 0, y: 0, width: PHONE.width, height: 320 }, async () => {
    const box = await header.boundingBox(), y = box.y + box.height / 2;
    await fingers.drag([box.x + box.width - 10, y], [box.x + 10, y]);
    await r.pause(500);
    await fingers.tap(await center(rendered));
    await r.pause(1500);
  });
  await fingers.tap(await center(app.locator('.bl-view3d-header [data-value="SOLID"]').first()));

  await r.gif("hold", { x: 0, y: 0, width: PHONE.width, height: 500 }, async () => {
    await fingers.hold(await center(app.locator('.bl-view3d-header [data-value="SOLID"]').first()), 600);
    await r.pause(1200);
    await fingers.tap(await app.point(0.3, 0.7));
    await r.pause(300);
    await fingers.hold(await app.point(0.5, 0.5), 1000);
    await r.pause(800);
  });
  await r.page.keyboard.press("Escape");
});
