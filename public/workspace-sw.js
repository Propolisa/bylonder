const CACHE = "babylon-workspace-runs-v1";
self.addEventListener("install", (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
// Cross-origin isolation, which Blender's threads need, where the host cannot send its headers (isolation.js): the
// site's pages and workers are answered with COOP and COEP added; the other files go to the network untouched, as they
// need neither. The docs viewer stays as served, for its embeds.
const ISOLATED = new Set(["document", "iframe", "worker", "sharedworker"]);
const isolated = (response) => {
  if (!response.status) return response;
  const headers = new Headers(response.headers);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Embedder-Policy", "credentialless");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith(new URL("__workspace_run/", self.registration.scope).pathname)) {
    const page = event.request.mode === "navigate" || ISOLATED.has(event.request.destination);
    if (page && !url.pathname.endsWith("/docs.html")) event.respondWith(fetch(event.request).then(isolated));
    return;
  }
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const clean = new URL(url);
      clean.search = "";
      clean.hash = "";
      let response = await cache.match(clean.href);
      if (!response && !/\.[^/]+$/.test(clean.pathname)) {
        for (const suffix of [".js", ".ts", ".mjs", "/index.js", "/index.ts"]) {
          response = await cache.match(clean.href + suffix);
          if (response) return Response.redirect(clean.href + suffix, 302);
        }
      }
      if (!response)
        return new Response("Project file not found: " + url.pathname, {
          status: 404,
          headers: { "Content-Type": "text/plain" },
        });
      if (url.searchParams.has("raw"))
        return new Response(
          "export default " + JSON.stringify(await response.text()),
          { headers: { "Content-Type": "text/javascript" } },
        );
      if (url.searchParams.has("module")) {
        const body = await response.text();
        const content = url.pathname.endsWith(".css")
          ? 'const style=document.createElement("style");style.textContent=' +
            JSON.stringify(body) +
            ";document.head.append(style);export default style;"
          : "export default " + body + ";";
        return new Response(content, {
          headers: { "Content-Type": "text/javascript" },
        });
      }
      // A page of a run (the Package View's) is framed by the isolated app, so it is isolated too, or the frame stays blank.
      return ISOLATED.has(event.request.destination) ? isolated(response) : response;
    })(),
  );
});
