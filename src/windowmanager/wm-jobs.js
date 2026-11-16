// Bylonder's jobs that run while the page goes on, as Blender's status bar lists its window manager's (template_running_jobs):
// each its name, how far it is (0 to 1) and a Cancel; the status bar shows them (space_view3d/viewport-ui.js).
const jobs = new Map();

/** A job started: set `progress` (0 to 1) and `text` as it goes, `end()` it; `cancel` is called when Cancel is pressed. */
export function startJob(name, cancel) {
  const job = { name, progress: 0, text: '', cancel, end: () => jobs.delete(name) };
  jobs.set(name, job);
  return job;
}
export const runningJobs = () => [...jobs.values()].map(({ name, progress, text }) => ({ name, progress, text }));
export const cancelJob = (name) => jobs.get(name)?.cancel();
