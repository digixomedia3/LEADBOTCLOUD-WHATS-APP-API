/**
 * Runs a background job on a timer without ever taking the worker down.
 *
 * Two things a bare `setInterval(async () => ...)` gets wrong:
 *  1. If the job throws (a database blip, one bad row), the rejection is unhandled and Node 24 stops the whole
 *     process, which also stops sending and webhooks. Here every failure is caught, logged and the timer carries on.
 *  2. If a run takes longer than the interval, a second copy starts on top of the first. Here the next tick is
 *     skipped while the previous run is still going, so slow runs never pile up or fight over the same rows.
 *
 * Returns the timer so shutdown can clear it, same as setInterval.
 */
export interface EveryHandle extends ReturnType<typeof setInterval> {}

export interface EveryOptions {
  /** Where failures are written. Defaults to console.error. */
  log?: (name: string, message: string) => void;
}

export function every(name: string, ms: number, job: () => Promise<unknown> | unknown, opts: EveryOptions = {}): EveryHandle {
  const log = opts.log ?? ((n, m) => console.error(n, m));
  let running = false;
  return setInterval(() => {
    if (running) return;                                  // previous run still going: skip this tick
    running = true;
    // The job may throw synchronously or reject; both end up here.
    Promise.resolve()
      .then(job)
      .catch((e: unknown) => log(name, e instanceof Error ? e.message : String(e)))
      .finally(() => { running = false; });
  }, ms);
}
