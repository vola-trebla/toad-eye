import { initObservability } from "toad-eye";

initObservability({
  serviceName: "toad-eye-demo",
  endpoint: process.env["OTEL_EXPORTER_ENDPOINT"] ?? "http://localhost:4318",
});

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { routes } from "./routes.js";

const app = new Hono();
app.route("/", routes);

const port = 3001;

serve({ fetch: app.fetch, port }, () => {
  console.log(`👁️🐸👁️ toad-eye demo running on http://localhost:${port}`);
  console.log(`   Grafana:    http://localhost:3100`);
  console.log(`   Jaeger:     http://localhost:16686`);
  console.log(`   Prometheus: http://localhost:9090`);
});
