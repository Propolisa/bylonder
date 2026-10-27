import { APP_BASE } from '../workspace/module-host.js';

// The context's API once its module has run: it can still be awaiting the module's WebAssembly after the frame loads.
const started = (win) => win.bylonderRender ?? new Promise((resolve, reject) => {
  win.addEventListener('bylonder-render', () => resolve(win.bylonderRender), { once: true });
  win.addEventListener('error', (event) => reject(Error(`Render context did not start: ${event.message}`)), { once: true });
});

// Starts a hidden render context (render.html) for a run payload; dispose() removes it.
export async function openRenderContext(input, size, options) {
  const frame = document.createElement('iframe');
  frame.className = 'render-context';
  frame.setAttribute('aria-hidden', 'true');
  frame.src = APP_BASE + 'render.html';
  document.body.append(frame);
  const dispose = () => frame.remove();
  try {
    await new Promise((resolve, reject) => { frame.onload = resolve; frame.onerror = () => reject(Error('Render context failed to load')); });
    const context = await started(frame.contentWindow);
    const opened = await context.open(input, size, options);
    return { context, opened, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
