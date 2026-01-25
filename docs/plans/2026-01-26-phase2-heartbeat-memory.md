# Phase 2: Heartbeat & Memory Tools Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add proactive heartbeat notifications and memory search tools so the bot can self-check and recall past context.

**Architecture:** Cron service schedules heartbeat execution. Notification service sends messages to configured channel. Memory tools search workspace/memory/ files using keyword matching.

**Tech Stack:** croner (cron scheduling), Node.js fs/promises (file operations)

---

## Task 1: Install croner dependency

**Files:**
- Modify: `package.json`

**Step 1: Install croner**

Run:
```bash
npm install croner
```

**Step 2: Verify installation**

Run:
```bash
npm ls croner
```
Expected: Shows croner in dependency tree

**Step 3: Verify build still works**

Run:
```bash
npm run build
```
Expected: Success

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add croner dependency for cron scheduling"
```

---

## Task 2: Notification Service Implementation

**Files:**
- Modify: `src/notifications/service.ts`

**Step 1: Implement notification service**

Replace the interface-only file with full implementation:

```typescript
/**
 * Notification service
 * @see design.md Section 5.7
 */

import { createLogger } from "../utils/logger.js";
import type { ChannelRegistry } from "../channels/registry.js";

const log = createLogger("notifications");

export interface NotificationService {
  notify(message: string, options?: NotifyOptions): Promise<void>;
  notifyChannel(channel: string, message: string): Promise<void>;
}

export interface NotifyOptions {
  priority?: "normal" | "high";
  silent?: boolean;
}

export interface NotificationServiceOptions {
  defaultChannel?: string;
  channels: ChannelRegistry;
}

export function createNotificationService(
  options: NotificationServiceOptions
): NotificationService {
  const { defaultChannel, channels } = options;

  return {
    async notify(message: string, _options?: NotifyOptions): Promise<void> {
      if (!defaultChannel) {
        log.warn("No default notification channel configured");
        return;
      }
      await this.notifyChannel(defaultChannel, message);
    },

    async notifyChannel(target: string, message: string): Promise<void> {
      // Parse channel target: "telegram:123456" or "discord:789012"
      const [channelId, userId] = target.split(":");
      if (!channelId || !userId) {
        log.error(`Invalid notification target: ${target}`);
        return;
      }

      const channel = channels.get(channelId);
      if (!channel) {
        log.error(`Channel not found: ${channelId}`);
        return;
      }

      try {
        await channel.send(userId, { text: message });
        log.info(`Notification sent to ${target}`);
      } catch (err) {
        log.error(`Failed to send notification to ${target}`, err);
      }
    },
  };
}
```

**Step 2: Verify build**

Run:
```bash
npm run build
```
Expected: Success

**Step 3: Commit**

```bash
git add src/notifications/service.ts
git commit -m "feat(notifications): implement notification service"
```

---

## Task 3: Cron Service

**Files:**
- Create: `src/cron/service.ts`

**Step 1: Create cron service**

```typescript
/**
 * Cron service for scheduled tasks
 * @see design.md Section 4.1
 */

import { Cron } from "croner";
import { createLogger } from "../utils/logger.js";

const log = createLogger("cron");

export interface CronJob {
  id: string;
  pattern: string;
  handler: () => Promise<void>;
}

export interface CronService {
  schedule(job: CronJob): void;
  stop(id: string): void;
  stopAll(): void;
}

export function createCronService(): CronService {
  const jobs = new Map<string, Cron>();

  return {
    schedule(job: CronJob): void {
      if (jobs.has(job.id)) {
        log.warn(`Job ${job.id} already exists, replacing...`);
        jobs.get(job.id)?.stop();
      }

      const cronJob = new Cron(job.pattern, async () => {
        log.info(`Running cron job: ${job.id}`);
        try {
          await job.handler();
          log.info(`Cron job ${job.id} completed`);
        } catch (err) {
          log.error(`Cron job ${job.id} failed`, err);
        }
      });

      jobs.set(job.id, cronJob);
      log.info(`Scheduled cron job: ${job.id} (${job.pattern})`);
    },

    stop(id: string): void {
      const job = jobs.get(id);
      if (job) {
        job.stop();
        jobs.delete(id);
        log.info(`Stopped cron job: ${id}`);
      }
    },

    stopAll(): void {
      for (const [id, job] of jobs) {
        job.stop();
        log.info(`Stopped cron job: ${id}`);
      }
      jobs.clear();
    },
  };
}
```

**Step 2: Verify build**

Run:
```bash
npm run build
```
Expected: Success

**Step 3: Commit**

```bash
git add src/cron/service.ts
git commit -m "feat(cron): add cron service with croner"
```

---

## Task 4: Heartbeat Executor

**Files:**
- Create: `src/cron/heartbeat.ts`

**Step 1: Create heartbeat executor**

```typescript
/**
 * Heartbeat execution
 * @see design.md Section 5.7
 */

