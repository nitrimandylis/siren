// Shared Notion client. Every watcher that writes to Notion goes through here
// so the API version is pinned in exactly one place, the way NTFY_TOPIC is
// read in exactly one place in ntfy.ts.

import { fetchRetry } from "./retry";

const NOTION_VERSION = "2022-06-28";

export async function notion(method: string, path: string, token: string, body?: unknown) {
  const response = await fetchRetry(`https://api.notion.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    // The body is truncated because Cloudflare error pages are whole HTML
    // documents and they drown the Actions log.
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`Notion ${path} returned HTTP ${response.status}: ${detail}`);
  }
  return response.json();
}
