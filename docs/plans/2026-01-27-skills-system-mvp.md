# Skills System MVP Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the Skills System MVP that allows loading external JavaScript modules as tools, with context injection for fetch/env capabilities.

**Architecture:** Skills are JavaScript modules in `workspace/skills/` directory. Each skill has a `package.json` with `owliabot` field for metadata, and an `index.js` exporting a `tools` object. Skills receive a `context` object providing `fetch`, `env`, and `meta` capabilities. Skill tools are registered with namespace prefix (`skill-name:tool-name`).

**Tech Stack:** Node.js dynamic import, Zod for validation, native fetch, Vitest for testing

---

## Task 1: Define Skill Types

**Files:**
- Create: `src/skills/types.ts`
- Test: `src/skills/__tests__/types.test.ts`

**Step 1: Write the failing test**

```typescript
// src/skills/__tests__/types.test.ts
import { describe, it, expect } from "vitest";
import { skillManifestSchema } from "../types.js";

describe("skillManifestSchema", () => {
  it("should validate a valid manifest", () => {
    const manifest = {
      name: "crypto-price",
      version: "0.1.0",
      main: "index.js",
      owliabot: {
        tools: [
          {
            name: "get_price",
            description: "Get crypto price",
            parameters: {
              type: "object",
              properties: {
                coin: { type: "string", description: "Coin ID" },
              },
              required: ["coin"],
            },
            security: { level: "read" },
          },
        ],
      },
    };

    const result = skillManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });

  it("should reject manifest without owliabot field", () => {
    const manifest = {
      name: "crypto-price",
      version: "0.1.0",
    };

    const result = skillManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
  });

  it("should accept optional requires.env", () => {
    const manifest = {
      name: "crypto-balance",
      version: "0.1.0",
      owliabot: {
        requires: {
          env: ["ALCHEMY_API_KEY"],
        },
        tools: [],
      },
    };

    const result = skillManifestSchema.safeParse(manifest);
    expect(result.success).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/skills/__tests__/types.test.ts`
Expected: FAIL with "Cannot find module '../types.js'"

**Step 3: Write minimal implementation**

```typescript
// src/skills/types.ts
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
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/skills/__tests__/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/skills/types.ts src/skills/__tests__/types.test.ts
git commit -m "feat(skills): add skill type definitions and manifest schema"
```

---

## Task 2: Build Skill Context Factory

**Files:**
- Create: `src/skills/context.ts`
- Test: `src/skills/__tests__/context.test.ts`

**Step 1: Write the failing test**

```typescript
// src/skills/__tests__/context.test.ts
import { describe, it, expect, vi } from "vitest";
import { createSkillContext } from "../context.js";

describe("createSkillContext", () => {
  it("should create context with filtered env vars", () => {
    // Set test env vars
    process.env.ALCHEMY_API_KEY = "test-key";
    process.env.SECRET_TOKEN = "should-not-be-included";

    const context = createSkillContext({
      skillName: "crypto-balance",
      toolName: "get_balance",
      callId: "call-123",
      userId: "user-456",
      channel: "telegram",
      requiredEnv: ["ALCHEMY_API_KEY"],
    });

    expect(context.env.ALCHEMY_API_KEY).toBe("test-key");
    expect(context.env.SECRET_TOKEN).toBeUndefined();
  });

  it("should provide native fetch", () => {
    const context = createSkillContext({
      skillName: "test",
      toolName: "test",
      callId: "1",
      userId: "1",
      channel: "test",
      requiredEnv: [],
    });

    expect(context.fetch).toBe(globalThis.fetch);
  });

  it("should include correct meta info", () => {
    const context = createSkillContext({
      skillName: "crypto-price",
      toolName: "get_price",
      callId: "call-789",
      userId: "user-abc",
      channel: "discord",
      requiredEnv: [],
    });

    expect(context.meta).toEqual({
      skillName: "crypto-price",
      toolName: "get_price",
      callId: "call-789",
      userId: "user-abc",
      channel: "discord",
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/skills/__tests__/context.test.ts`
Expected: FAIL with "Cannot find module '../context.js'"

**Step 3: Write minimal implementation**

