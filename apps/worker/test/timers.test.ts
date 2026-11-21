import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { every } from '../src/timers';

describe('every: a background job that cannot take the worker down', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('runs the job on every tick', async () => {
    const job = vi.fn(async () => {}); const t = every('x', 1000, job);
    await vi.advanceTimersByTimeAsync(3000); clearInterval(t);
    expect(job).toHaveBeenCalledTimes(3);
  });

  it('a job that rejects is logged and the next tick still runs (no unhandled rejection)', async () => {
    const unhandled = vi.fn(); process.on('unhandledRejection', unhandled);
    const log = vi.fn(); let n = 0;
    const t = every('connectors', 1000, async () => { n++; if (n === 1) throw new Error('database went away'); }, { log });
    await vi.advanceTimersByTimeAsync(3000); clearInterval(t);
    expect(log).toHaveBeenCalledWith('connectors', 'database went away');
    expect(n).toBe(3);                                         // kept going after the failure
    await vi.advanceTimersByTimeAsync(10); process.off('unhandledRejection', unhandled);
    expect(unhandled).not.toHaveBeenCalled();
  });

  it('a job that throws before its first await is caught too', async () => {
    const log = vi.fn(); const t = every('sync-throw', 1000, () => { throw new Error('boom'); }, { log });
    await vi.advanceTimersByTimeAsync(1000); clearInterval(t);
    expect(log).toHaveBeenCalledWith('sync-throw', 'boom');
  });

  it('a non-Error failure is logged as text instead of crashing the logger', async () => {
    const log = vi.fn(); const t = every('odd', 1000, () => Promise.reject('plain string'), { log });
    await vi.advanceTimersByTimeAsync(1000); clearInterval(t);
    expect(log).toHaveBeenCalledWith('odd', 'plain string');
  });

  it('a slow run is never started twice at once: ticks during it are skipped, then it resumes', async () => {
    let active = 0, peak = 0, started = 0; let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const t = every('slow', 1000, async () => { started++; active++; peak = Math.max(peak, active); await (started === 1 ? gate : Promise.resolve()); active--; });
    await vi.advanceTimersByTimeAsync(5000);                   // five ticks while the first run is stuck
    expect(started).toBe(1); expect(peak).toBe(1);
    release(); await vi.advanceTimersByTimeAsync(1000);        // the first run finishes, the next tick starts a new one
    expect(started).toBe(2); expect(peak).toBe(1);
    clearInterval(t);
  });

  it('a failed run frees the slot, so a failure never blocks the job forever', async () => {
    const log = vi.fn(); let n = 0;
    const t = every('retry', 1000, async () => { n++; throw new Error('still down'); }, { log });
    await vi.advanceTimersByTimeAsync(4000); clearInterval(t);
    expect(n).toBe(4); expect(log).toHaveBeenCalledTimes(4);
  });

  it('main.ts has no bare setInterval left: every background job goes through every()', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(src.match(/\bsetInterval\(/g) ?? []).toHaveLength(0);
    expect((src.match(/\bevery\(/g) ?? []).length).toBeGreaterThanOrEqual(10);
  });
});

describe('the failure this prevents, in a real process', () => {
  const run = (code: string) => spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 15_000 });
  it('a bare async setInterval that throws takes the whole process down (what the connector timer used to do)', () => {
    const r = run(`setInterval(async () => { throw new Error('database went away'); }, 50); setTimeout(() => process.exit(0), 1500);`);
    expect(r.status).not.toBe(0); expect(r.stderr).toContain('database went away');
  });
  it('the same job under every() is logged and the process lives on', () => {
    const code = `import { every } from ${JSON.stringify(new URL('../src/timers.ts', import.meta.url).pathname)};
      every('connector-events', 50, async () => { throw new Error('database went away'); });
      setTimeout(() => { console.log('SURVIVED'); process.exit(0); }, 1500);`;
    const r = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', code], { encoding: 'utf8', timeout: 20_000, cwd: new URL('..', import.meta.url).pathname });
    expect(r.stdout).toContain('SURVIVED'); expect(r.status).toBe(0); expect(r.stderr).toContain('database went away');
  });
});
