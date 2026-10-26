/** One owner for relative mouse input. Pointer lock is optional, never assumed.
 *  Each session locks the element it started on (the 3D Viewport being dragged). */
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
      else session.locked = true;
    } else if (session?.locked) {
      const lost = session.onLost;
      release();
      lost(); // Browser Escape can release lock without delivering keydown.
    }
  };
  const move = (event) => {
    if (!session) return;
    const locked = document.pointerLockElement === session.element;
    const dx = locked ? event.movementX : event.clientX - session.x;
    const dy = locked ? event.movementY : event.clientY - session.y;
    session.x = event.clientX;
    session.y = event.clientY;
    session.onMove(dx, dy, event);
  };
  const blur = () => {
    if (session) {
      const lost = session.onLost;
      release();
      lost();
    }
  };
  document.addEventListener("mousemove", move);
  document.addEventListener("pointerlockchange", lockChanged);
  document.addEventListener("pointerlockerror", failed);
  window.addEventListener("blur", blur);
  return {
    get active() {
      return !!session;
    },
    begin(point, onMove, onLost, element) {
      if (session) return false;
      requested = element;
      session = {
        element,
        x: point.x,
        y: point.y,
        onMove,
        onLost,
        locked: false,
        warned: false,
      };
      try {
        if (!element?.requestPointerLock) failed();
        else {
          const result = element.requestPointerLock();
          result?.catch(failed);
        }
      } catch {
        failed();
      }
      return true;
    },
    release,
    dispose() {
      release();
      document.removeEventListener("mousemove", move);
      document.removeEventListener("pointerlockchange", lockChanged);
      document.removeEventListener("pointerlockerror", failed);
      window.removeEventListener("blur", blur);
    },
  };
}