import { createLogger } from "../utils/logger.js";
import type { NotificationService } from "../notifications/service.js";
import type { WorkspaceFiles } from "../workspace/types.js";
import type { Config } from "../config/schema.js";
import { callWithFailover, type LLMProvider } from "../agent/runner.js";
import { buildSystemPrompt } from "../agent/system-prompt.js";
import type { Message } from "../agent/session.js";

const log = createLogger("heartbeat");

export interface HeartbeatOptions {
  config: Config;
  workspace: WorkspaceFiles;
  notifications: NotificationService;
}

export async function executeHeartbeat(options: HeartbeatOptions): Promise<void> {
  const { config, workspace, notifications } = options;

  log.info("Executing heartbeat...");

  // Build system prompt with heartbeat flag
  const systemPrompt = buildSystemPrompt({
    workspace,
    channel: "heartbeat",
    timezone: "UTC+8",
    model: config.providers[0].model,
    isHeartbeat: true,
  });

  // Build messages
  const messages: Message[] = [
    { role: "system", content: systemPrompt, timestamp: Date.now() },
    {
      role: "user",
      content: "Execute the heartbeat checklist from HEARTBEAT.md. If nothing needs attention, respond with exactly: HEARTBEAT_OK",
      timestamp: Date.now(),
    },
  ];

  // Call LLM
  const providers: LLMProvider[] = config.providers;
  const response = await callWithFailover(providers, messages, {});

  // Check response
  if (response.content.includes("HEARTBEAT_OK")) {
    log.info("Heartbeat OK - nothing to report");
    return;
  }

  // Send notification
  log.info("Heartbeat has something to report");
  await notifications.notify(`🦉 Heartbeat Report:\n\n${response.content}`);
}
```

**Step 2: Update system-prompt.ts to support isHeartbeat**

Modify `src/agent/system-prompt.ts` - add `isHeartbeat` to PromptContext interface and add heartbeat section:

```typescript
// Add to PromptContext interface:
isHeartbeat?: boolean;

// Add at the end of buildSystemPrompt function, before return:
if (ctx.isHeartbeat && workspace.heartbeat) {
  sections.push(`## Heartbeat Task
You are running as a scheduled heartbeat. Read and execute the checklist below.
If nothing needs attention, respond with exactly: HEARTBEAT_OK

${workspace.heartbeat}`);
}
```

**Step 3: Verify build**

Run:
```bash
npm run build
```
Expected: Success

**Step 4: Commit**

```bash
git add src/cron/heartbeat.ts src/agent/system-prompt.ts
git commit -m "feat(heartbeat): add heartbeat executor"
```

---

## Task 5: Wire Cron and Heartbeat into Gateway

**Files:**
- Modify: `src/gateway/server.ts`

**Step 1: Update gateway to initialize cron and heartbeat**

Add imports at top:

```typescript
import { createCronService } from "../cron/service.js";
import { executeHeartbeat } from "../cron/heartbeat.js";
import { createNotificationService } from "../notifications/service.js";
```

Update `startGateway` function - after `channels.startAll()`, add:

```typescript
// Create notification service
const notifications = createNotificationService({
  defaultChannel: config.notifications?.channel,
  channels,
});

// Create cron service
const cron = createCronService();

