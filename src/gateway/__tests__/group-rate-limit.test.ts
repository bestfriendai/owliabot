import { describe, it, expect } from "vitest";
import { GroupRateLimiter } from "../group-rate-limit.js";

describe("GroupRateLimiter", () => {
  it("limits concurrent acquisitions per key", () => {
    const rl = new GroupRateLimiter(1);
    const r1 = rl.tryAcquire("k");
    expect(r1).not.toBeNull();
    expect(rl.getActive("k")).toBe(1);

    const r2 = rl.tryAcquire("k");
    expect(r2).toBeNull();

    r1!();
    expect(rl.getActive("k")).toBe(0);

    const r3 = rl.tryAcquire("k");
    expect(r3).not.toBeNull();
    r3!();
  });
});

