// Discord sender. Only push.ts calls this; watchers go through ping() there.
// Name and avatar come from the webhook's own settings in Discord, so the
// payload sets neither. Markdown, not an
// embed: a heading, the body as a quote, and one subtext line with the tags
// and the link. The link is wrapped in <> so Discord does not add a preview
// card under it, which would bring the block back.

import { fetchRetry } from "./retry";
import type { Push } from "./push";

// Discord truncates nothing: it answers 400 and the run fails. Cut instead.
const CONTENT_MAX = 2000;

export async function pingDiscord(push: Push) {
  const webhook = process.env.DISCORD_WEBHOOK;
  if (!webhook) {
    throw new Error("DISCORD_WEBHOOK is not set");
  }

  const lines = [`### ${push.title}`, ...push.body.split("\n").map((l) => `> ${l}`)];
  const foot = [push.tags, push.click && `[open](<${push.click}>)`].filter(Boolean);
  if (foot.length) lines.push(`-# ${foot.join(" · ")}`);
  // A muted channel still pushes to the phone for a mention, which is the
  // only thing here that behaves like ntfy's urgent priority.
  if (push.priority === "urgent") lines.unshift("@here");

  const response = await fetchRetry(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      content: lines.join("\n").slice(0, CONTENT_MAX),
      allowed_mentions: { parse: ["everyone"] },
    }),
  });
  if (!response.ok) {
    throw new Error(`Discord returned HTTP ${response.status}`);
  }
}
