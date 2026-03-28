#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initObservability,
  traceLLMCall,
  shutdown,
  calculateCost,
} from "./index.js";
import type { LLMCallOutput } from "./index.js";

const INFRA_DIR = "infra/toad-eye";
const DEMO_DELAY_MIN_MS = 200;
const DEMO_DELAY_MAX_MS = 2000;
const DEMO_ERROR_RATE = 0.1;
const DEMO_TICK_INTERVAL_MS = 2000;
const DEMO_TOKEN_INPUT_RANGE = [50, 500] as const;
const DEMO_TOKEN_OUTPUT_RANGE = [20, 300] as const;

const SERVICES = [
  {
    name: "Grafana",
    service: "grafana",
    url: "http://localhost:3100",
    login: "admin / admin",
  },
  { name: "Jaeger UI", service: "jaeger", url: "http://localhost:16686" },
  { name: "Prometheus", service: "prometheus", url: "http://localhost:9090" },
  {
    name: "OTel Collector",
    service: "collector",
    url: "http://localhost:4318",
  },
] as const;

function getTemplatesDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  // dist/cli.js -> package root -> templates/
  return join(thisFile, "..", "..", "templates");
}

function getComposeFile(): string {
  return join(process.cwd(), INFRA_DIR, "docker-compose.yml");
}

function requireInfra(message = `Run \`npx toad-eye init\` first.`): string {
  const composeFile = getComposeFile();
  if (!existsSync(composeFile)) {
    console.error(`\u274c ${INFRA_DIR}/ not found. ${message}`);
    process.exit(1);
  }
  return composeFile;
}

function init() {
  const dest = join(process.cwd(), INFRA_DIR);
  const force = process.argv.includes("--force");

  if (existsSync(dest) && !force) {
    console.log(
      `✅ ${INFRA_DIR}/ already exists, skipping. Use --force to overwrite.`,
    );
    return;
  }

  const templatesDir = getTemplatesDir();
  if (!existsSync(templatesDir)) {
    console.error(
      `\u274c Templates not found at ${templatesDir}. Reinstall toad-eye.`,
    );
    process.exit(1);
  }

  const existed = existsSync(dest);
  mkdirSync(dest, { recursive: true });
  cpSync(templatesDir, dest, { recursive: true });

  const action = force && existed ? "Updated" : "Created";
  console.log(`✅ ${action} ${INFRA_DIR}/ with observability stack config.`);
  console.log();
  console.log("Next steps:");
  console.log("  npx toad-eye up      Start the stack");
  console.log("  npx toad-eye status  Check running services");
}

function requireDocker() {
  try {
    execFileSync("docker", ["--version"], { stdio: "ignore" });
  } catch {
    console.error(
      "❌ Docker not found. Install Docker Desktop: https://docs.docker.com/get-started/get-docker/",
    );
    process.exit(1);
  }
}

function up() {
  requireDocker();
  const composeFile = requireInfra();

  console.log("🐸 Starting observability stack...");
  console.log(
    "   (first run downloads ~500MB of Docker images — this may take a few minutes)\n",
  );
  execFileSync("docker", ["compose", "-f", composeFile, "up", "-d"], {
    stdio: "inherit",
  });
  console.log();
  status();
  console.log(
    "   Run 'npx toad-eye demo' to send test data and verify the stack works.",
  );
}

function down() {
  const composeFile = requireInfra("Nothing to stop.");

  console.log("\u{1f44b} Stopping observability stack...");
  execFileSync("docker", ["compose", "-f", composeFile, "down"], {
    stdio: "inherit",
  });
  console.log("\u2705 Stack stopped.");
}

interface ContainerInfo {
  Service: string;
  State: string;
  ExitCode: number;
}

/** Find the docker container matching a service by exact service name. Exported for testing. */
export function findContainerByService(
  containers: ReadonlyArray<{ Service: string; State: string }>,
  serviceKey: string,
): { Service: string; State: string } | undefined {
  return containers.find((c) => c.Service === serviceKey);
}

function isContainerHealthy(container: ContainerInfo | undefined): boolean {
  return container?.State === "running" && container.ExitCode === 0;
}

function status() {
  const composeFile = requireInfra();

  try {
    const output = execFileSync(
      "docker",
      ["compose", "-f", composeFile, "ps", "--all", "--format", "json"],
      { encoding: "utf-8" },
    );

    const lines = output.trim().split("\n").filter(Boolean);
    const containers = lines.map((line) => JSON.parse(line) as ContainerInfo);

    console.log("\u{1f438} toad-eye stack:");
    console.log();

    for (const svc of SERVICES) {
      const container = containers.find((c) => c.Service === svc.service) as
        | ContainerInfo
        | undefined;
      const healthy = isContainerHealthy(container);
      const icon = healthy ? "\u{1f7e2}" : "\u{1f534}";
      const suffix =
        container && !healthy
          ? ` (${container.State}${container.ExitCode ? `, exit code ${container.ExitCode}` : ""})`
          : "";
      const loginInfo = "login" in svc ? ` (${svc.login})` : "";
      console.log(
        `  ${icon} ${svc.name.padEnd(16)} ${svc.url}${loginInfo}${suffix}`,
      );
    }
    console.log();
  } catch {
    console.log("Could not check container status. Is Docker running?");
  }
}

