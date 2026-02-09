/**
 * Cron service integration for Gateway
 * Wires CronService into the gateway lifecycle with proper deps
 */

import { CronService } from "../cron/service.js";
import type { CronDeps, CronJob } from "../cron/types.js";
import { createLogger } from "../utils/logger.js";
import { join } from "node:path";
import { homedir } from "node:os";
import type { Config } from "../config/schema.js";
import { ensureOwliabotHomeEnv } from "../utils/paths.js";

const log = createLogger("cron");

export interface CronIntegrationDeps {
  config: Config;
  /** Called when a system event is enqueued (for main session jobs) */
  onSystemEvent?: (text: string, opts?: { agentId?: string | null }) => void;
  /** Called to request heartbeat on next tick */
  onHeartbeatRequest?: (reason: string) => void;
  /** Called to run heartbeat immediately (for wakeMode=now) */
  onHeartbeatRun?: (reason: string) => Promise<{ status: "ran" | "skipped" | "error"; reason: string }>;
  /** Called to run isolated agent job */
  onIsolatedJob?: (opts: { job: CronJob; message: string }) => Promise<{
    status: "ok" | "error" | "skipped";
    summary: string;
    error?: string;
    outputText?: string;
  }>;
}

/** Queue of pending system events for main session */
const systemEventQueue: Array<{ text: string; agentId?: string | null }> = [];

/** Flag indicating heartbeat was requested */
let heartbeatRequested = false;
let heartbeatRequestReason = "";

export function getSystemEventQueue(): Array<{ text: string; agentId?: string | null }> {
  return systemEventQueue;
}

export function consumeSystemEvents(): Array<{ text: string; agentId?: string | null }> {
  const events = [...systemEventQueue];
  systemEventQueue.length = 0;
  return events;
}

export function isHeartbeatRequested(): boolean {
  return heartbeatRequested;
}

export function consumeHeartbeatRequest(): { requested: boolean; reason: string } {
  const result = { requested: heartbeatRequested, reason: heartbeatRequestReason };
  heartbeatRequested = false;
  heartbeatRequestReason = "";
  return result;
}

export function createCronIntegration(deps: CronIntegrationDeps): {
  cronService: CronService;
  start: () => Promise<void>;
  stop: () => void;
} {
  const { config } = deps;

  // Resolve store path
  const storePath = config.cron?.store ?? join(ensureOwliabotHomeEnv(), "cron", "jobs.json");

  // Build CronDeps
  const cronDeps: CronDeps = {
    cronEnabled: config.cron?.enabled ?? true,
    storePath,
    log: {
      info: (obj, msg) => log.info(obj, msg),
      warn: (obj, msg) => log.warn(obj, msg),
      error: (obj, msg) => log.error(obj, msg),
    },
    nowMs: () => Date.now(),

    enqueueSystemEvent(text, opts) {
      systemEventQueue.push({ text, agentId: opts?.agentId });
      deps.onSystemEvent?.(text, opts);
    },

    requestHeartbeatNow(opts) {
      heartbeatRequested = true;
      heartbeatRequestReason = opts.reason;
      deps.onHeartbeatRequest?.(opts.reason);
    },

    runHeartbeatOnce: deps.onHeartbeatRun
      ? async (opts) => {
          const result = await deps.onHeartbeatRun!(opts.reason);
          return result;
        }
      : undefined,

    runIsolatedAgentJob: deps.onIsolatedJob
      ? async (opts) => {
          return await deps.onIsolatedJob!(opts);
        }
      : undefined,

    onEvent(evt) {
      log.debug({ event: evt.action, jobId: evt.jobId }, "cron event");
    },
  };

  const cronService = new CronService(cronDeps);

  return {
    cronService,
    async start() {
      await cronService.start();
    },
    stop() {
      cronService.stop();
    },
  };
}
