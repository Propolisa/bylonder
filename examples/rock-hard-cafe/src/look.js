// The café's look: the few tokens every piece of its interface draws with, readable over the bright counter and sized
// for thumbs. Sizes are CSS pixels; `px` turns one into the GUI's, which are the render's.
export const look = {
  font: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  text: '#ffffff',
  dim: '#ffffffc0',
  panel: '#00000059',
  accent: '#f08a3ccc',
  radius: 18,
  gap: 12,
  edge: 16,
  size: { small: 15, body: 17, line: 22 },
  thumb: 88,
  ring: 40,
};

/** A size in CSS pixels as the GUI's pixels on `engine`. */
export const px = (engine, css) => `${css / engine.getHardwareScalingLevel()}px`;
