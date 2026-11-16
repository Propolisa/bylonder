// Touch controls, shown once a finger touches the game, for two thumbs: the right half of the screen moves the hand as
// a trackpad moves a cursor (a ring on the wrist shows where it is, so the thumb never covers it), and the left half is
// the Grab button, held to keep the mug. Dragging the hand past its reach walks the barista after it, so one thumb
// reaches and walks. The mouse and the keys play as before.
import { defineSystem } from 'bylonder';
import { AdvancedDynamicTexture, Control, Ellipse, Rectangle, TextBlock } from '@babylonjs/gui';
import Barista from '../behaviors/barista.js';
import { look, px } from '../look.js';

export default defineSystem({
  name: 'Touch',
  create({ game, input, babylon }) {
    const scene = babylon.scene, engine = scene.getEngine();
    const screen = AdvancedDynamicTexture.CreateFullscreenUI('Touch', true, scene);
    const side = (left) => Object.assign(new Rectangle(left ? 'Grab Side' : 'Reach Side'), {
      width: 0.5, thickness: 0, isPointerBlocker: true,
      horizontalAlignment: left ? Control.HORIZONTAL_ALIGNMENT_LEFT : Control.HORIZONTAL_ALIGNMENT_RIGHT,
    });
    const grabSide = side(true), reachSide = side(false);
    // The Grab button where the left thumb rests, lit while held.
    const button = Object.assign(new Ellipse('Grab'), {
      thickness: 2, color: look.dim, background: look.panel, isPointerBlocker: false,
      horizontalAlignment: Control.HORIZONTAL_ALIGNMENT_LEFT, verticalAlignment: Control.VERTICAL_ALIGNMENT_BOTTOM,
    });
    const label = Object.assign(new TextBlock('Grab Label', 'Grab'), { color: look.text, fontFamily: look.font, fontWeight: '600' });
    button.addControl(label);
    grabSide.addControl(button);
    const ring = Object.assign(new Ellipse('Wrist'), { thickness: 3, color: look.text, isPointerBlocker: false });
    for (const control of [grabSide, reachSide, ring]) screen.addControl(control);

    const hold = (on) => {
      input.hold?.('Grab', on);
      button.background = on ? look.accent : look.panel;
    };
    grabSide.onPointerDownObservable.add(() => hold(true));
    grabSide.onPointerUpObservable.add(() => hold(false));
    // The GUI's pixels are the render's; the barista takes CSS pixels, as the scene's picking does.
    const css = ({ x, y }) => ({ x: x * engine.getHardwareScalingLevel(), y: y * engine.getHardwareScalingLevel() });
    let last = null;
    reachSide.onPointerDownObservable.add((at) => { last = css(at); });
    reachSide.onPointerMoveObservable.add((at) => {
      if (!last) return;
      const next = css(at);
      game.all(Barista)[0]?.drag(last, next);
      last = next;
    });
    reachSide.onPointerUpObservable.add(() => { last = null; });

    // Sized in CSS pixels whenever the render's scale changes.
    let linked = null, scaled = null;
    const size = () => {
      Object.assign(button, { width: px(engine, look.thumb), height: px(engine, look.thumb), left: px(engine, 2 * look.edge), top: px(engine, -3 * look.edge) });
      label.fontSize = px(engine, look.size.line);
      Object.assign(ring, { width: px(engine, look.ring), height: px(engine, look.ring) });
    };
    return {
      update() {
        const shown = !!input.touch;
        if (grabSide.isVisible !== shown) for (const control of [grabSide, reachSide, ring]) control.isVisible = shown;
        if (!shown) return;
        if (scaled !== engine.getHardwareScalingLevel()) { scaled = engine.getHardwareScalingLevel(); size(); }
        const palm = game.all(Barista)[0]?.palm ?? null;
        if (palm !== linked) ring.linkWithMesh((linked = palm));
      },
    };
  },
});
