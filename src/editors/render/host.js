import { openRenderContext } from '../../render/render-context.js';
import { createWriter } from '../../render/output.js';
import { outputSpec, encodeSize, fileFormats } from '../../render/formats.js';
import { outputSize } from '../../blenkernel/scene/render.js';
import { pointerStruct, structFind } from '../../python/bpy_rna.js';
import './result.css';
import { frameRate } from '../../blenkernel/scene/time.js';

const cancelled = () => new DOMException('Render cancelled', 'AbortError');
// A frame's promise, rejected on Cancel: a frame can wait on modifiers that take very long, and disposing the render
// context stops them.
const untilCancelled = (promise, signal) => new Promise((resolve, reject) => {
  signal.addEventListener('abort', () => reject(cancelled()), { once: true });
  promise.then(resolve, reject);
});

// Render Image (F12), Render Animation (Ctrl F12) and View Render (F11). Each job runs in a fresh hidden
// render context (render.html) built from a snapshot of the current document, and shows progress and the
// result in a Render Result window, like Blender's render window.
//   snapshot() -> run payload with the current scene edits and animation, independent of Remember Scene Edits
//   sequencer: { hasStrips(), openCompositor({ frameStart, frameEnd, width, height }) } for Post Processing > Sequencer
//   sceneAudio({ frameStart, frameEnd, sampleRate }, { progress(done, total), signal }) -> the scene's sound over those
//   frames, for video with audio
export function createRenderHost({ world, snapshot, sequencer, sceneAudio, name = () => 'render' }) {
  let job = null, last = null;
  const win = document.createElement('section');
  win.className = 'render-result';
  win.hidden = true;
  win.setAttribute('aria-label', 'Render Result');
  win.innerHTML = '<header><span>Render Result</span><button data-close title="Close (Esc)" aria-label="Close">×</button></header><div class="render-result-view"><canvas></canvas></div><div class="render-result-progress" hidden><div></div></div><footer><span data-status></span><span class="render-result-actions"><button data-cancel>Cancel</button><button data-save>Save As…</button></span></footer>';
  document.body.append(win);
  const view = win.querySelector('canvas'), status = win.querySelector('[data-status]');
  const cancelButton = win.querySelector('[data-cancel]'), saveButton = win.querySelector('[data-save]');
  const show = () => { win.hidden = false; };
  const setStatus = text => { status.textContent = text; };
  const bar = win.querySelector('.render-result-progress');
  // How far the job is (0 to 1), or null to hide the bar.
  const setProgress = (part) => { bar.hidden = part === null; bar.firstChild.style.width = `${(part ?? 0) * 100}%`; };
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
    const scene = world.mainSync.blender.scene;
    try { spec = outputSpec(pointerStruct(structFind('Scene'), scene, scene).render); } catch (error) { last = null; sync(); show(); setStatus('Render failed: ' + error.message); return; }
    // A still is shown first and saved on request; video formats save stills as PNG, as Blender's Save As does.
    if (kind === 'image' && spec.kind === 'video') spec = { kind: 'image', ...fileFormats.PNG, quality: 1 };
    const size = encodeSize(outputSize(settings.render), spec.kind === 'video');
    const frames = [];
    if (kind === 'image') frames.push(Math.round(world.animation.time.frame));
    else for (let f = time.frameStart; f <= time.frameEnd; f += time.frameStep) frames.push(f);
    const controller = new AbortController(), signal = controller.signal;
    const started = performance.now();
    job = { controller, kind };
    last = null; sync(); show();
    setStatus('Preparing render…');
    setProgress(0);
    let source = null, writer = null;
    try {
      const edit = settings.render.useSequencer && sequencer?.hasStrips();
      source = edit ? await sequencer.openCompositor({ frameStart: frames[0], frameEnd: frames.at(-1), ...size }) : await cameraSource(size, frames, spec.audio?.rate);
      const mixing = (done, total) => { setStatus(`Mixing scene sound | ${done} / ${total} | ${clock(started)}`); setProgress(done / total); };
      const audio = spec.audio ? await source.audio?.(signal, mixing) : null;
      writer = await createWriter(spec, { ...size, fps: frameRate(time), name: name(), frames: frames.length, audio });
      const out = new OffscreenCanvas(size.width, size.height), ctx = out.getContext('2d');
      for (let index = 0; index < frames.length; index++) {
        if (signal.aborted) throw cancelled();
        const catchingUp = (done, total) => { setStatus(`Frame ${frames[index]} | catching up ${done} / ${total} | ${clock(started)}`); if (frames.length === 1) setProgress(done / total); };
        const image = await untilCancelled(source.renderFrame(frames[index], catchingUp), signal);
        ctx.drawImage(image, 0, 0, size.width, size.height);
        image.close?.();
        draw(await createImageBitmap(out));
        if (spec.kind === 'video') await writer.add(new VideoFrame(out, { timestamp: Math.round(index * 1e6 / frameRate(time)) }));
        else await writer.add(out, frames[index]);
        setProgress((index + 1) / frames.length);
        setStatus(`Frame ${frames[index]} | ${index + 1} / ${frames.length} | ${size.width} x ${size.height} | ${source.label} | ${clock(started)}`);
      }
      last = await writer.finish();
      writer = null;
      setStatus(`Finished ${frames.length === 1 ? 'frame ' + frames[0] : frames.length + ' frames'} in ${clock(started)} | ${last.filename}${source.warnings?.length ? ' | ' + source.warnings[0] : ''}`);
      if (kind === 'animation') download(last);
    } catch (error) {
      await writer?.cancel();
      setStatus(error.name === 'AbortError' ? 'Render cancelled' : 'Render failed: ' + (error.message || error));
      if (error.name !== 'AbortError') console.error(error);
    } finally {
      source?.dispose();
      setProgress(null);
      job = null; sync();
    }
  }

  // The scene camera through the compositor, rendered in an isolated render context, with the scene's sound.
  async function cameraSource(size, frames, sampleRate) {
    const { context, opened, dispose } = await openRenderContext(snapshot(), size);
    return { label: 'Camera ' + opened.camera, warnings: opened.warnings, dispose, renderFrame: (frame, progress) => context.renderFrame({ frame, ...size, quality: 'final', progress }),
      audio: (signal, progress) => sceneAudio?.({ frameStart: frames[0], frameEnd: frames.at(-1), sampleRate }, { signal, progress }) };
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