```typescript
// src/skills/context.ts
/**
 * Skill Context Factory
 * @see docs/architecture/skills-system.md Section 3.4
 *
 * MVP: Context uses native capabilities directly.
 * Future: Can be swapped to RPC proxy for containerized mode.
 */

import type { SkillContext } from "./types.js";

export interface CreateContextOptions {
  skillName: string;
  toolName: string;
  callId: string;
  userId: string;
  channel: string;
  requiredEnv: string[];
}

export function createSkillContext(options: CreateContextOptions): SkillContext {
  const { skillName, toolName, callId, userId, channel, requiredEnv } = options;

  // Filter env vars to only those declared in requires.env
  const env: Record<string, string> = {};
  for (const key of requiredEnv) {
    const value = process.env[key];
    if (value !== undefined) {
      env[key] = value;
    }
  }

  return {
    env,
    fetch: globalThis.fetch,
    meta: {
      skillName,
      toolName,
      callId,
      userId,
      channel,
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/skills/__tests__/context.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/skills/context.ts src/skills/__tests__/context.test.ts
git commit -m "feat(skills): add context factory with env filtering"
```

---

## Task 3: Implement Skill Loader - Directory Scanning

**Files:**
- Create: `src/skills/loader.ts`
- Test: `src/skills/__tests__/loader.test.ts`

**Step 1: Write the failing test**

```typescript
// src/skills/__tests__/loader.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { scanSkillsDirectory } from "../loader.js";

const TEST_SKILLS_DIR = join(process.cwd(), "test-skills-tmp");

describe("scanSkillsDirectory", () => {
  beforeEach(async () => {
    await mkdir(TEST_SKILLS_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_SKILLS_DIR, { recursive: true, force: true });
  });

  it("should find skill directories with package.json", async () => {
    // Create test skill directory
    const skillDir = join(TEST_SKILLS_DIR, "test-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "package.json"),
      JSON.stringify({
        name: "test-skill",
        version: "0.1.0",
        owliabot: { tools: [] },
      })
    );

    const skills = await scanSkillsDirectory(TEST_SKILLS_DIR);

    expect(skills).toHaveLength(1);
    expect(skills[0]).toBe(skillDir);
  });

  it("should skip directories without package.json", async () => {
    const skillDir = join(TEST_SKILLS_DIR, "invalid-skill");
    await mkdir(skillDir);
    // No package.json

    const skills = await scanSkillsDirectory(TEST_SKILLS_DIR);

    expect(skills).toHaveLength(0);
  });

  it("should return empty array if directory does not exist", async () => {
    const skills = await scanSkillsDirectory("/nonexistent/path");

    expect(skills).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/skills/__tests__/loader.test.ts`
Expected: FAIL with "Cannot find module '../loader.js'"

**Step 3: Write minimal implementation**

```typescript
// src/skills/loader.ts
/**
 * Skill Loader
 * @see docs/architecture/skills-system.md Section 4
 */

import { readdir, readFile, access } from "node:fs/promises";
import { join } from "node:path";
import { createLogger } from "../utils/logger.js";

const log = createLogger("skills");

/**
 * Scan a directory for skill subdirectories (those containing package.json)
 */
export async function scanSkillsDirectory(skillsDir: string): Promise<string[]> {
  try {
    await access(skillsDir);
  } catch {
    log.warn(`Skills directory does not exist: ${skillsDir}`);
    return [];
  }

  const entries = await readdir(skillsDir, { withFileTypes: true });
  const skillPaths: string[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const skillPath = join(skillsDir, entry.name);
    const packagePath = join(skillPath, "package.json");

    try {
      await access(packagePath);
      skillPaths.push(skillPath);
    } catch {
      // No package.json, skip
      log.debug(`Skipping ${entry.name}: no package.json`);
    }
  }

  return skillPaths;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/skills/__tests__/loader.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/skills/loader.ts src/skills/__tests__/loader.test.ts
git commit -m "feat(skills): add directory scanning for skills"
```

---

## Task 4: Implement Skill Loader - Manifest Parsing

**Files:**
- Modify: `src/skills/loader.ts`
- Modify: `src/skills/__tests__/loader.test.ts`

**Step 1: Write the failing test**

Add to `src/skills/__tests__/loader.test.ts`:

