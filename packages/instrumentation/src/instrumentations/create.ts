import { createRequire } from "node:module";
import { diag } from "@opentelemetry/api";
import { traceLLMCall } from "../spans.js";
import type { LLMCallOutput } from "../spans.js";
import { calculateCost } from "../pricing.js";
import type { LLMProvider } from "../types/index.js";
import type { Instrumentation, PatchTarget } from "./types.js";

const require = createRequire(import.meta.url);

interface ActivePatch {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proto: any;
  method: string;
  original: (...args: unknown[]) => unknown;
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
      try {
        require.resolve(config.moduleName);
      } catch {
        return false;
      }

      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const sdk = require(config.moduleName);
        const mod = sdk.default ?? sdk;

        for (const patch of config.patches) {
          const proto = patch.getPrototype(mod);
          if (!proto?.[patch.method]) continue;

          const original = proto[patch.method] as (
            ...args: unknown[]
          ) => unknown;

          proto[patch.method] = function patchedMethod(
            body: unknown,
            ...rest: unknown[]
          ) {
            if (patch.shouldSkip?.(body)) {
              return original.call(this, body, ...rest);
            }

            const req = patch.extractRequest(body);

            return traceLLMCall(
              {
                provider: config.name,
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
                  cost: calculateCost(
                    req.model,
                    res.inputTokens,
                    res.outputTokens,
                  ),
                };
              },
            );
          };

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
