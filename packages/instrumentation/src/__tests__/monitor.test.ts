import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../core/metrics.js", () => ({
  recordSemanticDrift: vi.fn(),
}));

vi.mock("@opentelemetry/api", () => ({
  metrics: { getMeter: () => ({}) },
  diag: { warn: vi.fn(), debug: vi.fn() },
}));

const mockBaseline = {
  model: "gpt-4o",
  provider: "openai",
  embeddingModel: "text-embedding-3-small",
  embeddings: [[1, 0, 0]],
  sampleCount: 1,
  createdAt: "2026-03-19T00:00:00Z",
};

let baselineExists = true;

vi.mock("../drift/baseline.js", () => ({
  loadBaseline: () => (baselineExists ? mockBaseline : undefined),
}));

const { createDriftMonitor } = await import("../drift/monitor.js");
const { recordSemanticDrift } = await import("../core/metrics.js");

const mockEmbed = vi.fn<(text: string) => Promise<readonly number[]>>();

function makeMonitor(sampleRate = 1) {
  return createDriftMonitor({
    embedding: { provider: "custom", embed: mockEmbed },
    baselinePath: "/fake/baseline.json",
    sampleRate,
  });
}

describe("createDriftMonitor", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    baselineExists = true;
    mockEmbed.mockResolvedValue([1, 0, 0]);
  });

  it("returns drift value when checked", async () => {
    const monitor = makeMonitor();
    const drift = await monitor.check("response", "openai", "gpt-4o");
    expect(drift).toBeCloseTo(0);
  });

  it("calls embedding provider with response text", async () => {
    const monitor = makeMonitor();
    await monitor.check("hello world", "openai", "gpt-4o");
    expect(mockEmbed).toHaveBeenCalledWith("hello world");
  });

  it("records drift metric", async () => {
    const monitor = makeMonitor();
    await monitor.check("response", "openai", "gpt-4o");
    expect(recordSemanticDrift).toHaveBeenCalledWith(
      expect.closeTo(0),
      "openai",
      "gpt-4o",
    );
  });

  it("respects sampling rate — skips non-Nth calls", async () => {
    const monitor = makeMonitor(3);

    const r1 = await monitor.check("a", "openai", "gpt-4o");
    const r2 = await monitor.check("b", "openai", "gpt-4o");
    const r3 = await monitor.check("c", "openai", "gpt-4o");

    expect(r1).toBeUndefined(); // 1st — skip
    expect(r2).toBeUndefined(); // 2nd — skip
    expect(r3).toBeCloseTo(0); // 3rd — check
    expect(mockEmbed).toHaveBeenCalledTimes(1);
  });

  it("returns undefined when no baseline exists", async () => {
    baselineExists = false;
    const monitor = makeMonitor();
    const drift = await monitor.check("response", "openai", "gpt-4o");
    expect(drift).toBeUndefined();
    expect(mockEmbed).not.toHaveBeenCalled();
  });

  it("detects high drift for dissimilar responses", async () => {
    mockEmbed.mockResolvedValue([0, 1, 0]); // orthogonal to baseline [1,0,0]
    const monitor = makeMonitor();
    const drift = await monitor.check("different", "openai", "gpt-4o");
    expect(drift).toBeCloseTo(1);
  });
});
