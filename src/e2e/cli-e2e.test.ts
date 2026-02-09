import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse, stringify } from "yaml";

import { loadConfig } from "../config/loader.js";
import { startGatewayHttp } from "../gateway/http/server.js";
import { ToolRegistry } from "../agent/tools/registry.js";
import { echoTool } from "../agent/tools/builtin/echo.js";

describe.sequential("E2E: CLI onboard -> config/secrets -> gateway http", () => {
  const tmpRoot = "/tmp/e2e-test-config";
  const appYamlPath = join(tmpRoot, "app.yaml");
  const secretsYamlPath = join(tmpRoot, "secrets.yaml");
  const workspacePath = join(tmpRoot, "workspace");

  let gateway: Awaited<ReturnType<typeof startGatewayHttp>> | null = null;

  beforeAll(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
    await mkdir(dirname(appYamlPath), { recursive: true });
  }, 180_000);

  afterAll(async () => {
    if (gateway) {
      await gateway.stop();
      gateway = null;
    }
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it(
    "runs onboarding, validates generated config, starts gateway, and exercises pairing + tool + events",
    async () => {
      // Generate minimal config + secrets (equivalent to onboard output, but without spawning a subprocess).
      const appYaml = stringify({
        workspace: workspacePath,
        providers: [{ id: "anthropic", model: "claude-opus-4-5", apiKey: "secrets", priority: 1 }],
        discord: {
          requireMentionInGuild: true,
          channelAllowList: [],
          memberAllowList: ["123456789"],
        },
        telegram: {
          allowList: ["987654321"],
        },
        tools: { allowWrite: true },
        security: {
          writeToolAllowList: ["123456789", "987654321"],
          writeGateEnabled: false,
          writeToolConfirmation: false,
        },
      });

      const secretsYaml = stringify({
        anthropic: { apiKey: "sk-ant-api-test-e2e-fake-key" },
        discord: { token: "test-discord-token-e2e" },
        telegram: { token: "test-telegram-token-e2e" },
      });

      await writeFile(appYamlPath, appYaml, "utf-8");
      await writeFile(secretsYamlPath, secretsYaml, { encoding: "utf-8", mode: 0o600 });

      // Step 4 — Check generated config files
      const appYamlRaw = await readFile(appYamlPath, "utf-8");
      const secretsYamlRaw = await readFile(secretsYamlPath, "utf-8");

      const app: any = parse(appYamlRaw);
      const secrets: any = parse(secretsYamlRaw);

      expect(app.workspace).toBe(workspacePath);
      expect(Array.isArray(app.providers)).toBe(true);
      expect(app.providers[0]).toMatchObject({ id: "anthropic", apiKey: "secrets" });

      expect(app.discord).toBeTruthy();
      expect(app.discord.requireMentionInGuild).toBe(true);
      expect(app.discord.channelAllowList).toEqual([]);
      expect(app.discord.memberAllowList).toEqual(["123456789"]);

      // Telegram section includes allowList
      expect(app.telegram.allowList).toEqual(["987654321"]);

      // Security section with writeGate
      expect(app.tools).toBeTruthy();
      expect(app.tools.allowWrite).toBe(true);
      expect(app.security).toBeTruthy();
      expect(app.security.writeToolAllowList).toEqual(["123456789", "987654321"]);
      expect(app.security.writeGateEnabled).toBe(false);
      expect(app.security.writeToolConfirmation).toBe(false);

      expect(secrets.discord.token).toBe("test-discord-token-e2e");
      expect(secrets.telegram.token).toBe("test-telegram-token-e2e");

      const st = await stat(secretsYamlPath);
      expect(st.mode & 0o777).toBe(0o600);

      // Validate that the standard config loader can load this and merge tokens
      const loaded = await loadConfig(appYamlPath);
      expect(loaded.discord?.token).toBe("test-discord-token-e2e");
      expect(loaded.telegram?.token).toBe("test-telegram-token-e2e");
      expect(loaded.workspace).toBe(workspacePath);

      // Step 5 — Start gateway + send requests
      const toolRegistry = new ToolRegistry();
      toolRegistry.register(echoTool);

      gateway = await startGatewayHttp({
        toolRegistry,
        sessionStore: undefined as any,
        transcripts: undefined as any,
        config: {
          host: "127.0.0.1",
          port: 0,
          token: "gw-token-e2e",
          allowlist: ["127.0.0.1"],
          sqlitePath: ":memory:",
          idempotencyTtlMs: 10 * 60 * 1000,
          eventTtlMs: 24 * 60 * 60 * 1000,
          rateLimit: { windowMs: 60_000, max: 60 },
        },
        workspacePath: loaded.workspace,
        fetchImpl: async (url) => {
          // Minimal stub for web.fetch in sandboxed test environments.
          if (typeof url === "string" && url.startsWith("http://example.test/")) {
            return new Response("system-ok", { status: 200, headers: { "content-type": "text/plain" } });
          }
          return new Response("not-found", { status: 404 });
        },
        system: {
          web: {
            domainAllowList: ["example.test"],
            domainDenyList: [],
            allowPrivateNetworks: true,
            timeoutMs: 5_000,
            maxResponseBytes: 128 * 1024,
            userAgent: "owliabot-e2e",
            blockOnSecret: true,
          },
          exec: {
            commandAllowList: [],
            envAllowList: ["PATH", "LANG"],
            timeoutMs: 30_000,
            maxOutputBytes: 64 * 1024,
          },
          webSearch: {
            defaultProvider: "duckduckgo",
            timeoutMs: 10_000,
            maxResults: 5,
          },
        },
      });

      // Health
      {
        const res = await gateway.request("/health");
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
        expect(json.version).toBeTruthy();
      }

      // Unauthenticated request (missing device auth)
      {
        const res = await gateway.request("/command/tool", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ payload: { toolCalls: [] } }),
        });
        expect(res.status).toBe(401);
      }

      // Pairing flow: request -> pending -> approve -> token
      const deviceId = "device-e2e-1";
      gateway.store.addPending(deviceId, "127.0.0.1", "vitest");

      {
        const res = await gateway.request("/pairing/pending", {
          headers: { "X-Gateway-Token": "gw-token-e2e" },
        });
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.pending.map((p: any) => p.deviceId)).toContain(deviceId);
      }

      let deviceToken = "";
      {
        const res = await gateway.request("/pairing/approve", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Gateway-Token": "gw-token-e2e",
          },
          body: JSON.stringify({ deviceId, scope: { tools: "sign", system: true, mcp: false } }),
        });
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
        deviceToken = json.data.deviceToken;
        expect(typeof deviceToken).toBe("string");
        expect(deviceToken.length).toBeGreaterThan(10);
      }

      // Tool call with device token
      {
        const res = await gateway.request("/command/tool", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Device-Id": deviceId,
            "X-Device-Token": deviceToken,
          },
          body: JSON.stringify({
            payload: {
              toolCalls: [{ id: "1", name: "echo", arguments: { message: "hello" } }],
            },
          }),
        });
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.results[0]).toMatchObject({
          id: "1",
          name: "echo",
          success: true,
        });
        expect(json.data.results[0].data.echoed).toBe("hello");
      }

      // System call: web.fetch
      {
        const res = await gateway.request("/command/system", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Device-Id": deviceId,
            "X-Device-Token": deviceToken,
          },
          body: JSON.stringify({
            payload: {
              action: "web.fetch",
              args: { url: "http://example.test/" },
              sessionId: "e2e",
            },
            security: { level: "read" },
          }),
        });
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
        expect(json.data.result.success).toBe(true);
        expect(json.data.result.data.bodyText).toBe("system-ok");
      }

      // Events poll
      {
        const res = await gateway.request("/events/poll?since=0", {
          headers: {
            "X-Device-Id": deviceId,
            "X-Device-Token": deviceToken,
          },
        });
        expect(res.status).toBe(200);
        const json: any = await res.json();
        expect(json.ok).toBe(true);
        expect(Array.isArray(json.events)).toBe(true);
        expect(json.events.some((e: any) => e.type === "command.tool")).toBe(true);
        expect(json.events.some((e: any) => e.type === "command.system")).toBe(true);
      }

      // Revoke device -> tool call should be 401
      {
        const res = await gateway.request("/pairing/revoke", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Gateway-Token": "gw-token-e2e",
          },
          body: JSON.stringify({ deviceId }),
        });
        expect(res.status).toBe(200);
      }

      {
        const res = await gateway.request("/command/tool", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-Device-Id": deviceId,
            "X-Device-Token": deviceToken,
          },
          body: JSON.stringify({
            payload: {
              toolCalls: [{ id: "2", name: "echo", arguments: { message: "should-fail" } }],
            },
          }),
        });
        expect(res.status).toBe(401);
      }
    },
    180_000
  );
});
