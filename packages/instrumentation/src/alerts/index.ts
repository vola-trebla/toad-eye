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

export function startAlertsFromFile(configPath: string): AlertManager {
  const raw = readFileSync(configPath, "utf-8");
  const parsed = yaml.parse(raw) as AlertsConfig;
  const config = interpolateConfig(parsed) as AlertsConfig;
  const manager = new AlertManager(config);
  manager.start();
  return manager;
}
