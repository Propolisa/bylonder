// SPDX-License-Identifier: MIT OR Apache-2.0
// Override of the browser's service worker readiness: rejects when a worker fails to install (becomes redundant), which navigator.serviceWorker.ready never reports, so it would wait for ever; goes when browsers reject ready for it.

export const installFailure = (registration) => new Promise((resolve, reject) => {
  const watch = (worker) => worker?.addEventListener('statechange', () => {
    if (worker.state === 'redundant') reject(Error('The module host could not install. Reload this page once.'));
  });
  watch(registration.installing ?? registration.waiting);
  registration.addEventListener('updatefound', () => watch(registration.installing));
});
