import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  loadCronStore,
  saveCronStore,
  resolveCronStorePath,
  setCachedCronStore,
} from "../store.js";

function tmpDir(): string {
  return path.join(os.tmpdir(), `owliabot-cron-store-test-${process.pid}-${Math.random().toString(16).slice(2)}`);
}

describe("cron/store", () => {
  beforeEach(() => {
    // avoid cross-test cache bleed
    setCachedCronStore("/tmp/does-not-exist", null);
  });

  it("resolveCronStorePath expands ~", () => {
    const p = resolveCronStorePath("~/x/y.json");
    expect(p.startsWith(os.homedir())).toBe(true);
  });

  it("loadCronStore returns empty store when missing", async () => {
    const dir = tmpDir();
    const storePath = path.join(dir, "jobs.json");
    const store = await loadCronStore(storePath);
    expect(store.version).toBe(1);
    expect(store.jobs).toEqual([]);
  });

  it("loadCronStore supports JSON5 comments", async () => {
    const dir = tmpDir();
    await fs.mkdir(dir, { recursive: true });
    const storePath = path.join(dir, "jobs.json");
    await fs.writeFile(
      storePath,
      `{
        // hello
        version: 1,
        jobs: [ { id: "1", name: "n", enabled: true, createdAtMs: 1, updatedAtMs: 1, schedule: { kind: "cron", expr: "* * * * *" }, sessionTarget: "main", wakeMode: "next-heartbeat", payload: { kind: "systemEvent", text: "x" }, state: {} } ]
      }`,
      "utf-8",
    );

    const store = await loadCronStore(storePath);
    expect(store.jobs.length).toBe(1);
    expect(store.jobs[0]?.id).toBe("1");
  });

  it("saveCronStore writes atomically and creates .bak best-effort", async () => {
    const dir = tmpDir();
    const storePath = path.join(dir, "jobs.json");

    await saveCronStore(storePath, { version: 1, jobs: [] });

    const raw = await fs.readFile(storePath, "utf-8");
    expect(JSON.parse(raw)).toEqual({ version: 1, jobs: [] });

    const bakRaw = await fs.readFile(`${storePath}.bak`, "utf-8");
    expect(JSON.parse(bakRaw)).toEqual({ version: 1, jobs: [] });
  });

  it("loadCronStore caches by storePath", async () => {
    const dir = tmpDir();
    const storePath = path.join(dir, "jobs.json");

    const a = await loadCronStore(storePath);
    a.jobs.push(
      // mutate in-place; cache should preserve ref
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { id: "x" } as any,
    );
    const b = await loadCronStore(storePath);
    expect(b.jobs.some((j) => (j as any).id === "x")).toBe(true);
  });
});