```typescript
import { scanSkillsDirectory, parseSkillManifest } from "../loader.js";

describe("parseSkillManifest", () => {
  beforeEach(async () => {
    await mkdir(TEST_SKILLS_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_SKILLS_DIR, { recursive: true, force: true });
  });

  it("should parse valid package.json with owliabot field", async () => {
    const skillDir = join(TEST_SKILLS_DIR, "valid-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "package.json"),
      JSON.stringify({
        name: "valid-skill",
        version: "1.0.0",
        description: "A test skill",
        main: "index.js",
        owliabot: {
          requires: { env: ["API_KEY"] },
          tools: [
            {
              name: "test_tool",
              description: "Test tool",
              parameters: {
                type: "object",
                properties: { input: { type: "string" } },
                required: ["input"],
              },
              security: { level: "read" },
            },
          ],
        },
      })
    );

    const manifest = await parseSkillManifest(skillDir);

    expect(manifest.name).toBe("valid-skill");
    expect(manifest.owliabot.tools).toHaveLength(1);
    expect(manifest.owliabot.requires?.env).toEqual(["API_KEY"]);
  });

  it("should throw on invalid manifest", async () => {
    const skillDir = join(TEST_SKILLS_DIR, "invalid-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "package.json"),
      JSON.stringify({
        name: "invalid-skill",
        // Missing owliabot field
      })
    );

    await expect(parseSkillManifest(skillDir)).rejects.toThrow();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/skills/__tests__/loader.test.ts`
Expected: FAIL with "parseSkillManifest is not defined"

**Step 3: Write minimal implementation**

Add to `src/skills/loader.ts`:

```typescript
import { skillManifestSchema, type SkillManifest } from "./types.js";

/**
 * Parse and validate a skill's package.json
 */
export async function parseSkillManifest(skillPath: string): Promise<SkillManifest> {
  const packagePath = join(skillPath, "package.json");
  const content = await readFile(packagePath, "utf-8");
  const json = JSON.parse(content);

  const result = skillManifestSchema.safeParse(json);
  if (!result.success) {
    const errors = result.error.format();
    throw new Error(`Invalid skill manifest at ${packagePath}: ${JSON.stringify(errors)}`);
  }

  return result.data;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/skills/__tests__/loader.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/skills/loader.ts src/skills/__tests__/loader.test.ts
git commit -m "feat(skills): add manifest parsing with Zod validation"
```

---

## Task 5: Implement Skill Loader - Dynamic Import

**Files:**
- Modify: `src/skills/loader.ts`
- Modify: `src/skills/__tests__/loader.test.ts`

**Step 1: Write the failing test**

Add to `src/skills/__tests__/loader.test.ts`:

```typescript
import { scanSkillsDirectory, parseSkillManifest, loadSkillModule } from "../loader.js";

describe("loadSkillModule", () => {
  beforeEach(async () => {
    await mkdir(TEST_SKILLS_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_SKILLS_DIR, { recursive: true, force: true });
  });

  it("should load skill module with tools export", async () => {
    const skillDir = join(TEST_SKILLS_DIR, "loadable-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "package.json"),
      JSON.stringify({
        name: "loadable-skill",
        version: "0.1.0",
        main: "index.js",
        owliabot: { tools: [] },
      })
    );
    await writeFile(
      join(skillDir, "index.js"),
      `export const tools = {
        test_tool: async (params, context) => {
          return { success: true, data: { input: params.input } };
        }
      };`
    );

    const module = await loadSkillModule(skillDir, "index.js");

    expect(module.tools).toBeDefined();
    expect(typeof module.tools.test_tool).toBe("function");
  });

  it("should throw if module has no tools export", async () => {
    const skillDir = join(TEST_SKILLS_DIR, "no-tools-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "package.json"),
      JSON.stringify({
        name: "no-tools-skill",
        version: "0.1.0",
        owliabot: { tools: [] },
      })
    );
    await writeFile(join(skillDir, "index.js"), `export const foo = "bar";`);

    await expect(loadSkillModule(skillDir, "index.js")).rejects.toThrow(
      "must export a 'tools' object"
    );
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/skills/__tests__/loader.test.ts`
Expected: FAIL with "loadSkillModule is not defined"

**Step 3: Write minimal implementation**

Add to `src/skills/loader.ts`:

