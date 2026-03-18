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

export function startAlertsFromFile(configPath: string): AlertManager {
  const raw = readFileSync(configPath, "utf-8");
  const config = yaml.parse(raw) as AlertsConfig;
  const manager = new AlertManager(config);
  manager.start();
  return manager;
}
