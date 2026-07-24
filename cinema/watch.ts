// Watches Village Cinemas for showtimes matching the entries in watches.json
// and pings ntfy.sh for every watch that has matches. Silence a watch by
// deleting its entry (or disable the workflow).

import { ping } from "../ntfy";
import watches from "./watches.json";

const PAGE_URL = "https://www.villagecinemas.gr/en/tickets/film-choice";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const CINEMAS: Record<string, string> = {
  "01": "Rentis",
  "03": "Pagrati",
  "21": "The Mall Athens",
  "22": "Thessaloniki",
  "23": "Volos",
  "26": "Athens Metro Mall",
  "30": "Larissa",
};

export type Watch = {
  title: string; // case-insensitive substring of the movie title
  imax?: boolean; // only IMAX / IMAX 3D screens
  cinema?: string; // cinema id, e.g. "21" for The Mall Athens
  from?: string; // only showtimes on/after this date, "YYYY-MM-DD"
};

export function parseBookingData(html: string) {
  const match = html.match(/var bookingData = (\{[\s\S]*?)<\/script>/);
  if (match === null) {
    throw new Error("bookingData not found on page — layout may have changed");
  }
  return JSON.parse(match[1]);
}

// Returns the showtimes matching a watch, e.g. "2026-12-18 21:30 IMAX 7 @ The Mall Athens".
// Empty array means the movie isn't listed yet or nothing passes the filters.
export function matchShowtimes(data: any, watch: Watch): string[] {
  const wanted = watch.title.toUpperCase();
  const movieIds = new Set<string>();
  for (const record of data.records) {
    if (record.title.toUpperCase().includes(wanted)) {
      movieIds.add(record.movieId);
    }
  }

  const lines: string[] = [];
  for (const screen of data.screens) {
    if (!movieIds.has(screen.scheduledFilmId)) continue;
    if (watch.imax && !(screen.isImax || screen.isImax3D)) continue;
    if (watch.cinema && screen.cinemaId !== watch.cinema) continue;
    const date = screen.showtime.slice(0, 10);
    if (watch.from && date < watch.from) continue;
    const time = screen.showtime.slice(11, 16);
    const cinema = CINEMAS[screen.cinemaId] ?? `cinema ${screen.cinemaId}`;
    lines.push(`${date} ${time} ${screen.screenName} @ ${cinema}`);
  }
  return lines.sort();
}

async function alert(watch: Watch, lines: string[]) {
  const shown = lines.slice(0, 25);
  if (lines.length > shown.length) {
    shown.push(`...and ${lines.length - shown.length} more`);
  }
  await ping({
    title: `${watch.title} tickets are UP`,
    body: shown.join("\n"),
    priority: "urgent",
    tags: "rotating_light",
    click: PAGE_URL,
  });
}

async function main() {
  const response = await fetch(PAGE_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Village Cinemas returned HTTP ${response.status}`);
  }
  const data = parseBookingData(await response.text());

  for (const watch of watches as Watch[]) {
    const lines = matchShowtimes(data, watch);
    if (lines.length === 0) {
      console.log(`${watch.title}: nothing yet`);
      continue;
    }
    await alert(watch, lines);
    console.log(`${watch.title}: ALERT sent (${lines.length} showtimes)`);
  }
}

if (import.meta.main) {
  await main();
}
