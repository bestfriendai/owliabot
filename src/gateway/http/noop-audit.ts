/**
 * No-op audit logger for lightweight contexts (gateway HTTP server)
 * where file-based audit logging is unnecessary.
 */

import { ulid } from "ulid";
import type { AuditLogger } from "../../audit/logger.js";
import type { PreLogResult } from "../../audit/logger.js";

class NoopAuditLogger {
  async preLog(): Promise<PreLogResult> {
    return { ok: true, id: ulid() };
  }

  async finalize(): Promise<void> {}

  async getEntries(): Promise<[]> {
    return [];
  }
}

export function createNoopAuditLogger(): AuditLogger {
  return new NoopAuditLogger() as unknown as AuditLogger;
}
