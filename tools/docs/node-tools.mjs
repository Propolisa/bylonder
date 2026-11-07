// Node editor steps for the docs recorders (record.mjs): adding nodes from Shift A's search and linking sockets.
const EDITOR = ".bl-node-editor";

export const nodeTools = (r) => {
  const { app, page } = r;
  const editorAt = async (fx, fy) => {
    const box = await app.locator(EDITOR).boundingBox();
    return [box.x + box.width * fx, box.y + box.height * fy];
  };
  // A node by its idname, `Idname#n` for the n-th of its kind in the editor.
  const node = (name) => { const [idname, n = 0] = name.split("#"); return app.locator(`[data-node="${idname}"]`).nth(Number(n)); };
  // A socket by its identifier's start: a group's sockets are Socket_0, Socket_1 ...
  const socket = (name, side, id) => node(name).locator(`[data-socket^="${side}:${id}"]`).first();
  const center = async (locator) => { const b = await locator.boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  return {
    node,
    link: async (from, fromId, to, toId) => r.drag(await center(socket(from, "out", fromId)), await center(socket(to, "in", toId))),
    // Shift A, typed search, Enter, placed with a click at a fraction of the editor.
    add: async (search, fx, fy) => {
      const at = await editorAt(fx, fy);
      await page.mouse.move(...at, { steps: 6 });
      await r.keys("Shift A", "Shift+A");
      await app.locator(".bl-menu").waitFor();
      await page.keyboard.type(search, { delay: 50 });
      await r.pause(400);
      await page.keyboard.press("Enter");
      await app.settled();
      await page.mouse.move(at[0] + 10, at[1] + 5, { steps: 4 });
      await page.mouse.click(at[0] + 10, at[1] + 5);
      await app.settled();
    },
  };
};
