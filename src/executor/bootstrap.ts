/**
 * Phase 4 — Runtime bootstrap
 *
 * Initializes the RuntimeRegistry with available runtimes based on
 * feature flags and environment configuration.
 */

import type { Database } from "bun:sqlite";
import { RuntimeRegistry } from "./runtime";
import { CliRuntime } from "./cli-runtime";
import { ClaudeAgentSdkRuntime } from "./claude-sdk-runtime";

export function bootstrapRuntimeRegistry(db: Database): RuntimeRegistry {
  const registry = new RuntimeRegistry();

  // CLI runtime is always available (Tier 1 baseline)
  registry.register(new CliRuntime(db));

  // Claude Agent SDK runtime is behind a feature flag
  if (process.env.HB_TIER2_CLAUDE === "1") {
    registry.register(new ClaudeAgentSdkRuntime(db));
  }

  // OpenAI Agent SDK runtime is behind a feature flag (placeholder for Phase 4+)
  if (process.env.HB_TIER2_OPENAI === "1") {
    // registry.register(new OpenAIAgentSdkRuntime(db));
    // Not yet implemented — will be added in a future version
  }

  return registry;
}
