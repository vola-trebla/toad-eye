// Shared helpers for extracting data from OTLP spans
// Used by baselines, query, and providers routes

import type { OtlpSpan } from "../types.js";

export function getAttrString(span: OtlpSpan, key: string): string | undefined {
  const attr = span.attributes?.find((a) => a.key === key);
  return attr?.value.stringValue;
}

export function getAttrNumber(span: OtlpSpan, key: string): number {
  const attr = span.attributes?.find((a) => a.key === key);
  if (!attr) return 0;
  if (attr.value.doubleValue !== undefined) return attr.value.doubleValue;
  if (attr.value.intValue !== undefined)
    return parseInt(attr.value.intValue, 10);
  return 0;
}

export function getSpanDurationMs(span: OtlpSpan): number {
  try {
    const start = BigInt(span.startTimeUnixNano);
    const end = BigInt(span.endTimeUnixNano);
    return Number((end - start) / 1_000_000n);
  } catch {
    return 0;
  }
}

export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.max(0, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

export function sumArray(arr: readonly number[]): number {
  return arr.reduce((a, b) => a + b, 0);
}
