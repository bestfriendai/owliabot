/**
 * Skill System Type Definitions
 * @see docs/architecture/skills-system.md Section 3
 */

import { z } from "zod";
import type { JsonSchema, ToolResult } from "../agent/tools/interface.js";

// Tool definition in package.json owliabot field
export const skillToolSchema = z.object({
  name: z.string(),
  description: z.string(),
  parameters: z.object({
    type: z.literal("object"),
    properties: z.record(z.any()),
    required: z.array(z.string()).optional(),
  }),
  security: z.object({
    level: z.enum(["read", "write", "sign"]),
  }),
  timeout: z.number().optional(), // ms, default 30000
});

// owliabot field in package.json
export const owliabotConfigSchema = z.object({
  requires: z
    .object({
      env: z.array(z.string()).optional(),
    })
    .optional(),
  tools: z.array(skillToolSchema),
});

// Full package.json schema for skills
export const skillManifestSchema = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string().optional(),
  main: z.string().default("index.js"),
  owliabot: owliabotConfigSchema,
});

export type SkillManifest = z.infer<typeof skillManifestSchema>;
export type SkillToolDef = z.infer<typeof skillToolSchema>;
export type OwliabotConfig = z.infer<typeof owliabotConfigSchema>;

// Context passed to skill tool execution
export interface SkillContext {
  // Environment variables (only those declared in requires.env)
  env: Record<string, string>;

  // Network requests (MVP: native fetch)
  fetch: typeof globalThis.fetch;

  // Call metadata
  meta: {
    skillName: string;
    toolName: string;
    callId: string;
    userId: string;
    channel: string;
  };
}

// Skill module export format
export interface SkillModule {
  tools: Record<
    string,
    (params: unknown, context: SkillContext) => Promise<ToolResult | unknown>
  >;
}

// Loaded skill with manifest and module
export interface LoadedSkill {
  manifest: SkillManifest;
  module: SkillModule;
  path: string;
}
