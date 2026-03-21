import type { LLMProvider } from "../types/index.js";
import type { Instrumentation } from "./types.js";

const instrumentations = new Map<LLMProvider, Instrumentation>();
const active = new Set<LLMProvider>();

export function register(inst: Instrumentation) {
  instrumentations.set(inst.name, inst);
}

/**
 * Lazy registration — loads provider modules and registers instrumentations
 * only when enableAll() is first called. This avoids pulling in create.ts,
 * metrics.ts, and node:module on every `import` of toad-eye.
 */
let registered = false;

/** Skip lazy registration (used in tests that register mocks manually). */
export function skipAutoRegister() {
  registered = true;
}

async function ensureRegistered() {
  if (registered) return;
  registered = true;

  const [openai, anthropic, gemini] = await Promise.all([
    import("./openai.js"),
    import("./anthropic.js"),
    import("./gemini.js"),
  ]);

  register(openai.openaiInstrumentation);
  register(anthropic.anthropicInstrumentation);
  register(gemini.geminiInstrumentation);
}

export async function enableAll(providers: readonly LLMProvider[]) {
  await ensureRegistered();

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
