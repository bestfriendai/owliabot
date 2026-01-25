// Re-export registry
export { providerRegistry, type ProviderCallFn } from "./registry.js";

// Import providers to trigger registration
import "./anthropic.js";
import "./claude-oauth.js";

// Re-export for direct use if needed
export { callAnthropic, type AnthropicConfig } from "./anthropic.js";
