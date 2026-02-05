/**
 * Tool Policy - Policy-based tool filtering
 *
 * Provides a mechanism to filter available tools based on allow/deny lists.
 * Follows OpenClaw's filterToolsByPolicy pattern.
 *
 * @example
 * ```ts
 * // Allow only specific tools
 * const filtered = filterToolsByPolicy(tools, { allowList: ['echo', 'memory_search'] });
 *
 * // Deny specific tools
 * const filtered = filterToolsByPolicy(tools, { denyList: ['edit_file', 'cron'] });
 * ```
 */

import type { ToolDefinition } from "./interface.js";

/**
 * Tool policy configuration.
 *
 * Rules:
 * - If `allowList` is provided, only tools in the list are allowed (denyList is ignored)
 * - If only `denyList` is provided, all tools except those in the list are allowed
 * - If neither is provided, all tools are allowed
 */
export interface ToolPolicy {
  /** Only allow these tools (takes precedence over denyList) */
  allowList?: string[];
  /** Deny these tools (ignored if allowList is set) */
  denyList?: string[];
}

/**
 * Filter tools based on policy configuration.
 *
 * @param tools - Array of tool definitions to filter
 * @param policy - Optional policy configuration
 * @returns Filtered array of tool definitions
 */
export function filterToolsByPolicy(
  tools: ToolDefinition[],
  policy?: ToolPolicy,
): ToolDefinition[] {
  // No policy = return all tools
  if (!policy) {
    return tools;
  }

  const { allowList, denyList } = policy;

  // No lists configured = return all tools
  if (!allowList?.length && !denyList?.length) {
    return tools;
  }

  // allowList takes precedence
  if (allowList && allowList.length > 0) {
    const allowSet = new Set(allowList);
    return tools.filter((tool) => allowSet.has(tool.name));
  }

  // denyList filtering
  if (denyList && denyList.length > 0) {
    const denySet = new Set(denyList);
    return tools.filter((tool) => !denySet.has(tool.name));
  }

  return tools;
}
