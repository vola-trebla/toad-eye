import { createRequire } from "node:module";
import { diag } from "@opentelemetry/api";
import { traceLLMCall } from "../core/spans.js";
import type { LLMCallOutput } from "../core/spans.js";
import { calculateCost } from "../core/pricing.js";
import type { LLMProvider } from "../types/index.js";
import type { Instrumentation, PatchTarget } from "./types.js";

const require = createRequire(import.meta.url);

interface ActivePatch {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proto: any;
  method: string;
  original: (...args: unknown[]) => unknown;
}

function isModuleInstalled(moduleName: string): boolean {
  try {
    require.resolve(moduleName);
    return true;
  } catch {
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadModule(moduleName: string): any {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sdk = require(moduleName);
  return sdk.default ?? sdk;
}

function createPatchedMethod(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  original: (...args: any[]) => unknown,
  patch: PatchTarget,
  providerName: LLMProvider,
) {
  return function patchedMethod(
    this: unknown,
    body: unknown,
    ...rest: unknown[]
  ) {
    if (patch.shouldSkip?.(body)) {
      return original.call(this, body, ...rest);
    }

    const req = patch.extractRequest(body);

    return traceLLMCall(
      {
        provider: providerName,
        model: req.model,
        prompt: req.prompt,
        temperature: req.temperature,
      },
      async (): Promise<LLMCallOutput> => {
        const response = await original.call(this, body, ...rest);
        const res = patch.extractResponse(response, req.model);

        return {
          completion: res.completion,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
          cost: calculateCost(req.model, res.inputTokens, res.outputTokens),
        };
      },
    );
  };
}

/**
 * Factory for creating SDK instrumentations.
 * Eliminates boilerplate: SDK resolution, prototype patching, error handling, cleanup.
 */
export function createInstrumentation(config: {
  name: LLMProvider;
  moduleName: string;
  patches: PatchTarget[];
}): Instrumentation {
  const activePatches: ActivePatch[] = [];

  return {
    name: config.name,

    enable() {
      if (!isModuleInstalled(config.moduleName)) return false;

      try {
        const mod = loadModule(config.moduleName);

        for (const patch of config.patches) {
          const proto = patch.getPrototype(mod);
          if (!proto?.[patch.method]) continue;

          const original = proto[patch.method] as (
            ...args: unknown[]
          ) => unknown;

          proto[patch.method] = createPatchedMethod(
            original,
            patch,
            config.name,
          );
          activePatches.push({ proto, method: patch.method, original });
        }

        return activePatches.length > 0;
      } catch (err) {
        diag.warn(`toad-eye: failed to patch ${config.name}: ${err}`);
        return false;
      }
    },

    disable() {
      for (const { proto, method, original } of activePatches) {
        proto[method] = original;
      }
      activePatches.length = 0;
    },
  };
}
