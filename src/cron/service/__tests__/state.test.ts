import { describe, it, expect } from "vitest";
import { createCronServiceState } from "../state.js";

describe("cron/service/state", () => {
  it("creates state with defaults", () => {
    const s = createCronServiceState({
      cronEnabled: true,
      storePath: "/tmp/x.json",
      log: { info() {}, warn() {}, error() {} },
      enqueueSystemEvent() {},
      requestHeartbeatNow() {},
      runIsolatedAgentJob: async () => ({ status: "ok", summary: "" }),
    });

    expect(typeof s.deps.nowMs).toBe("function");
    expect(s.store).toBeNull();
    expect(s.timer).toBeNull();
    expect(s.running).toBe(false);
    expect(s.warnedDisabled).toBe(false);
  });
});
