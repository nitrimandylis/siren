# siren

Home for every alert that has to poll something on a schedule. Each watcher is
a folder, a workflow, and its own cron. Everything ends in an ntfy.sh push to
my phone.

## Layout

- `ntfy.ts` — shared push helper, the one place `NTFY_TOPIC` is read.
- `<watcher>/` — one folder per watcher, self-contained.
- `.github/workflows/<watcher>.yml` — one workflow per watcher, its own cron.

Adding a watcher: new folder, new workflow, pick a cron offset from `:00`
(GitHub delays on-the-hour jobs the most). No registry, no plugin system.

## Watchers

### `cinema` — Village Cinemas ticket drops

Polls the Village Cinemas (Greece) booking page every ~5 min and fires an
urgent push the moment showtimes matching `cinema/watches.json` appear. Built
for hype releases where IMAX sells out in hours (proved itself on THE ODYSSEY,
now aimed at Avengers and Dune 3).

No state: a triggered watch pings every cycle until its entry is deleted. It's
an alarm, not a log.

Cinema ids: 01 Rentis, 03 Pagrati, 21 The Mall Athens (the only IMAX),
22 Thessaloniki, 23 Volos, 26 Athens Metro Mall, 30 Larissa.

Secrets: `NTFY_TOPIC`.

### `repos` — Notion Coding Projects sync

Daily diff between GitHub and the Notion Coding Projects database, matched on
the `GitHub Repo ID` property so renames don't duplicate rows. Adds a row for
every repo that has none, refreshes `Last Pushed` where it drifted, and pushes
a summary only when something changed.

`Category` is left empty on new rows on purpose — it's a judgement call, and an
empty cell is a visible prompt to make it. Rows with no repo id (idea-stage
projects) are never touched.

The repo is public, so Actions logs are world-readable: the job logs counts
only, never repo names. Names go to the phone instead.

Secrets: `NTFY_TOPIC`, `GH_PAT` (classic token, `repo` scope, so private repos
are visible), `NOTION_TOKEN` (internal integration with the database shared to
it).

## History

Built 20/07/2026 as a single-purpose cinema watcher for THE ODYSSEY IMAX — the
30/07+ dates dropped while the first version was being written, tickets secured
same day. Generalized into an alert hub on 25/07/2026, when syncing the Notion
projects database by hand got old.
