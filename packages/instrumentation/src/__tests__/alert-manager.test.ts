import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AlertManager } from "../alerts/manager.js";
import type { AlertsConfig } from "../alerts/types.js";

vi.mock("../alerts/conditions.js", () => ({
  evaluateCondition: vi.fn(),
}));

vi.mock("../alerts/channels.js", () => ({
  sendToChannel: vi.fn(),
}));

vi.mock("../alerts/grafana.js", () => ({
  postGrafanaAnnotation: vi.fn(),
}));

import { evaluateCondition } from "../alerts/conditions.js";
import { sendToChannel } from "../alerts/channels.js";

const TRIGGERED = {
  triggered: true,
  value: 15,
  threshold: 10,
  topModels: [],
};
const NOT_TRIGGERED = {
  triggered: false,
  value: 3,
  threshold: 10,
  topModels: [],
};

function makeConfig(overrides: Partial<AlertsConfig> = {}): AlertsConfig {
  return {
    evalIntervalSeconds: 60,
    alerts: [
      {
        name: "high-cost",
        metric: "gen_ai.client.request.cost",
        condition: "> 10",
        channels: ["slack"],
      },
    ],
    channels: {
      slack: { type: "slack_webhook", url: "https://hooks.slack.example/test" },
    },
    ...overrides,
  };
}

// Flush the immediate evaluate() called in start() without advancing the interval
async function flushImmediate() {
  await vi.advanceTimersByTimeAsync(0);
}

describe("AlertManager lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(evaluateCondition).mockResolvedValue(NOT_TRIGGERED);
    vi.mocked(sendToChannel).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("calls evaluate immediately on start()", async () => {
    const manager = new AlertManager(makeConfig());
    manager.start();
    await flushImmediate();
    expect(evaluateCondition).toHaveBeenCalledTimes(1);
    manager.stop();
  });

  it("calls evaluate again on each interval tick", async () => {
    const manager = new AlertManager(makeConfig({ evalIntervalSeconds: 60 }));
    manager.start();
    await flushImmediate();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(evaluateCondition).toHaveBeenCalledTimes(2);
    manager.stop();
  });

  it("stop() prevents further evaluations", async () => {
    const manager = new AlertManager(makeConfig());
    manager.start();
    await flushImmediate();
    manager.stop();
    await vi.advanceTimersByTimeAsync(120_000);
    // Only the initial evaluate call
    expect(evaluateCondition).toHaveBeenCalledTimes(1);
  });

  it("clamps evalIntervalSeconds below minimum to 10s", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const manager = new AlertManager(makeConfig({ evalIntervalSeconds: 2 }));
    manager.start();
    await flushImmediate();
    // Advance 10s — should trigger second eval (interval was clamped to 10s)
    await vi.advanceTimersByTimeAsync(10_000);
    expect(evaluateCondition).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("below minimum"),
    );
    manager.stop();
    warnSpy.mockRestore();
  });
});

describe("AlertManager cooldown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(sendToChannel).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("fires alert when condition is triggered", async () => {
    vi.mocked(evaluateCondition).mockResolvedValue(TRIGGERED);
    const manager = new AlertManager(makeConfig());
    manager.start();
    await flushImmediate();
    expect(sendToChannel).toHaveBeenCalledTimes(1);
    manager.stop();
  });

  it("does not fire again within cooldown period", async () => {
    vi.mocked(evaluateCondition).mockResolvedValue(TRIGGERED);
    const manager = new AlertManager(
      makeConfig({ evalIntervalSeconds: 60, cooldownMinutes: 30 }),
    );
    manager.start();
    await flushImmediate();
    // Second tick — still within 30-minute cooldown
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sendToChannel).toHaveBeenCalledTimes(1);
    manager.stop();
  });

  it("fires again after cooldown expires", async () => {
    vi.mocked(evaluateCondition).mockResolvedValue(TRIGGERED);
    const manager = new AlertManager(
      makeConfig({ evalIntervalSeconds: 60, cooldownMinutes: 1 }),
    );
    manager.start();
    await flushImmediate();
    // Advance past 1-minute cooldown + one eval interval
    await vi.advanceTimersByTimeAsync(62_000);
    expect(sendToChannel).toHaveBeenCalledTimes(2);
    manager.stop();
  });
});

