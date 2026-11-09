// The phone's Back button (and the browser's) closes what is open instead of leaving the app, as Android apps do: one
// history entry stays above the app's page, and each Back that pops it closes the topmost thing and puts the entry
// back. What closes, in order: a dialog, then what the windows registered while it is open, the latest first (onBack:
// a menu, popover or popup, a folded area's drawer, a maximized area). With nothing open, Back stays in the app, unless
// there are unsaved changes and the user agrees to leave without them.

const closers = [];

// `close()` closes what it stands for and returns true, or returns false when nothing of it is open. Returns a remover.
export function onBack(close) {
  closers.push(close);
  return () => { if (closers.includes(close)) closers.splice(closers.indexOf(close), 1); };
}

// Closes the topmost open thing of this window's document and its frames'; returns whether something closed.
export function back(doc = document) {
  const dialog = [...doc.querySelectorAll('dialog[open]')].at(-1);
  if (dialog) {
    dialog.close();
    return true;
  }
  for (const frame of doc.querySelectorAll('iframe')) {
    try {
      if (frame.contentWindow?.__bylonderBack?.()) return true;
    } catch {} // A frame of another origin keeps its own.
  }
  return [...closers].reverse().some((close) => close());
}

// Lets a parent window's Back reach this window (a frame).
export const exposeBack = (win = window) => { win.__bylonderBack = () => back(win.document); };

const GUARD = { bylonder: 'back' };
// The top window: `unsaved()` says whether leaving would lose changes, `confirmLeave()` asks the user.
export function installBack(win = window, { unsaved = () => false, confirmLeave = () => win.confirm('Leave Bylonder? Your changes are not saved.') } = {}) {
  const guard = () => win.history.pushState(GUARD, '', win.location.href);
  if (win.history.state?.bylonder !== GUARD.bylonder) guard();
  const popped = () => {
    if (win.history.state?.bylonder === GUARD.bylonder) return;
    if (back(win.document) || !unsaved() || !confirmLeave()) return guard();
    win.removeEventListener('popstate', popped);
    win.history.back();
  };
  win.addEventListener('popstate', popped);
  return () => win.removeEventListener('popstate', popped);
}
