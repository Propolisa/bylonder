export const RUN_CACHE = "babylon-workspace-runs-v1";
export const APP_BASE = new URL(import.meta.env.BASE_URL, location.href).pathname;
export async function ensureModuleHost() {
  if (!("serviceWorker" in navigator))
    throw Error(
      "Service workers are required to run native multi-file projects.",
    );
  await navigator.serviceWorker.register(APP_BASE + "workspace-sw.js", { scope: APP_BASE });
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () =>
          reject(
            Error("Module host did not gain control. Reload this page once."),
          ),
        10000,
      );
      navigator.serviceWorker.addEventListener(
        "controllerchange",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
    });
}
const mime = (path) =>
  ({
    js: "text/javascript",
    mjs: "text/javascript",
    ts: "text/javascript",
    tsx: "text/javascript",
    jsx: "text/javascript",
    json: "application/json",
    css: "text/css",
    html: "text/html",
    svg: "image/svg+xml",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    webp: "image/webp",
    glb: "model/gltf-binary",
    gltf: "model/gltf+json",
    wasm: "application/wasm",
    txt: "text/plain",
    glsl: "text/plain",
  })[path.split(".").pop()] || "application/octet-stream";
let transformer;
async function transform(content, path) {
  if (!/\.(ts|tsx|jsx)$/.test(path) || path.endsWith(".d.ts")) return content;
  if (!transformer)
    transformer = (async () => {
      const esbuild = await import("esbuild-wasm");
      const wasm = await import("esbuild-wasm/esbuild.wasm?url");
      await esbuild.initialize({ wasmURL: wasm.default });
      return esbuild;
    })();
  const service = await transformer;
  return (
    await service.transform(content, {
      loader: path.split(".").pop(),
      format: "esm",
      target: "es2022",
      sourcefile: path,
      sourcemap: "inline",
    })
  ).code;
}
export async function publishRun(project) {
  await ensureModuleHost();
  const run = crypto.randomUUID(),
    base = APP_BASE + "__workspace_run/" + run + "/";
  const cache = await caches.open(RUN_CACHE);
  for (const [path, file] of Object.entries(project.files)) {
    const body =
      file.kind === "binary"
        ? Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0))
        : await transform(file.content, path);
    await cache.put(
      new URL(base + path, location.origin),
      new Response(body, {
        headers: {
          "Content-Type": file.mime || mime(path),
          "Cache-Control": "no-store",
        },
      }),
    );
  }
  // Cache is a runtime delivery layer, not the durable source of truth.
  return {
    run,
    base,
    importmap: project.files["importmap.json"]?.content || '{"imports":{}}',
    animation: project.animation || null,
    remember: !!project.settings.remember,
    overrides: project.settings.remember ? project.overrides : {},
    projectId: project.id,
  };
}
export async function removeRun(base) {
  const cache = await caches.open(RUN_CACHE);
  for (const request of await cache.keys())
    if (new URL(request.url).pathname.startsWith(base))
      await cache.delete(request);
}
