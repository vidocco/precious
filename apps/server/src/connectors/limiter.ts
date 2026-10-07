const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Spaces out requests per source: at most `requests` every `perSeconds`, evenly. */
export class RateLimiter {
  private nextAt = new Map<string, number>();

  async wait(key: string, limit: { requests: number; perSeconds: number }): Promise<number> {
    const interval = (limit.perSeconds * 1000) / limit.requests;
    const now = Date.now();
    const at = Math.max(now, this.nextAt.get(key) ?? 0);
    this.nextAt.set(key, at + interval);
    const delay = at - now;
    if (delay > 0) await sleep(delay);
    return delay;
  }
}