```typescript
import { pathToFileURL } from "node:url";
import type { SkillModule } from "./types.js";

/**
 * Dynamically import a skill module
 * Uses cache buster to support hot reload
 */
export async function loadSkillModule(
  skillPath: string,
  mainFile: string
): Promise<SkillModule> {
  const modulePath = join(skillPath, mainFile);
  const moduleUrl = pathToFileURL(modulePath).href;

  // Add cache buster for hot reload support
  const cacheBuster = Date.now();
  const urlWithBuster = `${moduleUrl}?v=${cacheBuster}`;

  const module = await import(urlWithBuster);

  if (!module.tools || typeof module.tools !== "object") {
    throw new Error(`Skill module at ${modulePath} must export a 'tools' object`);
  }

  return { tools: module.tools };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/skills/__tests__/loader.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/skills/loader.ts src/skills/__tests__/loader.test.ts
git commit -m "feat(skills): add dynamic import with cache buster"
```

---

## Task 6: Implement Full Skill Loader

**Files:**
- Modify: `src/skills/loader.ts`
- Modify: `src/skills/__tests__/loader.test.ts`

**Step 1: Write the failing test**

Add to `src/skills/__tests__/loader.test.ts`:

```typescript
import {
  scanSkillsDirectory,
  parseSkillManifest,
  loadSkillModule,
  loadSkills,
} from "../loader.js";

describe("loadSkills", () => {
  beforeEach(async () => {
    await mkdir(TEST_SKILLS_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_SKILLS_DIR, { recursive: true, force: true });
  });

  it("should load all valid skills from directory", async () => {
    // Create skill 1
    const skill1Dir = join(TEST_SKILLS_DIR, "skill-one");
    await mkdir(skill1Dir);
    await writeFile(
      join(skill1Dir, "package.json"),
      JSON.stringify({
        name: "skill-one",
        version: "0.1.0",
        owliabot: {
          tools: [
            {
              name: "tool_a",
              description: "Tool A",
              parameters: { type: "object", properties: {} },
              security: { level: "read" },
            },
          ],
        },
      })
    );
    await writeFile(
      join(skill1Dir, "index.js"),
      `export const tools = { tool_a: async () => ({ success: true }) };`
    );

    // Create skill 2
    const skill2Dir = join(TEST_SKILLS_DIR, "skill-two");
    await mkdir(skill2Dir);
    await writeFile(
      join(skill2Dir, "package.json"),
      JSON.stringify({
        name: "skill-two",
        version: "0.1.0",
        owliabot: {
          tools: [
            {
              name: "tool_b",
              description: "Tool B",
              parameters: { type: "object", properties: {} },
              security: { level: "read" },
            },
          ],
        },
      })
    );
    await writeFile(
      join(skill2Dir, "index.js"),
      `export const tools = { tool_b: async () => ({ success: true }) };`
    );

    const result = await loadSkills(TEST_SKILLS_DIR);

    expect(result.loaded).toHaveLength(2);
    expect(result.failed).toHaveLength(0);
    expect(result.loaded.map((s) => s.manifest.name).sort()).toEqual([
      "skill-one",
      "skill-two",
    ]);
  });

  it("should report failed skills without crashing", async () => {
    // Create valid skill
    const validDir = join(TEST_SKILLS_DIR, "valid");
    await mkdir(validDir);
    await writeFile(
      join(validDir, "package.json"),
      JSON.stringify({
        name: "valid",
        version: "0.1.0",
        owliabot: { tools: [] },
      })
    );
    await writeFile(join(validDir, "index.js"), `export const tools = {};`);

    // Create invalid skill (bad manifest)
    const invalidDir = join(TEST_SKILLS_DIR, "invalid");
    await mkdir(invalidDir);
    await writeFile(
      join(invalidDir, "package.json"),
      JSON.stringify({ name: "invalid" }) // Missing owliabot
    );

    const result = await loadSkills(TEST_SKILLS_DIR);

    expect(result.loaded).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].name).toBe("invalid");
    expect(result.failed[0].error).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/skills/__tests__/loader.test.ts`
Expected: FAIL with "loadSkills is not defined"

**Step 3: Write minimal implementation**

Add to `src/skills/loader.ts`:

```typescript
import type { LoadedSkill } from "./types.js";

export interface LoadSkillsResult {
  loaded: LoadedSkill[];
  failed: Array<{ name: string; error: string }>;
}

/**
 * Load all skills from a directory
 */
export async function loadSkills(skillsDir: string): Promise<LoadSkillsResult> {
  const result: LoadSkillsResult = {
    loaded: [],
    failed: [],
  };

  const skillPaths = await scanSkillsDirectory(skillsDir);

  for (const skillPath of skillPaths) {
    const skillName = skillPath.split("/").pop() || "unknown";

    try {
      const manifest = await parseSkillManifest(skillPath);
      const module = await loadSkillModule(skillPath, manifest.main);

      result.loaded.push({
        manifest,
        module,
        path: skillPath,
      });

      log.info(`Loaded skill: ${manifest.name}`);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      result.failed.push({ name: skillName, error });
      log.error(`Failed to load skill ${skillName}: ${error}`);
    }
  }

  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/skills/__tests__/loader.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/skills/loader.ts src/skills/__tests__/loader.test.ts
git commit -m "feat(skills): add full skill loader with error handling"
```

