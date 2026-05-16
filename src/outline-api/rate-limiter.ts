/**
 * Rolling-window rate limiter for the Outline API.
 *
 * Outline's default limit is ~1000 requests/hour/token. We track outgoing
 * request timestamps in a rolling 1-hour window and block the next call
 * until usage drops below the effective ceiling (`limit - buffer`).
 *
 * The limiter is independent of the 429 retry path inside `customInstance` —
 * the limiter is *proactive* (avoid hitting the wall), 429 retry is
 * *reactive* (recover if we do). Both are needed.
 */

export interface RateLimiterOptions {
  /** Hard limit per window. Default 1000 (Outline's default). */
  limit?: number;
  /** Headroom kept under `limit` to leave room for ad-hoc UI calls. */
  buffer?: number;
  /** Window length in ms. Default 1h. */
  windowMs?: number;
  /** Test seam. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class RateLimiter {
  private readonly limit: number;
  private readonly buffer: number;
  private readonly windowMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timestamps: number[] = [];
  /** Serializes acquire() so concurrent callers queue cleanly. */
  private chain: Promise<void> = Promise.resolve();

  constructor(opts: RateLimiterOptions = {}) {
    this.limit = opts.limit ?? 1000;
    this.buffer = opts.buffer ?? 0;
    this.windowMs = opts.windowMs ?? 60 * 60 * 1000;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? defaultSleep;
  }

  /** Number of requests currently inside the rolling window. */
  usage(): number {
    this.evict();
    return this.timestamps.length;
  }

  /** Acquire a slot; blocks until safe to send. */
  async acquire(): Promise<void> {
    // Chain so callers serialize through the same gate. This avoids two
    // parallel acquires both seeing "1 slot left" and racing.
    const previous = this.chain;
    let release!: () => void;
    this.chain = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      await this.waitForSlot();
      this.timestamps.push(this.now());
    } finally {
      release();
    }
  }

  private async waitForSlot(): Promise<void> {
    const ceiling = Math.max(1, this.limit - this.buffer);
    // Loop because sleep duration is computed once; if `now()` is mocked or
    // clock jumps, we may need another pass.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      this.evict();
      if (this.timestamps.length < ceiling) return;
      const oldest = this.timestamps[0];
      const waitMs = Math.max(1, oldest + this.windowMs - this.now());
      await this.sleep(waitMs);
    }
  }

  private evict(): void {
    const cutoff = this.now() - this.windowMs;
    while (this.timestamps.length > 0 && this.timestamps[0] <= cutoff) {
      this.timestamps.shift();
    }
  }
}
