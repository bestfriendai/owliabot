// src/agent/tools/__tests__/policy.test.ts
import { describe, it, expect } from "vitest";
import { filterToolsByPolicy, type ToolPolicy } from "../policy.js";
import type { ToolDefinition } from "../interface.js";

// Helper to create mock tool definitions
function createMockTool(name: string): ToolDefinition {
  return {
    name,
    description: `Mock tool: ${name}`,
    parameters: { type: "object", properties: {} },
    security: { level: "read" },
    execute: async () => ({ success: true }),
  };
}

describe("filterToolsByPolicy", () => {
  const mockTools: ToolDefinition[] = [
    createMockTool("echo"),
    createMockTool("memory_search"),
    createMockTool("memory_get"),
    createMockTool("edit_file"),
    createMockTool("cron"),
    createMockTool("list_files"),
  ];

  describe("no policy", () => {
    it("returns all tools when policy is undefined", () => {
      const result = filterToolsByPolicy(mockTools, undefined);
      expect(result).toEqual(mockTools);
    });

    it("returns all tools when policy is empty object", () => {
      const result = filterToolsByPolicy(mockTools, {});
      expect(result).toEqual(mockTools);
    });

    it("returns all tools when both lists are empty", () => {
      const policy: ToolPolicy = { allowList: [], denyList: [] };
      const result = filterToolsByPolicy(mockTools, policy);
      expect(result).toEqual(mockTools);
    });
  });

  describe("allowList", () => {
    it("filters to only allowed tools", () => {
      const policy: ToolPolicy = { allowList: ["echo", "memory_search"] };
      const result = filterToolsByPolicy(mockTools, policy);

      expect(result.map((t) => t.name)).toEqual(["echo", "memory_search"]);
    });

    it("returns empty array when allowList has no matches", () => {
      const policy: ToolPolicy = { allowList: ["nonexistent"] };
      const result = filterToolsByPolicy(mockTools, policy);

      expect(result).toEqual([]);
    });

    it("ignores denyList when allowList is provided", () => {
      const policy: ToolPolicy = {
        allowList: ["echo", "memory_search", "edit_file"],
        denyList: ["edit_file"], // Should be ignored
      };
      const result = filterToolsByPolicy(mockTools, policy);

      expect(result.map((t) => t.name)).toEqual([
        "echo",
        "memory_search",
        "edit_file",
      ]);
    });

    it("preserves order from original tools array", () => {
      const policy: ToolPolicy = { allowList: ["cron", "echo", "list_files"] };
      const result = filterToolsByPolicy(mockTools, policy);

      // Order should match original array, not allowList order
      expect(result.map((t) => t.name)).toEqual(["echo", "cron", "list_files"]);
    });
  });

  describe("denyList", () => {
    it("removes denied tools", () => {
      const policy: ToolPolicy = { denyList: ["edit_file", "cron"] };
      const result = filterToolsByPolicy(mockTools, policy);

      expect(result.map((t) => t.name)).toEqual([
        "echo",
        "memory_search",
        "memory_get",
        "list_files",
      ]);
    });

    it("returns all tools when denyList has no matches", () => {
      const policy: ToolPolicy = { denyList: ["nonexistent"] };
      const result = filterToolsByPolicy(mockTools, policy);

      expect(result).toEqual(mockTools);
    });

    it("returns empty array when all tools are denied", () => {
      const policy: ToolPolicy = {
        denyList: mockTools.map((t) => t.name),
      };
      const result = filterToolsByPolicy(mockTools, policy);

      expect(result).toEqual([]);
    });
  });

  describe("edge cases", () => {
    it("handles empty tools array", () => {
      const policy: ToolPolicy = { allowList: ["echo"] };
      const result = filterToolsByPolicy([], policy);

      expect(result).toEqual([]);
    });

    it("handles case-sensitive tool names", () => {
      const policy: ToolPolicy = { allowList: ["Echo", "MEMORY_SEARCH"] };
      const result = filterToolsByPolicy(mockTools, policy);

      // Should not match due to case sensitivity
      expect(result).toEqual([]);
    });
  });
});
