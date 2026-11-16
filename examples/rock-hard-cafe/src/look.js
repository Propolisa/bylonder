// The café's look: the few tokens every piece of its interface draws with (soft dark panels with round ends and white
// type, readable over the bright counter, sized for thumbs), and the panel they share. Sizes are CSS pixels; `px`
// turns one into the GUI's, which are the render's.
import { Rectangle, TextBlock } from '@babylonjs/gui';

export const look = {
  font: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  text: '#ffffff',
  dim: '#ffffffc0',
  panel: '#00000059',
  accent: '#f08a3ccc',
  gap: 12,
  edge: 16,
  size: { small: 14, body: 16, line: 20 },
  pill: 40,
  thumb: 88,
  ring: 40,
};

/** A size in CSS pixels as the GUI's pixels on `engine`. */
export const px = (engine, css) => `${css / engine.getHardwareScalingLevel()}px`;

/** A panel of the look: a pill holding `text`, sized to it; `sized(engine)` sets its sizes for the render's scale. */
export function pill(name, { italic = false, wrap = false } = {}) {
  const panel = Object.assign(new Rectangle(name), { thickness: 0, background: look.panel, adaptWidthToChildren: !wrap, adaptHeightToChildren: true, isPointerBlocker: false });
  const text = Object.assign(new TextBlock(`${name} Text`), { color: look.text, fontFamily: look.font, fontStyle: italic ? 'italic' : '', textWrapping: wrap, resizeToFit: true });
  panel.addControl(text);
  const sized = (engine) => {
    panel.cornerRadius = look.pill / 2 / engine.getHardwareScalingLevel();
    for (const side of ['paddingLeft', 'paddingRight']) text[side] = px(engine, look.pill / 2 - 4);
    for (const side of ['paddingTop', 'paddingBottom']) text[side] = px(engine, (look.pill - look.size.line) / 2);
    text.fontSize = px(engine, look.size.body);
  };
  return { panel, text, sized };
}
