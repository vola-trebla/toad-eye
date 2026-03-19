/**
 * Central type definitions for toad-eye.
 *
 * Organized by concern:
 * - providers.ts  — supported LLM provider names
 * - config.ts     — ToadEyeConfig (initObservability options)
 * - attributes.ts — OTel span attribute keys (GEN_AI_ATTRS)
 * - metrics.ts    — OTel metric names (GEN_AI_METRICS)
 * - spans.ts      — span-related types (LLMSpanAttributes, SpanStatus)
 */

export const INSTRUMENTATION_NAME = "toad-eye";

export type { LLMProvider } from "./providers.js";
export type { ToadEyeConfig } from "./config.js";
export { GEN_AI_ATTRS, LLM_ATTRS } from "./attributes.js";
export { GEN_AI_METRICS, LLM_METRICS } from "./metrics.js";
export type { MetricName } from "./metrics.js";
export type {
  SpanStatus,
  LLMSpanAttributes,
  AgentStepType,
  AgentStepInput,
} from "./spans.js";
