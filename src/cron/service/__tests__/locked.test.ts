import { describe, it, expect } from "vitest";
import { createCronServiceState } from "../state.js";
import { locked } from "../locked.js";

describe("cron/service/locked", () => {
  it("serializes operations per storePath", async () => {
    const state = createCronServiceState({
      cronEnabled: true,
      storePath: "/tmp/lock-test",
      log: { info() {}, warn() {}, error() {} },
      enqueueSystemEvent() {},
      requestHeartbeatNow() {},
      runIsolatedAgentJob: async () => ({ status: "ok", summary: "" }),
    });

    const order: string[] = [];

    const a = locked(state, async () => {
      order.push("a1");
      await new Promise((r) => setTimeout(r, 30));
      order.push("a2");
      return "a";
    });

    const b = locked(state, async () => {
      order.push("b1");
      return "b";
    });

    const res = await Promise.all([a, b]);
    expect(res).toEqual(["a", "b"]);
    expect(order).toEqual(["a1", "a2", "b1"]);
  });
});
