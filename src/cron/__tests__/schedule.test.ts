import { describe, it, expect, vi } from "vitest";

vi.mock("croner", () => {
  const created: any[] = [];
  class MockCron {
    expr: string;
    opts: any;
    constructor(expr: string, opts: any) {
      this.expr = expr;
      this.opts = opts;
      created.push(this);
    }
    nextRun(d: Date) {
      // deterministic: return now + 1234
      return new Date(d.getTime() + 1234);
    }
  }
  return { Cron: MockCron, __getCreated: () => created };
});

import { computeNextRunAtMs } from "../schedule.js";

describe("cron/schedule.computeNextRunAtMs", () => {
  it("at returns atMs when in future", () => {
    expect(computeNextRunAtMs({ kind: "at", atMs: 2000 }, 1999)).toBe(2000);
  });

  it("at returns undefined when not in future", () => {
    expect(computeNextRunAtMs({ kind: "at", atMs: 2000 }, 2000)).toBeUndefined();
  });

  it("every rounds up to next step from anchor", () => {
    const next = computeNextRunAtMs(
      { kind: "every", everyMs: 1000, anchorMs: 0 },
      1,
    );
    expect(next).toBe(1000);
  });

  it("every uses nowMs as default anchor", () => {
    const next = computeNextRunAtMs({ kind: "every", everyMs: 1000 }, 10_000);
    expect(next).toBe(11_000);
  });

  it("cron trims expr and passes timezone", async () => {
    const now = 100_000;
    const next = computeNextRunAtMs(
      { kind: "cron", expr: "  * * * * *  ", tz: "  UTC " },
      now,
    );
    expect(next).toBe(now + 1234);

    const croner = (await import("croner")) as any;
    const created = croner.__getCreated();
    expect(created).toHaveLength(1);
    expect(created[0].expr).toBe("* * * * *");
    expect(created[0].opts).toEqual({ timezone: "UTC", catch: false });
  });

  it("cron returns undefined for empty expr", () => {
    expect(computeNextRunAtMs({ kind: "cron", expr: "   " }, 0)).toBeUndefined();
  });
});
