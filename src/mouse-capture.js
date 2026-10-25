/** One owner for relative mouse input. Pointer lock is optional, never assumed. */
export function createMouseCapture(canvas, notify) {
  let session = null;
  const release = () => {
    session = null;
    if (document.pointerLockElement === canvas) document.exitPointerLock();
  };
  const failed = () => {
    if (session && !session.warned) {
      session.warned = true;
      notify("Mouse capture blocked. Use Alt to reposition between sweeps.");
    }
  };
  const lockChanged = () => {
    if (document.pointerLockElement === canvas) {
      if (!session) document.exitPointerLock();
      else session.locked = true;
    } else if (session?.locked) {
      const lost = session.onLost;
      release();
      lost(); // Browser Escape can release lock without delivering keydown.
    }
  };
  const move = (event) => {
    if (!session) return;
    const locked = document.pointerLockElement === canvas;
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
    begin(point, onMove, onLost) {
      if (session) return false;
      session = {
        x: point.x,
        y: point.y,
        onMove,
        onLost,
        locked: false,
        warned: false,
      };
      try {
        if (!canvas.requestPointerLock) failed();
        else {
          const result = canvas.requestPointerLock();
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
