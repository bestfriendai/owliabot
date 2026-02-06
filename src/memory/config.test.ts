import { describe, expect, it } from "vitest";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { resolveMemoryStorePath } from "./config.js";

describe("resolveMemoryStorePath", () => {
  it("resolves {workspace} and {agentId} placeholders", () => {
    const workspacePath = "/tmp/owliabot-workspace";
    const dbPath = resolveMemoryStorePath({
      config: { store: { path: "{workspace}/memory/{agentId}.sqlite" } } as any,
      agentId: "main",
      workspacePath,
    });

    expect(dbPath).toBe(join(workspacePath, "memory", "main.sqlite"));
  });

  it("sanitizes agentId before path interpolation", () => {
    const workspacePath = "/tmp/owliabot-workspace";
    const dbPath = resolveMemoryStorePath({
      config: { store: { path: "{workspace}/memory/{agentId}.sqlite" } } as any,
      agentId: "../john/doe",
      workspacePath,
    });

    expect(dbPath).toBe(join(workspacePath, "memory", "john-doe.sqlite"));
  });

  it("expands tilde-based paths", () => {
    const dbPath = resolveMemoryStorePath({
      config: { store: { path: "~/.owliabot/memory/{agentId}.sqlite" } } as any,
      agentId: "main",
    });

    expect(dbPath).toBe(join(homedir(), ".owliabot", "memory", "main.sqlite"));
  });

  it("falls back to ./workspace when workspacePath is not provided", () => {
    const dbPath = resolveMemoryStorePath({
      config: { store: { path: "{workspace}/memory/{agentId}.sqlite" } } as any,
      agentId: "main",
    });

    expect(dbPath).toBe(resolve("workspace", "memory", "main.sqlite"));
  });
});
