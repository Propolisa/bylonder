/** CSS-pixel gesture math, independent of rendering / device pixel ratio. */
export function radialRatio(start, current, center, minimumRadius = 12) {
  const radius = (p) =>
    Math.max(minimumRadius, Math.hypot(p.x - center.x, p.y - center.y));
  return radius(current) / radius(start);
}
export function angleDelta(previous, current, center) {
  const a = { x: previous.x - center.x, y: previous.y - center.y },
    b = { x: current.x - center.x, y: current.y - center.y };
  if (Math.hypot(a.x, a.y) < 4 || Math.hypot(b.x, b.y) < 4) return 0;
  return Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
}
export const snap = (value, step) => Math.round(value / step) * step;
export const wrap = (value, min, size) =>
  min + ((((value - min) % size) + size) % size);
