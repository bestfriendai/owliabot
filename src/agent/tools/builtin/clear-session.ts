// src/agent/tools/builtin/clear-session.ts
import type { ToolDefinition } from "../interface.js";
import type { SessionStore } from "../../session-store.js";
import type { SessionTranscriptStore } from "../../session-transcript.js";

export function createClearSessionTool(options: {
  sessionStore: SessionStore;
  transcripts: SessionTranscriptStore;
}): ToolDefinition {
  return {
    name: "clear_session",
    description:
      "Clear the current conversation history. Use when the user wants to start fresh.",
    parameters: {
      type: "object",
      properties: {},
    },
    security: {
      level: "read", // Read because it only affects current session
    },
    async execute(_params, ctx) {
      const { sessionStore, transcripts } = options;

      // v1: clear the current transcript. (Rotation semantics are handled in a later PR.)
      const entry = await sessionStore.getOrCreate(ctx.sessionKey);
      await transcripts.clear(entry.sessionId);

      return {
        success: true,
        data: { message: "Session cleared", sessionId: entry.sessionId },
      };
    },
  };
}
