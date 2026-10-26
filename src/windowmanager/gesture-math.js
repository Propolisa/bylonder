/** CSS-pixel gesture math, independent of rendering / device pixel ratio. */
export const snap = (value, step) => Math.round(value / step) * step;
export const wrap = (value, min, size) =>
  min + ((((value - min) % size) + size) % size);
