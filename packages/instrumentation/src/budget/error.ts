import type { BudgetExceededInfo } from "./types.js";

/** Thrown when onBudgetExceeded is 'block' and a budget limit is hit. */
export class ToadBudgetExceededError extends Error {
  readonly budget: BudgetExceededInfo["budget"];
  readonly limit: number;
  readonly current: number;
  readonly model?: string | undefined;
  readonly userId?: string | undefined;

  constructor(info: BudgetExceededInfo) {
    const target =
      info.budget === "perModel"
        ? ` for model ${info.model}`
        : info.budget === "perUser"
          ? ` for user ${info.userId}`
          : "";
    super(
      `toad-eye: ${info.budget} budget exceeded${target} — limit $${info.limit}, current $${info.current.toFixed(2)}`,
    );
    this.name = "ToadBudgetExceededError";
    this.budget = info.budget;
    this.limit = info.limit;
    this.current = info.current;
    this.model = info.model;
    this.userId = info.userId;
  }
}
