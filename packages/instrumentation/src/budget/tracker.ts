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
      reservedCost: 0,
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
        reservedCost: 0,
        perUser: new Map(),
        perModel: new Map(),
      };
    }
  }

  /**
   * Check budget BEFORE making an LLM call.
   * - block mode: throws ToadBudgetExceededError if budget is exceeded.
   * - downgrade mode: returns modified provider/model + budget type that triggered it.
   * - warn mode: returns null (warning emitted after call via recordCost).
   *
   * When estimatedCost is provided, it is added to reservedCost so concurrent
   * in-flight requests are counted against the budget before their actual cost is known.
   * Call recordCost with the same estimatedCost to release the reservation.
   */
  checkBefore(
    provider: string,
    model: string,
    userId?: string,
    estimatedCost = 0,
  ): {
    provider: string;
    model: string;
    budget: BudgetExceededInfo["budget"];
  } | null {
    this.resetIfNewDay();

    const exceeded = this.findExceeded(model, userId, estimatedCost);

    if (exceeded) {
      if (this.mode === "block") {
        throw new ToadBudgetExceededError(exceeded);
      }

      if (this.mode === "downgrade" && this.downgrade) {
        this.state.reservedCost += estimatedCost;
        return {
          ...this.downgrade({ provider, model }),
          budget: exceeded.budget,
        };
      }
    }

    // warn mode or no budget exceeded: reserve estimated cost and proceed
    this.state.reservedCost += estimatedCost;
    return null;
  }

  /**
   * Record cost AFTER a successful LLM call. Returns exceeded info if budget was just crossed.
   * Pass the same estimatedCost used in checkBefore() to release the reservation atomically.
   */
  recordCost(
    cost: number,
    model: string,
    userId?: string,
    reservedAmount = 0,
  ): BudgetExceededInfo | null {
    this.resetIfNewDay();

    this.state.reservedCost = Math.max(
      0,
      this.state.reservedCost - reservedAmount,
    );
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
    additionalCost = 0,
  ): BudgetExceededInfo | null {
    if (
      this.config.daily !== undefined &&
      this.state.totalCost + this.state.reservedCost + additionalCost >=
        this.config.daily
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

  /** Release a cost reservation when an LLM call fails (no cost was incurred). */
  releaseReservation(reservedAmount: number) {
    this.state.reservedCost = Math.max(
      0,
      this.state.reservedCost - reservedAmount,
    );
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
      reservedCost: 0,
      perUser: new Map(Object.entries(saved.perUser)),
      perModel: new Map(Object.entries(saved.perModel)),
    };
  }
}
