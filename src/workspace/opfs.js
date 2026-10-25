/** Content-addressed immutable snapshots; HEAD advances only after all writes close. */
export async function openOPFS() {
  if (!navigator.storage?.getDirectory)
    throw Error(
      "This browser does not provide OPFS. Use a current browser over HTTPS.",
    );
  const origin = await navigator.storage.getDirectory();
  const root = await origin.getDirectoryHandle("babylon-workspace-v1", {
    create: true,
  });
  async function parent(path, create = false) {
    const parts = path.split("/");
    const name = parts.pop();
    let dir = root;
    for (const part of parts)
      dir = await dir.getDirectoryHandle(part, { create });
    return { dir, name };
  }
  return {
    async read(path) {
      try {
        const { dir, name } = await parent(path);
        return await (await (await dir.getFileHandle(name)).getFile()).text();
      } catch (e) {
        if (e.name === "NotFoundError") return null;
        throw e;
      }
    },
    async write(path, text) {
      const { dir, name } = await parent(path, true);
      const handle = await dir.getFileHandle(name, { create: true });
      const writer = await handle.createWritable();
      try {
        await writer.write(text);
        await writer.close();
      } catch (e) {
        try {
          await writer.abort();
        } catch {}
        throw e;
      }
    },
    async list(path = "") {
      let dir = root;
      for (const part of path.split("/").filter(Boolean))
        dir = await dir.getDirectoryHandle(part);
      const result = [];
      for await (const [name, handle] of dir.entries())
        result.push({ name, kind: handle.kind });
      return result;
    },
    async lock(id, fn) {
      if (!navigator.locks)
        throw Error("Web Locks are required for safe multi-tab saves.");
      return navigator.locks.request("babylon-workspace:" + id, fn);
    },
  };
}
export async function hash(content) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(content),
  );
  return Array.from(new Uint8Array(digest), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
}
