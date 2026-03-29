export { toadEyeMiddleware, traceSampling } from "./middleware.js";
export type {
  TraceSamplingOptions,
  ToadEyeMiddlewareDispose,
} from "./middleware.js";
export type { ToadMcpOptions } from "./types.js";
export { MCP_METHODS } from "./spans.js";
export {
  enableMcpClientInstrumentation,
  disableMcpClientInstrumentation,
} from "./client.js";
export { recordMcpToolHallucination } from "./metrics.js";
