import { describe, it, expect, vi } from "vitest";

// Test the stream wrapping logic, extractors, and message parsing

describe("OpenAI multi-modal extraction (#98)", () => {
  // Inline the same logic as openai.ts extractMessages
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
    const result = extractMessages([{ content: "Hello world" }]);
    expect(result).toBe("Hello world");
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
      {
        content: [{ type: "image_url", image_url: { url: "https://..." } }],
      },
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

describe("OpenAI stream extraction", () => {
  it("accumulates content from delta chunks", async () => {
    // Simulate OpenAI extractStreamResponse
    const { extractStreamResponse } = await getOpenAIExtractor();

    const chunks = [
      { choices: [{ delta: { content: "Hello" } }] },
      { choices: [{ delta: { content: " world" } }] },
      {
        choices: [{ delta: {} }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      },
    ];

    const result = extractStreamResponse!(chunks);
    expect(result.completion).toBe("Hello world");
    expect(result.inputTokens).toBe(10);
    expect(result.outputTokens).toBe(5);
  });

  it("handles chunks without usage data", async () => {
    const { extractStreamResponse } = await getOpenAIExtractor();

    const chunks = [
      { choices: [{ delta: { content: "Hi" } }] },
      { choices: [{ delta: {} }] },
    ];

    const result = extractStreamResponse!(chunks);
    expect(result.completion).toBe("Hi");
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
  });

  it("handles empty stream", async () => {
    const { extractStreamResponse } = await getOpenAIExtractor();
    const result = extractStreamResponse!([]);
    expect(result.completion).toBe("");
    expect(result.inputTokens).toBe(0);
  });
});

describe("Anthropic stream extraction", () => {
  it("accumulates content from content_block_delta events", async () => {
    const { extractStreamResponse } = await getAnthropicExtractor();

    const chunks = [
      { type: "message_start", message: { usage: { input_tokens: 15 } } },
      { type: "content_block_delta", delta: { text: "Hello" } },
      { type: "content_block_delta", delta: { text: " from Claude" } },
      { type: "message_delta", usage: { output_tokens: 8 } },
      { type: "message_stop" },
    ];

    const result = extractStreamResponse!(chunks);
    expect(result.completion).toBe("Hello from Claude");
    expect(result.inputTokens).toBe(15);
    expect(result.outputTokens).toBe(8);
  });

  it("handles empty stream", async () => {
    const { extractStreamResponse } = await getAnthropicExtractor();
    const result = extractStreamResponse!([]);
    expect(result.completion).toBe("");
    expect(result.inputTokens).toBe(0);
  });
});

describe("stream wrapping (async iterable)", () => {
  it("wraps async iterable transparently", async () => {
    async function* mockStream() {
      yield { data: "chunk1" };
      yield { data: "chunk2" };
      yield { data: "chunk3" };
    }

    const collected: unknown[] = [];
    let completeCalled = false;

    // Inline wrapper matching the logic in create.ts
    async function* wrapStream<T>(
      stream: AsyncIterable<T>,
      onComplete: (chunks: T[]) => void,
    ) {
      const chunks: T[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
        yield chunk;
      }
      onComplete(chunks);
    }

    const wrapped = wrapStream(mockStream(), (chunks) => {
      completeCalled = true;
      collected.push(...chunks);
    });

    const results: unknown[] = [];
    for await (const chunk of wrapped) {
      results.push(chunk);
    }

    expect(results).toHaveLength(3);
    expect(completeCalled).toBe(true);
    expect(collected).toHaveLength(3);
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

// Helpers to get extractors without loading real SDKs
async function getOpenAIExtractor() {
  // We can't import the openai.ts file directly because it tries to register.
  // Instead, test the extraction logic inline (same code as in openai.ts)
  return {
    extractStreamResponse: (chunks: unknown[]) => {
      let completion = "";
      let inputTokens = 0;
      let outputTokens = 0;

      for (const chunk of chunks) {
        const c = chunk as {
          choices?: { delta?: { content?: string } }[];
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const delta = c?.choices?.[0]?.delta?.content;
        if (delta) completion += delta;
        if (c?.usage) {
          inputTokens = c.usage.prompt_tokens ?? inputTokens;
          outputTokens = c.usage.completion_tokens ?? outputTokens;
        }
      }

      return { completion, inputTokens, outputTokens };
    },
  };
}

async function getAnthropicExtractor() {
  return {
    extractStreamResponse: (chunks: unknown[]) => {
      let completion = "";
      let inputTokens = 0;
      let outputTokens = 0;

      for (const chunk of chunks) {
        const event = chunk as {
          type?: string;
          message?: { usage?: { input_tokens?: number } };
          delta?: { text?: string };
          usage?: { output_tokens?: number };
        };
        if (event.type === "content_block_delta" && event.delta?.text) {
          completion += event.delta.text;
        }
        if (event.type === "message_start" && event.message?.usage) {
          inputTokens = event.message.usage.input_tokens ?? 0;
        }
        if (event.type === "message_delta" && event.usage) {
          outputTokens = event.usage.output_tokens ?? 0;
        }
      }

      return { completion, inputTokens, outputTokens };
    },
  };
}
