// Scrolling as on the web: a trackpad's or a finger's pixels move the view at once, a mouse wheel's notches glide there
// over a few frames, and a flick keeps going and slows down. `pan(dx, dy)` scrolls the view by whole pixels (positive
// dy shows rows further down).

// Of a notch's distance still to go, the share scrolled per 60 Hz frame; of a flick's speed, the share kept.
const GLIDE = 0.3, FRICTION = 0.95, FRAME = 1000 / 60;
// A flick slower than this (pixels per millisecond) stops.
const STOP_SPEED = 0.02;
// How far back a drag's moves count toward its flick's speed, in milliseconds.
const FLICK_WINDOW = 100;

export function createSmoothScroll(pan) {
  let rest = { x: 0, y: 0 }, velocity = null, carry = { x: 0, y: 0 }, frame = 0, last = 0, samples = [];

  // Whole pixels go to pan; the fractions add up for later.
  function move(dx, dy) {
    carry = { x: carry.x + dx, y: carry.y + dy };
    const x = Math.trunc(carry.x), y = Math.trunc(carry.y);
    carry = { x: carry.x - x, y: carry.y - y };
    if (x || y) pan(x, y);
  }
  function tick(now) {
    const frames = last ? Math.min(now - last, 4 * FRAME) / FRAME : 1;
    last = now;
    let dx = 0, dy = 0;
    if (rest.x || rest.y) {
      const share = 1 - (1 - GLIDE) ** frames;
      dx = Math.abs(rest.x) < 1 ? rest.x : rest.x * share;
      dy = Math.abs(rest.y) < 1 ? rest.y : rest.y * share;
      rest = { x: rest.x - dx, y: rest.y - dy };
    }
    if (velocity) {
      dx += velocity.x * frames * FRAME;
      dy += velocity.y * frames * FRAME;
      const kept = FRICTION ** frames;
      velocity = { x: velocity.x * kept, y: velocity.y * kept };
      if (Math.hypot(velocity.x, velocity.y) < STOP_SPEED) velocity = null;
    }
    move(dx, dy);
    frame = rest.x || rest.y || velocity ? requestAnimationFrame(tick) : 0;
  }
  const animate = () => {
    if (frame) return;
    last = 0;
    frame = requestAnimationFrame(tick);
  };
  function stop() {
    cancelAnimationFrame(frame);
    frame = 0;
    rest = { x: 0, y: 0 };
    velocity = null;
  }

  return {
    stop,
    // A trackpad's pixels, at once.
    by(dx, dy) {
      velocity = null;
      move(dx, dy);
    },
    // A mouse wheel's notch, gliding.
    glide(dx, dy) {
      velocity = null;
      rest = { x: rest.x + dx, y: rest.y + dy };
      animate();
    },
    // A finger dragging the rows (client pixels); its release flicks them on at the speed it moved.
    drag(x, y, time) {
      const previous = samples.at(-1);
      samples = [...samples.filter((s) => time - s.time < FLICK_WINDOW), { x, y, time }];
      if (previous) move(previous.x - x, previous.y - y);
    },
    release(time) {
      const recent = samples.filter((s) => time - s.time < FLICK_WINDOW), [first, end] = [recent[0], recent.at(-1)];
      samples = [];
      if (!first || end.time - first.time <= 0) return;
      const span = end.time - first.time;
      velocity = { x: (first.x - end.x) / span, y: (first.y - end.y) / span };
      if (Math.hypot(velocity.x, velocity.y) < STOP_SPEED) velocity = null;
      else animate();
    },
  };
}
