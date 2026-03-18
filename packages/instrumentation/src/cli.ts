#!/usr/bin/env node

import { execSync, type ChildProcess, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initObservability, traceLLMCall, shutdown } from "./index.js";
import type { LLMCallOutput } from "./index.js";

const INFRA_DIR = "infra/toad-eye";

const SERVICES = [
  { name: "Grafana", url: "http://localhost:3100", login: "admin / admin" },
  { name: "Jaeger UI", url: "http://localhost:16686" },
  { name: "Prometheus", url: "http://localhost:9090" },
  { name: "OTel Collector", url: "http://localhost:4318" },
] as const;

function getTemplatesDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // dist/cli.js -> package root -> templates/
  return join(thisFile, "..", "..", "templates");
}

function getComposeFile(): string {
  return join(process.cwd(), INFRA_DIR, "docker-compose.yml");
}

function init() {
  const dest = join(process.cwd(), INFRA_DIR);

  if (existsSync(dest)) {
    console.log(`\u2705 ${INFRA_DIR}/ already exists, skipping.`);
    return;
  }

  const templatesDir = getTemplatesDir();
  if (!existsSync(templatesDir)) {
    console.error(
      `\u274c Templates not found at ${templatesDir}. Reinstall toad-eye.`,
    );
    process.exit(1);
  }

  mkdirSync(dest, { recursive: true });
  cpSync(templatesDir, dest, { recursive: true });

  console.log(`\u2705 Created ${INFRA_DIR}/ with observability stack config.`);
  console.log();
  console.log("Next steps:");
  console.log("  npx toad-eye up      Start the stack");
  console.log("  npx toad-eye status  Check running services");
}

function up() {
  const composeFile = getComposeFile();
  if (!existsSync(composeFile)) {
    console.error(
      `\u274c ${INFRA_DIR}/ not found. Run \`npx toad-eye init\` first.`,
    );
    process.exit(1);
  }

  console.log("\u{1f438} Starting observability stack...");
  execSync(`docker compose -f ${composeFile} up -d`, { stdio: "inherit" });
  console.log();
  status();
}

function down() {
  const composeFile = getComposeFile();
  if (!existsSync(composeFile)) {
    console.error(`\u274c ${INFRA_DIR}/ not found. Nothing to stop.`);
    process.exit(1);
  }

  console.log("\u{1f44b} Stopping observability stack...");
  execSync(`docker compose -f ${composeFile} down`, { stdio: "inherit" });
  console.log("\u2705 Stack stopped.");
}

function status() {
  const composeFile = getComposeFile();
  if (!existsSync(composeFile)) {
    console.error(
      `\u274c ${INFRA_DIR}/ not found. Run \`npx toad-eye init\` first.`,
    );
    process.exit(1);
  }

  try {
    const output = execSync(
      `docker compose -f ${composeFile} ps --format json`,
      {
        encoding: "utf-8",
      },
    );

    const lines = output.trim().split("\n").filter(Boolean);
    const containers = lines.map(
      (line) => JSON.parse(line) as { Service: string; State: string },
    );

    console.log("\u{1f438} toad-eye stack:");
    console.log();

    for (const svc of SERVICES) {
      const container = containers.find((c) =>
        svc.name.toLowerCase().includes(c.Service.toLowerCase()),
      );
      const state = container?.State === "running" ? "\u{1f7e2}" : "\u{1f534}";
      const loginInfo = "login" in svc ? ` (${svc.login})` : "";
      console.log(`  ${state} ${svc.name.padEnd(16)} ${svc.url}${loginInfo}`);
    }
    console.log();
  } catch {
    console.log("Could not check container status. Is Docker running?");
  }
}

const PROVIDERS = ["anthropic", "gemini", "openai"] as const;
const MODELS: Record<string, { costPer1k: number }> = {
  "claude-sonnet-4-20250514": { costPer1k: 0.003 },
  "gemini-2.5-flash": { costPer1k: 0.001 },
  "gpt-4o": { costPer1k: 0.005 },
};
const MODEL_NAMES = Object.keys(MODELS);

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function demo() {
  const composeFile = getComposeFile();
  if (!existsSync(composeFile)) {
    console.error(
      `\u274c ${INFRA_DIR}/ not found. Run \`npx toad-eye init\` first.`,
    );
    process.exit(1);
  }

  initObservability({
    serviceName: "toad-eye-demo",
    endpoint: "http://localhost:4318",
  });

  const prompts = [
    "Explain quantum computing",
    "Write a haiku about frogs",
    "What is the capital of Uruguay?",
    "How does TCP work?",
    "Translate hello to Japanese",
  ];

  console.log(
    "\u{1f438}\u{1f441}\u{fe0f} toad-eye demo — sending mock LLM traffic",
  );
  console.log("    Press Ctrl+C to stop\n");

  const tick = async () => {
    const providerIdx = randomBetween(0, PROVIDERS.length - 1);
    const provider = PROVIDERS[providerIdx]!;
    const model = MODEL_NAMES[providerIdx]!;
    const prompt = prompts[randomBetween(0, prompts.length - 1)]!;
    const costPer1k = MODELS[model]!.costPer1k;

    try {
      const result = await traceLLMCall(
        { provider, model, prompt, temperature: 0.7 },
        async (): Promise<LLMCallOutput> => {
          const latency = randomBetween(200, 2000);
          await new Promise((r) => setTimeout(r, latency));

          if (Math.random() < 0.1) {
            throw new Error(`${provider} API error: rate limit exceeded`);
          }

          const inputTokens = randomBetween(50, 500);
          const outputTokens = randomBetween(20, 300);
          const cost =
            Math.round(
              ((inputTokens + outputTokens) / 1000) * costPer1k * 1000000,
            ) / 1000000;

          return {
            completion: `Mock response for: "${prompt}"`,
            inputTokens,
            outputTokens,
            cost,
          };
        },
      );
      console.log(`  \u2705 [${provider}/${model}] ${prompt}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  \u274c [${provider}/${model}] ${msg}`);
    }
  };

  process.on("SIGINT", async () => {
    console.log("\n\u{1f44b} Shutting down...");
    await shutdown();
    process.exit(0);
  });

  // Send a request every 2 seconds
  const run = () => {
    tick().then(() => setTimeout(run, 2000));
  };
  run();
}

function help() {
  console.log(`
\u{1f438} toad-eye CLI — observability stack for LLM services

Commands:
  init     Copy observability configs into your project
  up       Start the stack (OTel Collector + Prometheus + Jaeger + Grafana)
  down     Stop the stack
  status   Show running services and URLs
  demo     Send mock LLM traffic to see data in Grafana
  help     Show this message
`);
}

const command = process.argv[2];

switch (command) {
  case "init":
    init();
    break;
  case "up":
    up();
    break;
  case "down":
    down();
    break;
  case "status":
    status();
    break;
  case "demo":
    demo();
    break;
  case "help":
  case "--help":
  case "-h":
  case undefined:
    help();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    help();
    process.exit(1);
}
