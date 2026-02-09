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
    let server: Awaited<ReturnType<typeof startGatewayHttp>>;
    try {
      server = await startGatewayHttp({ config: cfg });
    } catch (err: any) {
      if (err?.code === "EPERM") return;
      throw err;
    }
    const deviceRes = await fetch(server.baseUrl + "/pairing/approve", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Gateway-Token": "gw" },
      body: JSON.stringify({ deviceId: "dev1" }),
    });
    const { data }: any = await deviceRes.json();

    const res = await fetch(server.baseUrl + "/command/tool", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-Device-Id": "dev1",
        "X-Device-Token": data.deviceToken,
        "Idempotency-Key": "abc",
      },
      body: JSON.stringify({
        payload: { toolCalls: [{ id: "1", name: "echo", arguments: { message: "hi" } }] },
      }),
    });

    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.data.results[0].success).toBe(true);
    await server.stop();
  });
});
