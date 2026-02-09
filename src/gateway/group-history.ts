// src/gateway/group-history.ts
/**
 * In-memory per-group rolling buffer used to provide context for mention-gated
 * group chats (Telegram/Discord).
 */

export type GroupHistoryEntry = {
  sender: string;
  body: string;
  timestamp: number;
  messageId?: string;
};

export class GroupHistoryBuffer {
  private buffers: Map<string, GroupHistoryEntry[]>;
  private limit: number;

  constructor(limit = 50) {
    this.buffers = new Map();
    this.limit = Math.max(0, Math.floor(limit));
  }

  record(groupKey: string, entry: GroupHistoryEntry): void {
    if (!groupKey) return;
    if (this.limit === 0) return;

    const list = this.buffers.get(groupKey) ?? [];
    list.push(entry);

    // Enforce limit by dropping oldest.
    if (list.length > this.limit) {
      list.splice(0, list.length - this.limit);
    }

    this.buffers.set(groupKey, list);
  }

  getHistory(groupKey: string): GroupHistoryEntry[] {
    const list = this.buffers.get(groupKey) ?? [];
    // Return a shallow copy so callers can't mutate internal storage.
    return list.slice();
  }

  clear(groupKey: string): void {
    this.buffers.delete(groupKey);
  }
}

