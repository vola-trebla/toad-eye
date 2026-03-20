import type {
  BudgetConfig,
  BudgetExceededMode,
  BudgetState,
  BudgetExceededInfo,
  DowngradeCallback,
} from "./types.js";
import { ToadBudgetExceededError } from "./error.js";

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export class BudgetTracker {
  private readonly config: BudgetConfig;
  private readonly mode: BudgetExceededMode;
  private readonly downgrade?: DowngradeCallback | undefined;
  private state: BudgetState;

  constructor(
    config: BudgetConfig,
    mode: BudgetExceededMode,
    downgrade?: DowngradeCallback,
  ) {
    this.config = config;
    this.mode = mode;
    this.downgrade = downgrade;
    this.state = {
      date: todayUTC(),
      totalCost: 0,
      perUser: new Map(),
      perModel: new Map(),
    };
  }

  /** Reset counters if the day has changed. */
  private resetIfNewDay() {
    const today = todayUTC();
    if (this.state.date !== today) {
      this.state = {
        date: today,
        totalCost: 0,
        perUser: new Map(),
        perModel: new Map(),
      };
    }
  }

  /**
   * Check budget BEFORE making an LLM call.
   * Returns modified provider/model if downgrade mode triggers,
   * throws ToadBudgetExceededError if block mode triggers,
   * returns null if no action needed.
   */
  checkBefore(
    provider: string,
    model: string,
    userId?: string,
  ): { provider: string; model: string } | null {
    this.resetIfNewDay();

    const exceeded = this.findExceeded(model, userId);
    if (!exceeded) return null;

    if (this.mode === "block") {
      throw new ToadBudgetExceededError(exceeded);
    }

    if (this.mode === "downgrade" && this.downgrade) {
      return this.downgrade({ provider, model });
    }

    // 'warn' mode — continue, warning emitted after call
    return null;
  }

  /** Record cost AFTER a successful LLM call. Returns exceeded info if budget was just crossed. */
  recordCost(
    cost: number,
    model: string,
    userId?: string,
  ): BudgetExceededInfo | null {
    this.resetIfNewDay();

    this.state.totalCost += cost;
    this.state.perModel.set(
      model,
      (this.state.perModel.get(model) ?? 0) + cost,
    );
    if (userId) {
      this.state.perUser.set(
        userId,
        (this.state.perUser.get(userId) ?? 0) + cost,
      );
    }

    return this.findExceeded(model, userId);
  }

  /** Find which budget (if any) is exceeded. */
  private findExceeded(
    model: string,
    userId?: string,
  ): BudgetExceededInfo | null {
    if (
      this.config.daily !== undefined &&
      this.state.totalCost >= this.config.daily
    ) {
      return {
        budget: "daily",
        limit: this.config.daily,
        current: this.state.totalCost,
      };
    }

    const modelLimit = this.config.perModel?.[model];
    if (modelLimit !== undefined) {
      const modelCost = this.state.perModel.get(model) ?? 0;
      if (modelCost >= modelLimit) {
        return {
          budget: "perModel",
          limit: modelLimit,
          current: modelCost,
          model,
        };
      }
    }

    if (this.config.perUser !== undefined && userId) {
      const userCost = this.state.perUser.get(userId) ?? 0;
      if (userCost >= this.config.perUser) {
        return {
          budget: "perUser",
          limit: this.config.perUser,
          current: userCost,
          userId,
        };
      }
    }

    return null;
  }

  /** Get current budget usage as percentage (0-100+). */
  getUsagePercent(): number {
    if (this.config.daily === undefined || this.config.daily === 0) return 0;
    this.resetIfNewDay();
    return (this.state.totalCost / this.config.daily) * 100;
  }

  /** Get current state snapshot (for persistence or debugging). */
  getState(): Readonly<BudgetState> {
    this.resetIfNewDay();
    return this.state;
  }

  /** Restore state from persistence (e.g., on startup). */
  restoreState(saved: {
    date: string;
    totalCost: number;
    perUser: Record<string, number>;
    perModel: Record<string, number>;
  }) {
    if (saved.date !== todayUTC()) return; // stale state, ignore
    this.state = {
      date: saved.date,
      totalCost: saved.totalCost,
      perUser: new Map(Object.entries(saved.perUser)),
      perModel: new Map(Object.entries(saved.perModel)),
    };
  }
}
