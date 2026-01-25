import { createLogger } from "../../utils/logger.js";
import type { Message } from "../session.js";
import type { LLMResponse, CallOptions } from "../runner.js";

const log = createLogger("anthropic");

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

export interface AnthropicConfig {
  apiKey: string;
  model: string;
}

export async function callAnthropic(
  config: AnthropicConfig,
  messages: Message[],
  options?: CallOptions
): Promise<LLMResponse> {
  log.debug(`Calling Anthropic ${config.model}`);

  // Convert messages to Anthropic format
  const anthropicMessages = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  const systemMessage = messages.find((m) => m.role === "system");

  const body = {
    model: config.model,
    max_tokens: options?.maxTokens ?? 4096,
    system: systemMessage?.content,
    messages: anthropicMessages,
  };

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    log.error(`Anthropic error: ${response.status} ${text}`);
    throw new HTTPError(response.status, text);
  }

  const data = (await response.json()) as AnthropicResponse;

  const content = data.content
    .filter((c): c is { type: "text"; text: string } => c.type === "text")
    .map((c) => c.text)
    .join("");

  return {
    content,
    usage: {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens,
    },
    provider: "anthropic",
  };
}

// Import HTTPError from runner
import { HTTPError } from "../runner.js";

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}
