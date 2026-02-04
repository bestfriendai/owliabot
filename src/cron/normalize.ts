import type { CronJob, CronPayload, CronSchedule } from "./types.js";
import { parseAbsoluteTimeMs } from "./parse.js";
import { migrateLegacyCronPayload } from "./payload-migration.js";

const DEFAULT_OPTIONS = {
  applyDefaults: false,
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceSchedule(schedule: Record<string, unknown>): Record<string, unknown> {
  const next = { ...schedule };

  const kind = typeof schedule.kind === "string" ? schedule.kind : undefined;
  const atMsRaw = schedule.atMs;
  const atRaw = schedule.at;

  const parsedAtMs =
    typeof atMsRaw === "string"
      ? parseAbsoluteTimeMs(atMsRaw)
      : typeof atRaw === "string"
        ? parseAbsoluteTimeMs(atRaw)
        : null;

  // kind inference
  if (!kind) {
    if (
      typeof schedule.atMs === "number" ||
      typeof schedule.at === "string" ||
      typeof schedule.atMs === "string"
    ) {
      next.kind = "at";
    } else if (typeof schedule.everyMs === "number") {
      next.kind = "every";
    } else if (typeof schedule.expr === "string") {
      next.kind = "cron";
    }
  }

  // ISO / numeric string -> atMs
  if (typeof schedule.atMs !== "number" && parsedAtMs !== null) {
    next.atMs = parsedAtMs;
  }

  // legacy `at` key
  if ("at" in next) {
    delete next.at;
  }

  return next;
}

function coercePayload(payload: Record<string, unknown>): Record<string, unknown> {
  const next = { ...payload };
  migrateLegacyCronPayload(next);
  return next;
}

function unwrapJob(raw: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(raw.data)) {
    return raw.data;
  }
  if (isRecord(raw.job)) {
    return raw.job;
  }
  return raw;
}

export function normalizeCronJobInput(
  raw: unknown,
  options: { applyDefaults?: boolean } = DEFAULT_OPTIONS,
): Partial<CronJob> | null {
  if (!isRecord(raw)) {
    return null;
  }

  const base = unwrapJob(raw);
  const next: Record<string, unknown> = { ...base };

  // agentId: string|nil
  if ("agentId" in base) {
    const agentId = base.agentId;
    if (agentId === null) {
      next.agentId = null;
    } else if (typeof agentId === "string") {
      const trimmed = agentId.trim();
      if (trimmed) {
        next.agentId = trimmed;
      } else {
        delete next.agentId;
      }
    }
  }

  // enabled coercion from string
  if ("enabled" in base) {
    const enabled = base.enabled;
    if (typeof enabled === "boolean") {
      next.enabled = enabled;
    } else if (typeof enabled === "string") {
      const trimmed = enabled.trim().toLowerCase();
      if (trimmed === "true") {
        next.enabled = true;
      }
      if (trimmed === "false") {
        next.enabled = false;
      }
    }
  }

  if (isRecord(base.schedule)) {
    next.schedule = coerceSchedule(base.schedule) as unknown as CronSchedule;
  }

  if (isRecord(base.payload)) {
    next.payload = coercePayload(base.payload) as unknown as CronPayload;
  }

  if (options.applyDefaults) {
    if (!next.wakeMode) {
      next.wakeMode = "next-heartbeat";
    }
    if (!next.sessionTarget && isRecord(next.payload)) {
      const kind = typeof next.payload.kind === "string" ? next.payload.kind : "";
      if (kind === "systemEvent") {
        next.sessionTarget = "main";
      }
      if (kind === "agentTurn") {
        next.sessionTarget = "isolated";
      }
    }
  }

  return next as Partial<CronJob>;
}

export function normalizeCronJobCreate(
  raw: unknown,
  options?: { applyDefaults?: boolean },
): Partial<CronJob> | null {
  return normalizeCronJobInput(raw, { applyDefaults: true, ...options });
}

export function normalizeCronJobPatch(
  raw: unknown,
  options?: { applyDefaults?: boolean },
): Partial<CronJob> | null {
  return normalizeCronJobInput(raw, { applyDefaults: false, ...options });
}