---

## Task 7: Create Skill-to-Tool Converter

**Files:**
- Create: `src/skills/registry.ts`
- Test: `src/skills/__tests__/registry.test.ts`

**Step 1: Write the failing test**

```typescript
// src/skills/__tests__/registry.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { skillToToolDefinitions } from "../registry.js";
import type { LoadedSkill } from "../types.js";

describe("skillToToolDefinitions", () => {
  it("should convert skill to tool definitions with namespace", () => {
    const skill: LoadedSkill = {
      manifest: {
        name: "crypto-price",
        version: "0.1.0",
        main: "index.js",
        owliabot: {
          tools: [
            {
              name: "get_price",
              description: "Get crypto price",
              parameters: {
                type: "object",
                properties: {
                  coin: { type: "string", description: "Coin ID" },
                },
                required: ["coin"],
              },
              security: { level: "read" },
            },
          ],
        },
      },
      module: {
        tools: {
          get_price: async (params) => ({
            success: true,
            data: { price: 100 },
          }),
        },
      },
      path: "/skills/crypto-price",
    };

    const tools = skillToToolDefinitions(skill);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("crypto-price:get_price");
    expect(tools[0].description).toBe("Get crypto price");
    expect(tools[0].security.level).toBe("read");
  });

  it("should filter tools not defined in manifest", () => {
    const skill: LoadedSkill = {
      manifest: {
        name: "test-skill",
        version: "0.1.0",
        main: "index.js",
        owliabot: {
          tools: [
            {
              name: "declared_tool",
              description: "Declared in manifest",
              parameters: { type: "object", properties: {} },
              security: { level: "read" },
            },
          ],
        },
      },
      module: {
        tools: {
          declared_tool: async () => ({ success: true }),
          undeclared_tool: async () => ({ success: true }), // Not in manifest
        },
      },
      path: "/skills/test-skill",
    };

    const tools = skillToToolDefinitions(skill);

    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("test-skill:declared_tool");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/skills/__tests__/registry.test.ts`
Expected: FAIL with "Cannot find module '../registry.js'"

**Step 3: Write minimal implementation**

```typescript
// src/skills/registry.ts
/**
 * Skill Registry - Convert loaded skills to ToolDefinitions
 * @see docs/architecture/skills-system.md Section 4.4
 */

import { createLogger } from "../utils/logger.js";
import { createSkillContext } from "./context.js";
import type { LoadedSkill, SkillToolDef } from "./types.js";
import type { ToolDefinition, ToolContext, ToolResult } from "../agent/tools/interface.js";

const log = createLogger("skills");

/**
 * Convert a loaded skill to ToolDefinitions for the ToolRegistry
 * Tool names are namespaced: `skill-name:tool-name`
 */
export function skillToToolDefinitions(skill: LoadedSkill): ToolDefinition[] {
  const { manifest, module } = skill;
  const tools: ToolDefinition[] = [];

  for (const toolDef of manifest.owliabot.tools) {
    const toolFn = module.tools[toolDef.name];

    if (!toolFn) {
      log.warn(
        `Tool ${toolDef.name} declared in manifest but not exported by ${manifest.name}`
      );
      continue;
    }

    const fullName = `${manifest.name}:${toolDef.name}`;

    tools.push({
      name: fullName,
      description: toolDef.description,
      parameters: toolDef.parameters,
      security: toolDef.security,
      execute: createToolExecutor(skill, toolDef, toolFn),
    });
  }

  return tools;
}

function createToolExecutor(
  skill: LoadedSkill,
  toolDef: SkillToolDef,
  toolFn: (params: unknown, context: unknown) => Promise<unknown>
): ToolDefinition["execute"] {
  const { manifest } = skill;
  const requiredEnv = manifest.owliabot.requires?.env || [];
  const timeout = toolDef.timeout ?? 30_000;

  return async (params: unknown, ctx: ToolContext): Promise<ToolResult> => {
    const skillContext = createSkillContext({
      skillName: manifest.name,
      toolName: toolDef.name,
      callId: crypto.randomUUID(),
      userId: ctx.sessionKey,
      channel: ctx.sessionKey.split(":")[0] || "unknown",
      requiredEnv,
    });

    try {
      // Execute with timeout
      const result = await Promise.race([
        toolFn(params, skillContext),
        rejectAfter(timeout, `Skill execution timeout (${timeout}ms)`),
      ]);

      // Auto-wrap simple returns
      if (result && typeof result === "object" && !("success" in result)) {
        return { success: true, data: result };
      }

      return result as ToolResult;
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}

function rejectAfter(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error(message)), ms);
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/skills/__tests__/registry.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/skills/registry.ts src/skills/__tests__/registry.test.ts
git commit -m "feat(skills): add skill-to-tool converter with namespace"
```

