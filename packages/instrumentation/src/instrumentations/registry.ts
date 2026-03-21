import type { LLMProvider } from "../types/index.js";
import type { Instrumentation } from "./types.js";

const instrumentations = new Map<LLMProvider, Instrumentation>();
const active = new Set<LLMProvider>();

export function register(inst: Instrumentation) {
  instrumentations.set(inst.name, inst);
}

export function enableAll(providers: readonly LLMProvider[]) {
  const validProviders = Array.from(instrumentations.keys()).join(", ");

  for (const name of providers) {
    if (active.has(name)) continue;

    const inst = instrumentations.get(name);
    if (!inst) {
      console.warn(
        `toad-eye: unknown provider "${name}" — valid providers: ${validProviders}`,
      );
      continue;
    }

    const patched = inst.enable();
    if (patched) {
      active.add(name);
    } else {
      console.warn(
        `toad-eye: "${name}" SDK not found — install it to enable auto-instrumentation: npm install ${name === "gemini" ? "@google/generative-ai" : name}`,
      );
    }
  }
}

export function disableAll() {
  for (const name of active) {
    instrumentations.get(name)?.disable();
  }
  active.clear();
}
