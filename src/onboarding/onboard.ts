/**
 * Unified onboarding for OwliaBot (dev + docker modes)
 *
 * --docker flag switches to Docker-aware mode:
 *   - Generates docker-compose.yml
 *   - Writes configs to ~/.owliabot + ./config
 *   - Always configures gateway token + timezone
 *
 * Without --docker (dev mode):
 *   - Writes to ~/.owlia_dev/ via storage helpers
 *   - Optional gateway, workspace init, clawlet, writeGate
 */

import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { stringify as yamlStringify } from "yaml";
import { createLogger } from "../utils/logger.js";
import type { AppConfig, ProviderConfig, MemorySearchConfig, SystemCapabilityConfig, LLMProviderId } from "./types.js";
import { saveAppConfig, DEFAULT_APP_CONFIG_PATH, IS_DEV_MODE } from "./storage.js";
import { startOAuthFlow } from "../auth/oauth.js";
import { saveSecrets, loadSecrets, type SecretsConfig } from "./secrets.js";
import { ensureWorkspaceInitialized } from "../workspace/init.js";
import { runClawletOnboarding } from "./clawlet-onboard.js";
import { validateAnthropicSetupToken, isSetupToken } from "../auth/setup-token.js";
import {
  COLORS,
  info,
  success,
  warn,
  error as errorMsg,
  header,
  ask,
  askYN,
  selectOption,
  printBanner,
  DEFAULT_MODELS,
  detectExistingConfig as detectExistingConfigFromDir,
  type ExistingConfig,
} from "./shared.js";

const log = createLogger("onboard");

// ─────────────────────────────────────────────────────────────────────────────
// Docker helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Safely chmod a path, ignoring EPERM/EACCES errors from bind-mounted volumes.
 */
