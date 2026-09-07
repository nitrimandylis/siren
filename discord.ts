// Discord sender. Only push.ts calls this; watchers go through ping() there.
// Posts as SIGIL, the identity every automation speaks as.

import { fetchRetry } from "./retry";
import type { Push } from "./push";

// Discord truncates nothing: it answers 400 and the run fails. Cut instead.
const TITLE_MAX = 256;
const BODY_MAX = 4096;

const COLOURS = {
  default: 0x5865f2,
  high: 0xf5a623,
  urgent: 0xed4245,
};

export async function pingDiscord(push: Push) {
  const webhook = process.env.DISCORD_WEBHOOK;
  if (!webhook) {
    throw new Error("DISCORD_WEBHOOK is not set");
  }

  const priority = push.priority ?? "default";

  const response = await fetchRetry(webhook, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "SIGIL",
      // A muted channel still pushes to the phone for a mention, which is the
      // only thing here that behaves like ntfy's urgent priority.
      content: priority === "urgent" ? "@here" : undefined,
      allowed_mentions: { parse: ["everyone"] },
      embeds: [
        {
          title: push.title.slice(0, TITLE_MAX),
          description: push.body.slice(0, BODY_MAX),
          url: push.click,
          color: COLOURS[priority],
          footer: push.tags ? { text: push.tags } : undefined,
        },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Discord returned HTTP ${response.status}`);
  }
}
