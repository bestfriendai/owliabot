import http from "node:http";
import { createStore } from "./store.js";
import { isIpAllowed } from "./utils.js";

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
    const url = new URL(req.url ?? "/", "http://localhost");
    const remoteIp = getRemoteIp(req);
    if (
      opts.config.allowlist.length > 0 &&
      !isIpAllowed(remoteIp, opts.config.allowlist)
    ) {
      sendJson(res, 403, {
        ok: false,
        error: { code: "ERR_FORBIDDEN", message: "IP not allowed" },
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ ok: true, version: "0.1.0", uptime: process.uptime() })
      );
      return;
    }

    if (url.pathname === "/pairing/pending" && req.method === "GET") {
      if (!requireGatewayAuth(req, opts.config.token)) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Missing gateway token" },
        });
        return;
      }
      const pending = store.listPending();
      sendJson(res, 200, { ok: true, data: { pending } });
      return;
    }

    if (url.pathname === "/pairing/approve" && req.method === "POST") {
      if (!requireGatewayAuth(req, opts.config.token)) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Missing gateway token" },
        });
        return;
      }
      let body: any;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "Invalid JSON" },
        });
        return;
      }
      const deviceId = body?.deviceId;
      if (typeof deviceId !== "string" || deviceId.length === 0) {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "deviceId required" },
        });
        return;
      }
      const deviceToken = store.approveDevice(deviceId);
      sendJson(res, 200, {
        ok: true,
        data: { deviceId, deviceToken },
      });
      return;
    }

    if (url.pathname === "/pairing/revoke" && req.method === "POST") {
      if (!requireGatewayAuth(req, opts.config.token)) {
        sendJson(res, 401, {
          ok: false,
          error: { code: "ERR_UNAUTHORIZED", message: "Missing gateway token" },
        });
        return;
      }
      let body: any;
      try {
        body = await readJsonBody(req);
      } catch {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "Invalid JSON" },
        });
        return;
      }
      const deviceId = body?.deviceId;
      if (typeof deviceId !== "string" || deviceId.length === 0) {
        sendJson(res, 400, {
          ok: false,
          error: { code: "ERR_INVALID_REQUEST", message: "deviceId required" },
        });
        return;
      }
      store.revokeDevice(deviceId);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (url.pathname === "/events/poll" && req.method === "GET") {
      const sinceParam = url.searchParams.get("since");
      const since = sinceParam ? Number(sinceParam) : null;
      const now = Date.now();
      const { cursor, events } = store.pollEvents(
        Number.isFinite(since) ? since : null,
        100,
        now
      );
      sendJson(res, 200, { ok: true, cursor, events });
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        ok: false,
        error: { code: "ERR_INVALID_REQUEST", message: "Not Found" },
      })
    );
  });

  await new Promise<void>((resolve) => {
    server.listen(opts.config.port, opts.config.host, () => resolve());
  });

  const address = server.address();
  const port =
    typeof address === "object" && address ? address.port : opts.config.port;

  return {
    baseUrl: `http://${opts.config.host}:${port}`,
    stop: () => new Promise<void>((resolve) => server.close(() => resolve())),
    store,
  };
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>
) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

function getRemoteIp(req: http.IncomingMessage): string {
  const ip = req.socket.remoteAddress ?? "";
  if (ip.startsWith("::ffff:")) {
    return ip.slice(7);
  }
  if (ip === "::1") return "127.0.0.1";
  return ip;
}

function requireGatewayAuth(
  req: http.IncomingMessage,
  token?: string
): boolean {
  if (!token) return true;
  const provided = req.headers["x-gateway-token"];
  return typeof provided === "string" && provided === token;
}

async function readJsonBody(req: http.IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > 1_000_000) {
      throw new Error("Body too large");
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
