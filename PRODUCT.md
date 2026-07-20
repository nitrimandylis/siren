# siren

Watcher that pings my phone the moment Village Cinemas (Greece) opens booking
for movies I'm hunting tickets for — built for hype releases where IMAX sells
out in hours (proved itself on THE ODYSSEY, now aimed at Avengers and Dune 3).

- `watches.json` — the hunt list. Each entry: `title` (substring match),
  optional `imax`, `cinema` (id), `from` (YYYY-MM-DD).
- `watch.ts` — fetches the Village film-choice page, parses the embedded
  `bookingData` JSON, and sends an urgent ntfy.sh push for every watch with
  matching showtimes.
- `.github/workflows/watch.yml` — runs it every ~5 min via GitHub Actions cron.
- No state: a triggered watch pings every cycle until you delete its entry
  from `watches.json`. It's an alarm, not a log.

Needs `NTFY_TOPIC` as a GitHub Actions secret.

Cinema ids: 01 Rentis, 03 Pagrati, 21 The Mall Athens (the only IMAX),
22 Thessaloniki, 23 Volos, 26 Athens Metro Mall, 30 Larissa.

History: built 20/07/2026 for THE ODYSSEY IMAX — the 30/07+ dates dropped
while the first version was being written, tickets secured same day.
