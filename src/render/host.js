import { APP_BASE } from '../workspace/module-host.js';
import { outputSpec, encodeSize, fileFormats } from './formats.js';
import { outputSize } from '../scene/render.js';
import './result.css';

// Render Image (F12), Render Animation (Ctrl F12) and View Render (F11). Each job runs in a fresh hidden
// render context (render.html) built from a snapshot of the current document, and shows progress and the
// result in a Render Result window, like Blender's render window.
//   snapshot() -> run payload with the current scene edits and animation, independent of Remember Scene Edits
export function createRenderHost({ world, snapshot, name = () => 'render' }) {
  let job = null, last = null;
  const win = document.createElement('section');
  win.className = 'render-result';
  win.hidden = true;
  win.setAttribute('aria-label', 'Render Result');
  win.innerHTML = '<header><span>Render Result</span><button data-close title="Close (Esc)" aria-label="Close">×</button></header><div class="render-result-view"><canvas></canvas></div><footer><span data-status></span><span class="render-result-actions"><button data-cancel>Cancel</button><button data-save>Save As…</button></span></footer>';
  document.body.append(win);
  const view = win.querySelector('canvas'), status = win.querySelector('[data-status]');
  const cancelButton = win.querySelector('[data-cancel]'), saveButton = win.querySelector('[data-save]');
  const show = () => { win.hidden = false; };
  const setStatus = text => { status.textContent = text; };
  const sync = () => { cancelButton.hidden = !job; saveButton.hidden = !!job || !last; };
  const draw = bitmap => { view.width = bitmap.width; view.height = bitmap.height; view.getContext('2d').drawImage(bitmap, 0, 0); bitmap.close(); };
  const download = ({ blob, filename }) => {
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: filename });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  };
  const clock = start => { const s = (performance.now() - start) / 1000; return `${String(Math.floor(s / 60)).padStart(2, '0')}:${(s % 60).toFixed(2).padStart(5, '0')}`; };

  async function run(kind) {
    if (job) return;
    const settings = world.renderSettings.state, time = world.animation.time.state;
    let spec;
    try { spec = outputSpec(settings.render); } catch (error) { last = null; sync(); show(); setStatus('Render failed: ' + error.message); return; }
    // A still is shown first and saved on request; video formats save stills as PNG, as Blender's Save As does.
    if (kind === 'image' && spec.kind === 'video') spec = { kind: 'image', ...fileFormats.PNG, quality: 1 };
    const size = encodeSize(outputSize(settings.render), spec.kind === 'video');
    const frames = [];
    if (kind === 'image') frames.push(Math.round(world.animation.time.frame));
    else for (let f = time.frameStart; f <= time.frameEnd; f += time.frameStep) frames.push(f);
    const controller = new AbortController();
    const started = performance.now();
    job = { controller, kind };
    last = null; sync(); show();
    setStatus('Preparing render…');
    const frame = document.createElement('iframe');
    frame.className = 'render-context';
    frame.setAttribute('aria-hidden', 'true');
    frame.src = APP_BASE + 'render.html';
    document.body.append(frame);
    try {
      await new Promise((resolve, reject) => { frame.onload = resolve; frame.onerror = () => reject(Error('Render context failed to load')); });
      const context = frame.contentWindow.bylonderRender;
      if (!context) throw Error('Render context did not start');
      const opened = await context.open(snapshot(), size);
      const samples = Math.max(1, Math.round(settings.eevee.taaRenderSamples));
      const result = await context.render({
        frames, start: time.frameStart, fps: time.fps, width: size.width, height: size.height, samples,
        motionBlur: settings.render.useMotionBlur, shutter: settings.render.motionBlurShutter, spec, name: name(),
      }, {
        signal: controller.signal,
        onFrame(bitmap, info) {
          draw(bitmap);
          setStatus(`Frame ${info.frame} | ${info.index + 1} / ${info.count} | ${samples} samples | ${size.width} x ${size.height} | Camera ${opened.camera} | ${clock(started)}`);
        },
      });
      last = result;
      setStatus(`Finished ${frames.length === 1 ? 'frame ' + frames[0] : frames.length + ' frames'} in ${clock(started)} | ${result.filename}${opened.warnings.length ? ' | ' + opened.warnings[0] : ''}`);
      if (kind === 'animation') download(result);
    } catch (error) {
      setStatus(error.name === 'AbortError' ? 'Render cancelled' : 'Render failed: ' + (error.message || error));
      if (error.name !== 'AbortError') console.error(error);
    } finally {
      frame.remove();
      job = null; sync();
    }
  }

  cancelButton.onclick = () => job?.controller.abort();
  saveButton.onclick = () => last && download(last);
  win.querySelector('[data-close]').onclick = () => { if (!job) win.hidden = true; };
  return {
    renderImage: () => run('image'),
    renderAnimation: () => run('animation'),
    // F11: show or hide the last result.
    viewRender() { win.hidden = !win.hidden && !job; },
    get busy() { return !!job; },
    get open() { return !win.hidden; },
    // Escape cancels a running render, otherwise closes the window.
    escape() { if (job) { job.controller.abort(); return true; } if (!win.hidden) { win.hidden = true; return true; } return false; },
    dispose() { job?.controller.abort(); win.remove(); },
  };
}
