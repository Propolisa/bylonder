// @ts-check
// SPDX-License-Identifier: MIT OR Apache-2.0
// The modules of a package's own folders that runtime files load as they need them (bylonder-curves/curves.js): from
// beside the page, or from the host's module graph when a host runs the package in its own (the app's Game area), so
// that they share its Babylon.

/** @type {{ module?: (path: string) => Promise<any> }} */
export const packageHost = {};

/** A package folder's module by its path in the package. @param {string} path @param {string} root */
export const packageModule = (path, root) => packageHost.module?.(path) ?? import(new URL(path, root).href);
