// ntfy.sh sender. Only push.ts calls this; watchers go through ping() there.

import { fetchRetry } from "./retry";
import type { Push } from "./push";

export async function pingNtfy(push: Push) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) {
    throw new Error("NTFY_TOPIC is not set");
  }

  const headers: Record<string, string> = { Title: push.title };
  if (push.priority) headers.Priority = push.priority;
  if (push.tags) headers.Tags = push.tags;
  if (push.click) headers.Click = push.click;

  const response = await fetchRetry(`https://ntfy.sh/${topic}`, {
    method: "POST",
    headers,
    body: push.body,
  });
  if (!response.ok) {
    throw new Error(`ntfy returned HTTP ${response.status}`);
  }
}
