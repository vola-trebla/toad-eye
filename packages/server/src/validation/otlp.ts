// OTLP payload validation — checks structural correctness before storage

import type { OtlpTracePayload, OtlpMetricsPayload } from "../types.js";

export interface ValidationResult {
  readonly valid: boolean;
  readonly error?: string | undefined;
}

export function validateTracePayload(body: unknown): ValidationResult {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body must be a JSON object" };
  }

  const payload = body as Record<string, unknown>;

  if (!Array.isArray(payload["resourceSpans"])) {
    return {
      valid: false,
      error: "Missing or invalid 'resourceSpans' array",
    };
  }

  for (const [i, rs] of (payload["resourceSpans"] as unknown[]).entries()) {
    if (!rs || typeof rs !== "object") {
      return {
        valid: false,
        error: `resourceSpans[${i}] must be an object`,
      };
    }

    const resourceSpan = rs as Record<string, unknown>;

    if (!Array.isArray(resourceSpan["scopeSpans"])) {
      return {
        valid: false,
        error: `resourceSpans[${i}].scopeSpans must be an array`,
      };
    }

    for (const [j, ss] of (resourceSpan["scopeSpans"] as unknown[]).entries()) {
      if (!ss || typeof ss !== "object") {
        return {
          valid: false,
          error: `resourceSpans[${i}].scopeSpans[${j}] must be an object`,
        };
      }

      const scopeSpan = ss as Record<string, unknown>;

      if (!Array.isArray(scopeSpan["spans"])) {
        return {
          valid: false,
          error: `resourceSpans[${i}].scopeSpans[${j}].spans must be an array`,
        };
      }

      for (const [k, span] of (scopeSpan["spans"] as unknown[]).entries()) {
        const result = validateSpan(
          span,
          `resourceSpans[${i}].scopeSpans[${j}].spans[${k}]`,
        );
        if (!result.valid) return result;
      }
    }
  }

  return { valid: true };
}

function validateSpan(span: unknown, path: string): ValidationResult {
  if (!span || typeof span !== "object") {
    return { valid: false, error: `${path} must be an object` };
  }

  const s = span as Record<string, unknown>;

  if (typeof s["traceId"] !== "string" || s["traceId"].length === 0) {
    return { valid: false, error: `${path}.traceId is required` };
  }

  if (typeof s["spanId"] !== "string" || s["spanId"].length === 0) {
    return { valid: false, error: `${path}.spanId is required` };
  }

  if (typeof s["name"] !== "string" || s["name"].length === 0) {
    return { valid: false, error: `${path}.name is required` };
  }

  return { valid: true };
}

export function validateMetricsPayload(body: unknown): ValidationResult {
  if (!body || typeof body !== "object") {
    return { valid: false, error: "Request body must be a JSON object" };
  }

  const payload = body as Record<string, unknown>;

  if (!Array.isArray(payload["resourceMetrics"])) {
    return {
      valid: false,
      error: "Missing or invalid 'resourceMetrics' array",
    };
  }

  for (const [i, rm] of (payload["resourceMetrics"] as unknown[]).entries()) {
    if (!rm || typeof rm !== "object") {
      return {
        valid: false,
        error: `resourceMetrics[${i}] must be an object`,
      };
    }

    const resourceMetric = rm as Record<string, unknown>;

    if (!Array.isArray(resourceMetric["scopeMetrics"])) {
      return {
        valid: false,
        error: `resourceMetrics[${i}].scopeMetrics must be an array`,
      };
    }

    for (const [j, sm] of (
      resourceMetric["scopeMetrics"] as unknown[]
    ).entries()) {
      if (!sm || typeof sm !== "object") {
        return {
          valid: false,
          error: `resourceMetrics[${i}].scopeMetrics[${j}] must be an object`,
        };
      }

      const scopeMetric = sm as Record<string, unknown>;

      if (!Array.isArray(scopeMetric["metrics"])) {
        return {
          valid: false,
          error: `resourceMetrics[${i}].scopeMetrics[${j}].metrics must be an array`,
        };
      }

      for (const [k, metric] of (
        scopeMetric["metrics"] as unknown[]
      ).entries()) {
        const result = validateMetric(
          metric,
          `resourceMetrics[${i}].scopeMetrics[${j}].metrics[${k}]`,
        );
        if (!result.valid) return result;
      }
    }
  }

  return { valid: true };
}

function validateMetric(metric: unknown, path: string): ValidationResult {
  if (!metric || typeof metric !== "object") {
    return { valid: false, error: `${path} must be an object` };
  }

  const m = metric as Record<string, unknown>;

  if (typeof m["name"] !== "string" || m["name"].length === 0) {
    return { valid: false, error: `${path}.name is required` };
  }

  const hasData =
    m["sum"] != null || m["gauge"] != null || m["histogram"] != null;
  if (!hasData) {
    return {
      valid: false,
      error: `${path} must have at least one of: sum, gauge, histogram`,
    };
  }

  return { valid: true };
}

// Type-safe cast after validation
export function asTracePayload(body: unknown): OtlpTracePayload {
  return body as OtlpTracePayload;
}

export function asMetricsPayload(body: unknown): OtlpMetricsPayload {
  return body as OtlpMetricsPayload;
}
