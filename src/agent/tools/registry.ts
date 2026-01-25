// src/agent/tools/registry.ts
/**
 * Tool registry for managing available tools
 * @see design.md Section 5.2
 */

import { createLogger } from "../../utils/logger.js";
import type { ToolDefinition } from "./interface.js";

const log = createLogger("tools");

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>();

  register(tool: ToolDefinition): void {
    if (this.tools.has(tool.name)) {
      log.warn(`Tool ${tool.name} already registered, overwriting`);
    }
    this.tools.set(tool.name, tool);
    log.debug(`Registered tool: ${tool.name}`);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name);
  }

  getAll(): ToolDefinition[] {
    return Array.from(this.tools.values());
  }

  getReadOnly(): ToolDefinition[] {
    return this.getAll().filter((t) => t.security.level === "read");
  }

  toAnthropicFormat(): AnthropicTool[] {
    return this.getAll().map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }
}

export interface AnthropicTool {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}
