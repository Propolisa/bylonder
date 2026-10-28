/** One owner for relative mouse input. Pointer lock is optional, never assumed.
 *  Moves are measured in client coordinates; a session locks the element it started on (the 3D Viewport or number field
 *  being dragged) only once the pointer nears the edge of its area (the viewport itself, the window for a field), as
 *  Blender wraps the cursor there. Chromium's first move under a new lock jumps from the lock's origin (and synthetic
 *  input keeps doing so), so it is dropped. */
const EDGE_PX = 16;

// The window as an area: a number field's drag wraps at the window's edge.
export const WINDOW_AREA = { getBoundingClientRect: () => ({ left: 0, top: 0, right: innerWidth, bottom: innerHeight }) };

let shared = null;
// The window's one capture, which main.js creates with its notifier.
export const windowCapture = (notify = () => {}) => (shared ??= createMouseCapture(notify));
export function createMouseCapture(notify) {
  let session = null, requested = null; // requested: the element we last asked to lock
  const release = () => {
    const element = session?.element;
    session = null;
    if (element && document.pointerLockElement === element) document.exitPointerLock();
  };
  const failed = () => {
    if (session && !session.warned) {
      session.warned = true;
      notify("Mouse capture blocked. Use Alt to reposition between sweeps.");
    }
  };
  const lockChanged = () => {
    const locked = document.pointerLockElement;
    if (locked && locked === requested) {
      if (!session) document.exitPointerLock(); // the session ended before the lock arrived
      else session.locked = session.skip = true;
    } else if (session?.locked) {
      const lost = session.onLost;
      release();
      lost(); // Browser Escape can release lock without delivering keydown.
    }
  };
  const nearEdge = ({ clientX: x, clientY: y }, area) => {
    const r = area?.getBoundingClientRect?.();
    return !!r && (x < r.left + EDGE_PX || y < r.top + EDGE_PX || x > r.right - EDGE_PX || y > r.bottom - EDGE_PX);
  };
  const lock = () => {
    if (session.requested) return;
    session.requested = true;
    requested = session.element;
    try {
      if (!session.element?.requestPointerLock) failed();
      else session.element.requestPointerLock()?.catch(failed);
    } catch {
      failed();
    }
  };
  const move = (event) => {
    if (!session) return;
    const locked = document.pointerLockElement === session.element;
    if (locked && session.skip) { session.skip = false; return; }
    const dx = locked ? event.movementX : event.clientX - session.x;
    const dy = locked ? event.movementY : event.clientY - session.y;
    session.x = event.clientX;
    session.y = event.clientY;
    if (!locked && nearEdge(event, session.area)) lock();
    session.onMove(dx, dy, event);
  };
  const blur = () => {
    if (session) {
      const lost = session.onLost;
      release();
      lost();
    }
  };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerlockchange", lockChanged);
  document.addEventListener("pointerlockerror", failed);
  window.addEventListener("blur", blur);
  return {
    get active() {
      return !!session;
    },
    begin(point, onMove, onLost, element, area = element) {
      if (session) return false;
      session = { element, area, x: point.x, y: point.y, onMove, onLost, locked: false, skip: false, requested: false, warned: false };
      return true;
    },
    release,
    dispose() {
      release();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerlockchange", lockChanged);
      document.removeEventListener("pointerlockerror", failed);
      window.removeEventListener("blur", blur);
    },
  };
}
