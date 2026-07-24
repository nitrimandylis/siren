// Shared push helper. Every watcher sends its alerts through here so the topic
// is read from the environment in exactly one place.

export type Push = {
  title: string;
  body: string;
  priority?: "default" | "high" | "urgent";
  tags?: string; // comma-separated ntfy tag names, e.g. "rotating_light"
  click?: string; // URL opened when the notification is tapped
};

export async function ping(push: Push) {
  const topic = process.env.NTFY_TOPIC;
  if (!topic) {
    throw new Error("NTFY_TOPIC is not set");
  }

  const headers: Record<string, string> = { Title: push.title };
  if (push.priority) headers.Priority = push.priority;
  if (push.tags) headers.Tags = push.tags;
  if (push.click) headers.Click = push.click;

  const response = await fetch(`https://ntfy.sh/${topic}`, {
    method: "POST",
    headers,
    body: push.body,
  });
  if (!response.ok) {
    throw new Error(`ntfy returned HTTP ${response.status}`);
  }
}
