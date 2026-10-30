// The story's clock: frames to days of island time, a time-lapse that speeds up from a few hours a second to half a day
// a second, what has happened by then, and the camera's shots.
export const FPS = 24, FRAMES = 720;

// Days per second of film at second t: 0.12 at the start, 0.5 at the end.
const SLOW = 0.12, FAST = 0.5, LENGTH = FRAMES / FPS;
export const speed = (frame) => SLOW + (FAST - SLOW) * (Math.max(0, frame - 1) / FPS / LENGTH) ** 2;
export const days = (frame) => {
  const t = Math.max(0, frame - 1) / FPS;
  return SLOW * t + ((FAST - SLOW) * t ** 3) / (3 * LENGTH ** 2);
};

export const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// The eruption: lava runs from the crater to the sea over its first day and a half, the crater glows until day three.
export const eruption = (d) => 1 - smoothstep(2.2, 3, d);
// The day the grass reaches a place `s` of the way from the centre to the shore, after which a tree there may grow.
export const grassDay = (s) => 3.4 + 2 * Math.max(0, 1 - s / 0.85);

// The shots, as keys of the camera: where it is round the island (angle, distance, height) and the height it looks at.
// A wide opening, in close and low as the volcano erupts, up over the island as the soil spreads, wide again at the end.
export const SHOTS = [
  [1, -0.6, 27, 11, 1.2], [110, -0.15, 21, 7, 1.6], [210, 0.55, 15, 2.6, 2.4], [300, 1.05, 18, 5, 1.8],
  [420, 1.7, 13, 15, 0.5], [530, 2.5, 19, 5.5, 1.4], [640, 3.3, 21, 7.5, 1.4], [720, 3.8, 23, 9, 1.2],
];
// The camera's angle round the island at a frame, between its keys.
export function shotAngle(frame) {
  const i = Math.max(0, SHOTS.findIndex(([f], k) => frame >= f && frame <= (SHOTS[k + 1]?.[0] ?? Infinity)));
  const [f0, a0] = SHOTS[i], [f1, a1] = SHOTS[i + 1] ?? SHOTS[i];
  return f1 === f0 ? a0 : a0 + ((a1 - a0) * (frame - f0)) / (f1 - f0);
}
