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
      res.end(
        JSON.stringify({ ok: true, version: "0.1.0", uptime: process.uptime() })
      );
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
