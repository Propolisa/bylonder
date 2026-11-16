// Records docs/features/game-code.md's touch media: a pour in Rock Hard Café played by touch on an upright phone. The
// right thumb's strokes, a trackpad's, take the hand where the headless test takes it (tests/rock-hard-cafe-wasm.test.js):
// round behind the jars and swung onto the machine's button from its side, over the brewed mug, then, the left thumb
// holding Grab, drawn back round the sugar jar and onto the near side of the rock's top, where letting go serves it.
// usage: node tools/docs/record-cafe-touch.mjs
import { record } from "./record.mjs";

const PHONE = { width: 412, height: 915 };

await record("game-code", { example: "rock-hard-cafe", node: "Rock", size: PHONE, touch: true }, async (r) => {
  const { app, fingers } = r;
  await app.bylonder((b) => b.dock.show("game"));
  await app.settled();
  await app.bylonder((b) => b.runOperator("bylonder.game_play"));
  await app.until((b) => b.game.drawing && !!b.game.world, null, 240000);
  await r.pause(3000);
  // A place of the café on the page: the palm, the machine's button, the brewed mug or the rock, offset in the scene
  // (metres along its x and z), or a point of the counter's plane, at the hand's height.
  const where = (what, [dx, dz] = [0, 0]) => app.bylonder((b, [what, dx, dz]) => {
    const world = b.game.world, scene = b.game.blend.scene, V = scene.activeCamera.position.constructor;
    const find = (test) => [...world.instances.values()].find(test);
    const node = Array.isArray(what) ? null : what === "palm" ? scene.getMeshByName("Palm") : what === "button" ? scene.getNodeByName("Machine Button")
      : (what === "cup" ? find((i) => i.definition.name === "Cup") : find((i) => i.definition.name === "Rock" && i.state.mood === "waiting"))?.entity.node;
    let point;
    if (Array.isArray(what)) point = new V(what[0], 1.12, what[1]);
    else if (!node) return null;
    else {
      const { min, max } = node.getHierarchyBoundingVectors(true);
      point = new V((min.x + max.x) / 2 + dx, 1.12, (min.z + max.z) / 2 + dz);
    }
    if (what === "rock") {
      // The near side of its top: 0.2 m toward the barista.
      const toward = scene.getMeshByName("Palm").getAbsolutePosition().subtract(point);
      toward.y = 0;
      point.addInPlace(toward.normalize().scale(0.2));
    }
    const engine = scene.getEngine(), w = engine.getRenderWidth(), h = engine.getRenderHeight();
    const p = V.Project(point, scene.getTransformMatrix().constructor.Identity(), scene.getTransformMatrix(), scene.activeCamera.viewport.toGlobal(w, h));
    return [p.x / w, p.y / h];
  }, [what, dx, dz]).then(async (at) => {
    if (!at) return null;
    const canvas = await app.locator("#game-section canvas").boundingBox();
    return [canvas.x + canvas.width * at[0], canvas.y + canvas.height * at[1]];
  });
  const rest = [PHONE.width * 0.72, PHONE.height * 0.8], grab = [PHONE.width * 0.16, PHONE.height * 0.88];
  // One stroke of the right thumb from its rest spot, moving the hand onto `target`; `holding`, the left thumb on Grab.
  const reach = async (target, { holding = false, steps = 18 } = {}) => {
    for (let stroke = 0; stroke < 3; stroke++) {
      const [hx, hy] = await where("palm"), [tx, ty] = await target();
      const dx = tx - hx, dy = ty - hy;
      if (Math.hypot(dx, dy) < 6) return;
      const points = (t) => [...(holding ? [[...grab, 0]] : []), [rest[0] + dx * t, rest[1] + dy * t, 1]];
      await fingers.send("touchStart", points(0));
      for (let i = 1; i <= steps; i++) { await fingers.send("touchMove", points(i / steps)); await r.pause(20); }
      await fingers.send(holding ? "touchMove" : "touchEnd", holding ? [[...grab, 0]] : []);
      await r.pause(400);
    }
  };
  // A first touch shows the controls.
  await fingers.tap(rest);
  await r.pause(600);
  await r.gif("touch", undefined, async () => {
    // Behind the jars, on the barista's side of the counter, to the machine's side of its button, then onto it.
    for (const point of [[-0.2, -0.98], [1.0, -0.98]]) await reach(() => where(point));
    await reach(() => where("button", [0.25, 0]));
    await r.pause(800);
    await reach(() => where("button", [-0.05, 0]), { steps: 4 });
    await app.until((b) => [...b.game.world.instances.values()].some((i) => i.definition.name === "Cup"), null, 20000);
    await r.pause(5500);
    await reach(() => where("cup"));
    await r.pause(400);
    await fingers.send("touchStart", [[...grab, 0]]);
    await r.pause(300);
    for (const point of [[0.4, -0.98], [-0.05, -0.85]]) await reach(() => where(point), { holding: true });
    await reach(() => where("rock"), { holding: true });
    await r.pause(500);
    await fingers.send("touchEnd", []);
    await r.pause(2500);
  }, { hold: 600 });
});
