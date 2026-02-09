import path from "node:path";

export function resolveHomeDir(): string {
  return process.env.HOME ?? process.env.USERPROFILE ?? ".";
}

function expandTilde(p: string, homeDir: string): string {
  if (p === "~") return homeDir;
  if (p.startsWith("~/")) return path.join(homeDir, p.slice(2));
  if (p.startsWith("~")) return p.replace(/^~/, homeDir);
  return p;
}

/**
 * Resolve OWLIABOT_HOME for this process.
 *
 * Precedence:
 * 1) $OWLIABOT_HOME (if set)
 * 2) if $OWLIABOT_DEV is truthy: ~/.owlia_dev
 * 3) ~/.owliabot
 */
export function resolveOwliabotHome(): string {
  const homeDir = resolveHomeDir();

  const env = process.env.OWLIABOT_HOME?.trim();
  const dev = ["1", "true"].includes(process.env.OWLIABOT_DEV?.toLowerCase() ?? "");

  const base = env && env.length > 0
    ? env
    : dev
      ? path.join(homeDir, ".owlia_dev")
      : path.join(homeDir, ".owliabot");

  return path.resolve(expandTilde(base, homeDir));
}

/**
 * Ensure $OWLIABOT_HOME is set (useful because config loader expands ${OWLIABOT_HOME}).
 * Returns the resolved absolute path.
 */
export function ensureOwliabotHomeEnv(): string {
  if (!process.env.OWLIABOT_HOME?.trim()) {
    process.env.OWLIABOT_HOME = resolveOwliabotHome();
  }
  return process.env.OWLIABOT_HOME!;
}

/** Resolve a user-provided path-like string (supports leading ~). */
export function resolvePathLike(p: string): string {
  const homeDir = resolveHomeDir();
  return path.resolve(expandTilde(p, homeDir));
}

export function defaultConfigPath(): string {
  const home = ensureOwliabotHomeEnv();
  return path.join(home, "app.yaml");
}

export function defaultWorkspacePath(): string {
  const home = ensureOwliabotHomeEnv();
  return path.join(home, "workspace");
}

export function defaultSessionsDir(): string {
  const home = ensureOwliabotHomeEnv();
  return path.join(home, "sessions");
}

export function defaultCronStorePath(): string {
  const home = ensureOwliabotHomeEnv();
  return path.join(home, "cron", "jobs.json");
}

export function defaultGatewayDir(): string {
  const home = ensureOwliabotHomeEnv();
  return path.join(home, "gateway");
}

export function defaultInfraDbPath(): string {
  return path.join(defaultGatewayDir(), "infra.db");
}

export function defaultGatewayHttpDbPath(): string {
  return path.join(defaultGatewayDir(), "http.db");
}

export function defaultAuditLogPath(): string {
  return path.join(defaultGatewayDir(), "audit.jsonl");
}

export function defaultAuditArchiveDir(): string {
  return path.join(defaultGatewayDir(), "audit");
}

export function defaultUserSkillsDir(): string {
  const home = ensureOwliabotHomeEnv();
  return path.join(home, "skills");
}

