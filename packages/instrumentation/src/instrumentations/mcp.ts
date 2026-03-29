/**
 * Auto-instrumentation for MCP SDK.
 *
 * Patches McpServer.prototype so that any server instance created after
 * enableMcpInstrumentation() is automatically instrumented — no need
 * to call toadEyeMiddleware(server) manually.
 *
 * Uses __toad_eye_mcp_patched flag to prevent double-instrumentation
 * when both auto and manual approaches are used.
 */

import { createRequire } from "node:module";
import { toadEyeMiddleware } from "../mcp/middleware.js";

const require = createRequire(import.meta.url);

const PATCHED_FLAG = "__toad_eye_mcp_patched";
const MODULE_NAME = "@modelcontextprotocol/sdk/server/mcp.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mcpServerProto: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let originals: { tool: any; resource?: any; prompt?: any } | null = null;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveServerClass(): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sdk = require(MODULE_NAME);
    return sdk.McpServer ?? sdk.default?.McpServer;
  } catch {
    return null;
  }
}

/**
 * Enable MCP server auto-instrumentation.
 * For ESM projects, pass McpServer class directly to avoid CJS/ESM module mismatch.
 */
export function enableMcpInstrumentation(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  McpServerClass?: any,
): boolean {
  const McpServer = McpServerClass ?? resolveServerClass();

  if (!McpServer?.prototype) return false;
  if (McpServer.prototype[PATCHED_FLAG]) return true;

  const proto = McpServer.prototype;
  mcpServerProto = proto;

  originals = {
    tool: proto.tool,
    resource: proto.resource,
    prompt: proto.prompt,
  };

  // WeakSet tracks which instances have been instrumented
  const instrumented = new WeakSet();

  function ensureInstrumented(instance: Record<string, unknown>) {
    if (instrumented.has(instance)) return;
    instrumented.add(instance);

    // Restore original methods so middleware wraps the real ones
    instance.tool = originals!.tool.bind(instance);
    if (originals!.resource)
      instance.resource = originals!.resource.bind(instance);
    if (originals!.prompt) instance.prompt = originals!.prompt.bind(instance);

    toadEyeMiddleware(instance);
  }

  proto.tool = function patchedTool(...args: unknown[]): unknown {
    ensureInstrumented(this);
    return this.tool(...args);
  };

  if (originals.resource) {
    proto.resource = function patchedResource(...args: unknown[]): unknown {
      ensureInstrumented(this);
      return this.resource(...args);
    };
  }

  if (originals.prompt) {
    proto.prompt = function patchedPrompt(...args: unknown[]): unknown {
      ensureInstrumented(this);
      return this.prompt(...args);
    };
  }

  proto[PATCHED_FLAG] = true;
  return true;
}

export function disableMcpInstrumentation() {
  if (!mcpServerProto || !originals) return;

  mcpServerProto.tool = originals.tool;
  if (originals.resource) mcpServerProto.resource = originals.resource;
  if (originals.prompt) mcpServerProto.prompt = originals.prompt;
  delete mcpServerProto[PATCHED_FLAG];

  mcpServerProto = null;
  originals = null;
}
