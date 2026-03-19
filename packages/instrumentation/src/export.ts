/**
 * Trace-to-Dataset Export — converts production Jaeger traces into toad-eval test cases.
 *
 * Fetches a trace by ID from the Jaeger Query API, extracts LLM call data
 * (prompt, model, provider, response), and generates a YAML file in toad-eval format
 * with auto-generated assertions (max_length, not_contains, is_json).
 */

import { stringify } from "yaml";
import { GEN_AI_ATTRS } from "./types/index.js";

// -- Jaeger API response types --

interface JaegerTag {
  readonly key: string;
  readonly type: string;
  readonly value: string | number | boolean;
}

interface JaegerSpan {
  readonly traceID: string;
  readonly spanID: string;
  readonly operationName: string;
  readonly tags: readonly JaegerTag[];
  readonly startTime: number;
  readonly duration: number;
}

interface JaegerTrace {
  readonly traceID: string;
  readonly spans: readonly JaegerSpan[];
}

interface JaegerResponse {
  readonly data: readonly JaegerTrace[];
}

// -- toad-eval output types --

interface EvalAssertion {
  readonly type: string;
  readonly value: string | number | boolean;
}

interface EvalCase {
  readonly id: string;
  readonly variables: { readonly input: string };
  readonly assertions: readonly EvalAssertion[];
}

interface EvalDataset {
  readonly name: string;
  readonly source: "toad-eye-export";
  readonly metadata: {
    readonly trace_id: string;
    readonly exported_at: string;
    readonly model: string;
    readonly provider: string;
  };
  readonly cases: readonly EvalCase[];
}

export interface ExportTraceOptions {
  readonly jaegerUrl?: string | undefined;
  readonly output?: string | undefined;
}

const DEFAULT_JAEGER_URL = "http://localhost:16686";
const LENGTH_BUFFER_MULTIPLIER = 1.5;
const REFUSAL_MARKER = "i cannot";

function getTagValue(
  tags: readonly JaegerTag[],
  key: string,
): string | undefined {
  const tag = tags.find((t) => t.key === key);
  return tag !== undefined ? String(tag.value) : undefined;
}

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

function buildAssertions(completion: string | undefined): EvalAssertion[] {
  const assertions: EvalAssertion[] = [];

  if (completion !== undefined) {
    assertions.push({
      type: "max_length",
      value: Math.ceil(completion.length * LENGTH_BUFFER_MULTIPLIER),
    });

    if (!completion.toLowerCase().includes(REFUSAL_MARKER)) {
      assertions.push({ type: "not_contains", value: "I cannot" });
    }

    if (isJson(completion)) {
      assertions.push({ type: "is_json", value: true });
    }
  }

  return assertions;
}

function spanToEvalCase(span: JaegerSpan, index: number): EvalCase | undefined {
  const prompt = getTagValue(span.tags, GEN_AI_ATTRS.PROMPT);
  if (prompt === undefined) return undefined;

  const completion = getTagValue(span.tags, GEN_AI_ATTRS.COMPLETION);

  return {
    id: `production-case-${index + 1}`,
    variables: { input: prompt },
    assertions: buildAssertions(completion),
  };
}

/**
 * Fetch a trace from Jaeger by trace ID.
 * Requires Jaeger to be running with the Query API available.
 */
export async function fetchTrace(
  traceId: string,
  jaegerUrl = DEFAULT_JAEGER_URL,
): Promise<JaegerTrace> {
  const url = `${jaegerUrl}/api/traces/${traceId}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Failed to fetch trace ${traceId}: ${response.status} ${response.statusText}`,
    );
  }

  const body = (await response.json()) as JaegerResponse;

  if (body.data.length === 0) {
    throw new Error(`Trace ${traceId} not found`);
  }

  return body.data[0]!;
}

/**
 * Convert a Jaeger trace to a toad-eval YAML string.
 * Extracts LLM spans with prompt data, generates assertions from completions.
 *
 * Returns undefined if no exportable spans found (e.g. recordContent was false).
 */
export function traceToEvalYaml(trace: JaegerTrace): string | undefined {
  const cases = trace.spans
    .map((span, i) => spanToEvalCase(span, i))
    .filter((c): c is EvalCase => c !== undefined);

  if (cases.length === 0) return undefined;

  // Pick model/provider from first span that has them
  const firstSpanWithMeta = trace.spans.find(
    (s) => getTagValue(s.tags, GEN_AI_ATTRS.REQUEST_MODEL) !== undefined,
  );

  const dataset: EvalDataset = {
    name: `exported-trace-${trace.traceID.slice(0, 8)}`,
    source: "toad-eye-export",
    metadata: {
      trace_id: trace.traceID,
      exported_at: new Date().toISOString(),
      model:
        getTagValue(
          firstSpanWithMeta?.tags ?? [],
          GEN_AI_ATTRS.REQUEST_MODEL,
        ) ?? "unknown",
      provider:
        getTagValue(firstSpanWithMeta?.tags ?? [], GEN_AI_ATTRS.PROVIDER) ??
        "unknown",
    },
    cases,
  };

  return stringify(dataset);
}

/**
 * Full export pipeline: fetch trace from Jaeger → convert to toad-eval YAML.
 * Returns the YAML string. Caller is responsible for writing to file.
 */
export async function exportTrace(
  traceId: string,
  options: ExportTraceOptions = {},
): Promise<string> {
  const trace = await fetchTrace(traceId, options.jaegerUrl);
  const yaml = traceToEvalYaml(trace);

  if (yaml === undefined) {
    throw new Error(
      `No exportable spans in trace ${traceId}. Was recordContent enabled?`,
    );
  }

  return yaml;
}
