import { evaluateCondition } from "./conditions.js";
import { sendToChannel } from "./channels.js";
import { postGrafanaAnnotation } from "./grafana.js";
import type { AlertsConfig, AlertRule, FiredAlert } from "./types.js";

const DEFAULT_PROMETHEUS_URL = "http://localhost:9090";
const DEFAULT_GRAFANA_URL = "http://localhost:3100";
const DEFAULT_EVAL_INTERVAL_SECONDS = 60;
const DEFAULT_COOLDOWN_MINUTES = 30;

export class AlertManager {
  private readonly config: AlertsConfig;
  private readonly cooldowns = new Map<string, number>();
  private intervalId: ReturnType<typeof setInterval> | undefined;

  constructor(config: AlertsConfig) {
    this.config = config;
  }

  start() {
    const intervalMs =
      (this.config.evalIntervalSeconds ?? DEFAULT_EVAL_INTERVAL_SECONDS) * 1000;
    this.intervalId = setInterval(() => void this.evaluate(), intervalMs);
    void this.evaluate();
    console.log(
      `[toad-eye alerts] Started — ${this.config.alerts.length} rule(s), eval every ${intervalMs / 1000}s`,
    );
  }

  stop() {
    if (this.intervalId !== undefined) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
  }

  private isInCooldown(rule: AlertRule): boolean {
    const lastFired = this.cooldowns.get(rule.name);
    if (lastFired === undefined) return false;
    const cooldownMs =
      (rule.cooldown ??
        this.config.cooldownMinutes ??
        DEFAULT_COOLDOWN_MINUTES) *
      60 *
      1000;
    return Date.now() - lastFired < cooldownMs;
  }

  private async evaluate() {
    const prometheusUrl = this.config.prometheusUrl ?? DEFAULT_PROMETHEUS_URL;
    const grafanaUrl = this.config.grafanaUrl ?? DEFAULT_GRAFANA_URL;

    for (const rule of this.config.alerts) {
      if (this.isInCooldown(rule)) continue;

      const result = await evaluateCondition(prometheusUrl, rule);
      if (!result?.triggered) continue;

      this.cooldowns.set(rule.name, Date.now());

      const firedAlert: FiredAlert = {
        rule,
        value: result.value,
        threshold: result.threshold,
        topModels: result.topModels,
        firedAt: new Date(),
      };

      console.log(
        `[toad-eye alerts] 🚨 "${rule.name}" fired — value=${result.value.toFixed(4)}, threshold=${result.threshold}`,
      );

      await Promise.allSettled([
        this.fireChannels(firedAlert),
        this.postAnnotation(
          grafanaUrl,
          firedAlert.rule.name,
          firedAlert.value,
          firedAlert.threshold,
        ),
      ]);
    }
  }

  private async fireChannels(alert: FiredAlert) {
    const channels = this.config.channels ?? {};
    for (const channelName of alert.rule.channels) {
      const channelConfig = channels[channelName];
      if (!channelConfig) {
        console.warn(
          `[toad-eye alerts] Channel "${channelName}" not configured, skipping`,
        );
        continue;
      }
      try {
        await sendToChannel(channelConfig, alert);
        console.log(`[toad-eye alerts] ✓ Sent to channel "${channelName}"`);
      } catch (err) {
        console.error(
          `[toad-eye alerts] ✗ Failed to send to channel "${channelName}":`,
          err,
        );
      }
    }
  }

  private async postAnnotation(
    grafanaUrl: string,
    name: string,
    value: number,
    threshold: number,
  ) {
    try {
      await postGrafanaAnnotation(
        grafanaUrl,
        { name, value, threshold },
        this.config.grafanaApiKey,
      );
    } catch (err) {
      console.error(
        `[toad-eye alerts] Failed to post Grafana annotation:`,
        err,
      );
    }
  }
}