---

## Task 8: Create Skill System Entry Point

**Files:**
- Create: `src/skills/index.ts`

**Step 1: Write the failing test**

Add integration test to `src/skills/__tests__/loader.test.ts`:

```typescript
import { initializeSkills } from "../index.js";
import { ToolRegistry } from "../../agent/tools/registry.js";

describe("initializeSkills", () => {
  beforeEach(async () => {
    await mkdir(TEST_SKILLS_DIR, { recursive: true });
  });

  afterEach(async () => {
    await rm(TEST_SKILLS_DIR, { recursive: true, force: true });
  });

  it("should register skill tools with the tool registry", async () => {
    const skillDir = join(TEST_SKILLS_DIR, "my-skill");
    await mkdir(skillDir);
    await writeFile(
      join(skillDir, "package.json"),
      JSON.stringify({
        name: "my-skill",
        version: "0.1.0",
        owliabot: {
          tools: [
            {
              name: "greet",
              description: "Greet someone",
              parameters: {
                type: "object",
                properties: { name: { type: "string" } },
                required: ["name"],
              },
              security: { level: "read" },
            },
          ],
        },
      })
    );
    await writeFile(
      join(skillDir, "index.js"),
      `export const tools = {
        greet: async ({ name }) => ({ success: true, data: { message: "Hello " + name } })
      };`
    );

    const registry = new ToolRegistry();
    const result = await initializeSkills(TEST_SKILLS_DIR, registry);

    expect(result.loaded).toHaveLength(1);
    expect(registry.get("my-skill:greet")).toBeDefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/skills/__tests__/loader.test.ts`
Expected: FAIL with "initializeSkills is not defined"

**Step 3: Write minimal implementation**

```typescript
// src/skills/index.ts
/**
 * Skills System Entry Point
 * @see docs/architecture/skills-system.md
 */

export { loadSkills, scanSkillsDirectory } from "./loader.js";
export { skillToToolDefinitions } from "./registry.js";
export { createSkillContext } from "./context.js";
export type {
  SkillManifest,
  SkillContext,
  SkillModule,
  LoadedSkill,
} from "./types.js";

import { createLogger } from "../utils/logger.js";
import type { ToolRegistry } from "../agent/tools/registry.js";
import { loadSkills, type LoadSkillsResult } from "./loader.js";
import { skillToToolDefinitions } from "./registry.js";

const log = createLogger("skills");

/**
 * Initialize skills system and register tools
 */
export async function initializeSkills(
  skillsDir: string,
  registry: ToolRegistry
): Promise<LoadSkillsResult> {
  log.info(`Loading skills from ${skillsDir}`);

  const result = await loadSkills(skillsDir);

  // Register tools from loaded skills
  for (const skill of result.loaded) {
    const tools = skillToToolDefinitions(skill);
    for (const tool of tools) {
      registry.register(tool);
    }
    log.info(`Registered ${tools.length} tools from skill: ${skill.manifest.name}`);
  }

  // Log summary
  log.info(
    `Skills loaded: ${result.loaded.length} success, ${result.failed.length} failed`
  );

  if (result.failed.length > 0) {
    for (const { name, error } of result.failed) {
      log.error(`  - ${name}: ${error}`);
    }
  }

  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/skills/__tests__/loader.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/skills/index.ts src/skills/__tests__/loader.test.ts
git commit -m "feat(skills): add skills system entry point"
```

---

## Task 9: Integrate Skills into Gateway

