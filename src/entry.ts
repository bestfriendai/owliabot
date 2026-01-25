#!/usr/bin/env node
/**
 * OwliaBot entry point
 */

import { program } from "commander";
import { join } from "node:path";
import { loadConfig } from "./config/loader.js";
import { loadWorkspace } from "./workspace/loader.js";
import { startGateway } from "./gateway/server.js";
import { logger } from "./utils/logger.js";
import { createAuthStore } from "./auth/store.js";
import { startOAuthFlow } from "./auth/oauth.js";

const log = logger;

program
  .name("owliabot")
  .description("Crypto-native AI agent for Telegram and Discord")
  .version("0.1.0");

program
  .command("start")
  .description("Start the bot")
  .option("-c, --config <path>", "Config file path", "config.yaml")
  .action(async (options) => {
    try {
      log.info("Starting OwliaBot...");

      // Load config
      const config = await loadConfig(options.config);

      // Load workspace
      const workspace = await loadWorkspace(config.workspace);

      // Determine sessions directory
      const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";
      const sessionsDir = join(homeDir, ".owliabot", "sessions");

      // Start gateway
      const stop = await startGateway({
        config,
        workspace,
        sessionsDir,
      });

      // Handle shutdown
      const shutdown = async () => {
        log.info("Shutting down...");
        await stop();
        process.exit(0);
      };

      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      log.info("OwliaBot is running. Press Ctrl+C to stop.");
    } catch (err) {
      log.error("Failed to start", err);
      process.exit(1);
    }
  });

// Auth command group
const auth = program.command("auth").description("Manage authentication");

auth
  .command("setup")
  .description("Setup OAuth authentication with Claude")
  .action(async () => {
    try {
      const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";
      const authDir = join(homeDir, ".owliabot");
      const store = createAuthStore(authDir);

      log.info("Starting OAuth setup...");
      const token = await startOAuthFlow({ store });
      log.info("Authentication successful!");
      log.info(`Token expires at: ${new Date(token.expiresAt).toISOString()}`);
    } catch (err) {
      log.error("Authentication failed", err);
      process.exit(1);
    }
  });

auth
  .command("status")
  .description("Check authentication status")
  .action(async () => {
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";
    const authDir = join(homeDir, ".owliabot");
    const store = createAuthStore(authDir);

    const token = await store.get();
    if (!token) {
      log.info("Not authenticated. Run 'owliabot auth setup' to authenticate.");
      return;
    }

    if (store.isExpired(token)) {
      log.info("Token expired. Run 'owliabot auth setup' to re-authenticate.");
    } else if (store.needsRefresh(token)) {
      log.info("Token will expire soon, will be refreshed automatically.");
      log.info(`Expires at: ${new Date(token.expiresAt).toISOString()}`);
    } else {
      log.info("Authenticated");
      log.info(`Token expires at: ${new Date(token.expiresAt).toISOString()}`);
    }
  });

auth
  .command("logout")
  .description("Clear stored authentication")
  .action(async () => {
    const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? ".";
    const authDir = join(homeDir, ".owliabot");
    const store = createAuthStore(authDir);
    await store.clear();
    log.info("Logged out successfully");
  });

program.parse();
