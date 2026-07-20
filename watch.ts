// Watches Village Cinemas for THE ODYSSEY IMAX showtimes on/after CUTOFF
// at The Mall Athens, and pings ntfy.sh when they appear.

const PAGE_URL = "https://www.villagecinemas.gr/en/tickets/film-choice";
const CUTOFF = "2026-07-30";
const CINEMA_ID = "21"; // Maroussi - The Mall Athens, the only IMAX location
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

// Extracts the bookingData JSON from the page and returns the qualifying
// showtimes as human-readable strings, e.g. "2026-07-30 21:30 IMAX 7".
export function findImaxDrops(html: string): string[] {
  const match = html.match(/var bookingData = (\{[\s\S]*?)<\/script>/);
  if (match === null) {
    throw new Error("bookingData not found on page — layout may have changed");
  }
  const data = JSON.parse(match[1]);

  const odysseyIds = new Set<string>();
  for (const record of data.records) {
    if (record.title.toUpperCase().includes("ODYSSEY")) {
      odysseyIds.add(record.movieId);
    }
  }
  if (odysseyIds.size === 0) {
    throw new Error("THE ODYSSEY not in listings — title may have changed");
  }

  const hits: string[] = [];
  for (const screen of data.screens) {
    const isImax = screen.isImax || screen.isImax3D;
    const date = screen.showtime.slice(0, 10); // "2026-07-30" from "2026-07-30T21:30:00"
    if (
      odysseyIds.has(screen.scheduledFilmId) &&
      screen.cinemaId === CINEMA_ID &&
      isImax &&
      date >= CUTOFF
    ) {
      const time = screen.showtime.slice(11, 16);
      const soldout = screen.soldoutStatus ? " (soldout)" : "";
      hits.push(`${date} ${time} ${screen.screenName}${soldout}`);
    }
  }
  return hits.sort();
}

async function main() {
  const response = await fetch(PAGE_URL, { headers: { "User-Agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Village Cinemas returned HTTP ${response.status}`);
  }
  const hits = findImaxDrops(await response.text());

  if (hits.length === 0) {
    console.log(`No IMAX showtimes on/after ${CUTOFF} yet.`);
    return;
  }

  const topic = process.env.NTFY_TOPIC;
  if (!topic) {
    throw new Error("NTFY_TOPIC is not set");
  }
  const ping = await fetch(`https://ntfy.sh/${topic}`, {
    method: "POST",
    headers: {
      Title: "ODYSSEY IMAX 30/07+ tickets are UP",
      Priority: "urgent",
      Tags: "rotating_light",
      Click: PAGE_URL,
    },
    body: hits.join("\n"),
  });
  if (!ping.ok) {
    throw new Error(`ntfy returned HTTP ${ping.status}`);
  }
  console.log("ALERT sent:\n" + hits.join("\n"));
}

if (import.meta.main) {
  await main();
}