**Files:**
- Modify: `src/config/schema.ts` (add skills config)
- Modify: `src/gateway/server.ts` (load skills on startup)

**Step 1: Update config schema**

Add to `src/config/schema.ts`:

```typescript
// Add after existing schemas, before configSchema
export const skillsConfigSchema = z.object({
  enabled: z.boolean().default(true),
  directory: z.string().optional(), // defaults to workspace/skills
});

// Add to configSchema object:
skills: skillsConfigSchema.optional(),
```

**Step 2: Run build to verify no type errors**

Run: `npm run build`
Expected: PASS

**Step 3: Modify gateway to load skills**

Modify `src/gateway/server.ts`:

1. Add import at top:
```typescript
import { initializeSkills } from "../skills/index.js";
import { join } from "node:path";
```

2. Add skill loading after tool registration (around line 61):
```typescript
  // Load skills if enabled
  const skillsEnabled = config.skills?.enabled ?? true;
  if (skillsEnabled) {
    const skillsDir = config.skills?.directory ?? join(config.workspace, "skills");
    await initializeSkills(skillsDir, tools);
  }
```

**Step 4: Run build to verify integration compiles**

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/schema.ts src/gateway/server.ts
git commit -m "feat(skills): integrate skills loading into gateway startup"
```

---

## Task 10: Create Example Skill - crypto-price

**Files:**
- Create: `workspace/skills/crypto-price/package.json`
- Create: `workspace/skills/crypto-price/index.js`

**Step 1: Create skill directory**

```bash
mkdir -p workspace/skills/crypto-price
```

**Step 2: Create package.json**

```json
{
  "name": "crypto-price",
  "version": "0.1.0",
  "description": "Get cryptocurrency prices from CoinGecko",
  "main": "index.js",
  "owliabot": {
    "tools": [
      {
        "name": "get_price",
        "description": "Get current price of a cryptocurrency in USD or other currency",
        "parameters": {
          "type": "object",
          "properties": {
            "coin": {
              "type": "string",
              "description": "Coin ID (e.g., bitcoin, ethereum, solana)"
            },
            "currency": {
              "type": "string",
              "description": "Target currency (default: usd)"
            }
          },
          "required": ["coin"]
        },
        "security": {
          "level": "read"
        }
      }
    ]
  }
}
```

**Step 3: Create index.js**

```javascript
// workspace/skills/crypto-price/index.js

export const tools = {
  get_price: async ({ coin, currency = "usd" }, context) => {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(coin)}&vs_currencies=${encodeURIComponent(currency)}`;

    try {
      const res = await context.fetch(url);

      if (!res.ok) {
        return {
          success: false,
          error: `CoinGecko API error: ${res.status} ${res.statusText}`,
        };
      }

      const data = await res.json();

      if (!data[coin]) {
        return {
          success: false,
          error: `Coin not found: ${coin}. Try common IDs like 'bitcoin', 'ethereum', 'solana'.`,
        };
      }

      const price = data[coin][currency];
      if (price === undefined) {
        return {
          success: false,
          error: `Currency not supported: ${currency}. Try 'usd', 'eur', 'btc'.`,
        };
      }

      return {
        success: true,
        data: {
          coin,
          currency,
          price,
          timestamp: new Date().toISOString(),
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to fetch price: ${err.message}`,
      };
    }
  },
};
```

**Step 4: Test manually**

Run: `npm run build && npm run dev`
Expected: Logs should show "Loaded skill: crypto-price" and "Registered 1 tools from skill: crypto-price"

**Step 5: Commit**

```bash
git add workspace/skills/crypto-price/
git commit -m "feat(skills): add crypto-price example skill"
```

---

## Task 11: Create Example Skill - crypto-balance

**Files:**
- Create: `workspace/skills/crypto-balance/package.json`
- Create: `workspace/skills/crypto-balance/index.js`

**Step 1: Create skill directory**

```bash
mkdir -p workspace/skills/crypto-balance
```

**Step 2: Create package.json**

```json
{
  "name": "crypto-balance",
  "version": "0.1.0",
  "description": "Query wallet balances across multiple chains",
  "main": "index.js",
  "owliabot": {
    "requires": {
      "env": ["ALCHEMY_API_KEY"]
    },
    "tools": [
      {
        "name": "get_balance",
        "description": "Get native token balance (ETH/MATIC) for a wallet address",
        "parameters": {
          "type": "object",
          "properties": {
            "address": {
              "type": "string",
              "description": "Wallet address (0x...)"
            },
            "chain": {
              "type": "string",
              "description": "Blockchain: ethereum, polygon, arbitrum, base"
            }
          },
          "required": ["address", "chain"]
        },
        "security": {
          "level": "read"
        }
      }
    ]
  }
}
```

**Step 3: Create index.js**

```javascript
// workspace/skills/crypto-balance/index.js

