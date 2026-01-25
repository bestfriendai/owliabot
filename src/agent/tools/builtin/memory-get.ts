/**
 * Memory get tool - retrieve specific lines from a file
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { ToolDefinition } from "../interface.js";

export function createMemoryGetTool(workspacePath: string): ToolDefinition {
  return {
    name: "memory_get",
    description:
      "Get specific lines from a memory file. Use this after memory_search to read more context.",
    parameters: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "The file path relative to workspace (e.g., 'memory/diary/2026-01-25.md')",
        },
        from_line: {
          type: "number",
          description: "Starting line number (1-indexed, default: 1)",
        },
        num_lines: {
          type: "number",
          description: "Number of lines to read (default: 20)",
        },
      },
      required: ["path"],
    },
    security: {
      level: "read",
    },
    async execute(params) {
      const { path, from_line, num_lines } = params as {
        path: string;
        from_line?: number;
        num_lines?: number;
      };

      // Security: ensure path is within workspace
      if (path.includes("..") || path.startsWith("/")) {
        return {
          success: false,
          error: "Invalid path: must be relative to workspace",
        };
      }

      const fullPath = join(workspacePath, path);
      const startLine = (from_line ?? 1) - 1; // Convert to 0-indexed
      const lineCount = num_lines ?? 20;

      try {
        const content = await readFile(fullPath, "utf-8");
        const lines = content.split("\n");
        const endLine = Math.min(startLine + lineCount, lines.length);
        const selectedLines = lines.slice(startLine, endLine);

        return {
          success: true,
          data: {
            path,
            from_line: startLine + 1,
            to_line: endLine,
            total_lines: lines.length,
            content: selectedLines.join("\n"),
          },
        };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
          return {
            success: false,
            error: `File not found: ${path}`,
          };
        }
        throw err;
      }
    },
  };
}
