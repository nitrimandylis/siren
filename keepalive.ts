// Monthly heartbeat. The workflow's empty commit is what stops GitHub from
// disabling every schedule in this repo after 60 days without a push; this
// script is the other half — proof on the phone that the watchers are still
// armed, and watching what you think they are.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ping } from "./ntfy";
import watches from "./cinema/watches.json";
import type { Watch } from "./cinema/watch";

const WORKFLOWS = join(import.meta.dir, ".github", "workflows");

// "3-59/5 * * * *" -> "every 5 min", "17 6 * * *" -> "daily", "41 7 1 * *" ->
// "monthly". Anything else returns the raw cron rather than guessing wrong.
export function describeCron(cron: string): string {
  const [minute, hour, day] = cron.split(" ");
  if (hour === "*" && minute.includes("/")) return `every ${minute.split("/")[1]} min`;
  if (hour === "*") return cron;
  if (day !== "*") return "monthly";
  return "daily";
}

export function describeWatch(watch: Watch): string {
  const filters: string[] = [];
  if (watch.imax) filters.push("imax");
  if (watch.cinema) filters.push(`cinema ${watch.cinema}`);
  if (watch.from) filters.push(`from ${watch.from}`);
  return filters.length === 0 ? watch.title : `${watch.title} (${filters.join(", ")})`;
}

// The keepalive cron is the 1st of the month, so the next one is the 1st of the
// next one. Month 12 rolls the year over on its own.
export function nextKeepalive(from: Date): string {
  const next = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  const day = String(next.getDate()).padStart(2, "0");
  const month = String(next.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

// One line per scheduled workflow, read off the workflow files so a new watcher
// appears here without anyone remembering to add it.
// ponytail: a file on disk means "scheduled", not "still enabled" — if GitHub
// ever disables a schedule anyway, this reports it as armed. Checking for real
// needs the Actions API and a token, which is the thing keepalive exists to
// make unnecessary.
export function status(now: Date): string[] {
  const lines: string[] = [];
  for (const file of readdirSync(WORKFLOWS).sort()) {
    const name = file.replace(/\.ya?ml$/, "");
    if (name === "keepalive") continue;
    const cron = readFileSync(join(WORKFLOWS, file), "utf8").match(/cron:\s*"([^"]+)"/);
    if (cron === null) continue; // not on a schedule, nothing to keep alive
    let line = `${name}: ${describeCron(cron[1])}`;
    if (name === "cinema") {
      const list = (watches as Watch[]).map(describeWatch).join(", ");
      line += list.length === 0 ? " — no watches" : ` — ${list}`;
    }
    lines.push(line);
  }
  lines.push(`next keepalive: ${nextKeepalive(now)}`);
  return lines;
}

if (import.meta.main) {
  const lines = status(new Date());
  await ping({
    title: "siren is armed",
    body: lines.join("\n"),
    tags: "satellite",
  });
  // The repo is public, so the log gets the count and the phone gets the names.
  console.log(`armed: ${lines.length - 1} scheduled workflows`);
}
