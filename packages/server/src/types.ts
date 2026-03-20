// OTLP JSON payload types (simplified from OpenTelemetry proto spec)
// Only the fields we need for ingestion validation

export interface OtlpAnyValue {
  readonly stringValue?: string | undefined;
  readonly intValue?: string | undefined;
  readonly doubleValue?: number | undefined;
  readonly boolValue?: boolean | undefined;
  readonly arrayValue?:
    | { readonly values: readonly OtlpAnyValue[] }
    | undefined;
}

export interface OtlpKeyValue {
  readonly key: string;
  readonly value: OtlpAnyValue;
}

// --- Traces ---

export interface OtlpSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly name: string;
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano: string;
  readonly attributes?: readonly OtlpKeyValue[] | undefined;
  readonly parentSpanId?: string | undefined;
  readonly kind?: number | undefined;
  readonly status?: { readonly code?: number | undefined } | undefined;
}

export interface OtlpScopeSpans {
  readonly scope?: { readonly name?: string | undefined } | undefined;
  readonly spans: readonly OtlpSpan[];
}

export interface OtlpResourceSpans {
  readonly resource?:
    | {
        readonly attributes?: readonly OtlpKeyValue[] | undefined;
      }
    | undefined;
  readonly scopeSpans: readonly OtlpScopeSpans[];
}

export interface OtlpTracePayload {
  readonly resourceSpans: readonly OtlpResourceSpans[];
}

// --- Metrics ---

export interface OtlpNumberDataPoint {
  readonly timeUnixNano: string;
  readonly asInt?: string | undefined;
  readonly asDouble?: number | undefined;
  readonly attributes?: readonly OtlpKeyValue[] | undefined;
}

export interface OtlpHistogramDataPoint {
  readonly timeUnixNano: string;
  readonly count: string;
  readonly sum?: number | undefined;
  readonly bucketCounts?: readonly string[] | undefined;
  readonly explicitBounds?: readonly number[] | undefined;
  readonly attributes?: readonly OtlpKeyValue[] | undefined;
}

export interface OtlpMetric {
  readonly name: string;
  readonly sum?:
    | { readonly dataPoints: readonly OtlpNumberDataPoint[] }
    | undefined;
  readonly gauge?:
    | { readonly dataPoints: readonly OtlpNumberDataPoint[] }
    | undefined;
  readonly histogram?:
    | {
        readonly dataPoints: readonly OtlpHistogramDataPoint[];
      }
    | undefined;
}

export interface OtlpScopeMetrics {
  readonly scope?: { readonly name?: string | undefined } | undefined;
  readonly metrics: readonly OtlpMetric[];
}

export interface OtlpResourceMetrics {
  readonly resource?:
    | {
        readonly attributes?: readonly OtlpKeyValue[] | undefined;
      }
    | undefined;
  readonly scopeMetrics: readonly OtlpScopeMetrics[];
}

export interface OtlpMetricsPayload {
  readonly resourceMetrics: readonly OtlpResourceMetrics[];
}

// --- Server config ---

export interface ServerConfig {
  readonly port: number;
  readonly apiKeys: readonly string[];
  readonly rateLimit: {
    readonly windowMs: number;
    readonly maxRequests: number;
  };
}

// --- Storage ---

export interface StoredTrace {
  readonly receivedAt: string;
  readonly apiKey: string;
  readonly payload: OtlpTracePayload;
}

export interface StoredMetrics {
  readonly receivedAt: string;
  readonly apiKey: string;
  readonly payload: OtlpMetricsPayload;
}
