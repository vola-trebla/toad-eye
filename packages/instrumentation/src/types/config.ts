import type { LLMProvider } from "./providers.js";
import type {
  BudgetConfig,
  BudgetExceededMode,
  DowngradeCallback,
} from "../budget/types.js";

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
  /** Regex patterns to redact from prompt/completion text before recording. */
  readonly redactPatterns?: readonly RegExp[] | undefined;

  // Auto-instrumentation
  readonly instrument?: readonly LLMProvider[] | undefined;

  // Budget guards
  /** Budget limits — daily, per-user, per-model spend caps in USD. */
  readonly budgets?: BudgetConfig | undefined;
  /** What to do when budget is exceeded: 'warn' (log), 'block' (throw), 'downgrade' (callback). */
  readonly onBudgetExceeded?: BudgetExceededMode | undefined;
  /** Callback for 'downgrade' mode — receives original provider/model, returns replacement. */
  readonly downgradeCallback?: DowngradeCallback | undefined;

  // Session tracking
  /** Static session ID — all spans will carry this value as `session.id`. */
  readonly sessionId?: string | undefined;
  /** Dynamic session ID extractor — called per traceLLMCall to resolve session ID. */
  readonly sessionExtractor?: (() => string | undefined) | undefined;
}
