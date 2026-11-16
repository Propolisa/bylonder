// Touch controls, shown once a finger touches the game, for two thumbs: the right half of the screen moves the hand as
// a trackpad moves a cursor (a ring on the wrist shows where it is, so the thumb never covers it), and the left half is
// the Grab button, held to keep the mug. Dragging the hand past its reach walks the barista after it, so one thumb
// reaches and walks. Each finger is followed by its own pointer events from the moment it lands, so a grab right after a
// drag, or with the other thumb still down, is taken at once. The mouse and the keys play as before.
import { defineSystem } from 'bylonder';
import { AdvancedDynamicTexture, Control, Ellipse, TextBlock } from '@babylonjs/gui';
import Barista from '../behaviors/barista.js';
import { look, px } from '../look.js';

/**
 * The thumbs on a screen `width` CSS pixels wide: a finger landing on the left half holds Grab until it lifts (`grab(on)`),
 * one on the right half drags (`drag(from, to)`, CSS pixels), each by its pointer id.
 */
export function thumbs(width, { grab, drag }) {
  const fingers = new Map();
  const holding = () => [...fingers.values()].includes('grab');
  return {
    down(id, x, y) {
      fingers.set(id, x < width() / 2 ? 'grab' : { x, y });
      if (fingers.get(id) === 'grab') grab(true);
    },
    move(id, x, y) {
      const from = fingers.get(id);
      if (!from || from === 'grab') return;
      drag(from, { x, y });
      fingers.set(id, { x, y });
    },
    up(id) {
      const was = fingers.get(id);
      fingers.delete(id);
      if (was === 'grab' && !holding()) grab(false);
    },
  };
}

export default defineSystem({
  name: 'Touch',
  create({ game, input, babylon }) {
    const scene = babylon.scene, engine = scene.getEngine(), canvas = engine.getRenderingCanvas();
    const screen = AdvancedDynamicTexture.CreateFullscreenUI('Touch', true, scene);
    // The Grab button where the left thumb rests, lit while held.
    const button = Object.assign(new Ellipse('Grab'), {
      thickness: 2, color: look.dim, background: look.panel, isPointerBlocker: false,
      horizontalAlignment: Control.HORIZONTAL_ALIGNMENT_LEFT, verticalAlignment: Control.VERTICAL_ALIGNMENT_BOTTOM,
    });
    const label = Object.assign(new TextBlock('Grab Label', 'Grab'), { color: look.text, fontFamily: look.font, fontWeight: '600', isPointerBlocker: false });
    button.addControl(label);
    const ring = Object.assign(new Ellipse('Wrist'), { thickness: 3, color: look.text, isPointerBlocker: false });
    for (const control of [button, ring]) screen.addControl(control);

    let dragged = false;
    const fingers = thumbs(() => canvas?.clientWidth ?? 0, {
      grab: (on) => {
        input.hold?.('Grab', on);
        button.background = on ? look.accent : look.panel;
      },
      drag: (from, to) => {
        dragged = true;
        game.all(Barista)[0]?.drag(from, to);
      },
    });
    // The canvas's own pointer events, a finger's from its landing to its lifting wherever it goes.
    const at = (e) => { const box = canvas.getBoundingClientRect(); return [e.clientX - box.left, e.clientY - box.top]; };
    const listeners = {
      pointerdown: (e) => { if (e.pointerType !== 'touch') return; canvas.setPointerCapture?.(e.pointerId); fingers.down(e.pointerId, ...at(e)); },
      pointermove: (e) => { if (e.pointerType === 'touch') fingers.move(e.pointerId, ...at(e)); },
      pointerup: (e) => { if (e.pointerType === 'touch') fingers.up(e.pointerId); },
      pointercancel: (e) => { if (e.pointerType === 'touch') fingers.up(e.pointerId); },
    };
    for (const [type, fn] of Object.entries(listeners)) canvas?.addEventListener(type, fn);

    // Sized in CSS pixels whenever the render's scale changes.
    let linked = null, scaled = null;
    const size = () => {
      Object.assign(button, { width: px(engine, look.thumb), height: px(engine, look.thumb), left: px(engine, 2 * look.edge), top: px(engine, -3 * look.edge) });
      label.fontSize = px(engine, look.size.line);
      Object.assign(ring, { width: px(engine, look.ring), height: px(engine, look.ring) });
    };
    return {
      /** Whether a finger has reached with the hand yet. */
      get dragged() { return dragged; },
      update() {
        const shown = !!input.touch;
        if (button.isVisible !== shown) for (const control of [button, ring]) control.isVisible = shown;
        if (!shown) return;
        if (scaled !== engine.getHardwareScalingLevel()) { scaled = engine.getHardwareScalingLevel(); size(); }
        const palm = game.all(Barista)[0]?.palm ?? null;
        if (palm !== linked) ring.linkWithMesh((linked = palm));
      },
      dispose() {
        for (const [type, fn] of Object.entries(listeners)) canvas?.removeEventListener(type, fn);
      },
    };
  },
});