// Schedule heartbeat if enabled
if (config.heartbeat?.enabled) {
  cron.schedule({
    id: "heartbeat",
    pattern: config.heartbeat.cron,
    handler: async () => {
      await executeHeartbeat({ config, workspace, notifications });
    },
  });
  log.info(`Heartbeat scheduled: ${config.heartbeat.cron}`);
}
```

Update the cleanup function to stop cron:

```typescript
return async () => {
  cron.stopAll();
  await channels.stopAll();
  log.info("Gateway stopped");
};
```

**Step 2: Verify build**

Run:
```bash
npm run build
```
Expected: Success

**Step 3: Commit**

```bash
git add src/gateway/server.ts
git commit -m "feat(gateway): wire cron and heartbeat services"
```

---

## Task 6: Memory Search Tool

**Files:**
- Create: `src/workspace/memory-search.ts`
- Create: `src/agent/tools/builtin/memory-search.ts`

**Step 1: Create memory search utility**

```typescript
/**
 * Memory search - keyword matching
 * @see design.md Section 5.4
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { createLogger } from "../utils/logger.js";

const log = createLogger("memory-search");

export interface MemorySearchResult {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  snippet: string;
}

export interface SearchOptions {
  maxResults?: number;
  paths?: string[];
}

export async function searchMemory(
  workspacePath: string,
  query: string,
  options?: SearchOptions
): Promise<MemorySearchResult[]> {
  const maxResults = options?.maxResults ?? 10;
  const memoryDir = join(workspacePath, "memory");
  const results: MemorySearchResult[] = [];
  const queryLower = query.toLowerCase();

  try {
    const files = await findMarkdownFiles(memoryDir);

    for (const file of files) {
      const content = await readFile(file, "utf-8");
      const lines = content.split("\n");
      const relativePath = relative(workspacePath, file);

      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(queryLower)) {
          const startLine = Math.max(0, i - 2);
          const endLine = Math.min(lines.length - 1, i + 2);

          results.push({
            path: relativePath,
            startLine,
            endLine,
            score: 1.0,
            snippet: lines.slice(startLine, endLine + 1).join("\n"),
          });

          if (results.length >= maxResults) {
            return results;
          }
        }
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      log.debug("Memory directory not found");
      return [];
    }
    throw err;
  }

  return results;
}

async function findMarkdownFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        const subFiles = await findMarkdownFiles(fullPath);
        files.push(...subFiles);
      } else if (entry.name.endsWith(".md")) {
        files.push(fullPath);
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }

  return files;
}
```

**Step 2: Create memory search tool**

```typescript
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
```

**Step 3: Verify build**

Run:
```bash
npm run build
```
Expected: Success

**Step 4: Commit**

```bash
git add src/workspace/memory-search.ts src/agent/tools/builtin/memory-search.ts
git commit -m "feat(tools): add memory_search tool"
```

---

## Task 7: Memory Get Tool

**Files:**
- Create: `src/agent/tools/builtin/memory-get.ts`

**Step 1: Create memory get tool**

```typescript
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
```

**Step 2: Verify build**

Run:
```bash
npm run build
```
Expected: Success

**Step 3: Commit**

```bash
git add src/agent/tools/builtin/memory-get.ts
git commit -m "feat(tools): add memory_get tool"
```

---

## Task 8: Register Memory Tools in Gateway

**Files:**
- Modify: `src/agent/tools/builtin/index.ts`
- Modify: `src/gateway/server.ts`

**Step 1: Export memory tools from index**

Add to `src/agent/tools/builtin/index.ts`:

```typescript
export { createMemorySearchTool } from "./memory-search.js";
export { createMemoryGetTool } from "./memory-get.js";
```

**Step 2: Register memory tools in gateway**

In `src/gateway/server.ts`, add imports:

```typescript
import {
  echoTool,
  createHelpTool,
  createClearSessionTool,
  createMemorySearchTool,
  createMemoryGetTool,
} from "../agent/tools/builtin/index.js";
```

After existing tool registrations, add:

```typescript
tools.register(createMemorySearchTool(config.workspace));
tools.register(createMemoryGetTool(config.workspace));
```

**Step 3: Verify build**

Run:
```bash
npm run build
```
Expected: Success

**Step 4: Commit**

```bash
git add src/agent/tools/builtin/index.ts src/gateway/server.ts
git commit -m "feat(gateway): register memory tools"
```

---

## Task 9: Create Sample Memory Files for Testing

**Files:**
- Create: `workspace/memory/diary/2026-01-25.md`
- Create: `workspace/HEARTBEAT.md`

**Step 1: Create sample diary file**

```markdown
# 2026-01-25 Daily Log

## Morning
- Started working on OwliaBot Phase 2
- Implemented cron service with croner

## Afternoon
- Added memory search functionality
- Keyword matching works well for MVP

## Decisions
- Decided to use simple keyword search for MVP
- Will add semantic search later if needed

## Notes
- Remember to test heartbeat with short cron interval first
- User prefers notifications on Telegram
```

**Step 2: Create sample HEARTBEAT.md**

```markdown
# Heartbeat Checklist

Run this checklist periodically to check on things:

## Check Items

1. **Portfolio Status** - If any significant price changes detected, report them
2. **Pending Tasks** - Check if there are any reminders or tasks due
3. **System Health** - Confirm all systems are operational

## Response Format

If everything is fine, respond with: HEARTBEAT_OK

If something needs attention, describe what needs attention.
```

**Step 3: Commit**

```bash
git add workspace/memory/diary/2026-01-25.md workspace/HEARTBEAT.md
git commit -m "docs: add sample memory and heartbeat files"
```

---

## Summary

After completing all tasks, Phase 2 adds:

1. **Cron Service** - Schedule recurring tasks with cron patterns
2. **Notification Service** - Send proactive messages to configured channel
3. **Heartbeat Executor** - Run periodic checks and report issues
4. **Memory Search Tool** - Search workspace/memory/ using keywords
5. **Memory Get Tool** - Retrieve specific lines from memory files

**To test:**

1. Enable heartbeat in config.yaml:
```yaml
heartbeat:
  enabled: true
  cron: "* * * * *"  # Every minute for testing
```

2. Run the bot and wait for heartbeat execution

3. Test memory tools by asking:
   - "Search my memory for decisions"
   - "What did I work on yesterday?"
