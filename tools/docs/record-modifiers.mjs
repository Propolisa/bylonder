// Records docs/features/modifiers.md's media: a floor of cubes made by two stacked Array modifiers on the Default Cube.
// usage: node tools/docs/record-modifiers.mjs
import { record } from "./record.mjs";

const VIEW = '[data-section="viewport"]', PROPERTIES = '[data-section="properties"]';

await record("modifiers", {}, async (r) => {
  const { app } = r;
  const properties = app.locator(PROPERTIES);
  const addArray = () => r.menu(app.frame().getByRole("button", { name: "Add Modifier" }), "Generate", "Array");
  await app.click();
  await r.tab("Modifiers");
  await r.gif("add-array", undefined, addArray);
  await r.gif("count", undefined, async () => {
    await r.field(properties, "Count", 5);
    await r.field(properties, "Offset X", 1.2);
  });
  await r.gif("second-array", undefined, async () => {
    await addArray();
    // The second panel's number fields (Count, Offset X, Y, Z, Rotation, Scale) follow the first panel's ten.
    for (const [index, value] of [[10, 5], [11, 0], [12, 1.2]]) {
      const field = properties.locator('[role="spinbutton"]').nth(index);
      await field.evaluate((el) => el.scrollIntoView({ block: "center" }));
      await field.click();
      await app.page.keyboard.press("Control+A");
      await app.page.keyboard.type(String(value));
      await app.page.keyboard.press("Enter");
      await app.settled();
    }
    await app.hover();
    for (let i = 0; i < 3; i++) await app.page.mouse.wheel(0, 120);
    await app.settled();
  });
  await r.shot("thumbnail", VIEW, { part: [0.1, 0.1, 0.9, 0.9] });
});
