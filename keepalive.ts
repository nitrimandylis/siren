// Monthly heartbeat. The workflow's empty commit is what stops GitHub from
// disabling every schedule in this repo after 60 days without a push; this
// script is the other half — proof on the phone that the watchers are still
// armed, and watching what you think they are.

import { ping } from "./ntfy";
import watches from "./cinema/watches.json";

const titles = (watches as { title: string }[]).map((w) => w.title);

await ping({
  title: "siren is armed",
  body: titles.length > 0 ? `cinema: ${titles.join(", ")}` : "cinema: no watches",
  tags: "satellite",
});

// The repo is public, so the log gets the count and the phone gets the names.
console.log(`armed: ${titles.length} cinema watches`);
