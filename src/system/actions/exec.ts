import { spawn } from "node:child_process";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import fs from "node:fs";
import { tmpdir } from "node:os";
import { resolve, isAbsolute } from "node:path";
import { execArgsSchema, type ExecArgs, type SystemCapabilityConfig } from "../interface.js";
import { checkCommandWhitelist } from "../security/command-whitelist.js";
import { sanitizeEnv } from "../security/env-sanitizer.js";

export interface ExecActionContext {
  workspacePath: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface ExecActionResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  truncated: boolean;
  timedOut: boolean;
  durationMs: number;
}

async function resolveCwd(workspacePath: string, cwd?: string): Promise<string> {
  const wsReal = await realpath(workspacePath);
  const target = cwd
    ? isAbsolute(cwd)
      ? cwd
      : resolve(workspacePath, cwd)
    : workspacePath;

  const targetReal = await realpath(target);

  // Ensure target is within workspace real path
  const rel = targetReal.startsWith(wsReal) ? targetReal.slice(wsReal.length) : null;
  if (rel === null || (rel.length > 0 && !rel.startsWith("/"))) {
    throw new Error("CWD must be within workspace");
  }

  return targetReal;
}

export async function execAction(
  argsRaw: unknown,
  ctx: ExecActionContext,
  config: SystemCapabilityConfig["exec"]
): Promise<ExecActionResult> {
  const parsed = execArgsSchema.parse(argsRaw) as ExecArgs & { params: string[] };

  const allowList = config?.commandAllowList ?? [];
  const verdict = checkCommandWhitelist(parsed.command, allowList);
  if (!verdict.allowed) {
    throw new Error(`Command not allowed: ${verdict.reason ?? "denied"}`);
  }

  const cwd = await resolveCwd(ctx.workspacePath, ctx.cwd);

  const timeoutMs = parsed.timeoutMs ?? config?.timeoutMs ?? 60_000;
  const maxOutputBytes = config?.maxOutputBytes ?? 256 * 1024;
  const envAllowList = config?.envAllowList ?? [];

  const { env } = sanitizeEnv(ctx.env, envAllowList);

  const started = Date.now();

  const tmp = await mkdtemp(resolve(tmpdir(), "owliabot-exec-"));
  const stdoutPath = resolve(tmp, "stdout.txt");
  const stderrPath = resolve(tmp, "stderr.txt");

  const stdoutFd = fs.openSync(stdoutPath, "w");
  const stderrFd = fs.openSync(stderrPath, "w");

  const readFileLimited = (path: string, maxBytes: number): string => {
    try {
      const fd = fs.openSync(path, "r");
      try {
        const buf = Buffer.allocUnsafe(maxBytes);
        const n = fs.readSync(fd, buf, 0, maxBytes, 0);
        return buf.subarray(0, n).toString("utf8");
      } finally {
        fs.closeSync(fd);
      }
    } catch {
      return "";
    }
  };

  return await new Promise<ExecActionResult>((resolvePromise) => {
    const child = spawn(parsed.command, parsed.params ?? [], {
      cwd,
      env,
      shell: false,
      windowsHide: true,
      // Capture output to files rather than pipes:
      // This is more reliable in constrained environments and keeps memory bounded.
      stdio: ["ignore", stdoutFd, stderrFd],
    });

    let truncated = false;
    let timedOut = false;

    const safeKill = () => {
      if (child.killed) return;
      try {
        child.kill("SIGKILL");
      } catch {
        // ignore
      }
    };

    const tTimeout = setTimeout(() => {
      timedOut = true;
      safeKill();
    }, timeoutMs);

    const tSize = setInterval(() => {
      try {
        const outSize = fs.statSync(stdoutPath).size;
        const errSize = fs.statSync(stderrPath).size;
        if (outSize + errSize > maxOutputBytes) {
          truncated = true;
          safeKill();
        }
      } catch {
        // ignore
      }
    }, 25);

    const finish = async (exitCode: number | null, signal: NodeJS.Signals | null, errMsg?: string) => {
      clearTimeout(tTimeout);
      clearInterval(tSize);
      try { fs.closeSync(stdoutFd); } catch {}
      try { fs.closeSync(stderrFd); } catch {}

      const durationMs = Date.now() - started;
      const stdout = errMsg ? "" : readFileLimited(stdoutPath, maxOutputBytes);
      const stderr = errMsg ? errMsg : readFileLimited(stderrPath, maxOutputBytes);

      // Best-effort cleanup
      try {
        await rm(tmp, { recursive: true, force: true });
      } catch {
        // ignore
      }

      resolvePromise({
        exitCode,
        signal,
        stdout,
        stderr,
        truncated,
        timedOut,
        durationMs,
      });
    };

    child.on("error", (err) => {
      void finish(null, null, String(err?.message ?? err));
    });

    child.on("close", (code, signal) => {
      void finish(code, signal);
    });
  });
}
