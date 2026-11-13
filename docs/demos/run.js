// A debug recording of a demo page's play (?debug): per frame the time step and the character's intent, plus the
// start state, the last 5 minutes kept. Ctrl+S downloads it as JSON, M marks a moment. ?replay=<path> on the page, or
// node tools/replay-run.mjs in Node, plays it back: everything past the intent is computed again, never recorded.

const vector = (v) => (v ? [v.x, v.y, v.z] : [0, 0, 0]);
const stateOf = (hero) => ({ position: vector(hero.movement.position), facing: vector(hero.movement.facing), time: hero.time });

/** Records `hero` on the page `name`; returns { event(name) } for page actions to replay by name, and toJSON(). */
export function recordRun(hero, name, seconds = 300) {
  // frames[i] is frame dropped + i; states[k] is where the character was at the start of frame states[k].frame.
  let frames = [], states = [], marks = [], t = 0, dropped = 0, pending = null;
  const update = hero.update.bind(hero);
  hero.update = (dt) => {
    // Each whole second's state, so the oldest second can go and the run start from the next.
    if (!states.length || t - states.at(-1).t >= 1) states.push({ t, frame: dropped + frames.length, ...stateOf(hero) });
    update(dt);
    const intent = hero.intent ?? {};
    frames.push({ dt, move: vector(intent.move), ...(intent.facing && { facing: vector(intent.facing) }), ...(intent.jump && { jump: true }), ...(pending && { event: pending }) });
    pending = null;
    t += dt;
    if (t - states[0].t > seconds + 1) {
      states.shift();
      frames.splice(0, states[0].frame - dropped);
      dropped = states[0].frame;
    }
  };
  const toJSON = () => {
    const { t: from, frame, ...start } = states[0];
    return { page: name, start, from, frames: frames.slice(frame - dropped), marks: marks.filter((m) => m >= from) };
  };
  const save = () => {
    const file = toJSON();
    const link = Object.assign(document.createElement('a'), { download: `run-${name}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.json`,
      href: URL.createObjectURL(new Blob([JSON.stringify(file)], { type: 'application/json' })) });
    link.click();
  };
  if (typeof addEventListener === 'function') addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
    else if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) marks.push(t);
  });
  return { event: (label) => { pending = label; }, toJSON };
}

/**
 * Plays a run back on `hero`, made as the recording's was but updated by hand: its intents as its input, its time
 * steps as its clock, a page event (`events[name]`) at its frame. step() plays a frame and returns false at the end.
 */
export function replayRun(hero, run, events = {}) {
  const V = hero.movement.position.constructor;
  hero.movement.place(new V(...run.start.position), new V(...run.start.facing), 0);
  let k = 0;
  hero.input = () => {
    const f = run.frames[k];
    return { move: new V(...f.move), ...(f.facing && { facing: new V(...f.facing) }), ...(f.jump && { jump: true }) };
  };
  return {
    get frame() { return k; },
    step() {
      const f = run.frames[k];
      if (!f) return false;
      if (f.event) events[f.event]?.();
      hero.update(f.dt);
      k++;
      return true;
    },
  };
}
