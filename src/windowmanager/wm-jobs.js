// Jobs (wm_jobs.cc): work done off the main thread for an owner. As in Blender, a new job for an owner waits for the
// one running, which is stopped instead once it has run for longer than a moment; a job queued behind it and replaced
// never starts. The running-jobs template (uiTemplateRunningJobs) shows the jobs that take that long, each with a
// button that stops it, and a job's questions before it goes on.

// Why a job ended without finishing: `by` is 'user' (its Cancel button) or 'superseded' (a newer job of its owner).
export class JobStopped extends Error {
  constructor(by) {
    super(by === 'user' ? 'Cancelled' : 'Superseded by a newer job');
    Object.assign(this, { name: 'AbortError', by });
  }
}

// `ask`: whether jobs may ask before going on (a window shows them); without it every question is answered yes.
export function createJobs({ delay = 300, ask = false } = {}) {
  const running = new Map(), queued = new Map(), listeners = new Set();
  const emit = () => listeners.forEach((fn) => fn());
  const stop = (job, by) => job.controller.abort(new JobStopped(by));

  function time(job) {
    clearTimeout(job.timer);
    job.slow = false;
    job.started = performance.now();
    job.timer = setTimeout(() => {
      job.slow = true;
      if (queued.has(job.owner)) stop(job, 'superseded');
      emit();
    }, delay);
  }

  function begin(job) {
    running.set(job.owner, job);
    time(job);
    const { signal } = job.controller;
    const context = {
      // Asks the user whether to go on: resolves when they continue; their Cancel stops the job.
      ask: (question) => !ask ? Promise.resolve() : new Promise((resolve) => {
        job.question = question;
        job.answer = () => { job.question = null; time(job); emit(); resolve(); };
        emit();
      }),
    };
    new Promise((resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      Promise.resolve().then(() => job.work(signal, context)).then(resolve, reject);
    }).then(job.resolve, job.reject).finally(() => {
      clearTimeout(job.timer);
      running.delete(job.owner);
      const next = queued.get(job.owner);
      queued.delete(job.owner);
      if (next) begin(next);
      emit();
    });
    emit();
  }

  // Ends an owner's jobs whose work is no longer wanted.
  function cancel(owner) {
    queued.get(owner)?.reject(new JobStopped('superseded'));
    queued.delete(owner);
    if (running.has(owner)) stop(running.get(owner), 'superseded');
  }

  return {
    // Runs work(signal, {ask}) for an owner, as described above. Resolves to what it returns; rejects with what it
    // throws, or a JobStopped.
    run(owner, name, work) {
      return new Promise((resolve, reject) => {
        const job = { owner, name, work, resolve, reject, controller: new AbortController(), question: null };
        queued.get(owner)?.reject(new JobStopped('superseded'));
        const current = running.get(owner);
        if (!current) return begin(job);
        queued.set(owner, job);
        if (current.slow || current.question) stop(current, 'superseded');
      });
    },
    // The jobs to show: those running for longer than the delay or asking a question, oldest first.
    get shown() { return [...running.values()].filter((job) => job.slow || job.question); },
    stop: (job) => stop(job, 'user'),
    cancel,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() {
      new Set([...queued.keys(), ...running.keys()]).forEach(cancel);
      listeners.clear();
    },
  };
}
