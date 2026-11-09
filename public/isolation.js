// Blender's threads need cross-origin isolation (SharedArrayBuffer). Where the host cannot send its headers (GitHub
// Pages), the app's service worker adds them (workspace-sw.js): a page it does not control yet registers it and loads
// again once it does. Without isolation Blender runs on one thread.
if (!crossOriginIsolated && isSecureContext && navigator.serviceWorker && !navigator.serviceWorker.controller) {
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload(), { once: true });
  navigator.serviceWorker.register(new URL("workspace-sw.js", document.baseURI), { scope: "./" }).catch(() => {});
}
