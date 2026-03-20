// Server entry point — starts the toad-eye ingestion server

import { serve } from "@hono/node-server";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();
const { app } = createApp(config);

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`\n🐸 toad-eye ingestion server running on port ${info.port}`);
  console.log(`   POST /v1/traces   — send OTLP traces`);
  console.log(`   POST /v1/metrics  — send OTLP metrics`);
  console.log(`   GET  /health      — health check\n`);
});
