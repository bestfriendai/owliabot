import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { webFetchAction } from "../actions/web-fetch.js";

function listen(server: http.Server): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const onError = (err: unknown) => reject(err);
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", onError);
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

describe("system/actions/web-fetch", () => {
  let srv: http.Server;
  let baseUrl = "";
  let close: (() => Promise<void>) | null = null;
  let canListen = true;

  beforeAll(async () => {
    srv = http.createServer((req, res) => {
      if (req.url === "/big") {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("x".repeat(10_000));
        return;
      }
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("ok");
    });
    try {
      const l = await listen(srv);
      baseUrl = `http://127.0.0.1:${l.port}`;
      close = l.close;
    } catch (err: any) {
      // Sandbox blocks listening sockets (EPERM). Skip in that environment.
      if (err?.code === "EPERM") {
        canListen = false;
        return;
      }
      throw err;
    }
  });

  afterAll(async () => {
    await close?.();
  });

  it("fetches allowed URL and returns body", async () => {
    if (!canListen) return;
    const r = await webFetchAction(
      { url: baseUrl + "/" },
      { fetchImpl: fetch },
      {
        domainAllowList: ["127.0.0.1"],
        domainDenyList: [],
        allowPrivateNetworks: true,
        timeoutMs: 5_000,
        maxResponseBytes: 100_000,
        userAgent: "vitest",
        blockOnSecret: true,
      }
    );

    expect(r.status).toBe(200);
    expect(r.bodyText).toBe("ok");
  });

  it("truncates large responses", async () => {
    if (!canListen) return;
    const r = await webFetchAction(
      { url: baseUrl + "/big", maxResponseBytes: 1000 },
      { fetchImpl: fetch },
      {
        domainAllowList: ["127.0.0.1"],
        domainDenyList: [],
        allowPrivateNetworks: true,
        timeoutMs: 5_000,
        maxResponseBytes: 1000,
        userAgent: "vitest",
        blockOnSecret: true,
      }
    );

    expect(r.truncated).toBe(true);
    expect(r.bodyText.length).toBeLessThanOrEqual(1000);
  });

  it("blocks POST bodies with high-confidence secrets", async () => {
    if (!canListen) return;
    await expect(
      webFetchAction(
        {
          url: baseUrl + "/",
          method: "POST",
          body: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
        },
        { fetchImpl: fetch },
        {
          domainAllowList: ["127.0.0.1"],
          domainDenyList: [],
          allowPrivateNetworks: true,
          timeoutMs: 5_000,
          maxResponseBytes: 100_000,
          userAgent: "vitest",
          blockOnSecret: true,
        }
      )
    ).rejects.toThrow(/high-severity secret/);
  });
});
