import { describe, it, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

import {
  appendCronRunLog,
  readCronRunLogEntries,
  resolveCronRunLogPath,
} from "../run-log.js";

function tmpFile(): string {
  return path.join(
    os.tmpdir(),
    `owliabot-cron-runlog-${process.pid}-${Math.random().toString(16).slice(2)}.jsonl`,
  );
}

describe("cron/run-log", () => {
  it("resolveCronRunLogPath locates under store dir/runs", () => {
    const p = resolveCronRunLogPath({ storePath: "/x/y/jobs.json", jobId: "abc" });
    expect(p.replaceAll("\\", "/")).toContain("/x/y/runs/abc.jsonl");
  });

  it("appendCronRunLog appends and readCronRunLogEntries reads", async () => {
    const filePath = tmpFile();

    await appendCronRunLog(filePath, {
      ts: 1,
      jobId: "j1",
      action: "finished",
      status: "ok",
      runAtMs: 1,
      durationMs: 2,
      nextRunAtMs: 3,
      summary: "s",
    });

    const entries = await readCronRunLogEntries(filePath, { limit: 10 });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.jobId).toBe("j1");
  });

  it("readCronRunLogEntries ignores invalid lines and non-finished actions", async () => {
    const filePath = tmpFile();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      [
        "not json",
        JSON.stringify({ ts: 1, jobId: "j1", action: "started" }),
        JSON.stringify({ ts: 2, jobId: "j1", action: "finished", status: "ok", runAtMs: 2, durationMs: 1 }),
        "",
      ].join("\n"),
      "utf-8",
    );

    const entries = await readCronRunLogEntries(filePath, { limit: 10 });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.ts).toBe(2);
  });

  it("appendCronRunLog prunes when exceeding maxBytes", async () => {
    const filePath = tmpFile();

    for (let i = 0; i < 20; i++) {
      await appendCronRunLog(
        filePath,
        {
          ts: i,
          jobId: "j1",
          action: "finished",
          status: "ok",
          runAtMs: i,
          durationMs: 1,
          summary: "x".repeat(200),
        },
        { maxBytes: 500, keepLines: 3 },
      );
    }

    const raw = await fs.readFile(filePath, "utf-8");
    const lines = raw
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    expect(lines.length).toBeLessThanOrEqual(3);

    const entries = await readCronRunLogEntries(filePath, { limit: 10 });
    expect(entries.length).toBeLessThanOrEqual(3);
  });
});
