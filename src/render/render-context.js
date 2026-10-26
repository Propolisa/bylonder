import { APP_BASE } from '../workspace/module-host.js';

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
    const context = frame.contentWindow.bylonderRender;
    if (!context) throw Error('Render context did not start');
    const opened = await context.open(input, size, options);
    return { context, opened, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
