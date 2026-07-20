# imax-ping

Watcher that pings my phone when THE ODYSSEY IMAX showtimes on/after 30/07/2026
appear at Village Cinemas, The Mall Athens (the only IMAX location in Greece).

- `watch.ts` — fetches the Village Cinemas film-choice page, parses the embedded
  `bookingData` JSON, filters for IMAX Odyssey showtimes ≥ 30/07 at cinema 21,
  and POSTs an urgent push to ntfy.sh if any exist.
- `.github/workflows/watch.yml` — runs it every ~5 min via GitHub Actions cron.
- Repeats the ping every cycle until the workflow is disabled (alarm, not log).

Needs `NTFY_TOPIC` as a GitHub Actions secret. Single-purpose and disposable:
once the tickets are booked, disable the workflow.

Status (20/07/2026): the target dates dropped the day this was built — 30/07
through 05/08 went live while the watcher was being written.
