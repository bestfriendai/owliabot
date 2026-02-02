# Gateway HTTP v1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an HTTP-only Gateway v1 with auth, pairing, idempotency, events, audit, and tool routing backed by SQLite.

**Architecture:** A standalone `node:http` server (`src/gateway-http.ts`) loads config, initializes a SQLite-backed store, wires middleware (allowlist, auth, idempotency, rate limit), and routes to handlers for health/status/pairing/events/command. Tool execution reuses existing ToolRegistry and ToolExecutor.

**Tech Stack:** Node.js 22, TypeScript, `node:http`, SQLite (via `better-sqlite3`), `ipaddr.js`, Vitest, native `fetch`.

---

### Task 1: Add gateway HTTP config + tests

**Files:**
- Modify: `src/config/schema.ts`
- Modify: `config.example.yaml`
- Create: `src/config/__tests__/gateway-http.test.ts`

**Step 1: Write failing tests for schema**

```ts
// src/config/__tests__/gateway-http.test.ts
import { describe, it, expect } from "vitest";
import { configSchema } from "../schema.js";

describe("gateway.http config", () => {
  it("accepts gateway http config", () => {
    const cfg = {
      providers: [{ id: "x", model: "m", apiKey: "k", priority: 1 }],
      workspace: "./workspace",
      gateway: {
        http: {
          host: "127.0.0.1",
          port: 8080,
          token: "secret",
          allowlist: ["127.0.0.1", "10.0.0.0/8"],
          sqlitePath: "./workspace/gateway.db",
          idempotencyTtlMs: 600000,
          eventTtlMs: 86400000,
          rateLimit: { windowMs: 60000, max: 60 },
        },
      },
    };

    const parsed = configSchema.safeParse(cfg);
    expect(parsed.success).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/config/__tests__/gateway-http.test.ts`
Expected: FAIL (schema rejects gateway.http)

**Step 3: Update schema + example config**

```ts
// src/config/schema.ts (add near bottom)
const gatewayHttpSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.number().int().default(8787),
  token: z.string().optional(),
  allowlist: z.array(z.string()).default([]),
  sqlitePath: z.string().default("./workspace/gateway.db"),
  idempotencyTtlMs: z.number().int().default(10 * 60 * 1000),
  eventTtlMs: z.number().int().default(24 * 60 * 60 * 1000),
  rateLimit: z
    .object({
      windowMs: z.number().int().default(60_000),
      max: z.number().int().default(60),
    })
    .default({ windowMs: 60_000, max: 60 }),
});

// inside configSchema
  gateway: z
    .object({
      http: gatewayHttpSchema.optional(),
    })
    .optional(),
```

```yaml
# config.example.yaml (append)
# Gateway HTTP (optional)
# gateway:
#   http:
#     host: 127.0.0.1
#     port: 8787
#     token: ${GATEWAY_TOKEN}
#     allowlist:
#       - "127.0.0.1"
#       - "10.0.0.0/8"
#     sqlitePath: ./workspace/gateway.db
#     idempotencyTtlMs: 600000
#     eventTtlMs: 86400000
#     rateLimit:
#       windowMs: 60000
#       max: 60
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/config/__tests__/gateway-http.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/config/schema.ts config.example.yaml src/config/__tests__/gateway-http.test.ts
git commit -m "feat: add gateway http config"
```

---

### Task 2: Add dependencies + allowlist/hash utilities

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/gateway-http/utils.ts`
- Test: `src/gateway-http/__tests__/utils.test.ts`

**Step 1: Write failing tests for utils**

```ts
// src/gateway-http/__tests__/utils.test.ts
import { describe, it, expect } from "vitest";
import { isIpAllowed, hashToken, hashRequest } from "../utils.js";

