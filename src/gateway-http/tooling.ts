import { ToolRegistry } from "../agent/tools/registry.js";
import {
  echoTool,
  createHelpTool,
  createClearSessionTool,
  createMemorySearchTool,
  createMemoryGetTool,
  createListFilesTool,
  createEditFileTool,
} from "../agent/tools/builtin/index.js";
import type { SessionManager } from "../agent/session.js";
import { initializeSkills } from "../skills/index.js";
import { join } from "node:path";

function createNoopSessions(): SessionManager {
  return {
    async get() {
      return {
        key: "gateway:noop" as any,
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        messageCount: 0,
      };
    },
    async append() {},
    async getHistory() {
      return [];
    },
    async clear() {},
    async list() {
      return [];
    },
  };
}

export async function createGatewayToolRegistry(workspacePath: string) {
  const tools = new ToolRegistry();
  const sessions = createNoopSessions();

  tools.register(echoTool);
  tools.register(createHelpTool(tools));
  tools.register(createClearSessionTool(sessions));
  tools.register(createMemorySearchTool(workspacePath));
  tools.register(createMemoryGetTool(workspacePath));
  tools.register(createListFilesTool(workspacePath));
  tools.register(createEditFileTool(workspacePath));

  const skillsDir = join(workspacePath, "skills");
  await initializeSkills(skillsDir, tools);

  return tools;
}
