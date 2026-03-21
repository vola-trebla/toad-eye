import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Import registry directly to test enableAll behavior
import {
  enableAll,
  register,
  disableAll,
} from "../instrumentations/registry.js";
import type { Instrumentation } from "../instrumentations/types.js";

function makeInst(
  name: "openai" | "anthropic" | "gemini",
  enables: boolean,
): Instrumentation {
  return {
    name,
    enable: vi.fn(() => enables),
    disable: vi.fn(),
  };
}

describe("enableAll — user-visible warnings", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    disableAll();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    disableAll();
  });

  it("warns with console.warn when provider is unknown (not registered)", () => {
    // @ts-expect-error — intentionally passing unknown provider
    enableAll(["opanai"]);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("unknown provider"),
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("opanai"));
  });

  it("includes valid provider list in the unknown provider warning", () => {
    // @ts-expect-error — intentionally passing unknown provider
    enableAll(["groq"]);

    const call = warnSpy.mock.calls[0]?.[0] as string;
    expect(call).toMatch(/valid providers:/);
  });

  it("warns with console.warn when SDK is not installed", () => {
    const inst = makeInst("openai", false); // enable() returns false = SDK not found
    register(inst);
    enableAll(["openai"]);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"openai" SDK not found'),
    );
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("npm install openai"),
    );
  });

  it("includes correct package name hint for gemini", () => {
    const inst = makeInst("gemini", false);
    register(inst);
    enableAll(["gemini"]);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("@google/generative-ai"),
    );
  });

  it("does not warn when provider is successfully patched", () => {
    const inst = makeInst("anthropic", true);
    register(inst);
    enableAll(["anthropic"]);

    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not re-warn when provider is already active", () => {
    const inst = makeInst("openai", true);
    register(inst);
    enableAll(["openai"]);
    enableAll(["openai"]); // second call — already active

    expect(inst.enable).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
