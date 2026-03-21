import { describe, it, expect } from "vitest";
import { findContainerByService } from "../cli.js";

const MOCK_CONTAINERS = [
  { Service: "grafana", State: "running" },
  { Service: "jaeger", State: "running" },
  { Service: "prometheus", State: "exited" },
  { Service: "collector", State: "running" },
];

describe("findContainerByService", () => {
  it("matches by exact service name", () => {
    expect(findContainerByService(MOCK_CONTAINERS, "grafana")?.State).toBe(
      "running",
    );
  });

  it("matches collector service", () => {
    expect(findContainerByService(MOCK_CONTAINERS, "collector")?.State).toBe(
      "running",
    );
  });

  it("matches stopped service correctly", () => {
    expect(findContainerByService(MOCK_CONTAINERS, "prometheus")?.State).toBe(
      "exited",
    );
  });

  it("returns undefined for unknown service key", () => {
    expect(findContainerByService(MOCK_CONTAINERS, "unknown")).toBeUndefined();
  });

  it("does not match partial names (old bug: 'a' would match everything)", () => {
    expect(findContainerByService(MOCK_CONTAINERS, "a")).toBeUndefined();
  });

  it("does not match superstrings (old bug: display name includes container name)", () => {
    // Old logic: "jaeger ui".includes("jaeger") — fragile
    // New logic: exact match only
    expect(
      findContainerByService(MOCK_CONTAINERS, "jaeger ui"),
    ).toBeUndefined();
  });

  it("returns undefined for empty containers list", () => {
    expect(findContainerByService([], "grafana")).toBeUndefined();
  });
});
