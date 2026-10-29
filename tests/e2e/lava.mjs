// The workflow of docs/lava-material.md through real input, for the smoke test and the visual parity harness
// (tools/blender-reference/ui-shots.py builds the same in Blender).

// The cube deleted, a UV Sphere added, Subdivision Surface and Displace with a new Clouds texture; the Properties
// editor left on the Texture tab.
export async function displacedSphere(app) {
  await app.click();
  await app.page.keyboard.press("x");
  await app.frame().getByRole("menuitem", { name: "Delete" }).click();
  await app.hover();
  await app.page.keyboard.press("Shift+A");
  await app.frame().getByRole("menuitem", { name: "Mesh", exact: true }).click();
  await app.frame().getByRole("menuitem", { name: "UV Sphere" }).click();
  await app.until((b) => b.world.scene.getMeshByName("Sphere"));
  await app.locator('[role="tab"][aria-label="Modifiers"]').click();
  for (const [category, name] of [["Generate", "Subdivision Surface"], ["Deform", "Displace"]]) {
    await app.frame().getByRole("button", { name: "Add Modifier" }).click();
    await app.frame().getByRole("menuitem", { name: category }).hover();
    await app.frame().getByRole("menuitem", { name }).click();
  }
  await app.frame().locator('section[data-blender="MOD_PT_Displace"]').getByRole("button", { name: "New" }).click();
  await app.locator('[role="tab"][aria-label="Texture"]').click();
  await app.frame().getByRole("button", { name: "Image or Movie" }).click();
  await app.frame().getByRole("menuitem", { name: "Clouds" }).click();
  await app.until((b) => b.world.textures.all()[0]?.values.type === "CLOUDS");
}

// The Shading workspace, New Material, and the lava nodes added with Shift A and linked by dragging: Texture Coordinate's
// Object into two 4D Noise Textures, the first through a Color Ramp (black at 0.5 to orange) into Principled BSDF's
// Emission Color and Strength, the second (Detail 8) through Bump into its Normal; a dark Base Color.
export async function lavaMaterial(app) {
  await app.page.click('[data-workspace="shading"]');
  await app.until((b) => b.views.input.state.shading === "material");
  await app.frame().getByRole("button", { name: "New Material" }).click();
  const nodes = (idname) => app.frame().locator(`[data-node="${idname}"]`);
  await nodes("ShaderNodeOutputMaterial").waitFor();
  const box = await app.frame().locator(".bl-node-editor").boundingBox();
  // Shift A over the editor, typed to search, Enter for the best match; a click places the node.
  const add = async (name, fx, fy) => {
    const at = [box.x + box.width * fx, box.y + box.height * fy];
    await app.page.mouse.move(...at);
    await app.page.keyboard.press("Shift+A");
    await app.page.keyboard.type(name);
    await app.page.keyboard.press("Enter");
    await app.page.mouse.move(at[0] + 4, at[1] + 4);
    await app.page.mouse.click(at[0] + 4, at[1] + 4);
  };
  await add("Texture Coordinate", 0.02, 0.2);
  await add("Noise Texture", 0.12, 0.05);
  await add("Color Ramp", 0.24, 0.05);
  await add("Noise Texture", 0.12, 0.55);
  await add("Bump", 0.24, 0.6);
  const socket = (node, side, id) => node.locator(`[data-socket="${side}:${id}"]`);
  const link = async (from, output, to, input) => {
    const a = await socket(from, "out", output).boundingBox(), b = await socket(to, "in", input).boundingBox();
    await app.page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
    await app.page.mouse.down();
    await app.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 });
    await app.page.mouse.up();
  };
  const [coord, ramp, bump, principled] = ["ShaderNodeTexCoord", "ShaderNodeValToRGB", "ShaderNodeBump", "ShaderNodeBsdfPrincipled"].map(nodes);
  const [noise, detail] = [nodes("ShaderNodeTexNoise").first(), nodes("ShaderNodeTexNoise").last()];
  for (const node of [noise, detail]) {
    await node.getByRole("button", { name: "3D" }).dispatchEvent("pointerdown");
    await app.frame().getByRole("menuitem", { name: "4D" }).click();
  }
  // A click on a number field types its value.
  await detail.getByRole("button", { name: /^Detail/ }).click();
  await detail.locator("input:not([type])").fill("8");
  await app.page.keyboard.press("Enter");
  await link(coord, "Object", noise, "Vector");
  await link(coord, "Object", detail, "Vector");
  await link(noise, "Fac", ramp, "Fac");
  await link(ramp, "Color", principled, "Emission Color");
  await link(noise, "Fac", principled, "Emission Strength");
  await link(detail, "Fac", bump, "Height");
  await link(bump, "Normal", principled, "Normal");
  // The ramp's white stop, picked on the band, made orange.
  const band = await ramp.getByLabel("Color ramp").boundingBox();
  await app.page.mouse.click(band.x + band.width - 3, band.y + band.height / 2);
  await ramp.locator('input[type="color"]').fill("#ff6000");
  // Cracks: the black stop moved to the middle, and a dark surface around them.
  await app.page.mouse.click(band.x + 3, band.y + band.height / 2);
  await ramp.getByRole("button", { name: /^Pos/ }).click();
  await ramp.locator("input:not([type])").fill("0.5");
  await app.page.keyboard.press("Enter");
  await principled.locator('input[type="color"]').first().fill("#0a0a0a");
}
