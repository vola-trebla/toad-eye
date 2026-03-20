/** Budget configuration for initObservability(). */
export interface BudgetConfig {
  /** Max daily spend in USD for the entire application. */
  readonly daily?: number | undefined;
  /** Max daily spend in USD per user. Requires userId in traceLLMCall attributes. */
  readonly perUser?: number | undefined;
  /** Max daily spend in USD per model. */
  readonly perModel?: Readonly<Record<string, number>> | undefined;
}

/** What happens when a budget is exceeded. */
export type BudgetExceededMode = "warn" | "block" | "downgrade";

/** Callback for 'downgrade' mode — receives original input, returns modified input. */
export type DowngradeCallback = (original: {
  readonly provider: string;
  readonly model: string;
}) => { readonly provider: string; readonly model: string };

/** Internal state tracking daily spend. */
export interface BudgetState {
  date: string;
  totalCost: number;
  perUser: Map<string, number>;
  perModel: Map<string, number>;
}

/** Info about which budget was exceeded. */
export interface BudgetExceededInfo {
  readonly budget: "daily" | "perUser" | "perModel";
  readonly limit: number;
  readonly current: number;
  readonly model?: string | undefined;
  readonly userId?: string | undefined;
}