const DEMO_MODELS = [
  { provider: "anthropic", model: "claude-sonnet-4-20250514" },
  { provider: "gemini", model: "gemini-2.5-flash" },
  { provider: "openai", model: "gpt-4o" },
] as const;

function randomBetween(min: number, max: number) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const DEMO_PROMPTS = [
  "Explain quantum computing",
  "Write a haiku about frogs",
  "What is the capital of Uruguay?",
  "How does TCP work?",
  "Translate hello to Japanese",
];

function pickRandom<T>(arr: readonly T[]): T {
  return arr[randomBetween(0, arr.length - 1)]!;
}

async function simulateLLMCall(
  provider: string,
  model: string,
  prompt: string,
): Promise<LLMCallOutput> {
  await new Promise((r) =>
    setTimeout(r, randomBetween(DEMO_DELAY_MIN_MS, DEMO_DELAY_MAX_MS)),
  );

  if (Math.random() < DEMO_ERROR_RATE) {
    throw new Error(`${provider} API error: rate limit exceeded`);
  }

  const inputTokens = randomBetween(...DEMO_TOKEN_INPUT_RANGE);
  const outputTokens = randomBetween(...DEMO_TOKEN_OUTPUT_RANGE);

  return {
    completion: `Mock response for: "${prompt}"`,
    inputTokens,
    outputTokens,
    cost: calculateCost(model, inputTokens, outputTokens),
  };
}

async function demo() {
  requireInfra();

  // Warn early if OTel Collector is unreachable — data would be silently lost otherwise
  try {
    await fetch("http://localhost:4318/v1/traces", {
      method: "POST",
      body: "[]",
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    console.warn(
      "⚠️  OTel Collector not reachable at localhost:4318 — data will not be recorded.\n   Run 'npx toad-eye up' first, then retry.\n",
    );
  }

  initObservability({
    serviceName: "toad-eye-demo",
    endpoint: "http://localhost:4318",
  });

  console.log("🐸👁️ toad-eye demo — sending mock LLM traffic");
  console.log("    Press Ctrl+C to stop\n");
  console.log("✅ Stack verified! Add this to your app:\n");
  console.log(
    "   import { initObservability } from 'toad-eye';\n   initObservability({ serviceName: 'my-app', instrument: ['openai'] });\n",
  );

  process.on("SIGINT", async () => {
    console.log("\n\u{1f44b} Shutting down...");
    await shutdown();
    process.exit(0);
  });

  const tick = async () => {
    const { provider, model } = pickRandom(DEMO_MODELS);
    const prompt = pickRandom(DEMO_PROMPTS);

    try {
      await traceLLMCall({ provider, model, prompt, temperature: 0.7 }, () =>
        simulateLLMCall(provider, model, prompt),
      );
      console.log(`  \u2705 [${provider}/${model}] ${prompt}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  \u274c [${provider}/${model}] ${msg}`);
    }
  };

  const run = () => {
    tick().then(() => setTimeout(run, DEMO_TICK_INTERVAL_MS));
  };
  run();
}

async function exportTraceCommand() {
  const traceId = process.argv[3];
  if (!traceId) {
    console.error(
      "✗ Usage: npx toad-eye export-trace <trace_id> [--output dir] [--jaeger-url url]",
    );
    process.exit(1);
  }

  const args = process.argv.slice(4);
  let outputDir = process.cwd();
  let jaegerUrl: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--output" && args[i + 1]) {
      outputDir = resolve(args[i + 1]!);
      i++;
    } else if (args[i] === "--jaeger-url" && args[i + 1]) {
      try {
        new URL(args[i + 1]!);
        jaegerUrl = args[i + 1];
      } catch {
        console.error(`❌ Invalid --jaeger-url: ${args[i + 1]}`);
        process.exit(1);
      }
      i++;
    }
  }

  const { exportTrace } = await import("./export.js");

  try {
    const yaml = await exportTrace(traceId, { jaegerUrl });
    const filename = `trace-${traceId.slice(0, 8)}.eval.yaml`;
    const filepath = join(outputDir, filename);

    if (!existsSync(outputDir)) {
      mkdirSync(outputDir, { recursive: true });
    }

    writeFileSync(filepath, yaml, "utf-8");
    console.log(`✅ Exported trace ${traceId} → ${filepath}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`✗ ${msg}`);
    process.exit(1);
  }
}

function help() {
  const cmd = (name: string) => name.padEnd(15);
  console.log(`
🐸 toad-eye CLI — observability stack for LLM services

Commands:
  ${cmd("init")}Copy observability configs into your project
  ${cmd("init --force")}Overwrite existing configs with latest templates
  ${cmd("up")}Start the stack (OTel Collector + Prometheus + Jaeger + Grafana)
  ${cmd("down")}Stop the stack
  ${cmd("status")}Show running services and URLs
  ${cmd("demo")}Send mock LLM traffic to see data in Grafana
  ${cmd("export-trace")}Export a Jaeger trace to toad-eval YAML
  ${cmd("help")}Show this message
`);
}

function runCli() {
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
    case "export-trace":
      exportTraceCommand();
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
}

// Only auto-execute when run as CLI entry point, not when imported (e.g., in tests).
// Use realpathSync to resolve symlinks (npx creates a symlink in node_modules/.bin/).
if (
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === realpathSync(resolve(process.argv[1]))
) {
  runCli();
}
