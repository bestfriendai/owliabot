/**
 * Memory search tool
 */

import type { ToolDefinition } from "../interface.js";
import { searchMemory } from "../../../workspace/memory-search.js";

export function createMemorySearchTool(workspacePath: string): ToolDefinition {
  return {
    name: "memory_search",
    description:
      "Search through memory files for relevant context. Use this to recall past conversations, decisions, or stored information.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query (keywords to look for)",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results to return (default: 5)",
        },
      },
      required: ["query"],
    },
    security: {
      level: "read",
    },
    async execute(params) {
      const { query, max_results } = params as {
        query: string;
        max_results?: number;
      };

      const results = await searchMemory(workspacePath, query, {
        maxResults: max_results ?? 5,
      });

      if (results.length === 0) {
        return {
          success: true,
          data: { message: "No results found", results: [] },
        };
      }

      return {
        success: true,
        data: {
          message: `Found ${results.length} result(s)`,
          results: results.map((r) => ({
            path: r.path,
            lines: `${r.startLine + 1}-${r.endLine + 1}`,
            snippet: r.snippet,
          })),
        },
      };
    },
  };
}
