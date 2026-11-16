// Blender's threads need cross-origin isolation (SharedArrayBuffer). Where the host cannot send its headers (GitHub
// Pages), the app's service worker adds them (workspace-sw.js): a page it does not control yet registers it and loads
// again once it does. Without isolation Blender runs on one thread. The app starts once `isolated` settles: at once
// where no second load is coming, never where one is (so the first load makes nothing, no project and no Blender), and
// after all where the worker fails to install, was active already (a reload that bypassed it), or takes too long.
self.isolated = !crossOriginIsolated && isSecureContext && navigator.serviceWorker && !navigator.serviceWorker.controller
  ? new Promise((resolve) => {
    const workers = navigator.serviceWorker;
    workers.addEventListener("controllerchange", () => location.reload(), { once: true });
    workers.getRegistration().then(async (before) => {
      const registration = await workers.register(new URL("workspace-sw.js", document.baseURI), { scope: "./" });
      if (before?.active) return resolve();
      const worker = registration.installing ?? registration.waiting;
      worker?.addEventListener("statechange", () => { if (worker.state === "redundant") resolve(); });
    }).catch(resolve);
    setTimeout(resolve, 30000);
  })
  : Promise.resolve();
