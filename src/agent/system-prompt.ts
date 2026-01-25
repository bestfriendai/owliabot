import type { WorkspaceFiles } from "../workspace/types.js";

export interface PromptContext {
  workspace: WorkspaceFiles;
  channel: string;
  timezone: string;
  model: string;
  isHeartbeat?: boolean;
}

export function buildSystemPrompt(ctx: PromptContext): string {
  const sections: string[] = [];

  // 1. Base role
  sections.push("You are a crypto-focused AI assistant running locally.");

  // 2. SOUL.md - Persona
  if (ctx.workspace.soul) {
    sections.push(`## Persona & Boundaries\n${ctx.workspace.soul}`);
  }

  // 3. IDENTITY.md - Identity
  if (ctx.workspace.identity) {
    sections.push(`## Identity\n${ctx.workspace.identity}`);
  }

  // 4. USER.md - User profile
  if (ctx.workspace.user) {
    sections.push(`## User Profile\n${ctx.workspace.user}`);
  }

  // 5. Runtime info
  sections.push(`## Runtime
- Time: ${new Date().toISOString()}
- Timezone: ${ctx.timezone}
- Channel: ${ctx.channel}
- Model: ${ctx.model}
`);

  // 6. Heartbeat mode
  if (ctx.isHeartbeat && ctx.workspace.heartbeat) {
    sections.push(`## Heartbeat
Read the following checklist and execute it:

${ctx.workspace.heartbeat}

If nothing needs attention, reply: HEARTBEAT_OK
`);
  }

  return sections.join("\n\n");
}
