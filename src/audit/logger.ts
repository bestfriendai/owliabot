/**
 * Audit logger with fail-closed strategy
 * @see docs/design/audit-strategy.md Section 9.1
 */

import { appendFile, readFile } from "node:fs/promises";
import { ulid } from "ulid";
import { redactParams } from "./redact.js";
import { createLogger } from "../utils/logger.js";
import { defaultAuditLogPath } from "../utils/paths.js";

const log = createLogger("audit");

export interface AuditEntry {
  id: string;
  ts: string;
  version: number;
  tool: string;
  tier: number | "none";
  effectiveTier: number | "none";
  securityLevel: "read" | "write" | "sign";
  user: string;
  channel: string;
  deviceId?: string;
  params: Record<string, unknown>;
  result:
    | "success"
    | "denied"
    | "timeout"
    | "error"
    | "escalated"
    | "emergency-stopped"
    | "pending";
  reason?: string;
  error?: string;
  amountUsd?: number;
  finalizedAt?: string;
  txHash?: string;
  chainId?: number;
  blockNumber?: number;
  gasUsed?: string;
  sessionKeyId?: string;
  signerTier?: string;
  confirmation?: {
    required: boolean;
    channel: string;
    requestedAt: string;
    respondedAt?: string;
    approved?: boolean;
    latencyMs?: number;
  };
  traceId?: string;
  requestId?: string;
  duration?: number;
}

export interface PreLogResult {
  ok: boolean;
  id: string;
  error?: string;
}

export class AuditLogger {
  private logPath: string;
  private degraded = false;
  private memoryBuffer: string[] = [];
  private readonly maxBufferSize = 1000;

  constructor(logPath = defaultAuditLogPath()) {
    this.logPath = logPath;
  }

  /**
   * Phase 1: Pre-log before execution (fail-closed)
   */
  async preLog(partial: Partial<AuditEntry>): Promise<PreLogResult> {
    const id = ulid();
    const entry: Partial<AuditEntry> = {
      id,
      ts: new Date().toISOString(),
      version: 1,
      result: "pending",
      ...partial,
      params: partial.params ? redactParams(partial.params) : {},
    };

    try {
      await this.writeLine(JSON.stringify(entry));
      return { ok: true, id };
    } catch (err) {
      log.error("Audit pre-log failed", err);
      this.degraded = true;
      return {
        ok: false,
        id,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Phase 2: Finalize after execution
   */
  async finalize(
    id: string,
    result: Exclude<AuditEntry["result"], "pending">,
    reason?: string,
    extra?: Partial<AuditEntry>
  ): Promise<void> {
    const update = {
      _finalize: id,
      ts: new Date().toISOString(),
      result,
      reason,
      ...extra,
    };

    try {
      await this.writeLine(JSON.stringify(update));
    } catch (err) {
      // Finalize failure enters degraded mode but doesn't block returning results
      log.error("Audit finalize failed, entering degraded mode", err);
      this.degraded = true;
      this.bufferLine(JSON.stringify(update));
    }
  }

  isDegraded(): boolean {
    return this.degraded;
  }

  private async writeLine(line: string): Promise<void> {
    // First flush memory buffer if any
    if (this.memoryBuffer.length > 0) {
      const buffered = this.memoryBuffer.splice(0);
      for (const bl of buffered) {
        await appendFile(this.logPath, bl + "\n", "utf-8");
      }
      this.degraded = false;
      log.info("Memory buffer flushed, audit system recovered");
    }

    await appendFile(this.logPath, line + "\n", "utf-8");
  }

  private bufferLine(line: string): void {
    if (this.memoryBuffer.length >= this.maxBufferSize) {
      this.memoryBuffer.shift(); // Drop oldest
      log.warn("Audit buffer full, dropping oldest entry");
    }
    this.memoryBuffer.push(line);
    process.stderr.write(`[AUDIT-DEGRADED] ${line}\n`);
  }

  /**
   * Query recent entries (for anomaly detection).
   * Merges finalize records into their corresponding pre-log entries.
   */
  async queryRecent(limit = 100): Promise<AuditEntry[]> {
    try {
      const content = await readFile(this.logPath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);

      // Two-pass: collect pre-log entries and finalize records, then merge
      const preLogEntries = new Map<string, AuditEntry>();
      const finalizeRecords = new Map<string, Record<string, unknown>>();
      const insertionOrder: string[] = [];

      // Take last N lines (use 2x limit to account for finalize records)
      const recentLines = lines.slice(-(limit * 2));
      for (const line of recentLines) {
        try {
          const parsed = JSON.parse(line);
          if ("_finalize" in parsed) {
            finalizeRecords.set(parsed._finalize as string, parsed);
          } else if (parsed.id) {
            preLogEntries.set(parsed.id, parsed as AuditEntry);
            insertionOrder.push(parsed.id);
          }
        } catch (parseErr) {
          log.warn("Failed to parse audit line", parseErr);
        }
      }

      // Merge finalize data into pre-log entries
      for (const [id, finalize] of finalizeRecords) {
        const entry = preLogEntries.get(id);
        if (entry) {
          if (finalize.result) entry.result = finalize.result as AuditEntry["result"];
          if (finalize.reason) entry.reason = finalize.reason as string;
          if (finalize.duration !== undefined) entry.duration = finalize.duration as number;
          if (finalize.txHash) entry.txHash = finalize.txHash as string;
          if (finalize.finalizedAt) entry.finalizedAt = finalize.finalizedAt as string;
        }
      }

      // Return entries in insertion order, capped at limit
      const entries: AuditEntry[] = [];
      for (const id of insertionOrder) {
        const entry = preLogEntries.get(id);
        if (entry) entries.push(entry);
      }
      return entries.slice(-limit);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
  }
}
