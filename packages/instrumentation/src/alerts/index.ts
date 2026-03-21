export { AlertManager } from "./manager.js";
export { parseCondition } from "./conditions.js";
export type {
  AlertsConfig,
  AlertRule,
  AlertChannelConfig,
  FiredAlert,
} from "./types.js";

import { readFileSync } from "node:fs";
import yaml from "yaml";
import { AlertManager } from "./manager.js";
import type { AlertsConfig } from "./types.js";

/** Resolve ${ENV_VAR} references in string values throughout the config. */
function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, name: string) => {
    return process.env[name] ?? `\${${name}}`;
  });
}

function interpolateConfig(obj: unknown): unknown {
  if (typeof obj === "string") return resolveEnvVars(obj);
  if (Array.isArray(obj)) return obj.map(interpolateConfig);
  if (obj !== null && typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj as Record<string, unknown>).map(([k, v]) => [
        k,
        interpolateConfig(v),
      ]),
    );
  }
  return obj;
}

function validateConfig(config: unknown): asserts config is AlertsConfig {
  if (typeof config !== "object" || config === null) {
    throw new Error("toad-eye: alerts config must be an object");
  }
  const c = config as Record<string, unknown>;
  if (!Array.isArray(c["alerts"])) {
    throw new Error('toad-eye: alerts config missing required "alerts" array');
  }
  for (const rule of c["alerts"] as unknown[]) {
    if (typeof rule !== "object" || rule === null) {
      throw new Error("toad-eye: each alert rule must be an object");
    }
    const r = rule as Record<string, unknown>;
    for (const field of ["name", "metric", "condition"] as const) {
      if (typeof r[field] !== "string" || !r[field]) {
        throw new Error(
          `toad-eye: alert rule missing required string field "${field}"`,
        );
      }
    }
    if (!Array.isArray(r["channels"]) || r["channels"].length === 0) {
      throw new Error(
        `toad-eye: alert rule "${String(r["name"])}" must have at least one channel`,
      );
    }
  }
}

export function startAlertsFromFile(configPath: string): AlertManager {
  const raw = readFileSync(configPath, "utf-8");
  const parsed: unknown = yaml.parse(raw);
  const interpolated = interpolateConfig(parsed);
  validateConfig(interpolated);
  const manager = new AlertManager(interpolated);
  manager.start();
  return manager;
}