function safeChmod(path: string, mode: number): boolean {
  try {
    chmodSync(path, mode);
    return true;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EACCES") return false;
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dev-mode config detection (reads via secrets loader)
// ─────────────────────────────────────────────────────────────────────────────

async function detectExistingConfigFromSecrets(appConfigPath: string): Promise<ExistingConfig | null> {
  try {
    const existing = await loadSecrets(appConfigPath);
    if (!existing) return null;

    const result: ExistingConfig = {};
    let hasAny = false;

    if (existing.anthropic?.apiKey) { result.anthropicKey = existing.anthropic.apiKey; hasAny = true; }
    if (existing.anthropic?.token) { result.anthropicToken = existing.anthropic.token; hasAny = true; }
    if (existing.openai?.apiKey) { result.openaiKey = existing.openai.apiKey; hasAny = true; }
    if (existing.discord?.token) { result.discordToken = existing.discord.token; hasAny = true; }
    if (existing.telegram?.token) { result.telegramToken = existing.telegram.token; hasAny = true; }

    return hasAny ? result : null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Docker-mode config detection (reads from ~/.owliabot)
// ─────────────────────────────────────────────────────────────────────────────

interface DockerExistingConfig extends ExistingConfig {
  openaiCompatKey?: string;
  anthropicOAuth?: boolean;
  openaiOAuth?: boolean;
}

function detectExistingConfigDocker(): DockerExistingConfig | null {
  const home = homedir();
  const configDir = join(home, ".owliabot");
  const secretsPath = join(configDir, "secrets.yaml");

  const baseConfig = detectExistingConfigFromDir(configDir);
  if (!baseConfig && !existsSync(secretsPath)) return null;

  const result: DockerExistingConfig = baseConfig ? { ...baseConfig } : {};

  // Check for openai-compatible key
  if (existsSync(secretsPath)) {
    const content = readFileSync(secretsPath, "utf-8");
    const compatMatch = content.match(/^openai-compatible:\s*\n\s+apiKey:\s*"?([^"\n]+)"?/m);
    if (compatMatch?.[1] && compatMatch[1] !== '""') {
      result.openaiCompatKey = compatMatch[1];
    }
  }

  if (baseConfig?.hasOAuthAnthro) result.anthropicOAuth = true;
  if (baseConfig?.hasOAuthCodex) result.openaiOAuth = true;

  return Object.keys(result).length > 0 ? result : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public interface
// ─────────────────────────────────────────────────────────────────────────────

export interface OnboardOptions {
  /** Path for app.yaml in dev mode */
  appConfigPath?: string;
  /** Enable Docker-aware mode */
  docker?: boolean;
  /** Config output directory (docker mode) */
  configDir?: string;
  /** Output directory for docker-compose.yml (docker mode) */
  outputDir?: string;
}

export async function runOnboarding(options: OnboardOptions = {}): Promise<void> {
  const dockerMode = options.docker === true;

  if (dockerMode) {
    return runDockerMode(options);
  }
  return runDevMode(options);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: provider Q&A
// ─────────────────────────────────────────────────────────────────────────────

interface ProviderResult {
  providers: ProviderConfig[];
  secrets: SecretsConfig;
  /** Flags for Docker-mode OAuth guidance */
  useAnthropic: boolean;
  useOpenaiCodex: boolean;
}

async function askProviders(
  rl: ReturnType<typeof createInterface>,
  dockerMode: boolean,
): Promise<ProviderResult> {
  const secrets: SecretsConfig = {};
  const providers: ProviderConfig[] = [];
  let priority = 1;
  let useAnthropic = false;
  let useOpenaiCodex = false;

  const aiChoice = await selectOption(rl, "Choose your AI provider(s):", [
    "Anthropic (Claude) - API Key or setup-token",
    "OpenAI (API key)",
    dockerMode
      ? "OpenAI (OAuth via ChatGPT Plus/Pro - openai-codex)"
      : "OpenAI Codex (ChatGPT Plus/Pro OAuth)",
    "OpenAI-compatible (Ollama / vLLM / LM Studio / etc.)",
    "Multiple providers (fallback chain)",
  ]);

  // Anthropic
  if (aiChoice === 0 || aiChoice === 4) {
    useAnthropic = true;
    console.log("");

    if (dockerMode) {
      header("Anthropic Authentication");
      info("Anthropic: https://console.anthropic.com/settings/keys");
      const useOAuth = await askYN(rl, "Use OAuth instead of API key? (Claude Pro/Max subscription)", true);
      if (!useOAuth) {
        const key = await ask(rl, "Enter Anthropic API key: ", true);
        if (key) {
          secrets.anthropic = { apiKey: key };
          success("Anthropic API key set");
        }
      } else {
        success("Anthropic OAuth: after starting the container, run:");
        info("  docker exec -it owliabot owliabot auth setup anthropic");
      }
    } else {
      header("Anthropic Authentication");
      info("Supports two authentication methods:");
      info("");
      info("  • Setup-token (Claude Pro/Max subscription)");
      info("    Run `claude setup-token` to generate one");
      info("    Format: sk-ant-oat01-...");
      info("");
      info("  • API Key (pay-as-you-go)");
      info("    Get from console.anthropic.com");
      info("    Format: sk-ant-api03-...");
      console.log("");

      const tokenAns = await ask(rl, "Paste setup-token or API key (leave empty for env var): ");
      if (tokenAns) {
        if (isSetupToken(tokenAns)) {
          const err = validateAnthropicSetupToken(tokenAns);
          if (err) warn(`Setup-token validation warning: ${err}`);
          secrets.anthropic = { token: tokenAns };
          success("Setup-token saved (Claude Pro/Max)");
        } else {
          secrets.anthropic = { apiKey: tokenAns };
          success("API key saved");
        }
      }
    }

    const defaultModel = DEFAULT_MODELS.anthropic;
    const model = (await ask(rl, `Model [${defaultModel}]: `)) || defaultModel;
    const apiKeyValue = dockerMode
      ? (secrets.anthropic?.apiKey ? "secrets" : "oauth")
      : (secrets.anthropic ? "secrets" : "env");

    providers.push({
      id: "anthropic",
      model,
      apiKey: apiKeyValue,
      priority: priority++,
    } as ProviderConfig);
  }

  // OpenAI
  if (aiChoice === 1 || aiChoice === 4) {
    console.log("");
    info("OpenAI API keys: https://platform.openai.com/api-keys");
    const apiKey = await ask(rl, dockerMode ? "Enter OpenAI API key: " : "OpenAI API key (leave empty for env var): ", dockerMode);
    if (apiKey) {
      secrets.openai = { apiKey };
      success("OpenAI API key saved");
    }

    const defaultModel = DEFAULT_MODELS.openai;
    const model = (await ask(rl, `Model [${defaultModel}]: `)) || defaultModel;
    providers.push({
      id: "openai",
      model,
      apiKey: apiKey ? "secrets" : "env",
      priority: priority++,
    } as ProviderConfig);
  }

  // OpenAI Codex (OAuth)
  if (aiChoice === 2 || aiChoice === 4) {
    useOpenaiCodex = true;
    console.log("");
    info("OpenAI Codex uses your ChatGPT Plus/Pro subscription via OAuth.");

    if (dockerMode) {
      success("OpenAI OAuth: after starting the container, run:");
      info("  docker exec -it owliabot owliabot auth setup openai-codex");
    } else {
      const runOAuth = await askYN(rl, "Start OAuth flow now?", false);
      if (runOAuth) {
        info("Starting OpenAI Codex OAuth flow...");
        await startOAuthFlow("openai-codex");
        success("OAuth completed");
      } else {
        info("Run `owliabot auth setup openai-codex` later to authenticate.");
      }
    }

    providers.push({
      id: "openai-codex",
      model: DEFAULT_MODELS["openai-codex"],
      apiKey: "oauth",
      priority: priority++,
    } as ProviderConfig);
  }

  // OpenAI-compatible
  if (aiChoice === 3 || aiChoice === 4) {
    console.log("");
    info("OpenAI-compatible supports any server with the OpenAI v1 API:");
    info("  - Ollama:    http://localhost:11434/v1");
    info("  - vLLM:      http://localhost:8000/v1");
    info("  - LM Studio: http://localhost:1234/v1");
    if (!dockerMode) info("  - LocalAI:   http://localhost:8080/v1");
    console.log("");

    const baseUrl = await ask(rl, "API base URL: ");
    if (baseUrl) {
      const defaultModel = DEFAULT_MODELS["openai-compatible"];
      const model = (await ask(rl, `Model [${defaultModel}]: `)) || defaultModel;
      const apiKey = await ask(rl, dockerMode ? "API key (optional): " : "API key (optional, leave empty if not required): ", dockerMode);

      providers.push({
        id: "openai-compatible" as LLMProviderId,
        model,
        baseUrl,
        apiKey: apiKey ? "secrets" : "none",
        priority: priority++,
      } as ProviderConfig);

      if (apiKey) {
        (secrets as any)["openai-compatible"] = { apiKey };
      }
      success(`OpenAI-compatible configured: ${baseUrl}`);
    }
  }

  return { providers, secrets, useAnthropic, useOpenaiCodex };
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared: channel Q&A
// ─────────────────────────────────────────────────────────────────────────────

interface ChannelResult {
  discordEnabled: boolean;
  telegramEnabled: boolean;
  discordToken: string;
  telegramToken: string;
}

async function askChannels(
  rl: ReturnType<typeof createInterface>,
  secrets: SecretsConfig,
  dockerMode: boolean,
): Promise<ChannelResult> {
  const chatChoice = await selectOption(rl, "Choose platform(s):", [
    "Discord",
    "Telegram",
    "Both",
  ]);

  const discordEnabled = chatChoice === 0 || chatChoice === 2;
  const telegramEnabled = chatChoice === 1 || chatChoice === 2;
  let discordToken = "";
  let telegramToken = "";

  if (discordEnabled) {
    console.log("");
    info("Discord developer portal: https://discord.com/developers/applications");
    if (!dockerMode) {
      info("Setup guide: https://github.com/owliabot/owliabot/blob/main/docs/discord-setup.md");
      info("⚠️  Remember to enable MESSAGE CONTENT INTENT in the developer portal!");
    }
    const token = await ask(
      rl,
      dockerMode ? "Enter Discord bot token: " : "Discord bot token (leave empty to set later): ",
      dockerMode,
    );
    if (token) {
      secrets.discord = { token };
      discordToken = token;
      success("Discord token set");
    }
  }

  if (telegramEnabled) {
    console.log("");
    info("Telegram BotFather: https://t.me/BotFather");
    const token = await ask(
      rl,
      dockerMode ? "Enter Telegram bot token: " : "Telegram bot token (leave empty to set later): ",
      dockerMode,
    );
    if (token) {
      secrets.telegram = { token };
      telegramToken = token;
      success("Telegram token set");
    }
  }

  return { discordEnabled, telegramEnabled, discordToken, telegramToken };
}

// ─────────────────────────────────────────────────────────────────────────────
// Dev mode
// ─────────────────────────────────────────────────────────────────────────────

async function runDevMode(options: OnboardOptions): Promise<void> {
  const appConfigPath = options.appConfigPath ?? DEFAULT_APP_CONFIG_PATH;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    printBanner(IS_DEV_MODE ? "(dev mode)" : "");
    if (IS_DEV_MODE) {
      info("Dev mode enabled (OWLIABOT_DEV=1). Config will be saved to ~/.owlia_dev/");
    }

    // Check for existing config
    const existing = await detectExistingConfigFromSecrets(appConfigPath);
    let reuseExisting = false;
    const secrets: SecretsConfig = {};

    if (existing) {
      header("Existing configuration found");
      info(`Found existing config at: ${dirname(appConfigPath)}`);

      if (existing.anthropicKey) info(`Found Anthropic API key: ${existing.anthropicKey.slice(0, 15)}...`);
      if (existing.anthropicToken) info("Found Anthropic setup-token");
      if (existing.openaiKey) info(`Found OpenAI API key: ${existing.openaiKey.slice(0, 10)}...`);
      if (existing.discordToken) info(`Found Discord token: ${existing.discordToken.slice(0, 20)}...`);
      if (existing.telegramToken) info(`Found Telegram token: ${existing.telegramToken.slice(0, 10)}...`);

      reuseExisting = await askYN(rl, "Do you want to reuse existing configuration?", true);
      if (reuseExisting) {
        success("Will reuse existing configuration");
        if (existing.anthropicKey) secrets.anthropic = { apiKey: existing.anthropicKey };
        if (existing.anthropicToken) secrets.anthropic = { ...secrets.anthropic, token: existing.anthropicToken };
        if (existing.openaiKey) secrets.openai = { apiKey: existing.openaiKey };
        if (existing.discordToken) secrets.discord = { token: existing.discordToken };
        if (existing.telegramToken) secrets.telegram = { token: existing.telegramToken };
      } else {
        info("Will configure new credentials");
      }
    }

    // Channels
    header("Chat platforms");

    let discordEnabled = false;
    let telegramEnabled = false;

    if (reuseExisting && (existing?.discordToken || existing?.telegramToken)) {
      discordEnabled = !!existing.discordToken;
      telegramEnabled = !!existing.telegramToken;
      success("Reusing existing chat platform configuration:");
      if (discordEnabled) info("  - Discord");
      if (telegramEnabled) info("  - Telegram");
    } else {
      const ch = await askChannels(rl, secrets, false);
      discordEnabled = ch.discordEnabled;
      telegramEnabled = ch.telegramEnabled;
    }

    // Workspace
    header("Workspace");
    const defaultWorkspace = join(dirname(appConfigPath), "workspace");
    const workspace = (await ask(rl, `Workspace path [${defaultWorkspace}]: `)) || defaultWorkspace;
    success(`Workspace: ${workspace}`);

    // Provider selection
    header("AI provider setup");

    let providers: ProviderConfig[] = [];
    let priority = 1;

    const hasExistingProvider = reuseExisting && (existing?.anthropicKey || existing?.anthropicToken || existing?.openaiKey);

    if (hasExistingProvider) {
      success("Reusing existing AI provider configuration");

      if (existing?.anthropicKey || existing?.anthropicToken) {
        providers.push({
          id: "anthropic",
          model: DEFAULT_MODELS.anthropic,
          apiKey: existing.anthropicToken ? "secrets" : (existing.anthropicKey ? "secrets" : "env"),
          priority: priority++,
        } as ProviderConfig);
      }
      if (existing?.openaiKey) {
        providers.push({
          id: "openai",
          model: DEFAULT_MODELS.openai,
          apiKey: "secrets",
          priority: priority++,
        } as ProviderConfig);
      }
    } else {
      const result = await askProviders(rl, false);
      providers = result.providers;
      Object.assign(secrets, result.secrets);
    }

    if (providers.length === 0) {
      warn("No provider configured. Add one later in the config file.");
      providers.push({
        id: "anthropic",
        model: DEFAULT_MODELS.anthropic,
        apiKey: "env",
        priority: 1,
      } as ProviderConfig);
    }

    // Gateway HTTP (optional)
    header("Gateway HTTP (optional)");
    info("Gateway HTTP provides a REST API for health checks and integrations.");

    const enableGateway = await askYN(rl, "Enable Gateway HTTP?", false);
    let gatewayConfig: { http?: { host: string; port: number; token?: string } } | undefined;

    if (enableGateway) {
      const port = parseInt(await ask(rl, "Port [8787]: ") || "8787", 10);
      const token = randomBytes(16).toString("hex");
      info(`Generated gateway token: ${token.slice(0, 8)}...`);

      gatewayConfig = {
        http: {
          host: "127.0.0.1",
          port,
          token,
        },
      };
      success(`Gateway HTTP enabled on port ${port}`);
    }

    // Default memory search config
    const memorySearchConfig: MemorySearchConfig = {
      enabled: true,
      provider: "sqlite",
      fallback: "naive",
      store: {
        path: join(workspace, "memory", "{agentId}.sqlite"),
      },
      extraPaths: [],
      sources: ["files"],
      indexing: {
        autoIndex: true,
        minIntervalMs: 5 * 60 * 1000,
      },
    };

    // Default system capability config
    const systemConfig: SystemCapabilityConfig = {
      exec: {
        commandAllowList: [
          "ls", "cat", "head", "tail", "grep", "find", "echo", "pwd", "wc",
          "date", "env", "which", "file", "stat", "du", "df", "curl",
          "rm", "mkdir", "touch", "mv", "cp",
        ],
        envAllowList: ["PATH", "HOME", "USER", "LANG", "LC_ALL"],
        timeoutMs: 60_000,
        maxOutputBytes: 256 * 1024,
      },
      web: {
        domainAllowList: [],
        domainDenyList: [],
        allowPrivateNetworks: false,
        timeoutMs: 15_000,
        maxResponseBytes: 512 * 1024,
        blockOnSecret: true,
      },
      webSearch: {
        defaultProvider: "duckduckgo",
        timeoutMs: 15_000,
        maxResults: 10,
      },
    };

    // Build config
    const config: AppConfig = {
      workspace,
      providers,
      memorySearch: memorySearchConfig,
      system: systemConfig,
    };

    // Collect user allowlists for channels and writeGate
    const userAllowLists: { discord: string[]; telegram: string[] } = {
      discord: [],
      telegram: [],
    };

    if (discordEnabled) {
      header("Discord configuration");
      info("Ensure your bot has these permissions: View Channels, Send Messages, Send Messages in Threads, Read Message History");
      info("See: https://github.com/owliabot/owliabot/blob/main/docs/discord-setup.md");
      console.log("");

      const channelIds = await ask(rl, "Channel allowlist (comma-separated channel IDs, leave empty for all): ");
      const channelAllowList = channelIds.split(",").map((s) => s.trim()).filter(Boolean);

      const memberIds = await ask(rl, "Member allowlist - user IDs allowed to interact (comma-separated): ");
      const memberAllowList = memberIds.split(",").map((s) => s.trim()).filter(Boolean);
      userAllowLists.discord = memberAllowList;

      config.discord = {
        requireMentionInGuild: true,
        channelAllowList,
        ...(memberAllowList.length > 0 && { memberAllowList }),
      };

      if (memberAllowList.length > 0) {
        success(`Discord member allowlist: ${memberAllowList.join(", ")}`);
      }
    }

    if (telegramEnabled) {
      header("Telegram configuration");

      const telegramUserIds = await ask(rl, "User allowlist - user IDs allowed to interact (comma-separated): ");
      const allowList = telegramUserIds.split(",").map((s) => s.trim()).filter(Boolean);
      userAllowLists.telegram = allowList;

      config.telegram = {
        ...(allowList.length > 0 && { allowList }),
      };

      if (allowList.length > 0) {
        success(`Telegram user allowlist: ${allowList.join(", ")}`);
      }
    }

    // Optional Clawlet wallet setup
    const walletConfig = await runClawletOnboarding(rl, secrets);
    if (walletConfig.enabled) {
      config.wallet = {
        clawlet: {
          enabled: true,
          baseUrl: walletConfig.baseUrl,
          requestTimeout: 30000,
          defaultChainId: walletConfig.defaultChainId,
          defaultAddress: walletConfig.defaultAddress,
        },
      };
    }

    // Security: writeGate allowList
    const allUserIds = [...userAllowLists.discord, ...userAllowLists.telegram];

    if (allUserIds.length > 0) {
      header("Write tools security");
      info("Users in the write-tool allowlist can use file write/edit tools.");
      info(`Auto-included from channel allowlists: ${allUserIds.join(", ")}`);

      const writeAllowListAns = await ask(rl, "Additional user IDs to allow (comma-separated, leave empty to use only channel users): ");
      const additionalIds = writeAllowListAns.split(",").map((s) => s.trim()).filter(Boolean);

      const writeToolAllowList = [...new Set([...allUserIds, ...additionalIds])];

      if (writeToolAllowList.length > 0) {
        config.tools = {
          ...(config.tools ?? {}),
          allowWrite: true,
        };
        config.security = {
          writeGateEnabled: false,
          writeToolAllowList,
          writeToolConfirmation: false,
        };
        success("Filesystem write tools enabled (write_file/edit_file/apply_patch)");
        success(`Write-tool allowlist: ${writeToolAllowList.join(", ")}`);
        success("Write-gate globally disabled");
        success("Write-tool confirmation disabled (allowlisted users can write directly)");
      }
    }

    if (gatewayConfig) {
      config.gateway = gatewayConfig;
    }

    // Save config
    header("Saving configuration");

    await saveAppConfig(config, appConfigPath);
    success(`Saved config to: ${appConfigPath}`);

    const hasSecrets = Object.keys(secrets).length > 0;
    if (hasSecrets) {
      await saveSecrets(appConfigPath, secrets);
      success(`Saved secrets to: ${dirname(appConfigPath)}/secrets.yaml`);
    }

    // Initialize workspace
    const workspaceInit = await ensureWorkspaceInitialized({ workspacePath: workspace });
    if (workspaceInit.wroteBootstrap) {
      success("Created BOOTSTRAP.md for first-run setup");
    }
    if (workspaceInit.copiedSkills && workspaceInit.skillsDir) {
      success(`Copied bundled skills to: ${workspaceInit.skillsDir}`);
    }

    // Next steps
    header("Done!");
    console.log("Next steps:");

    if (discordEnabled && !secrets.discord?.token) {
      console.log("  • Set Discord token: owliabot token set discord");
    }
    if (telegramEnabled && !secrets.telegram?.token) {
      console.log("  • Set Telegram token: owliabot token set telegram");
    }
    if (providers.some(p => p.apiKey === "env")) {
      console.log("  • Set API key env var (ANTHROPIC_API_KEY or OPENAI_API_KEY)");
    }
    if (providers.some(p => p.apiKey === "oauth" && p.id === "openai-codex")) {
      console.log("  • Complete OAuth: owliabot auth setup openai-codex");
    }

    console.log("  • Start the bot: owliabot start");
    console.log("");
    success("All set!");

  } finally {
    rl.close();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Docker mode
// ─────────────────────────────────────────────────────────────────────────────

async function runDockerMode(options: OnboardOptions): Promise<void> {
  const configDir = options.configDir ?? "./config";
  const outputDir = options.outputDir ?? ".";

  // Compute host paths for Docker volume mounts
  let hostConfigDir: string;
  if (configDir.startsWith("/app/")) {
    hostConfigDir = "." + configDir.slice(4);
  } else if (configDir.startsWith("/")) {
    hostConfigDir = "./config";
  } else {
    hostConfigDir = configDir.startsWith("./") ? configDir : `./${configDir}`;
  }
  const dockerConfigPath = hostConfigDir;
  const shellConfigPath = hostConfigDir.replace(/^\.\//, "$(pwd)/");

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  try {
    printBanner("(Docker)");

    mkdirSync(configDir, { recursive: true });

    // Check for existing config
    const existing = detectExistingConfigDocker();
    let reuseExisting = false;

    if (existing) {
      header("Existing configuration found");
      info("Found existing config at: ~/.owliabot");

      if (existing.anthropicKey) info(`Found Anthropic API key: ${existing.anthropicKey.slice(0, 10)}...`);
      if (existing.anthropicOAuth) info("Found Anthropic OAuth token");
      if (existing.openaiKey) info(`Found OpenAI API key: ${existing.openaiKey.slice(0, 10)}...`);
      if (existing.openaiOAuth) info("Found OpenAI OAuth token (openai-codex)");
      if (existing.discordToken) info(`Found Discord token: ${existing.discordToken.slice(0, 20)}...`);
      if (existing.telegramToken) info(`Found Telegram token: ${existing.telegramToken.slice(0, 10)}...`);
      if (existing.gatewayToken) info(`Found Gateway token: ${existing.gatewayToken.slice(0, 10)}...`);

      reuseExisting = await askYN(rl, "Do you want to reuse existing configuration?", true);
      if (reuseExisting) {
        success("Will reuse existing configuration");
      } else {
        info("Will configure new credentials");
      }
    }

    // ── AI Providers ──
    header("AI provider setup");

    let secrets: SecretsConfig = {};
    let providers: ProviderConfig[] = [];
    let useAnthropic = false;
    let useOpenaiCodex = false;
    let priority = 1;

    if (reuseExisting && existing) {
      if (existing.anthropicKey || existing.anthropicOAuth) {
        useAnthropic = true;
        if (existing.anthropicKey) secrets.anthropic = { apiKey: existing.anthropicKey };
        providers.push({
          id: "anthropic",
          model: DEFAULT_MODELS.anthropic,
          apiKey: existing.anthropicKey ? "secrets" : "oauth",
          priority: priority++,
        } as ProviderConfig);
        success("Reusing Anthropic configuration");
      }
      if (existing.openaiKey) {
        secrets.openai = { apiKey: existing.openaiKey };
        providers.push({
          id: "openai",
          model: DEFAULT_MODELS.openai,
          apiKey: "secrets",
          priority: priority++,
        } as ProviderConfig);
        success("Reusing OpenAI configuration");
      }
      if (existing.openaiOAuth) {
        useOpenaiCodex = true;
        providers.push({
          id: "openai-codex",
          model: DEFAULT_MODELS["openai-codex"],
          apiKey: "oauth",
          priority: priority++,
        } as ProviderConfig);
        success("Reusing OpenAI OAuth (openai-codex) configuration");
      }
    }

    if (providers.length === 0) {
      const result = await askProviders(rl, true);
      providers = result.providers;
      secrets = result.secrets;
      useAnthropic = result.useAnthropic;
      useOpenaiCodex = result.useOpenaiCodex;
    }

    if (providers.length === 0) {
      errorMsg("You must select at least one provider.");
      process.exit(1);
    }

    // ── Chat platforms ──
    header("Chat platform setup");

    let discordToken = "";
    let telegramToken = "";

    if (reuseExisting && (existing?.discordToken || existing?.telegramToken)) {
      success("Reusing existing chat platform configuration:");
      if (existing?.discordToken) {
        discordToken = existing.discordToken;
        secrets.discord = { token: discordToken };
        info("  - Discord");
      }
      if (existing?.telegramToken) {
        telegramToken = existing.telegramToken;
        secrets.telegram = { token: telegramToken };
        info("  - Telegram");
      }
    } else {
      const ch = await askChannels(rl, secrets, true);
      discordToken = ch.discordToken;
      telegramToken = ch.telegramToken;
    }

    if (!discordToken && !telegramToken) {
      errorMsg("You must configure at least one chat platform token.");
      process.exit(1);
    }

    // ── Gateway HTTP ──
    header("Gateway HTTP");
    info("Gateway HTTP is used for health checks and REST API access.");

    const gatewayPort = await ask(rl, "Host port to expose the gateway [8787]: ") || "8787";

    let gatewayToken = reuseExisting && existing?.gatewayToken ? existing.gatewayToken : "";
    if (!gatewayToken) {
      gatewayToken = randomBytes(16).toString("hex");
      info("Generated a random gateway token.");
    } else {
      success("Reusing existing Gateway token");
    }

    const confirmToken = await ask(rl, `Gateway token [${gatewayToken.slice(0, 8)}...]: `, true);
    if (confirmToken) gatewayToken = confirmToken;
    success("Gateway token set");

    (secrets as any).gateway = { token: gatewayToken };

    // ── Timezone ──
    header("Other settings");
    const tz = await ask(rl, "Timezone [UTC]: ") || "UTC";
    success(`Timezone: ${tz}`);

    // ── Write configs ──
    header("Writing config");

    const home = homedir();
    const owliabotHome = join(home, ".owliabot");
    mkdirSync(owliabotHome, { recursive: true });
    if (!safeChmod(owliabotHome, 0o700)) {
      warn(`Could not chmod ${owliabotHome} - using host permissions (bind-mounted volume)`);
    }
    mkdirSync(join(owliabotHome, "auth"), { recursive: true });

    // Write secrets.yaml
    const secretsData = {
      anthropic: { apiKey: secrets.anthropic?.apiKey ?? "" },
      openai: { apiKey: secrets.openai?.apiKey ?? "" },
      "openai-compatible": { apiKey: (secrets as any)["openai-compatible"]?.apiKey ?? "" },
      discord: { token: secrets.discord?.token ?? "" },
      telegram: { token: secrets.telegram?.token ?? "" },
      gateway: { token: gatewayToken },
    };

    const secretsYaml = `# OwliaBot Secrets
# Generated by onboard on ${new Date().toISOString()}
# This file contains sensitive information. Do NOT commit it.

${yamlStringify(secretsData, { indent: 2 })}`;

    const secretsPath = join(owliabotHome, "secrets.yaml");
    writeFileSync(secretsPath, secretsYaml);
    if (safeChmod(secretsPath, 0o600)) {
      success(`Wrote ${secretsPath} (chmod 600)`);
    } else {
      warn(`Wrote ${secretsPath} (chmod skipped - host-mounted volume, ensure host permissions are secure)`);
    }

    // Write app.yaml
    let appYaml = `# OwliaBot config
# Generated by onboard on ${new Date().toISOString()}
# Secrets are in ~/.owliabot/secrets.yaml

providers:
`;

    for (const p of providers) {
      appYaml += `  - id: ${p.id}\n`;
      appYaml += `    model: ${p.model}\n`;
      appYaml += `    apiKey: ${p.apiKey}\n`;
      if ((p as any).baseUrl) {
        appYaml += `    baseUrl: ${(p as any).baseUrl}\n`;
      }
      appYaml += `    priority: ${p.priority}\n`;
    }

    appYaml += `\n# Chat platform config (tokens are read from secrets.yaml)\n`;
    if (discordToken) appYaml += `discord:\n  enabled: true\n`;
    if (telegramToken) appYaml += `telegram:\n  enabled: true\n`;

    appYaml += `
# Gateway HTTP config (token resolved from secrets.yaml)
gateway:
  http:
    host: 0.0.0.0
    port: 8787
    token: secrets

workspace: /app/workspace
timezone: ${tz}
`;

    const appConfigPath = join(configDir, "app.yaml");
    writeFileSync(appConfigPath, appYaml);
    success(`Wrote ${appConfigPath}`);

    // Create symlink for secrets
    const secretsLink = join(configDir, "secrets.yaml");
    try {
      const { symlinkSync, unlinkSync } = await import("node:fs");
      try { unlinkSync(secretsLink); } catch {}
      symlinkSync(secretsPath, secretsLink);
      success(`Linked ${secretsLink} -> ${secretsPath}`);
    } catch {
      info("Note: Could not create symlink. Mount secrets.yaml manually.");
    }

    // ── Docker output ──
    header("Docker commands");

    const image = "ghcr.io/owliabot/owliabot:latest";

    // Docker run command
    console.log("Docker run command:");
    console.log(`
docker run -d \\
  --name owliabot \\
  --restart unless-stopped \\
  -p 127.0.0.1:${gatewayPort}:8787 \\
  -v ~/.owliabot/secrets.yaml:/app/config/secrets.yaml:ro \\
  -v ~/.owliabot/auth:/home/owliabot/.owliabot/auth \\
  -v ${shellConfigPath}/app.yaml:/app/config/app.yaml:ro \\
  -v owliabot_workspace:/app/workspace \\
  -e TZ=${tz} \\
  ${image} \\
  start -c /app/config/app.yaml
`);

    // docker-compose.yml
    const composeYaml = `# docker-compose.yml for OwliaBot
# Generated by onboard

services:
  owliabot:
    image: ${image}
    container_name: owliabot
    restart: unless-stopped
    ports:
      - "127.0.0.1:${gatewayPort}:8787"
    volumes:
      - ~/.owliabot/secrets.yaml:/app/config/secrets.yaml:ro
      - ~/.owliabot/auth:/home/owliabot/.owliabot/auth
      - ${dockerConfigPath}/app.yaml:/app/config/app.yaml:ro
      - owliabot_workspace:/app/workspace
    environment:
      - TZ=${tz}
    command: ["start", "-c", "/app/config/app.yaml"]
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:8787/health"]
      interval: 5s
      timeout: 3s
      retries: 3
      start_period: 10s

volumes:
  owliabot_workspace:
    name: owliabot_workspace
`;

    const composePath = join(outputDir, "docker-compose.yml");
    writeFileSync(composePath, composeYaml);
    success(`Wrote ${composePath}`);
    console.log("\nTo start:");
    console.log("  docker compose up -d     # Docker Compose v2");
    console.log("  docker-compose up -d     # Docker Compose v1");

    // ── Summary ──
    header("Done");

    console.log("Files created:");
    console.log("  - ~/.owliabot/secrets.yaml   (sensitive)");
    console.log("  - ~/.owliabot/auth/          (OAuth tokens)");
    console.log("  - ./config/app.yaml          (app config)");
    console.log("  - ./docker-compose.yml       (Docker Compose)");
    console.log("");

    const needsOAuth = (useAnthropic && !secrets.anthropic?.apiKey) || useOpenaiCodex;

    console.log("Next steps:");
    console.log("  1. Start the container:");
    console.log("     docker compose up -d");
    console.log("");
    if (needsOAuth) {
      console.log("  2. Set up OAuth authentication (run after container is started):");
      if (useAnthropic && !secrets.anthropic?.apiKey) {
        console.log("     docker exec -it owliabot owliabot auth setup anthropic");
      }
      if (useOpenaiCodex) {
        console.log("     docker exec -it owliabot owliabot auth setup openai-codex");
      }
      console.log("");
      console.log("  3. Check logs:");
    } else {
      console.log("  2. Check logs:");
    }
    console.log("     docker compose logs -f");
    console.log("");

    console.log("Gateway HTTP:");
    console.log(`  - URL:   http://localhost:${gatewayPort}`);
    console.log(`  - Token: ${gatewayToken.slice(0, 8)}...`);
    console.log("");

    success("All set!");

  } finally {
    rl.close();
  }
}
