export async function postGrafanaAnnotation(
  grafanaUrl: string,
  alert: { name: string; value: number; threshold: number },
  apiKey: string | undefined,
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  } else {
    // Fall back to Basic Auth with default Grafana credentials
    headers["Authorization"] = `Basic ${btoa("admin:admin")}`;
  }

  const res = await fetch(`${grafanaUrl}/api/annotations`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      time: Date.now(),
      tags: ["toad-eye", "alert", alert.name],
      text: `🚨 ${alert.name}: ${alert.value.toFixed(4)} > ${alert.threshold}`,
    }),
  });
  if (!res.ok) {
    throw new Error(
      `Grafana annotation failed: ${res.status} ${res.statusText}`,
    );
  }
}
