const CACHE = "babylon-workspace-runs-v1";
self.addEventListener("install", (event) =>
  event.waitUntil(self.skipWaiting()),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(new URL("__workspace_run/", self.registration.scope).pathname)
  )
    return;
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
      return response;
    })(),
  );
});