describe("gateway utils", () => {
  it("matches allowlist CIDR", () => {
    expect(isIpAllowed("10.1.2.3", ["10.0.0.0/8"]))
      .toBe(true);
  });

  it("hashes tokens deterministically", () => {
    expect(hashToken("abc")).toBe(hashToken("abc"));
  });

  it("hashes request inputs", () => {
    const h1 = hashRequest("POST", "/command/tool", "{}", "dev1");
    const h2 = hashRequest("POST", "/command/tool", "{}", "dev1");
    expect(h1).toBe(h2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/gateway-http/__tests__/utils.test.ts`
Expected: FAIL (module not found)

**Step 3: Add dependencies and implement utils**

```bash
npm install ipaddr.js
npm install -D @types/ipaddr.js
```

```ts
// src/gateway-http/utils.ts
import ipaddr from "ipaddr.js";
import { createHash } from "node:crypto";

export function isIpAllowed(ip: string, allowlist: string[]): boolean {
  if (allowlist.length === 0) return false;
  const addr = ipaddr.parse(ip.includes(":") ? ip : ip.trim());
  return allowlist.some((entry) => {
    if (entry.includes("/")) {
      const [range, bits] = entry.split("/");
      const cidr = ipaddr.parse(range);
      return addr.match(cidr, Number(bits));
    }
    return addr.toString() === ipaddr.parse(entry).toString();
  });
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashRequest(
  method: string,
  path: string,
  body: string,
  deviceId: string
): string {
  return createHash("sha256")
    .update(`${method}:${path}:${deviceId}:${body}`)
    .digest("hex");
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/gateway-http/__tests__/utils.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add package.json package-lock.json src/gateway-http/utils.ts src/gateway-http/__tests__/utils.test.ts
git commit -m "feat: add gateway http utils"
```

---

### Task 3: SQLite store (schema + TTL cleanup + idempotency)

**Files:**
- Create: `src/gateway-http/store.ts`
- Create: `src/gateway-http/__tests__/store.test.ts`

**Step 1: Write failing tests for store**

```ts
// src/gateway-http/__tests__/store.test.ts
import { describe, it, expect } from "vitest";
import { createStore } from "../store.js";
import { tmpdir } from "node:os";
import { join } from "node:path";

function dbPath(name: string) {
  return join(tmpdir(), `gw-${Date.now()}-${name}.db`);
}

describe("gateway store", () => {
  it("stores and retrieves devices", () => {
    const store = createStore(dbPath("devices"));
    store.addPending("dev1", "1.2.3.4", "ua");
    const token = store.approveDevice("dev1");
    const device = store.getDevice("dev1");
    expect(device?.tokenHash).toBeTruthy();
    expect(token).toBeTruthy();
  });

  it("supports idempotency cache", () => {
    const store = createStore(dbPath("idem"));
    store.saveIdempotency("k", "h", { ok: true }, Date.now() + 1000);
    const hit = store.getIdempotency("k");
    expect(hit?.requestHash).toBe("h");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/gateway-http/__tests__/store.test.ts`
Expected: FAIL (module not found)

**Step 3: Add dependency and implement store**

```bash
npm install better-sqlite3
npm install -D @types/better-sqlite3
```

```ts
// src/gateway-http/store.ts
import Database from "better-sqlite3";
import { hashToken } from "./utils.js";

export interface DeviceRecord {
  deviceId: string;
  tokenHash: string | null;
  revokedAt: number | null;
}

export interface IdempotencyRecord {
  key: string;
  requestHash: string;
  responseJson: string;
  expiresAt: number;
}

export interface EventRecord {
  id: number;
  type: string;
  time: number;
  status: string;
  source: string;
  message: string;
  metadataJson: string | null;
}

export interface Store {
  getDevice(deviceId: string): DeviceRecord | null;
  addPending(deviceId: string, ip: string, userAgent: string): void;
  listPending(): Array<{ deviceId: string; requestedAt: number; ip: string; userAgent: string }>;
  approveDevice(deviceId: string, token?: string): string;
  revokeDevice(deviceId: string): void;
  saveIdempotency(key: string, requestHash: string, response: unknown, expiresAt: number): void;
  getIdempotency(key: string): IdempotencyRecord | null;
  insertEvent(event: Omit<EventRecord, "id"> & { expiresAt: number }): void;
  pollEvents(since: number | null, limit: number, now: number): { cursor: number; events: EventRecord[] };
  insertAudit(row: Record<string, unknown>): void;
  checkRateLimit(bucket: string, windowMs: number, max: number, now: number): { allowed: boolean; resetAt: number };
  cleanup(now: number): void;
}

export function createStore(path: string): Store {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      device_id TEXT PRIMARY KEY,
      token_hash TEXT,
      revoked_at INTEGER,
      paired_at INTEGER,
      last_seen_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS pairing_pending (
      device_id TEXT PRIMARY KEY,
      requested_at INTEGER,
      ip TEXT,
      user_agent TEXT
    );
    CREATE TABLE IF NOT EXISTS idempotency (
      key TEXT PRIMARY KEY,
      request_hash TEXT,
      response_json TEXT,
      expires_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT,
      time INTEGER,
      status TEXT,
      source TEXT,
      message TEXT,
      metadata_json TEXT,
      expires_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      time INTEGER,
      actor_id TEXT,
      device_id TEXT,
      route TEXT,
      ip TEXT,
      request_id TEXT,
      trace_id TEXT,
      action TEXT,
      level TEXT,
      result TEXT,
      metadata_json TEXT
    );
    CREATE TABLE IF NOT EXISTS rate_limits (
      bucket TEXT PRIMARY KEY,
      count INTEGER,
      reset_at INTEGER
    );
  `);

  return {
    getDevice(deviceId) {
      const row = db.prepare("SELECT device_id, token_hash, revoked_at FROM devices WHERE device_id=?").get(deviceId);
      if (!row) return null;
      return { deviceId: row.device_id, tokenHash: row.token_hash, revokedAt: row.revoked_at };
    },
    addPending(deviceId, ip, userAgent) {
      db.prepare(
        "INSERT OR REPLACE INTO pairing_pending(device_id, requested_at, ip, user_agent) VALUES(?,?,?,?)"
      ).run(deviceId, Date.now(), ip, userAgent);
    },
    listPending() {
      return db.prepare("SELECT device_id, requested_at, ip, user_agent FROM pairing_pending").all();
    },
    approveDevice(deviceId, token) {
      const issued = token ?? cryptoRandomToken();
      const tokenHash = hashToken(issued);
      db.prepare(
        "INSERT OR REPLACE INTO devices(device_id, token_hash, revoked_at, paired_at, last_seen_at) VALUES(?,?,?,?,?)"
      ).run(deviceId, tokenHash, null, Date.now(), Date.now());
      db.prepare("DELETE FROM pairing_pending WHERE device_id=?").run(deviceId);
      return issued;
    },
    revokeDevice(deviceId) {
      db.prepare("UPDATE devices SET revoked_at=? WHERE device_id=?").run(Date.now(), deviceId);
    },
    saveIdempotency(key, requestHash, response, expiresAt) {
      db.prepare(
        "INSERT OR REPLACE INTO idempotency(key, request_hash, response_json, expires_at) VALUES(?,?,?,?)"
      ).run(key, requestHash, JSON.stringify(response), expiresAt);
    },
    getIdempotency(key) {
      return db.prepare("SELECT key, request_hash, response_json, expires_at FROM idempotency WHERE key=?").get(key) ?? null;
    },
    insertEvent(event) {
      db.prepare(
        "INSERT INTO events(type, time, status, source, message, metadata_json, expires_at) VALUES(?,?,?,?,?,?,?)"
      ).run(
        event.type,
        event.time,
        event.status,
        event.source,
        event.message,
        event.metadataJson,
        event.expiresAt
      );
    },
    pollEvents(since, limit, now) {
      const rows = since
        ? db.prepare("SELECT id, type, time, status, source, message, metadata_json FROM events WHERE id>? AND expires_at>? ORDER BY id ASC LIMIT ?")
            .all(since, now, limit)
        : db.prepare("SELECT id, type, time, status, source, message, metadata_json FROM events WHERE expires_at>? ORDER BY id DESC LIMIT ?")
            .all(now, limit)
            .reverse();
      const cursor = rows.length ? rows[rows.length - 1].id : since ?? 0;
      return { cursor, events: rows.map(mapEventRow) };
    },
    insertAudit(row) {
      db.prepare(
        "INSERT INTO audit_logs(time, actor_id, device_id, route, ip, request_id, trace_id, action, level, result, metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)"
      ).run(
        row.time,
        row.actor_id,
        row.device_id,
        row.route,
        row.ip,
        row.request_id,
        row.trace_id,
        row.action,
        row.level,
        row.result,
        row.metadata_json
      );
    },
    checkRateLimit(bucket, windowMs, max, now) {
      const current = db.prepare("SELECT count, reset_at FROM rate_limits WHERE bucket=?").get(bucket);
      if (!current || current.reset_at <= now) {
        db.prepare("INSERT OR REPLACE INTO rate_limits(bucket, count, reset_at) VALUES(?,?,?)")
          .run(bucket, 1, now + windowMs);
        return { allowed: true, resetAt: now + windowMs };
      }
      if (current.count >= max) {
        return { allowed: false, resetAt: current.reset_at };
      }
      db.prepare("UPDATE rate_limits SET count=count+1 WHERE bucket=?").run(bucket);
      return { allowed: true, resetAt: current.reset_at };
    },
    cleanup(now) {
      db.prepare("DELETE FROM idempotency WHERE expires_at <= ?").run(now);
      db.prepare("DELETE FROM events WHERE expires_at <= ?").run(now);
    },
  };
}

function cryptoRandomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString("hex");
}

function mapEventRow(row: any): EventRecord {
  return {
    id: row.id,
    type: row.type,
    time: row.time,
    status: row.status,
    source: row.source,
    message: row.message,
    metadataJson: row.metadata_json,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/gateway-http/__tests__/store.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/gateway-http/store.ts src/gateway-http/__tests__/store.test.ts package.json package-lock.json
git commit -m "feat: add gateway sqlite store"
```

---

### Task 4: HTTP server skeleton + core endpoints

**Files:**
- Create: `src/gateway-http/server.ts`
- Create: `src/gateway-http/__tests__/server.health.test.ts`

**Step 1: Write failing health endpoint test**

```ts
// src/gateway-http/__tests__/server.health.test.ts
import { describe, it, expect } from "vitest";
import { startGatewayHttp } from "../server.js";

const baseConfig = {
  host: "127.0.0.1",
  port: 0,
  token: undefined,
  allowlist: ["127.0.0.1"],
  sqlitePath: ":memory:",
  idempotencyTtlMs: 600000,
  eventTtlMs: 86400000,
  rateLimit: { windowMs: 60000, max: 60 },
};

describe("gateway health", () => {
  it("returns ok", async () => {
    const server = await startGatewayHttp({ config: baseConfig });
    const res = await fetch(server.baseUrl + "/health");
    const json = await res.json();
    expect(json.ok).toBe(true);
    await server.stop();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/gateway-http/__tests__/server.health.test.ts`
Expected: FAIL (module not found)

**Step 3: Implement server skeleton and /health**

```ts
// src/gateway-http/server.ts
import http from "node:http";
import { createStore } from "./store.js";

export interface GatewayHttpConfig {
  host: string;
  port: number;
  token?: string;
  allowlist: string[];
  sqlitePath: string;
  idempotencyTtlMs: number;
  eventTtlMs: number;
  rateLimit: { windowMs: number; max: number };
}

export async function startGatewayHttp(opts: { config: GatewayHttpConfig }) {
  const store = createStore(opts.config.sqlitePath);
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, version: "0.1.0", uptime: process.uptime() }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: { code: "ERR_INVALID_REQUEST", message: "Not Found" } }));
  });

  await new Promise<void>((resolve) => {
    server.listen(opts.config.port, opts.config.host, () => resolve());
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : opts.config.port;

  return {
    baseUrl: `http://${opts.config.host}:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
    store,
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/gateway-http/__tests__/server.health.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/gateway-http/server.ts src/gateway-http/__tests__/server.health.test.ts
git commit -m "feat: add gateway http server skeleton"
```

---

### Task 5: Pairing + auth + events endpoints

**Files:**
- Modify: `src/gateway-http/server.ts`
- Create: `src/gateway-http/__tests__/server.pairing.test.ts`

**Step 1: Write failing pairing test**

```ts
// src/gateway-http/__tests__/server.pairing.test.ts
import { describe, it, expect } from "vitest";
import { startGatewayHttp } from "../server.js";

const cfg = {
  host: "127.0.0.1",
  port: 0,
  token: "gw",
  allowlist: ["127.0.0.1"],
  sqlitePath: ":memory:",
  idempotencyTtlMs: 600000,
  eventTtlMs: 86400000,
  rateLimit: { windowMs: 60000, max: 60 },
};

describe("pairing", () => {
  it("approves device and returns token", async () => {
    const server = await startGatewayHttp({ config: cfg });
    const res = await fetch(server.baseUrl + "/pairing/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
      body: JSON.stringify({ deviceId: "dev1" }),
    });
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.deviceToken).toBeTruthy();
    await server.stop();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/gateway-http/__tests__/server.pairing.test.ts`
Expected: FAIL

**Step 3: Implement auth + pairing + events**

Add helpers into `server.ts`:
- read JSON body with size limit
- verify allowlist (using `isIpAllowed`)
- verify gateway token
- `/pairing/pending`, `/pairing/approve`, `/pairing/revoke`
- `/events/poll?since=` with store.pollEvents

**Step 4: Run test to verify it passes**

Run: `npm test -- src/gateway-http/__tests__/server.pairing.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/gateway-http/server.ts src/gateway-http/__tests__/server.pairing.test.ts
git commit -m "feat: add pairing and events endpoints"
```

---

### Task 6: /command/tool + entry script

**Files:**
- Modify: `src/gateway-http/server.ts`
- Create: `src/gateway-http/tooling.ts`
- Create: `src/gateway-http/__tests__/server.command-tool.test.ts`
- Create: `src/gateway-http.ts`
- Modify: `package.json`

**Step 1: Write failing /command/tool test**

```ts
// src/gateway-http/__tests__/server.command-tool.test.ts
import { describe, it, expect } from "vitest";
import { startGatewayHttp } from "../server.js";

const cfg = {
  host: "127.0.0.1",
  port: 0,
  token: "gw",
  allowlist: ["127.0.0.1"],
  sqlitePath: ":memory:",
  idempotencyTtlMs: 600000,
  eventTtlMs: 86400000,
  rateLimit: { windowMs: 60000, max: 60 },
};

describe("command tool", () => {
  it("executes echo tool", async () => {
    const server = await startGatewayHttp({ config: cfg });
    const deviceRes = await fetch(server.baseUrl + "/pairing/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
      body: JSON.stringify({ deviceId: "dev1" }),
    });
    const { data } = await deviceRes.json();

    const res = await fetch(server.baseUrl + "/command/tool", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Device-Id": "dev1",
        "X-Device-Token": data.deviceToken,
        "Idempotency-Key": "abc",
      },
      body: JSON.stringify({
        payload: { toolCalls: [{ id: "1", name: "echo", arguments: { text: "hi" } }] },
      }),
    });

    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.results[0].success).toBe(true);
    await server.stop();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/gateway-http/__tests__/server.command-tool.test.ts`
Expected: FAIL

**Step 3: Implement tool registry + handler + entrypoint**

```ts
// src/gateway-http/tooling.ts
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
import { initializeSkills } from "../skills/index.js";
import { join } from "node:path";

export async function createGatewayToolRegistry(workspacePath: string) {
  const tools = new ToolRegistry();
  tools.register(echoTool);
  tools.register(createHelpTool(tools));
  tools.register(createClearSessionTool({ append: async () => {}, getHistory: async () => [] } as any));
  tools.register(createMemorySearchTool(workspacePath));
  tools.register(createMemoryGetTool(workspacePath));
  tools.register(createListFilesTool(workspacePath));
  tools.register(createEditFileTool(workspacePath));

  const skillsDir = join(workspacePath, "skills");
  await initializeSkills(skillsDir, tools);
  return tools;
}
```

```ts
// src/gateway-http.ts
import { loadConfig } from "./config/loader.js";
import { startGatewayHttp } from "./gateway-http/server.js";

const config = await loadConfig(process.argv[2] ?? "config.yaml");
if (!config.gateway?.http) {
  throw new Error("gateway.http config is required to start HTTP gateway");
}
await startGatewayHttp({ config: config.gateway.http, workspacePath: config.workspace });
```

```json
// package.json (scripts)
"gateway": "tsx src/gateway-http.ts"
```

**Step 4: Run test to verify it passes**

Run: `npm test -- src/gateway-http/__tests__/server.command-tool.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/gateway-http/tooling.ts src/gateway-http/server.ts src/gateway-http.ts src/gateway-http/__tests__/server.command-tool.test.ts package.json
git commit -m "feat: add command tool handler and entrypoint"
```

---

### Task 7: Add idempotency + rate limit enforcement in server

**Files:**
- Modify: `src/gateway-http/server.ts`
- Create: `src/gateway-http/__tests__/server.idempotency.test.ts`

**Step 1: Write failing idempotency test**

```ts
// src/gateway-http/__tests__/server.idempotency.test.ts
import { describe, it, expect } from "vitest";
import { startGatewayHttp } from "../server.js";

const cfg = {
  host: "127.0.0.1",
  port: 0,
  token: "gw",
  allowlist: ["127.0.0.1"],
  sqlitePath: ":memory:",
  idempotencyTtlMs: 600000,
  eventTtlMs: 86400000,
  rateLimit: { windowMs: 60000, max: 1 },
};

describe("idempotency", () => {
  it("replays response for same key+hash", async () => {
    const server = await startGatewayHttp({ config: cfg });
    const approve = await fetch(server.baseUrl + "/pairing/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
      body: JSON.stringify({ deviceId: "dev1" }),
    });
    const { data } = await approve.json();

    const body = JSON.stringify({ payload: { toolCalls: [] } });
    const headers = {
      "content-type": "application/json",
      "X-Device-Id": "dev1",
      "X-Device-Token": data.deviceToken,
      "Idempotency-Key": "k1",
    };
    const r1 = await fetch(server.baseUrl + "/command/tool", { method: "POST", headers, body });
    const r2 = await fetch(server.baseUrl + "/command/tool", { method: "POST", headers, body });
    expect((await r1.text())).toBe((await r2.text()));
    await server.stop();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/gateway-http/__tests__/server.idempotency.test.ts`
Expected: FAIL

**Step 3: Implement idempotency + rate limit middleware**

Add in `server.ts`:
- Compute `requestHash` via `hashRequest`
- If `Idempotency-Key` exists, check store; on hit return cached response
- Store response JSON on success
- Enforce `rateLimit` via store.checkRateLimit

**Step 4: Run test to verify it passes**

Run: `npm test -- src/gateway-http/__tests__/server.idempotency.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/gateway-http/server.ts src/gateway-http/__tests__/server.idempotency.test.ts
git commit -m "feat: add idempotency and rate limiting"
```

---

### Task 8: Final integration tests

**Files:**
- Create: `src/gateway-http/__tests__/integration.test.ts`

**Step 1: Write failing integration test**

```ts
// src/gateway-http/__tests__/integration.test.ts
import { describe, it, expect } from "vitest";
import { startGatewayHttp } from "../server.js";

const cfg = {
  host: "127.0.0.1",
  port: 0,
  token: "gw",
  allowlist: ["127.0.0.1"],
  sqlitePath: ":memory:",
  idempotencyTtlMs: 600000,
  eventTtlMs: 86400000,
  rateLimit: { windowMs: 60000, max: 60 },
};

describe("gateway integration", () => {
  it("pair -> tool -> events", async () => {
    const server = await startGatewayHttp({ config: cfg });
    const approve = await fetch(server.baseUrl + "/pairing/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
      body: JSON.stringify({ deviceId: "dev1" }),
    });
    const { data } = await approve.json();

    await fetch(server.baseUrl + "/command/tool", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Device-Id": "dev1",
        "X-Device-Token": data.deviceToken,
        "Idempotency-Key": "t1",
      },
      body: JSON.stringify({ payload: { toolCalls: [] } }),
    });

    const events = await fetch(server.baseUrl + "/events/poll");
    const json = await events.json();
    expect(json.cursor).toBeTypeOf("number");
    await server.stop();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npm test -- src/gateway-http/__tests__/integration.test.ts`
Expected: FAIL

**Step 3: Implement missing event emission**

Update `server.ts` to insert `events` for command results (e.g. `tool.result`).

**Step 4: Run test to verify it passes**

Run: `npm test -- src/gateway-http/__tests__/integration.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/gateway-http/__tests__/integration.test.ts src/gateway-http/server.ts
git commit -m "test: add gateway integration tests"
```

---

## Final verification

Run full tests: `npm test`
Expected: PASS

