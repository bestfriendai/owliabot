import { describe, it, expect } from "vitest";
import { normalizeCronJobCreate, normalizeCronJobPatch } from "../normalize.js";

function jobBase() {
  return {
    name: "n",
    enabled: true,
    schedule: { expr: "* * * * *" },
    payload: { kind: "systemEvent", text: "x" },
  };
}

describe("cron/normalize", () => {
  it("returns null for non-objects", () => {
    expect(normalizeCronJobCreate(null)).toBeNull();
    expect(normalizeCronJobCreate(123)).toBeNull();
  });

  it("infers schedule.kind", () => {
    const out = normalizeCronJobCreate({ ...jobBase(), schedule: { expr: "* * * * *" } });
    expect(out?.schedule?.kind).toBe("cron");

    const out2 = normalizeCronJobCreate({ ...jobBase(), schedule: { everyMs: 1000 } });
    expect(out2?.schedule?.kind).toBe("every");

    const out3 = normalizeCronJobCreate({ ...jobBase(), schedule: { atMs: 1000 } });
    expect(out3?.schedule?.kind).toBe("at");
  });

  it("coerces schedule.at ISO string to atMs (UTC default)", () => {
    const out = normalizeCronJobCreate({
      ...jobBase(),
      schedule: { at: "2020-01-01T00:00:00" },
    });
    expect(out?.schedule?.kind).toBe("at");
    expect(typeof (out?.schedule as any).atMs).toBe("number");
  });

  it("drops schedule.at key", () => {
    const out = normalizeCronJobCreate({
      ...jobBase(),
      schedule: { at: "2020-01-01" },
    });
    expect((out?.schedule as any).at).toBeUndefined();
  });

  it("coerces enabled from string", () => {
    const out = normalizeCronJobCreate({ ...jobBase(), enabled: "false" });
    expect(out?.enabled).toBe(false);
  });

  it("migrates payload.provider -> payload.channel", () => {
    const out = normalizeCronJobCreate({
      ...jobBase(),
      payload: { kind: "agentTurn", message: "m", provider: "Discord" },
    });
    expect((out?.payload as any).provider).toBeUndefined();
    expect((out?.payload as any).channel).toBe("discord");
  });

  it("create applies defaults (wakeMode, sessionTarget)", () => {
    const out = normalizeCronJobCreate({
      ...jobBase(),
      payload: { kind: "agentTurn", message: "m" },
    });
    expect(out?.wakeMode).toBe("next-heartbeat");
    expect(out?.sessionTarget).toBe("isolated");
  });

  it("patch does not apply defaults", () => {
    const out = normalizeCronJobPatch({ payload: { kind: "systemEvent", text: "x" } });
    expect(out?.wakeMode).toBeUndefined();
    expect(out?.sessionTarget).toBeUndefined();
  });
});
