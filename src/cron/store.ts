import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import JSON5 from "json5";

import type { CronStore } from "./types.js";

export const DEFAULT_CRON_DIR = path.join(os.homedir(), ".owliabot", "cron");
export const DEFAULT_CRON_STORE_PATH = path.join(DEFAULT_CRON_DIR, "jobs.json");

/** In-process cache, shared across CronService instances. */
const storeCache = new Map<string, CronStore>();

export function resolveCronStorePath(storePath?: string): string {
  if (storePath?.trim()) {
    const raw = storePath.trim();
    if (raw.startsWith("~")) {
      return path.resolve(raw.replace("~", os.homedir()));
    }
    return path.resolve(raw);
  }
  return DEFAULT_CRON_STORE_PATH;
}

export function getCachedCronStore(storePath: string): CronStore | undefined {
  return storeCache.get(path.resolve(storePath));
}

export function setCachedCronStore(storePath: string, store: CronStore | null): void {
  const resolved = path.resolve(storePath);
  if (!store) {
    storeCache.delete(resolved);
    return;
  }
  storeCache.set(resolved, store);
}

export async function loadCronStore(storePath: string): Promise<CronStore> {
  const resolved = path.resolve(storePath);
  const cached = storeCache.get(resolved);
  if (cached) {
    return cached;
  }

  try {
    const raw = await fs.promises.readFile(resolved, "utf-8");
    const parsed = JSON5.parse(raw);
    const jobs = Array.isArray(parsed?.jobs) ? (parsed.jobs as unknown[]) : [];
    const store: CronStore = {
      version: 1,
      jobs: jobs.filter(Boolean) as any,
    };
    storeCache.set(resolved, store);
    return store;
  } catch {
    const store: CronStore = { version: 1, jobs: [] };
    storeCache.set(resolved, store);
    return store;
  }
}

export async function saveCronStore(storePath: string, store: CronStore): Promise<void> {
  const resolved = path.resolve(storePath);
  await fs.promises.mkdir(path.dirname(resolved), { recursive: true });

  const tmp = `${resolved}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`;
  const json = JSON.stringify(store, null, 2);

  await fs.promises.writeFile(tmp, json, "utf-8");
  await fs.promises.rename(tmp, resolved);

  // best-effort backup
  try {
    await fs.promises.copyFile(resolved, `${resolved}.bak`);
  } catch {
    // ignore
  }

  storeCache.set(resolved, store);
}
