// Node module hooks for running example projects as the app does: `@workbench/sdk` is the running project's SDK,
// `?raw` imports are text, and app modules may import without extensions, as Vite allows.
const SDK = 'bylonder:sdk';

export async function resolve(specifier, context, next) {
  if (specifier === '@workbench/sdk') return { url: SDK, shortCircuit: true };
  if (specifier.endsWith('?raw')) return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
  try {
    return await next(specifier, context);
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND' || !/^\.\.?\//.test(specifier)) throw error;
    return next(specifier + '.js', context);
  }
}

export async function load(url, context, next) {
  if (url === SDK) {
    const { sdkModuleSource } = await import('../../src/runtime/sdk-module.js');
    return { format: 'module', source: sdkModuleSource, shortCircuit: true };
  }
  if (!url.endsWith('?raw')) return next(url, context);
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL(url.slice(0, -'?raw'.length)), 'utf8');
  return { format: 'module', source: 'export default ' + JSON.stringify(text), shortCircuit: true };
}
