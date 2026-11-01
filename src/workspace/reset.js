// Help > Reset App: everything the app keeps in this browser goes (projects and their media in the origin's private
// file system, IndexedDB, local and session storage, caches and the service worker), and the app starts again clean.
// before(): what must let go of storage first (the scene's frame holds files open).
export async function resetApp(before = () => {}) {
  await before();
  const root = await navigator.storage?.getDirectory?.();
  if (root) for await (const name of root.keys()) await root.removeEntry(name, { recursive: true }).catch(() => {});
  for (const { name } of (await indexedDB.databases?.()) ?? [])
    await new Promise((done) => Object.assign(indexedDB.deleteDatabase(name), { onsuccess: done, onerror: done, onblocked: done }));
  localStorage.clear();
  sessionStorage.clear();
  for (const key of (await globalThis.caches?.keys()) ?? []) await caches.delete(key);
  for (const registration of (await navigator.serviceWorker?.getRegistrations()) ?? []) await registration.unregister();
  location.replace(location.pathname);
}
