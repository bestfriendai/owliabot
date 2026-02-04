import { describe, it, expect, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { createCronServiceState } from "../state.js";
import * as ops from "../ops.js";
import type { CronJobCreateInput } from "../../types.js";

function tmpStorePath(): string {
  return path.join(
    os.tmpdir(),
    `owliabot-cron-ops-${process.pid}-${Math.random().toString(16).slice(2)}`,
    "jobs.json",
  );
}

describe("cron/service/ops", () => {
  it("start loads store, recomputes next runs, persists, and arms timer", async () => {
    const storePath = tmpStorePath();
    const info = vi.fn();

    let now = 1000;
    const state = createCronServiceState({
      cronEnabled: true,
      storePath,
      log: { info, warn() {}, error() {} },
      enqueueSystemEvent() {},
      requestHeartbeatNow() {},
      runIsolatedAgentJob: async () => ({ status: "ok", summary: "" }),
      nowMs: () => now,
    });

    await ops.start(state);

    // store created on first persist
    const raw = await fs.readFile(storePath, "utf-8").catch(() => "");
    expect(raw).toContain("\"version\"");
    expect(info).toHaveBeenCalled();
  });

  it("add/update/remove mutate store and persist", async () => {
    const storePath = tmpStorePath();

    const state = createCronServiceState({
      cronEnabled: true,
      storePath,
      log: { info() {}, warn() {}, error() {} },
      enqueueSystemEvent() {},
      requestHeartbeatNow() {},
      runIsolatedAgentJob: async () => ({ status: "ok", summary: "" }),
      nowMs: () => 10_000,
    });

    const input: CronJobCreateInput = {
      agentId: null,
      name: "Job",
      enabled: true,
      deleteAfterRun: false,
      description: "d",
      schedule: { kind: "every", everyMs: 1000 },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      payload: { kind: "systemEvent", text: "hello" },
      isolation: undefined,
    };

    const job = await ops.add(state, input);
    expect(job.id).toBeTruthy();

    const updated = await ops.update(state, job.id, { name: "Job2", enabled: false });
    expect(updated.name).toBe("Job2");
    expect(updated.enabled).toBe(false);

    const res = await ops.remove(state, job.id);
    expect(res.ok).toBe(true);
    expect(res.removed).toBe(true);

    const raw = await fs.readFile(storePath, "utf-8");
    expect(raw).toContain("\"jobs\"");
    expect(raw).not.toContain(job.id);
  });

  it("run returns not-due when job is in the future", async () => {
    const storePath = tmpStorePath();
    let now = 1000;

    const state = createCronServiceState({
      cronEnabled: true,
      storePath,
      log: { info() {}, warn() {}, error() {} },
      enqueueSystemEvent() {},
      requestHeartbeatNow() {},
      runIsolatedAgentJob: async () => ({ status: "ok", summary: "" }),
      nowMs: () => now,
    });

    const job = await ops.add(state, {
      agentId: null,
      name: "Job",
      enabled: true,
      deleteAfterRun: false,
      schedule: { kind: "every", everyMs: 1000 },
      sessionTarget: "main",
      wakeMode: "next-heartbeat",
      payload: { kind: "systemEvent", text: "hello" },
      isolation: undefined,
    });

    // Move schedule into the future.
    const j = (await ops.update(state, job.id, {
      schedule: { kind: "at", atMs: 5000 },
      enabled: true,
      state: { lastStatus: undefined, lastRunAtMs: undefined },
    })) as any;
    expect(j.state.nextRunAtMs).toBe(5000);

    const res = await ops.run(state, job.id, "due");
    expect(res.ran).toBe(false);
    expect(res.reason).toBe("not-due");

    // force should run
    const enqueueSystemEvent = vi.fn();
    state.deps.enqueueSystemEvent = enqueueSystemEvent as any;
    state.deps.requestHeartbeatNow = vi.fn() as any;

    const res2 = await ops.run(state, job.id, "force");
    expect(res2.ran).toBe(true);
    expect(enqueueSystemEvent).toHaveBeenCalled();
  });
});
