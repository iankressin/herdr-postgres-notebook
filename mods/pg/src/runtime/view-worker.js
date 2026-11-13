// A continuation may wake inside another view's call. Starting all jobs from this loop keeps
// their context attached to the owning view. Jobs run concurrently; the loop only dispatches.
export class ViewWorker {
  constructor(cx, reportError = (error) => console.error(error)) {
    this.jobs = [];
    this.wake = null;
    this.closed = false;
    cx.spawn(async (cx) => {
      while (!this.closed) {
        const job = this.jobs.shift();
        if (job) {
          Promise.resolve().then(() => job(cx)).catch(reportError);
          continue;
        }
        await new Promise((resolve) => { this.wake = resolve; });
      }
    });
  }

  spawn(job) {
    if (this.closed) return;
    this.jobs.push(job);
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  close() {
    this.closed = true;
    this.jobs = [];
    this.wake?.();
    this.wake = null;
  }
}
