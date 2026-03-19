import { diag } from "@opentelemetry/api";
import type { LLMProvider } from "../types/index.js";
import type { Instrumentation } from "./types.js";

const instrumentations = new Map<LLMProvider, Instrumentation>();
const active = new Set<LLMProvider>();

export function register(inst: Instrumentation) {
  instrumentations.set(inst.name, inst);
}

export function enableAll(providers: readonly LLMProvider[]) {
  for (const name of providers) {
    if (active.has(name)) continue;

    const inst = instrumentations.get(name);
    if (!inst) {
      diag.warn(`toad-eye: unknown provider "${name}", skipping`);
      continue;
    }

    const patched = inst.enable();
    if (patched) {
      active.add(name);
      diag.debug(`toad-eye: auto-instrumented ${name}`);
    } else {
      diag.debug(`toad-eye: ${name} SDK not found, skipping`);
    }
  }
}

export function disableAll() {
  for (const name of active) {
    instrumentations.get(name)?.disable();
  }
  active.clear();
}
