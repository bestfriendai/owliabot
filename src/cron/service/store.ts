import { migrateLegacyCronPayload } from "../payload-migration.js";
import { loadCronStore, saveCronStore } from "../store.js";
import type { CronServiceState } from "./state.js";
import { inferLegacyName, normalizeOptionalText, isRecord } from "./normalize.js";

export async function ensureLoaded(state: CronServiceState): Promise<void> {
  if (state.store) {
    return;
  }

  const loaded = await loadCronStore(state.deps.storePath);
  const jobs = loaded.jobs ?? [];

  let mutated = false;
  for (const raw of jobs as any[]) {
    const nameRaw = raw?.name;
    if (typeof nameRaw !== "string" || nameRaw.trim().length === 0) {
      raw.name = inferLegacyName({ schedule: raw.schedule, payload: raw.payload });
      mutated = true;
    } else {
      raw.name = nameRaw.trim();
    }

    const desc = normalizeOptionalText(raw.description);
    if (raw.description !== desc) {
      raw.description = desc;
      mutated = true;
    }

    const payload = raw.payload;
    if (isRecord(payload)) {
      if (migrateLegacyCronPayload(payload)) {
        mutated = true;
      }
    }
  }

  state.store = { version: 1, jobs: jobs as any };

  if (mutated) {
    await persist(state);
  }
}

export function warnIfDisabled(state: CronServiceState, action: string): void {
  if (state.deps.cronEnabled) {
    return;
  }
  if (state.warnedDisabled) {
    return;
  }
  state.warnedDisabled = true;
  state.deps.log.warn(
    { enabled: false, action, storePath: state.deps.storePath },
    "cron: scheduler disabled; jobs will not run automatically",
  );
}

export async function persist(state: CronServiceState): Promise<void> {
  if (!state.store) {
    return;
  }
  await saveCronStore(state.deps.storePath, state.store);
}
