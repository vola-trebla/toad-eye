import type { AlertChannelConfig, FiredAlert } from "./types.js";

function formatMessage(alert: FiredAlert): string {
  const topModelsText =
    alert.topModels.length > 0
      ? `\nTop models by spend:\n${alert.topModels.map((m) => `  • ${m.model}: $${m.value.toFixed(4)}`).join("\n")}`
      : "";
  return [
    `🚨 Alert: ${alert.rule.name}`,
    `Metric: ${alert.rule.metric}`,
    `Value: ${alert.value.toFixed(4)} (threshold: ${alert.threshold})`,
    `Condition: ${alert.rule.condition}`,
    topModelsText,
  ]
    .filter(Boolean)
    .join("\n");
}

async function sendTelegram(
  config: Extract<AlertChannelConfig, { type: "telegram" }>,
  alert: FiredAlert,
) {
  const res = await fetch(
    `https://api.telegram.org/bot${config.token}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: config.chatId,
        text: formatMessage(alert),
      }),
    },
  );
  if (!res.ok) throw new Error(`Telegram send failed: ${res.status}`);
}

async function sendSlackWebhook(
  config: Extract<AlertChannelConfig, { type: "slack_webhook" }>,
  alert: FiredAlert,
) {
  const res = await fetch(config.url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: formatMessage(alert) }),
  });
  if (!res.ok) throw new Error(`Slack webhook failed: ${res.status}`);
}

async function sendWebhook(
  config: Extract<AlertChannelConfig, { type: "webhook" }>,
  alert: FiredAlert,
) {
  const res = await fetch(config.url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...config.headers },
    body: JSON.stringify({
      alertName: alert.rule.name,
      metric: alert.rule.metric,
      value: alert.value,
      threshold: alert.threshold,
      condition: alert.rule.condition,
      topModels: alert.topModels,
      firedAt: alert.firedAt.toISOString(),
    }),
  });
  if (!res.ok) throw new Error(`Webhook delivery failed: ${res.status}`);
}

async function sendEmail(
  config: Extract<AlertChannelConfig, { type: "email" }>,
  alert: FiredAlert,
) {
  let createTransport: (typeof import("nodemailer"))["createTransport"];
  try {
    ({ createTransport } = await import("nodemailer"));
  } catch {
    throw new Error(
      "toad-eye: email alerts require nodemailer — install it: npm install nodemailer",
    );
  }
  const transporter = createTransport({
    host: config.host,
    port: config.port,
    auth: { user: config.user, pass: config.password },
  });
  const to =
    typeof config.to === "string"
      ? config.to
      : Array.from(config.to).join(", ");
  await transporter.sendMail({
    from: config.from,
    to,
    subject: `🚨 toad-eye alert: ${alert.rule.name}`,
    text: formatMessage(alert),
  });
}

export async function sendToChannel(
  channel: AlertChannelConfig,
  alert: FiredAlert,
) {
  switch (channel.type) {
    case "telegram":
      return sendTelegram(channel, alert);
    case "slack_webhook":
      return sendSlackWebhook(channel, alert);
    case "webhook":
      return sendWebhook(channel, alert);
    case "email":
      return sendEmail(channel, alert);
  }
}
