export type AlertChannelConfig =
  | {
      readonly type: "telegram";
      readonly token: string;
      readonly chatId: string;
    }
  | { readonly type: "slack_webhook"; readonly url: string }
  | {
      readonly type: "webhook";
      readonly url: string;
      readonly headers?: Record<string, string> | undefined;
    }
  | {
      readonly type: "email";
      readonly host: string;
      readonly port: number;
      readonly user: string;
      readonly password: string;
      readonly from: string;
      readonly to: string | readonly string[];
    };

export interface AlertRule {
  readonly name: string;
  readonly metric: string;
  readonly condition: string;
  readonly channels: readonly string[];
  readonly cooldown?: number | undefined;
}

export interface AlertsConfig {
  readonly prometheusUrl?: string | undefined;
  readonly grafanaUrl?: string | undefined;
  readonly grafanaApiKey?: string | undefined;
  readonly evalIntervalSeconds?: number | undefined;
  readonly cooldownMinutes?: number | undefined;
  readonly channels?: Record<string, AlertChannelConfig> | undefined;
  readonly alerts: readonly AlertRule[];
}

export interface FiredAlert {
  readonly rule: AlertRule;
  readonly value: number;
  readonly threshold: number;
  readonly topModels: ReadonlyArray<{ model: string; value: number }>;
  readonly firedAt: Date;
}
