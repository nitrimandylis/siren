// Discord sender. Only push.ts calls this; watchers go through ping() there.
// Posts as SIGIL, the identity every automation speaks as. Plain text, not an
// embed: a bold title, the body, the link, and the tags as a subtext line.

import { fetchRetry } from "./retry";
import type { Push } from "./push";

// Discord truncates nothing: it answers 400 and the run fails. Cut instead.
const CONTENT_MAX = 2000;

export async function pingDiscord(push: Push) {
  const webhook = process.env.DISCORD_WEBHOOK;
  if (!webhook) {
    throw new Error("DISCORD_WEBHOOK is not set");
  }

  const lines = [`**${push.title}**`, push.body];
  if (push.click) lines.push(push.click);
  if (push.tags) lines.push(`-# ${push.tags}`);
  // A muted channel still pushes to the phone for a mention, which is the
  // only thing here that behaves like ntfy's urgent priority.
  if (push.priority === "urgent") lines.unshift("@here");

  const response = await fetchRetry(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "SIGIL",
      content: lines.join("\n").slice(0, CONTENT_MAX),
      allowed_mentions: { parse: ["everyone"] },
    }),
  });
  if (!response.ok) {
    throw new Error(`Discord returned HTTP ${response.status}`);
  }
}
