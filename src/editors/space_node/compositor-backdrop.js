// Blender's compositor backdrop: the composite behind the Compositor's nodes. It is one more engine view through the
// scene camera, sized to the output aspect; while shown it binds the compositor.
export function createCompositorBackdrop({ world, overlays, camera, output, shadingChanged }) {
  const canvas = Object.assign(document.createElement('canvas'), { className: 'compositor-backdrop' });
  canvas.setAttribute('aria-hidden', 'true');
  let shown = false;
  const view = {
    canvas, rendered: true, wantsCompositor: false, state: { cameraView: false },
    get active() { return shown && !!camera(); },
    get camera() { return camera(); },
    beforeRender() {
      overlays.setEnabled(false);
      world.beforeViewRender({ rendered: true, compositor: view.wantsCompositor });
    },
  };
  let host = null;
  const fit = () => {
    const { width, height } = output();
    const k = Math.min(host.clientWidth / width, host.clientHeight / height);
    Object.assign(canvas.style, { width: Math.floor(width * k) + 'px', height: Math.floor(height * k) + 'px' });
  };
  const observer = new ResizeObserver(() => host && fit());
  return {
    view,
    get shown() { return view.active; },
    show(element) {
      if (host === element) return;
      host = element;
      host.classList.add('bl-backdrop');
      host.prepend(canvas);
      observer.observe(host);
      fit();
      shown = true;
      shadingChanged();
    },
    hide() {
      if (!host) return;
      host.classList.remove('bl-backdrop');
      canvas.remove();
      observer.disconnect();
      host = null;
      shown = false;
      shadingChanged();
    },
  };
}
