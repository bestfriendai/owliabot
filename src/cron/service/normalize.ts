import type { CronJob, CronPayload } from "../types.js";

function truncateUtf16Safe(input: string, maxLen: number): string {
  if (input.length <= maxLen) {
    return input;
  }
  // Avoid splitting surrogate pairs.
  let end = Math.max(0, maxLen);
  const code = input.charCodeAt(end - 1);
  if (code >= 0xd800 && code <= 0xdbff) {
    end -= 1;
  }
  return input.slice(0, end);
}

export function normalizeRequiredName(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new Error("cron job name is required");
  }
  const name = raw.trim();
  if (!name) {
    throw new Error("cron job name is required");
  }
  return name;
}

export function normalizeOptionalText(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

function truncateText(input: string, maxLen: number): string {
  if (input.length <= maxLen) {
    return input;
  }
  return `${truncateUtf16Safe(input, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

export function normalizeOptionalAgentId(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

export function inferLegacyName(job: {
  schedule?: Partial<CronJob["schedule"]>;
  payload?: Partial<CronJob["payload"]>;
}): string {
  const payload: any = job?.payload;
  const text =
    payload?.kind === "systemEvent" && typeof payload.text === "string"
      ? payload.text
      : payload?.kind === "agentTurn" && typeof payload.message === "string"
        ? payload.message
        : "";

  const firstLine =
    text
      .split("\n")
      .map((l: string) => l.trim())
      .find(Boolean) ?? "";

  if (firstLine) {
    return truncateText(firstLine, 60);
  }

  const kind = typeof job?.schedule?.kind === "string" ? job.schedule.kind : "";
  if (kind === "cron" && typeof (job as any)?.schedule?.expr === "string") {
    return `Cron: ${truncateText((job as any).schedule.expr, 52)}`;
  }
  if (kind === "every" && typeof (job as any)?.schedule?.everyMs === "number") {
    return `Every: ${(job as any).schedule.everyMs}ms`;
  }
  if (kind === "at") {
    return "One-shot";
  }
  return "Cron job";
}

export function normalizePayloadToSystemText(payload: CronPayload): string {
  if (payload.kind === "systemEvent") {
    return payload.text.trim();
  }
  return payload.message.trim();
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
