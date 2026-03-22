import { describe, it, expect } from "vitest";

import type { StreamAccumulator } from "../instrumentations/types.js";

// Test the accumulator-based stream extraction and message parsing

function freshAcc(): StreamAccumulator {
  return {
    completion: "",
    thinkingContent: "",
    inputTokens: 0,
    outputTokens: 0,
    toolCalls: [],
  };
}

describe("OpenAI multi-modal extraction (#98)", () => {
  function extractMessages(messages: unknown): string {
    if (!Array.isArray(messages)) return "";
    return messages
      .map((m: { content?: unknown }) => {
        if (typeof m.content === "string") return m.content;
        if (Array.isArray(m.content)) {
          return (m.content as { type?: string; text?: string }[])
            .map((part) => {
              if (part.type === "text") return part.text ?? "";
              if (part.type === "image_url") return "[image]";
              if (part.type === "input_audio") return "[audio]";
              return "";
            })
            .filter(Boolean)
            .join("");
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }

  it("extracts plain string content", () => {
    expect(extractMessages([{ content: "Hello world" }])).toBe("Hello world");
  });

  it("extracts text from ContentPart array", () => {
    const result = extractMessages([
      {
        content: [
          { type: "text", text: "What is in this image?" },
          { type: "image_url", image_url: { url: "https://..." } },
        ],
      },
    ]);
    expect(result).toBe("What is in this image?[image]");
  });

  it("handles image-only messages", () => {
    const result = extractMessages([
      { content: [{ type: "image_url", image_url: { url: "https://..." } }] },
    ]);
    expect(result).toBe("[image]");
  });

  it("handles audio content", () => {
    const result = extractMessages([
      {
        content: [
          { type: "input_audio", input_audio: { data: "base64..." } },
          { type: "text", text: "Transcribe this" },
        ],
      },
    ]);
    expect(result).toBe("[audio]Transcribe this");
  });

  it("handles mixed string and multi-modal messages", () => {
    const result = extractMessages([
      { role: "system", content: "You are helpful" },
      {
        role: "user",
        content: [
          { type: "text", text: "Describe:" },
          { type: "image_url", image_url: { url: "https://..." } },
        ],
      },
    ]);
    expect(result).toBe("You are helpful\nDescribe:[image]");
  });
});

describe("OpenAI stream accumulator", () => {
  function accumulateChunk(acc: StreamAccumulator, chunk: unknown) {
    const c = chunk as {
      choices?: { delta?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const delta = c?.choices?.[0]?.delta?.content;
    if (delta) acc.completion += delta;
    if (c?.usage) {
      acc.inputTokens = c.usage.prompt_tokens ?? acc.inputTokens;
      acc.outputTokens = c.usage.completion_tokens ?? acc.outputTokens;
    }
  }

  it("accumulates content from delta chunks", () => {
    const acc = freshAcc();
    accumulateChunk(acc, { choices: [{ delta: { content: "Hello" } }] });
    accumulateChunk(acc, { choices: [{ delta: { content: " world" } }] });
    accumulateChunk(acc, {
      choices: [{ delta: {} }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    });

    expect(acc.completion).toBe("Hello world");
    expect(acc.inputTokens).toBe(10);
    expect(acc.outputTokens).toBe(5);
  });

  it("handles chunks without usage data", () => {
    const acc = freshAcc();
    accumulateChunk(acc, { choices: [{ delta: { content: "Hi" } }] });
    accumulateChunk(acc, { choices: [{ delta: {} }] });

    expect(acc.completion).toBe("Hi");
    expect(acc.inputTokens).toBe(0);
    expect(acc.outputTokens).toBe(0);
  });

  it("does not store raw chunk objects", () => {
    const acc = freshAcc();
    const bigChunk = {
      choices: [{ delta: { content: "x" } }],
      metadata: { large: "object" },
    };
    accumulateChunk(acc, bigChunk);

    // acc only has primitives, no reference to bigChunk
    expect(Object.keys(acc)).toEqual([
      "completion",
      "thinkingContent",
      "inputTokens",
      "outputTokens",
      "toolCalls",
    ]);
  });
});

describe("Anthropic stream accumulator", () => {
  function accumulateChunk(acc: StreamAccumulator, chunk: unknown) {
    const event = chunk as {
      type?: string;
      message?: { usage?: { input_tokens?: number } };
      delta?: { text?: string };
      usage?: { output_tokens?: number };
    };
    if (event.type === "content_block_delta" && event.delta?.text) {
      acc.completion += event.delta.text;
    }
    if (event.type === "message_start" && event.message?.usage) {
      acc.inputTokens = event.message.usage.input_tokens ?? 0;
    }
    if (event.type === "message_delta" && event.usage) {
      acc.outputTokens = event.usage.output_tokens ?? 0;
    }
  }

  it("accumulates content from content_block_delta events", () => {
    const acc = freshAcc();
    accumulateChunk(acc, {
      type: "message_start",
      message: { usage: { input_tokens: 15 } },
    });
    accumulateChunk(acc, {
      type: "content_block_delta",
      delta: { text: "Hello" },
    });
    accumulateChunk(acc, {
      type: "content_block_delta",
      delta: { text: " from Claude" },
    });
    accumulateChunk(acc, {
      type: "message_delta",
      usage: { output_tokens: 8 },
    });
    accumulateChunk(acc, { type: "message_stop" });

    expect(acc.completion).toBe("Hello from Claude");
    expect(acc.inputTokens).toBe(15);
    expect(acc.outputTokens).toBe(8);
  });
});

describe("Gemini stream accumulator (#104)", () => {
  function accumulateChunk(acc: StreamAccumulator, chunk: unknown) {
    const c = chunk as {
      text?: () => string;
      usageMetadata?: {
        promptTokenCount?: number;
        candidatesTokenCount?: number;
      };
    };
    try {
      const text = c?.text?.();
      if (text) acc.completion += text;
    } catch {
      // text() may throw
    }
    if (c?.usageMetadata) {
      acc.inputTokens = c.usageMetadata.promptTokenCount ?? acc.inputTokens;
      acc.outputTokens =
        c.usageMetadata.candidatesTokenCount ?? acc.outputTokens;
    }
  }

  it("accumulates text from Gemini stream chunks", () => {
    const acc = freshAcc();
    accumulateChunk(acc, { text: () => "Hello " });
    accumulateChunk(acc, { text: () => "from Gemini" });
    accumulateChunk(acc, {
      text: () => "",
      usageMetadata: { promptTokenCount: 20, candidatesTokenCount: 12 },
    });

    expect(acc.completion).toBe("Hello from Gemini");
    expect(acc.inputTokens).toBe(20);
    expect(acc.outputTokens).toBe(12);
  });

  it("handles text() throwing (blocked content)", () => {
    const acc = freshAcc();
    accumulateChunk(acc, {
      text: () => {
        throw new Error("Content blocked");
      },
    });

    expect(acc.completion).toBe("");
  });
});

describe("stream wrapping (async iterable)", () => {
  it("wraps async iterable with accumulator", async () => {
    async function* mockStream() {
      yield { n: 1 };
      yield { n: 2 };
      yield { n: 3 };
    }

    let completeAcc: StreamAccumulator | null = null;

    async function* wrapStream<T>(
      stream: AsyncIterable<T>,
      onComplete: (acc: StreamAccumulator) => void,
    ) {
      const acc: StreamAccumulator = {
        completion: "",
        thinkingContent: "",
        inputTokens: 0,
        outputTokens: 0,
        toolCalls: [],
      };
      for await (const chunk of stream) {
        acc.completion += String((chunk as { n: number }).n);
        yield chunk;
      }
      onComplete(acc);
    }

    const wrapped = wrapStream(mockStream(), (acc) => {
      completeAcc = acc;
    });

    const results: unknown[] = [];
    for await (const chunk of wrapped) {
      results.push(chunk);
    }

    expect(results).toHaveLength(3);
    expect(completeAcc).not.toBeNull();
    expect(completeAcc!.completion).toBe("123");
  });

  it("propagates errors from stream", async () => {
    async function* failingStream() {
      yield { data: "ok" };
      throw new Error("Stream error");
    }

    async function* wrapStream<T>(stream: AsyncIterable<T>) {
      for await (const chunk of stream) {
        yield chunk;
      }
    }

    const wrapped = wrapStream(failingStream());
    const results: unknown[] = [];

    await expect(async () => {
      for await (const chunk of wrapped) {
        results.push(chunk);
      }
    }).rejects.toThrow("Stream error");

    expect(results).toHaveLength(1);
  });
});
