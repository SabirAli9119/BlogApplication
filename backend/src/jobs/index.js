import { publishDueBlogs } from "./publishScheduledBlogs.job.js";

const timers = [];

const every = (name, intervalMs, task) => {
  let running = false;
  const tick = async () => {
    if (running) return; // never let two runs overlap
    running = true;
    try {
      const processed = await task();
      if (processed) console.log(`[job:${name}] processed ${processed}`);
    } catch (err) {
      console.error(`[job:${name}] failed:`, err.message);
    } finally {
      running = false;
    }
  };
  tick(); // once at startup, to catch up after any downtime
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  timers.push(timer);
};

export const startJobs = () => {
  every("publishScheduledBlogs", 60 * 1000, publishDueBlogs);
};

export const stopJobs = () => {
  timers.forEach(clearInterval);
  timers.length = 0;
};