/**
 * Builtin tools factory
 *
 * Creates all builtin tools with a unified options interface.
 * Matches OpenClaw's factory pattern for consistency.
 *
 * Special cases (registered separately):
 * - helpTool: Needs ToolRegistry reference, registered last
 * - cronTool: Needs CronService which is created after initial setup
 */

import type { ToolDefinition } from "../interface.js";
import type { SessionStore } from "../../session-store.js";
import type { SessionTranscriptStore } from "../../session-transcript.js";
import type { SystemCapabilityConfig } from "../../../system/interface.js";
import { filterToolsByPolicy, type ToolPolicy } from "../policy.js";

// Core tools
import { echoTool } from "./echo.js";

// Session tools
import { createClearSessionTool } from "./clear-session.js";

// Memory tools
import { createMemorySearchTool } from "./memory-search.js";
import { createMemoryGetTool } from "./memory-get.js";

// FS read tools
import { createListFilesTool } from "./list-files.js";
import { createReadFileTool } from "./read-file.js";

// FS write tools (gated by allowWrite)
import { createEditFileTool } from "./edit-file.js";
import { createWriteFileTool } from "./write-file.js";
import { createApplyPatchTool } from "./apply-patch.js";

// System tools (require capability config)
import { createExecTool, type ExecToolDeps } from "./exec.js";
import { createWebFetchTool, type WebFetchToolDeps } from "./web-fetch.js";
import { createWebSearchTool, type WebSearchToolDeps } from "./web-search.js";

/**
 * Options for creating builtin tools
 */
export interface BuiltinToolsOptions {
  /** Workspace directory path */
  workspace: string;

  /** Session store for clear_session tool */
  sessionStore: SessionStore;

  /** Transcript store for clear_session tool */
  transcripts: SessionTranscriptStore;

  /** Tool configuration */
  tools?: {
    /** Enable write tools (edit_file, write_file, apply_patch). Default: false */
    allowWrite?: boolean;
    /** Policy for filtering tools */
    policy?: ToolPolicy;
  };

  /**
   * System capability configuration for exec/web tools.
   * If not provided, exec and web tools will not be created.
   */
  system?: SystemCapabilityConfig;

  /**
   * Optional fetch implementation for web tools.
   * Defaults to global fetch.
   */
  fetchImpl?: typeof fetch;
}

/**
 * Create all builtin tools (except help and cron).
 *
 * Tools are organized by category:
 * - **Core tools** (always available): echo
 * - **Session tools**: clear_session
 * - **Memory tools**: memory_search, memory_get
 * - **FS read tools**: list_files, read_file
 * - **FS write tools** (gated by allowWrite): edit_file, write_file, apply_patch
 * - **System tools** (require system config): exec, web_fetch, web_search
 *
 * Usage:
 * ```ts
 * const tools = new ToolRegistry();
 * for (const tool of createBuiltinTools(opts)) {
 *   tools.register(tool);
 * }
 * tools.register(createHelpTool(tools));  // Last - needs registry
 * // ... after cron setup ...
 * tools.register(createCronTool({ cronService }));
 * ```
 *
 * @param opts - Options containing workspace path, stores, and config
 * @returns Array of tool definitions
 */
export function createBuiltinTools(
  opts: BuiltinToolsOptions,
): ToolDefinition[] {
  const {
    workspace,
    sessionStore,
    transcripts,
    tools: toolsConfig,
    system,
    fetchImpl,
  } = opts;

  const allowWrite = toolsConfig?.allowWrite ?? false;

  const builtins: (ToolDefinition | null)[] = [
    // ─────────────────────────────────────────────────────────────────────────
    // Core tools (always available)
    // ─────────────────────────────────────────────────────────────────────────
    echoTool,

    // ─────────────────────────────────────────────────────────────────────────
    // Session tools
    // ─────────────────────────────────────────────────────────────────────────
    createClearSessionTool({ sessionStore, transcripts }),

    // ─────────────────────────────────────────────────────────────────────────
    // Memory tools
    // ─────────────────────────────────────────────────────────────────────────
    createMemorySearchTool({ workspace }),
    createMemoryGetTool({ workspace }),

    // ─────────────────────────────────────────────────────────────────────────
    // FS read tools (always available)
    // ─────────────────────────────────────────────────────────────────────────
    createListFilesTool({ workspace }),
    createReadFileTool(workspace),

    // ─────────────────────────────────────────────────────────────────────────
    // FS write tools (gated by allowWrite)
    // ─────────────────────────────────────────────────────────────────────────
    allowWrite ? createEditFileTool({ workspace }) : null,
    allowWrite ? createWriteFileTool(workspace) : null,
    allowWrite ? createApplyPatchTool(workspace) : null,

    // ─────────────────────────────────────────────────────────────────────────
    // System tools (require capability config)
    // ─────────────────────────────────────────────────────────────────────────
    system?.exec
      ? createExecTool({
          workspacePath: workspace,
          config: system.exec,
        })
      : null,

    system?.web
      ? createWebFetchTool({
          config: system.web,
          fetchImpl,
        })
      : null,

    // web_search needs the full SystemCapabilityConfig (for API keys, etc.)
    // Gate on webSearch or web config to avoid unintentionally exposing search
    // when only exec is configured
    system?.webSearch || system?.web
      ? createWebSearchTool({
          config: system,
          fetchImpl,
        })
      : null,
  ];

  // Filter out null entries (disabled tools)
  const tools = builtins.filter((t): t is ToolDefinition => t !== null);

  // Apply policy filtering
  return filterToolsByPolicy(tools, toolsConfig?.policy);
}

// Re-export tool deps types for consumers
export type { ExecToolDeps, WebFetchToolDeps, WebSearchToolDeps };
