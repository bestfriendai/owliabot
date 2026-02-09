// src/gateway/group-rate-limit.ts
/**
 * Simple in-memory per-session-key concurrency limiter for group mentions.
 */

export class GroupRateLimiter {
  private readonly maxConcurrent: number;
  private readonly active: Map<string, number>;

  constructor(maxConcurrent = 3) {
    this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent));
    this.active = new Map();
  }

  tryAcquire(key: string): (() => void) | null {
    if (!key) return null;
    const cur = this.active.get(key) ?? 0;
    if (cur >= this.maxConcurrent) return null;
    this.active.set(key, cur + 1);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = (this.active.get(key) ?? 1) - 1;
      if (next <= 0) this.active.delete(key);
      else this.active.set(key, next);
    };
  }

  getActive(key: string): number {
    return this.active.get(key) ?? 0;
  }
}

