import { RateLimiter } from '../src/outline-api/rate-limiter';

/**
 * Drive the limiter with synthetic time. Sleep advances the clock instead of
 * actually waiting; usage moves with each acquire.
 */
function makeHarness(limit: number, buffer: number, windowMs: number) {
  let clock = 0;
  const now = () => clock;
  const sleep = (ms: number) => {
    clock += ms;
    return Promise.resolve();
  };
  const limiter = new RateLimiter({ limit, buffer, windowMs, now, sleep });
  return {
    limiter,
    advance: (ms: number) => {
      clock += ms;
    },
    clock: () => clock,
  };
}

describe('RateLimiter', () => {
  test('admits requests until ceiling, then blocks until oldest ages out', async () => {
    const { limiter, advance, clock } = makeHarness(5, 1, 1000); // ceiling = 4

    for (let i = 0; i < 4; i++) {
      advance(10);
      await limiter.acquire();
    }
    expect(limiter.usage()).toBe(4);

    // The 5th would exceed; limiter must wait for the first to age out.
    const before = clock();
    const start = clock();
    await limiter.acquire();
    const after = clock();
    expect(after).toBeGreaterThan(before);
    // The first acquire happened at clock=10; it ages out at 10 + 1000 = 1010.
    expect(after).toBeGreaterThanOrEqual(1010);
    expect(after - start).toBeGreaterThan(0);
  });

  test('serializes concurrent acquires', async () => {
    const { limiter, advance } = makeHarness(2, 0, 1000); // ceiling = 2

    advance(1);
    await limiter.acquire();
    advance(1);
    await limiter.acquire();

    // Two concurrent acquires; both should resolve, but only after the window
    // shifts forward.
    const a = limiter.acquire();
    const b = limiter.acquire();
    await Promise.all([a, b]);
    expect(limiter.usage()).toBe(2); // first two aged out, latest two remain
  });

  test('buffer reduces effective limit', async () => {
    const { limiter, advance } = makeHarness(10, 8, 1000); // ceiling = 2
    advance(1);
    await limiter.acquire();
    advance(1);
    await limiter.acquire();
    // Third acquire must wait — ceiling is 2.
    const before = Date.now();
    void before;
    const p = limiter.acquire();
    let done = false;
    void p.then(() => {
      done = true;
    });
    // Give microtasks a chance — without advancing the synthetic clock, the
    // limiter should still be waiting.
    await Promise.resolve();
    await Promise.resolve();
    expect(done).toBe(false);
    await p;
    expect(done).toBe(true);
  });
});
