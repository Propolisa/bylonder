// Mounts the running-jobs template for a window's jobs (wm-jobs.js) into a host element.
import { createApp, h, markRaw, reactive } from "vue";
import RunningJobs from "./components/RunningJobs.vue";
import "./components/tailwind.css";

export function createRunningJobs(host, jobs) {
  const state = reactive({ jobs: [] });
  const ids = new WeakMap();
  let next = 0, timer = 0;
  const id = (job) => ids.get(job) ?? (ids.set(job, ++next), next);
  const sync = () => {
    const shown = jobs.shown;
    state.jobs = shown.map((job) => ({ id: id(job), job: markRaw(job), name: job.name, question: job.question, seconds: ((performance.now() - job.started) / 1000).toFixed(1) }));
    clearTimeout(timer);
    if (shown.length) timer = setTimeout(sync, 100);
  };
  const unsubscribe = jobs.subscribe(sync);
  const app = createApp({
    render: () => h(RunningJobs, { jobs: state.jobs, onStop: ({ job }) => jobs.stop(job), onAnswer: ({ job }) => job.answer() }),
  });
  app.mount(host);
  return {
    dispose() {
      clearTimeout(timer);
      unsubscribe();
      app.unmount();
    },
  };
}
