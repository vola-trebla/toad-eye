/** Thrown when context guard blockAt threshold is exceeded. */
export class ToadContextExceededError extends Error {
  readonly utilization: number;
  readonly threshold: number;
  readonly model: string;
  readonly maxContextTokens: number;
  readonly inputTokens: number;

  constructor(info: {
    utilization: number;
    threshold: number;
    model: string;
    maxContextTokens: number;
    inputTokens: number;
  }) {
    super(
      `toad-eye: context window ${(info.utilization * 100).toFixed(0)}% full (${info.inputTokens}/${info.maxContextTokens} tokens) for model ${info.model} — blocked at ${(info.threshold * 100).toFixed(0)}%`,
    );
    this.name = "ToadContextExceededError";
    this.utilization = info.utilization;
    this.threshold = info.threshold;
    this.model = info.model;
    this.maxContextTokens = info.maxContextTokens;
    this.inputTokens = info.inputTokens;
  }
}
