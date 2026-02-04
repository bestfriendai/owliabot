import { describe, it, expect, vi } from "vitest";
import { createCronServiceState } from "../state.js";
import {
  applyJobPatch,
  computeJobNextRunAtMs,
  createJob,
  isJobDue,
  nextWakeAtMs,
  recomputeNextRuns,
} from "../jobs.js";

describe("cron/service/jobs", () => {
  it("computeJobNextRunAtMs: one-shot stays due until ok", () => {
    const job: any = {
      id: "j",
      enabled: true,
      schedule: { kind: "at", atMs: 1000 },
      state: {},
    };
    expect(computeJobNextRunAtMs(job, 0)).toBe(1000);

    job.state.lastStatus = "ok";
    job.state.lastRunAtMs = 999;
    expect(computeJobNextRunAtMs(job, 0)).toBeUndefined();
  });

  it("createJob validates sessionTarget/payload.kind", () => {
    const state = createCronServiceState({
      cronEnabled: true,
      storePath: "/tmp/x",
      log: { info() {}, warn() {}, error() {} },
      enqueueSystemEvent() {},
      requestHeartbeatNow() {},
      runIsolatedAgentJob: async () => ({ status: "ok", summary: "" }),
      nowMs: () => 1,
    });

    expect(() =>
      createJob(state, {
        name: "n",
        enabled: true,
        schedule: { kind: "cron", expr: "* * * * *" },
        sessionTarget: "main",
        wakeMode: "next-heartbeat",
        payload: { kind: "agentTurn", message: "m" },
      } as any),
    ).toThrow(/main cron jobs/);
  });

  it("applyJobPatch merges agentTurn payload fields", () => {
    const job: any = {
      id: "j",
      agentId: null,
      name: "n",
      enabled: true,
      createdAtMs: 1,
      updatedAtMs: 1,
      schedule: { kind: "cron", expr: "* * * * *" },
      sessionTarget: "isolated",
      wakeMode: "next-heartbeat",
      payload: { kind: "agentTurn", message: "m", model: "a" },
      state: {},
    };

    applyJobPatch(job, { payload: { kind: "agentTurn", model: "b" } as any });
    expect(job.payload.model).toBe("b");
    expect(job.payload.message).toBe("m");
  });

  it("recomputeNextRuns clears stuck running marker", () => {
    const warn = vi.fn();
    const state = createCronServiceState({
      cronEnabled: true,
      storePath: "/tmp/x",
      log: { info() {}, warn, error() {} },
      enqueueSystemEvent() {},
      requestHeartbeatNow() {},
      runIsolatedAgentJob: async () => ({ status: "ok", summary: "" }),
      nowMs: () => 10_000_000,
    });
    state.store = {
      version: 1,
      jobs: [
        {
          id: "j",
          agentId: null,
          name: "n",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: { kind: "every", everyMs: 1000, anchorMs: 0 },
          sessionTarget: "isolated",
          wakeMode: "next-heartbeat",
          payload: { kind: "agentTurn", message: "m" },
          state: { runningAtMs: 10_000_000 - 3 * 60 * 60 * 1000 },
        } as any,
      ],
    };

    recomputeNextRuns(state);
    expect((state.store.jobs[0] as any).state.runningAtMs).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("nextWakeAtMs picks min nextRunAtMs", () => {
    const state: any = { store: { jobs: [] } };
    state.store.jobs = [
      { enabled: true, state: { nextRunAtMs: 10 } },
      { enabled: true, state: { nextRunAtMs: 5 } },
    ];
    expect(nextWakeAtMs(state)).toBe(5);
  });

  it("isJobDue respects forced", () => {
    const job: any = { enabled: false, state: {} };
    expect(isJobDue(job, 0, { forced: true })).toBe(true);
  });
});