describe("AlertManager parallel evaluation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(sendToChannel).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("evaluates all rules even when one Prometheus call fails", async () => {
    vi.mocked(evaluateCondition)
      .mockRejectedValueOnce(new Error("Prometheus unreachable"))
      .mockResolvedValueOnce(TRIGGERED);

    const manager = new AlertManager(
      makeConfig({
        alerts: [
          {
            name: "rule-a",
            metric: "gen_ai.client.request.cost",
            condition: "> 10",
            channels: ["slack"],
          },
          {
            name: "rule-b",
            metric: "gen_ai.client.errors",
            condition: "> 5",
            channels: ["slack"],
          },
        ],
      }),
    );

    vi.spyOn(console, "error").mockImplementation(() => {});
    manager.start();
    await flushImmediate();

    // Both rules attempted
    expect(evaluateCondition).toHaveBeenCalledTimes(2);
    // rule-b fired despite rule-a failure
    expect(sendToChannel).toHaveBeenCalledTimes(1);
    manager.stop();
  });

  it("evaluates multiple rules in a single cycle", async () => {
    vi.mocked(evaluateCondition).mockResolvedValue(NOT_TRIGGERED);
    const manager = new AlertManager(
      makeConfig({
        alerts: [
          {
            name: "r1",
            metric: "gen_ai.client.request.cost",
            condition: "> 10",
            channels: ["slack"],
          },
          {
            name: "r2",
            metric: "gen_ai.client.errors",
            condition: "> 5",
            channels: ["slack"],
          },
          {
            name: "r3",
            metric: "gen_ai.client.requests",
            condition: "> 100",
            channels: ["slack"],
          },
        ],
      }),
    );
    manager.start();
    await flushImmediate();
    expect(evaluateCondition).toHaveBeenCalledTimes(3);
    manager.stop();
  });
});

describe("AlertManager channel failure handling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(evaluateCondition).mockResolvedValue(TRIGGERED);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("logs error but continues when channel send fails", async () => {
    vi.mocked(sendToChannel).mockRejectedValue(new Error("Network error"));
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const manager = new AlertManager(makeConfig());
    manager.start();
    await flushImmediate();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Failed to send to channel "slack"'),
      expect.any(Error),
    );
    errorSpy.mockRestore();
    manager.stop();
  });

  it("continues with remaining channels when one fails", async () => {
    vi.mocked(sendToChannel)
      .mockRejectedValueOnce(new Error("slack down"))
      .mockResolvedValueOnce(undefined);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const manager = new AlertManager(
      makeConfig({
        alerts: [
          {
            name: "high-cost",
            metric: "gen_ai.client.request.cost",
            condition: "> 10",
            channels: ["slack", "webhook"],
          },
        ],
        channels: {
          slack: {
            type: "slack_webhook",
            url: "https://hooks.slack.example/test",
          },
          webhook: { type: "webhook", url: "https://hooks.example/test" },
        },
      }),
    );
    manager.start();
    await flushImmediate();
    // Both channels were attempted despite first failing
    expect(sendToChannel).toHaveBeenCalledTimes(2);
    manager.stop();
  });
});

describe("startAlertsFromFile YAML validation", () => {
  it("catches missing alerts array", async () => {
    const { startAlertsFromFile } = await import("../alerts/index.js");
    const { writeFileSync, unlinkSync } = await import("node:fs");
    const tmpPath = "/tmp/toad-eye-test-config.yaml";
    writeFileSync(tmpPath, "evalIntervalSeconds: 60\n");
    expect(() => startAlertsFromFile(tmpPath)).toThrow(
      'missing required "alerts" array',
    );
    unlinkSync(tmpPath);
  });

  it("catches rule missing required field", async () => {
    const { startAlertsFromFile } = await import("../alerts/index.js");
    const { writeFileSync, unlinkSync } = await import("node:fs");
    const tmpPath = "/tmp/toad-eye-test-config2.yaml";
    writeFileSync(
      tmpPath,
      `alerts:\n  - name: broken-rule\n    metric: gen_ai.client.request.cost\n`,
    );
    expect(() => startAlertsFromFile(tmpPath)).toThrow(
      'missing required string field "condition"',
    );
    unlinkSync(tmpPath);
  });

  it("catches rule with no channels", async () => {
    const { startAlertsFromFile } = await import("../alerts/index.js");
    const { writeFileSync, unlinkSync } = await import("node:fs");
    const tmpPath = "/tmp/toad-eye-test-config3.yaml";
    writeFileSync(
      tmpPath,
      `alerts:\n  - name: no-channels\n    metric: gen_ai.client.request.cost\n    condition: "> 10"\n    channels: []\n`,
    );
    expect(() => startAlertsFromFile(tmpPath)).toThrow(
      "must have at least one channel",
    );
    unlinkSync(tmpPath);
  });
});
