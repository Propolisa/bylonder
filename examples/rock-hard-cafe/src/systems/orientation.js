// The screen's orientation, a setting of the board's menu: Auto follows the phone (turning it reflows the page and the
// camera reframes), Portrait and Landscape lock the screen to it (the Screen Orientation API, which takes fullscreen, as
// the café plays on a phone). Where the screen cannot be locked (iOS Safari), a hint asks to turn the phone instead.
import { defineSystem, enumOf } from 'bylonder';
import { AdvancedDynamicTexture, Control } from '@babylonjs/gui';
import { pill } from '../look.js';

export const ORIENTATIONS = ['Auto', 'Portrait', 'Landscape'];

const HINT = { Portrait: 'Turn your phone upright', Landscape: 'Turn your phone sideways' };

export default defineSystem({
  name: 'Orientation',
  props: { orientation: enumOf(ORIENTATIONS) },
  create({ props, babylon }) {
    const engine = babylon.scene.getEngine(), canvas = engine.getRenderingCanvas();
    // The page's own window, which takes fullscreen and turns, also where the game runs in a frame of it (the editor).
    const own = canvas?.ownerDocument.defaultView;
    const page = (() => { try { return own?.top?.document ? own.top : own; } catch { return own; } })();
    const doc = page?.document, phone = !!page?.matchMedia('(pointer: coarse)').matches;
    let orientation = props.orientation;
    const apply = () => {
      const screen = page?.screen.orientation;
      if (orientation === 'Auto') { try { screen?.unlock(); } catch { /* nothing locked */ } return; }
      screen?.lock?.(/** @type {any} */ (orientation.toLowerCase())).catch(() => {});
    };
    // Locking takes fullscreen, so a choice made before it is applied again on entering it.
    doc?.addEventListener('fullscreenchange', apply);
    apply();
    const screen = AdvancedDynamicTexture.CreateFullscreenUI('Orientation', true, babylon.scene);
    const hint = pill('Turn Hint');
    Object.assign(hint.panel, { verticalAlignment: Control.VERTICAL_ALIGNMENT_CENTER, isVisible: false });
    screen.addControl(hint.panel);
    const portrait = () => !!page && page.innerHeight > page.innerWidth;
    let scaled = null;
    return {
      /** Auto, Portrait or Landscape. */
      get orientation() { return orientation; },
      set orientation(value) { if (ORIENTATIONS.includes(value) && value !== orientation) { orientation = value; apply(); } },
      /** Whether the page is upright (taller than wide). */
      get portrait() { return portrait(); },
      /** Whether the hint to turn the phone shows. */
      get hinted() { return hint.panel.isVisible; },
      update() {
        if (scaled !== engine.getHardwareScalingLevel()) { scaled = engine.getHardwareScalingLevel(); hint.sized(engine); }
        const wrong = orientation !== 'Auto' && portrait() !== (orientation === 'Portrait');
        // Where the lock took, the phone turns and the hint goes.
        hint.panel.isVisible = phone && wrong;
        if (hint.panel.isVisible) hint.text.text = HINT[orientation];
      },
      dispose() {
        doc?.removeEventListener('fullscreenchange', apply);
        if (orientation !== 'Auto') { try { page?.screen.orientation.unlock(); } catch { /* nothing locked */ } }
      },
    };
  },
});
