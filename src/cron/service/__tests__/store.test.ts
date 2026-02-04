import { describe, it, expect, vi } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import { createCronServiceState } from "../state.js";
import { ensureLoaded, warnIfDisabled } from "../store.js";

function tmpStorePath(): string {
  return path.join(
    os.tmpdir(),
    `owliabot-cron-svc-store-${process.pid}-${Math.random().toString(16).slice(2)}`,
    "jobs.json",
  );
}

describe("cron/service/store", () => {
  it("ensureLoaded loads store and migrates legacy fields (name, desc, payload.provider)", async () => {
    const storePath = tmpStorePath();
    await fs.mkdir(path.dirname(storePath), { recursive: true });

    await fs.writeFile(
      storePath,
      `{
        // json5
        version: 1,
        jobs: [
          {
            id: "j1",
            enabled: true,
            createdAtMs: 1,
            updatedAtMs: 1,
            schedule: { kind: "cron", expr: "* * * * *" },
            sessionTarget: "isolated",
            wakeMode: "next-heartbeat",
            description: "   ",
            payload: { kind: "agentTurn", message: "hi", provider: "Discord" },
            state: {}
          }
        ]
      }`,
      "utf-8",
    );

    const state = createCronServiceState({
      cronEnabled: true,
      storePath,
      log: { info() {}, warn() {}, error() {} },
      enqueueSystemEvent() {},
      requestHeartbeatNow() {},
      runIsolatedAgentJob: async () => ({ status: "ok", summary: "" }),
    });

    await ensureLoaded(state);

    expect(state.store?.jobs).toHaveLength(1);
    const job: any = state.store?.jobs[0];
    expect(typeof job.name).toBe("string");
    expect(job.description).toBeUndefined();
    expect(job.payload.provider).toBeUndefined();
    expect(job.payload.channel).toBe("discord");

    // ensureLoaded persists when mutated
    const raw = await fs.readFile(storePath, "utf-8");
    expect(raw).toContain("\"name\"");
  });

  it("warnIfDisabled warns only once", () => {
    const warn = vi.fn();
    const state = createCronServiceState({
      cronEnabled: false,
      storePath: "/tmp/x",
      log: { info() {}, warn, error() {} },
      enqueueSystemEvent() {},
      requestHeartbeatNow() {},
      runIsolatedAgentJob: async () => ({ status: "ok", summary: "" }),
    });

    warnIfDisabled(state, "add");
    warnIfDisabled(state, "add");

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
