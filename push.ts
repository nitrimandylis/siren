// Shared push helper. Every watcher sends its alerts through here, and this is
// the only place the transport is chosen: Discord if DISCORD_WEBHOOK is set,
// ntfy if NTFY_TOPIC is set, both if both are. Neither set is a loud failure.

import { pingDiscord } from "./discord";
import { pingNtfy } from "./ntfy";

export type Push = {
  title: string;
  body: string;
  priority?: "default" | "high" | "urgent";
  tags?: string; // ntfy tag names or Discord footer text, e.g. "rotating_light"
  click?: string; // URL opened when the notification is tapped
};

export async function ping(push: Push) {
  const senders = [];
  if (process.env.DISCORD_WEBHOOK) senders.push(pingDiscord(push));
  if (process.env.NTFY_TOPIC) senders.push(pingNtfy(push));
  if (senders.length === 0) {
    throw new Error("neither DISCORD_WEBHOOK nor NTFY_TOPIC is set");
  }
  await Promise.all(senders);
}
