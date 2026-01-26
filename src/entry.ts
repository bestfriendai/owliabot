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
import {
  startOAuthFlow,
  getOAuthStatus,
  clearOAuthCredentials,
} from "./auth/oauth.js";

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
  .description("Setup OAuth authentication with Claude (Anthropic)")
  .action(async () => {
    try {
      log.info("Starting OAuth setup...");
      const credentials = await startOAuthFlow();
      log.info("Authentication successful!");
      log.info(`Token expires at: ${new Date(credentials.expires).toISOString()}`);
      if (credentials.email) {
        log.info(`Account: ${credentials.email}`);
      }
    } catch (err) {
      log.error("Authentication failed", err);
      process.exit(1);
    }
  });

auth
  .command("status")
  .description("Check authentication status")
  .action(async () => {
    const status = await getOAuthStatus();

    if (status.authenticated) {
      log.info("Authenticated with Anthropic OAuth");
      // Token is valid (auto-refresh already happened in getOAuthStatus if needed)
      if (status.expiresAt) {
        log.info(`Token expires at: ${new Date(status.expiresAt).toISOString()}`);
      }
      if (status.email) {
        log.info(`Account: ${status.email}`);
      }
    } else {
      log.info("Not authenticated.");
      log.info("Run 'owliabot auth setup' to authenticate, or set ANTHROPIC_API_KEY.");
    }
  });

auth
  .command("logout")
  .description("Clear stored authentication")
  .action(async () => {
    await clearOAuthCredentials();
    log.info("Logged out successfully");
  });

program.parse();
