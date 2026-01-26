/**
 * OAuth flow for Claude subscription using pi-ai
 * @see design.md DR-007
 */

import {
  loginAnthropic,
  refreshAnthropicToken,
  type OAuthCredentials,
} from "@mariozechner/pi-ai";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import open from "open";
import { createInterface } from "node:readline";
import { createLogger } from "../utils/logger.js";

const log = createLogger("oauth");

const AUTH_FILE = join(
  process.env.HOME ?? process.env.USERPROFILE ?? ".",
  ".owliabot",
  "auth.json"
);

/**
 * Start OAuth flow for Anthropic
 */
export async function startOAuthFlow(): Promise<OAuthCredentials> {
  log.info("Starting Anthropic OAuth flow...");

  const credentials = await loginAnthropic(
    // Open browser with auth URL
    (url: string) => {
      log.info("Opening browser for authentication...");
      log.info(`If browser doesn't open, visit: ${url}`);
      open(url);
    },
    // Prompt for authorization code
    async () => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      return new Promise<string>((resolve) => {
        rl.question("Paste authorization code: ", (code) => {
          rl.close();
          resolve(code.trim());
        });
      });
    }
  );

  // Save credentials
  await saveOAuthCredentials(credentials);

  log.info("Authentication successful!");
  return credentials;
}

/**
 * Refresh OAuth token
 */
export async function refreshOAuthCredentials(
  credentials: OAuthCredentials
): Promise<OAuthCredentials> {
  log.info("Refreshing OAuth token...");

  const newCredentials = await refreshAnthropicToken(credentials.refresh);

  // Save new credentials
  await saveOAuthCredentials(newCredentials);

  log.info("Token refreshed successfully");
  return newCredentials;
}

/**
 * Load saved OAuth credentials
 */
export async function loadOAuthCredentials(): Promise<OAuthCredentials | null> {
  try {
    const content = await readFile(AUTH_FILE, "utf-8");
    const data = JSON.parse(content) as OAuthCredentials;

    // Check if expired
    if (Date.now() >= data.expires) {
      log.debug("OAuth token expired, needs refresh");
      // Auto-refresh
      try {
        return await refreshOAuthCredentials(data);
      } catch (err) {
        log.warn("Token refresh failed, need re-authentication");
        return null;
      }
    }

    return data;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

/**
 * Save OAuth credentials
 */
export async function saveOAuthCredentials(
  credentials: OAuthCredentials
): Promise<void> {
  await mkdir(dirname(AUTH_FILE), { recursive: true });
  await writeFile(AUTH_FILE, JSON.stringify(credentials, null, 2));
  log.debug(`Credentials saved to ${AUTH_FILE}`);
}

/**
 * Clear saved OAuth credentials
 */
export async function clearOAuthCredentials(): Promise<void> {
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(AUTH_FILE);
    log.info("Credentials cleared");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err;
    }
  }
}

/**
 * Check OAuth status
 */
export async function getOAuthStatus(): Promise<{
  authenticated: boolean;
  expiresAt?: number;
  email?: string;
}> {
  const credentials = await loadOAuthCredentials();

  if (!credentials) {
    return { authenticated: false };
  }

  return {
    authenticated: true,
    expiresAt: credentials.expires,
    email: credentials.email,
  };
}
