// Records docs/features/geometry-node-editor.md's media: a sunflower's seed spiral built in the Geometry Node Editor from
// the Default Cube's scene (points, a radius by the square root of the index, a turn by the golden angle, seeds on the
// points), then the Sunflowers example's group and the workspace with it.
// usage: node tools/docs/record-geometry-node-editor.mjs
import { record } from "./record.mjs";
import { nodeTools } from "./node-tools.mjs";

const EDITOR = ".bl-node-editor", VIEW = '[data-section="viewport"]';
const GOLDEN = 2.39996;

await record("geometry-node-editor", {}, async (r) => {
  const { app, page } = r;
  const { node, link, add } = nodeTools(r);
  await r.gif("start", undefined, async () => {
    await app.hover(0.5, 0.5);
    await r.keys("Delete");
    await r.menu(app.locator('[data-blender="VIEW3D_MT_add"]'), "Mesh", "Plane");
    await r.tab("Modifiers");
    await r.menu(app.locator(".bl-properties-region").getByRole("button", { name: "Add Modifier" }), "Geometry Nodes");
    await app.locator(".bl-properties-region").getByRole("button", { name: "New" }).first().click();
    await app.settled();
    await page.click('[data-workspace="geometry-nodes"]');
    await app.settled();
    await node("NodeGroupOutput").waitFor();
    await app.hover(0.5, 0.5);
    await r.keys("Numpad 7", "Numpad7");
    await r.keys("Numpad .", "NumpadDecimal");
    await r.pause(800);
  });
  // The editor is maximized (Ctrl Space) while nodes are added, and restored to show the result.
  const maximize = async () => {
    await app.locator(EDITOR).hover();
    await r.keys("Ctrl Space", "Control+Space");
  };
  await r.gif("points", undefined, async () => {
    await maximize();
    await add("Points", 0.08, 0.135);
    await r.field(node("GeometryNodePoints"), "Count", 500);
    await r.field(node("GeometryNodePoints"), "Radius", 0.015);
    await add("Set Position", 0.437, 0.452);
    await link("GeometryNodePoints", "Geometry", "GeometryNodeSetPosition", "Geometry");
    await link("GeometryNodeSetPosition", "Geometry", "NodeGroupOutput", "Socket");
    await add("Index", 0.03, 0.646);
    await add("Square Root", 0.116, 0.646);
    await add("Math Multiply", 0.226, 0.646);
    await add("Combine XYZ", 0.343, 0.701);
    await link("GeometryNodeInputIndex", "Index", "ShaderNodeMath#0", "Value");
    await link("ShaderNodeMath#0", "Value", "ShaderNodeMath#1", "Value");
    await r.field(node("ShaderNodeMath#1"), "Value", 0.04);
    await link("ShaderNodeMath#1", "Value", "ShaderNodeCombineXYZ", "X");
    await link("ShaderNodeCombineXYZ", "Vector", "GeometryNodeSetPosition", "Position");
    await maximize();
    await r.pause(2500);
  });
  await r.gif("golden-angle", undefined, async () => {
    await maximize();
    await add("Math Multiply", 0.17, 0.3);
    await add("Vector Rotate", 0.469, 0.701);
    await link("GeometryNodeInputIndex", "Index", "ShaderNodeMath#2", "Value");
    await r.field(node("ShaderNodeMath#2"), "Value", GOLDEN);
    await link("ShaderNodeCombineXYZ", "Vector", "ShaderNodeVectorRotate", "Vector");
    await link("ShaderNodeMath#2", "Value", "ShaderNodeVectorRotate", "Angle");
    await link("ShaderNodeVectorRotate", "Vector", "GeometryNodeSetPosition", "Position");
    await maximize();
    await r.pause(2500);
  });
  await r.gif("angle", undefined, async () => {
    for (const angle of [2.3, 2.4, GOLDEN]) {
      await r.field(node("ShaderNodeMath#2"), "Value", angle);
      await r.pause(1300);
    }
  });
  await r.gif("seeds", undefined, async () => {
    await maximize();
    await add("Instance on Points", 0.782, 0.135);
    await add("UV Sphere", 0.782, 0.549);
    await r.field(node("GeometryNodeMeshUVSphere"), "Radius", 0.02);
    await link("GeometryNodeSetPosition", "Geometry", "GeometryNodeInstanceOnPoints", "Points");
    await link("GeometryNodeMeshUVSphere", "Mesh", "GeometryNodeInstanceOnPoints", "Instance");
    await link("GeometryNodeInstanceOnPoints", "Instances", "NodeGroupOutput", "Socket");
    await maximize();
    await r.pause(2500);
  });
});

await record("geometry-node-editor", { example: "geometry-node-editor", node: "Sunflower" }, async (r) => {
  const { app, page } = r;
  await app.hover();
  await r.keys("Numpad 0", "Numpad0");
  await r.keys("Home");
  // Rendered straight after opening draws washed out until the shading changes once: Material Preview first.
  for (const shading of ["material", "rendered"]) {
    await app.bylonder((b, shading) => { b.views.input.state.overlays = false; b.views.input.setShading(shading); }, shading);
    await page.mouse.move(1, 1);
    await r.pause(8000);
  }
  await r.shot("thumbnail", VIEW, { part: [0.06, 0.08, 1, 1] });
  await page.click('[data-workspace="geometry-nodes"]');
  await app.settled();
  await app.locator(EDITOR).hover();
  await r.keys("Ctrl Space", "Control+Space");
  await r.keys("Home");
  await r.pause(1000);
  await r.shot("sunflower-tree", EDITOR);
});
