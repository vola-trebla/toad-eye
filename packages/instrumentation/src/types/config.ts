import type { InstrumentTarget } from "./providers.js";
import type {
  BudgetConfig,
  BudgetExceededMode,
  DowngradeCallback,
} from "../budget/types.js";

/** Sampling configuration. Tail sampling runs in OTel Collector, SDK sends all spans. */
export interface SamplingConfig {
  /** SDK-side sampling rate (0.0–1.0). Default: 1.0 (send everything to Collector). */
  readonly sdkRate?: number | undefined;
  /** Collector-side tail sampling settings (used when generating otel-collector.yml). */
  readonly collector?:
    | {
        /** Keep 100% of error traces. Default: true */
        readonly keepErrors?: boolean | undefined;
        /** Keep 100% of traces slower than this (ms). Default: 2000 */
        readonly highLatencyMs?: number | undefined;
        /** Sample this % of healthy traffic (0–100). Default: 10 */
        readonly healthyRate?: number | undefined;
      }
    | undefined;
}

/**
 * Configuration for initObservability().
 * This is what the user passes when connecting toad-eye to their service.
 */
export interface ToadEyeConfig {
  readonly serviceName: string;
  readonly endpoint?: string | undefined;

  // Cloud mode
  /** API key for toad-eye cloud. When set, transport switches to HTTPS cloud endpoint automatically. */
  readonly apiKey?: string | undefined;
  /** Custom cloud endpoint override. Defaults to https://cloud.toad-eye.dev. */
  readonly cloudEndpoint?: string | undefined;

  // FinOps attribution — global attributes applied to all spans/metrics
  readonly attributes?: Readonly<Record<string, string>> | undefined;

  // Privacy
  /** Set to false to disable recording prompt/completion text in spans. */
  readonly recordContent?: boolean | undefined;
  /** Record SHA-256 hash of content instead of plain text. Allows prompt comparison without reading. */
  readonly hashContent?: boolean | undefined;
  /** Salt for hashContent — prepended before hashing to prevent rainbow table attacks on short strings. */
  readonly salt?: string | undefined;
  /** Regex patterns to redact from prompt/completion text before recording. */
  readonly redactPatterns?: readonly RegExp[] | undefined;
  /** Enable built-in redaction patterns for common PII: email, SSN, credit card, phone. */
  readonly redactDefaults?: boolean | undefined;
  /** Log what was masked to console (for debugging redaction config). No data is sent externally. */
  readonly auditMasking?: boolean | undefined;

  // Sampling
  /** Configure trace sampling. Tail sampling happens in OTel Collector, not SDK. */
  readonly sampling?: SamplingConfig | undefined;

  // Auto-instrumentation
  readonly instrument?: readonly InstrumentTarget[] | undefined;

  // Budget guards
  /** Budget limits — daily, per-user, per-model spend caps in USD. */
  readonly budgets?: BudgetConfig | undefined;
  /** What to do when budget is exceeded: 'warn' (log), 'block' (throw), 'downgrade' (callback). */
  readonly onBudgetExceeded?: BudgetExceededMode | undefined;
  /** Callback for 'downgrade' mode — receives original provider/model, returns replacement. */
  readonly downgradeCallback?: DowngradeCallback | undefined;

  // Context guard
  /** Warn or block when context window utilization exceeds thresholds. */
  readonly contextGuard?:
    | {
        /** Warn when utilization exceeds this ratio (0.0–1.0). Default: none. */
        readonly warnAt?: number | undefined;
        /** Block (throw ToadContextExceededError) when utilization exceeds this ratio. Default: none. */
        readonly blockAt?: number | undefined;
      }
    | undefined;

  // Session tracking
  /** Static session ID — all spans will carry this value as `session.id`. */
  readonly sessionId?: string | undefined;
  /** Dynamic session ID extractor — called per traceLLMCall to resolve session ID. */
  readonly sessionExtractor?: (() => string | undefined) | undefined;
}