const RPC_URLS = {
  ethereum: "https://eth-mainnet.g.alchemy.com/v2/",
  polygon: "https://polygon-mainnet.g.alchemy.com/v2/",
  arbitrum: "https://arb-mainnet.g.alchemy.com/v2/",
  base: "https://base-mainnet.g.alchemy.com/v2/",
};

const NATIVE_SYMBOLS = {
  ethereum: "ETH",
  polygon: "MATIC",
  arbitrum: "ETH",
  base: "ETH",
};

export const tools = {
  get_balance: async ({ address, chain }, context) => {
    // Validate chain
    if (!RPC_URLS[chain]) {
      return {
        success: false,
        error: `Unsupported chain: ${chain}. Supported: ${Object.keys(RPC_URLS).join(", ")}`,
      };
    }

    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return {
        success: false,
        error: `Invalid address format: ${address}. Expected 0x followed by 40 hex characters.`,
      };
    }

    // Check for API key
    const apiKey = context.env.ALCHEMY_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        error: "ALCHEMY_API_KEY not configured. Please set it in your environment.",
      };
    }

    const url = RPC_URLS[chain] + apiKey;

    try {
      const res = await context.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_getBalance",
          params: [address, "latest"],
          id: 1,
        }),
      });

      if (!res.ok) {
        return {
          success: false,
          error: `RPC error: ${res.status} ${res.statusText}`,
        };
      }

      const data = await res.json();

      if (data.error) {
        return {
          success: false,
          error: `RPC error: ${data.error.message}`,
        };
      }

      const balanceWei = BigInt(data.result);
      const balanceEth = Number(balanceWei) / 1e18;

      return {
        success: true,
        data: {
          address,
          chain,
          balance: balanceEth.toFixed(6),
          balanceWei: balanceWei.toString(),
          symbol: NATIVE_SYMBOLS[chain],
        },
      };
    } catch (err) {
      return {
        success: false,
        error: `Failed to fetch balance: ${err.message}`,
      };
    }
  },
};
```

**Step 4: Test manually (requires ALCHEMY_API_KEY)**

If you have an Alchemy API key:
```bash
ALCHEMY_API_KEY=your-key npm run dev
```

**Step 5: Commit**

```bash
git add workspace/skills/crypto-balance/
git commit -m "feat(skills): add crypto-balance example skill"
```

---

## Task 12: Update CHANGELOG

**Files:**
- Modify: `CHANGELOG.md`

**Step 1: Add Skills System entry**

Add under `## [Unreleased]` section:

```markdown
### Added
- **Skills System MVP** - Extensible tool system via JavaScript modules
  - `src/skills/` - Skill loader, context factory, and registry
  - Skills directory: `workspace/skills/`
  - Namespace format: `skill-name:tool-name`
  - Context injection: `fetch`, `env`, `meta`
  - Example skills: `crypto-price`, `crypto-balance`
- Skills configuration in `config.yaml`:
  - `skills.enabled` (default: true)
  - `skills.directory` (default: workspace/skills)
```

**Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: add Skills System MVP to CHANGELOG"
```

---

## Summary

After completing all tasks, you will have:

1. **Type definitions** (`src/skills/types.ts`) - Zod schemas for skill manifests
2. **Context factory** (`src/skills/context.ts`) - Creates execution context with filtered env
3. **Skill loader** (`src/skills/loader.ts`) - Scans, parses, and imports skills
4. **Tool converter** (`src/skills/registry.ts`) - Converts skills to ToolDefinitions
5. **Entry point** (`src/skills/index.ts`) - Unified API for the skills system
6. **Gateway integration** - Skills auto-load on startup
7. **Example skills** - `crypto-price` and `crypto-balance`

**Run all tests:**
```bash
npm test -- src/skills/
```

**Manual verification:**
```bash
npm run build && npm run dev
# Check logs for skill loading
# Test via Telegram/Discord: "What's the price of bitcoin?"
```
