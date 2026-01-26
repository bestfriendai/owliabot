#!/usr/bin/env npx tsx
/**
 * Quick test script for LLM integration
 * Usage: ANTHROPIC_API_KEY=sk-... npx tsx scripts/test-llm.ts
 */

import { runLLM } from "../src/agent/runner.js";
import { resolveModel, validateAliases } from "../src/agent/models.js";

async function main() {
  console.log("=== OwliaBot LLM Test ===\n");

  // Test 1: Validate model aliases
  console.log("1. Validating model aliases...");
  const validation = validateAliases();
  if (validation.valid) {
    console.log("   ✅ All aliases valid\n");
  } else {
    console.log("   ⚠️ Some aliases invalid:");
    validation.errors.forEach((e) => console.log(`      - ${e}`));
    console.log();
  }

  // Test 2: Resolve model
  console.log("2. Testing model resolution...");
  try {
    const model = resolveModel({ model: "claude-sonnet-4-5" });
    console.log(`   ✅ Resolved: ${model.provider}/${model.id}\n`);
  } catch (err) {
    console.log(`   ❌ Failed: ${(err as Error).message}\n`);
    process.exit(1);
  }

  // Test 3: Call LLM
  console.log("3. Testing LLM call...");
  try {
    const response = await runLLM(
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      [
        { role: "system", content: "You are a helpful assistant. Be very brief.", timestamp: Date.now() },
        { role: "user", content: "Say hello in one word.", timestamp: Date.now() },
      ],
      { maxTokens: 50 }
    );

    console.log(`   ✅ Response: "${response.content}"`);
    console.log(`   📊 Usage: ${response.usage.promptTokens} in / ${response.usage.completionTokens} out`);
    console.log(`   🤖 Provider: ${response.provider}/${response.model}`);
    if (response.truncated) {
      console.log("   ⚠️ Response was truncated");
    }
    console.log();
  } catch (err) {
    console.log(`   ❌ Failed: ${(err as Error).message}\n`);
    process.exit(1);
  }

  // Test 4: Test with tools
  console.log("4. Testing LLM with tools...");
  try {
    const response = await runLLM(
      { provider: "anthropic", model: "claude-sonnet-4-5" },
      [
        { role: "system", content: "You are a helpful assistant.", timestamp: Date.now() },
        { role: "user", content: "What time is it? Use the get_time tool.", timestamp: Date.now() },
      ],
      {
        maxTokens: 200,
        tools: [
          {
            name: "get_time",
            description: "Get the current time",
            parameters: {
              type: "object",
              properties: {},
            },
            security: { level: "read" },
            execute: async () => ({ success: true, data: new Date().toISOString() }),
          },
        ],
      }
    );

    if (response.toolCalls && response.toolCalls.length > 0) {
      console.log(`   ✅ Tool call requested: ${response.toolCalls[0].name}`);
    } else {
      console.log(`   ⚠️ No tool call (response: "${response.content.slice(0, 50)}...")`);
    }
    console.log();
  } catch (err) {
    console.log(`   ❌ Failed: ${(err as Error).message}\n`);
    process.exit(1);
  }

  console.log("=== All tests passed! ===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
