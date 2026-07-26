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
projects) are never touched. The `nitrimandylis` profile README repo is skipped
via an `IGNORED` set at the top of `sync.ts` — add to it for anything else on
GitHub that isn't a project.

The repo README becomes the page body. `repos/markdown.ts` converts markdown to
Notion blocks (the API won't take markdown): headings, lists, quotes, fenced
code, inline links and emphasis. Badge rows and centering `<div>`s are dropped,
tables survive as code blocks.

The body is owned by the sync. The `README synced` date property holds the date
of the README commit a body was built from; when the README moves, the body is
deleted block by block and rebuilt, and the property is stamped forward. A push
that never touched the README rebuilds nothing. Notes typed into one of these
pages do not survive the next README commit.

Known ceilings: a README over 300 blocks is cut (`MAX_BODY_BLOCKS`), any single
text run over 2000 characters is truncated, appends are chunked 100 at a time,
and every Notion write is followed by a 350 ms gap to stay under its ~3
requests/second. Clearing a page costs one DELETE per block, so a rebuild is
slow by design — it only happens when a README actually moves.

The repo is public, so Actions logs are world-readable: the job logs counts
only, never repo names. Names go to the phone instead.

Secrets: `NTFY_TOPIC`, `GH_PAT` (classic token, `repo` scope, so private repos
are visible), `NOTION_API_KEY` (internal integration with the database shared to
it). The workflow maps `NOTION_API_KEY` to the `NOTION_TOKEN` env var the script
reads — GitHub reserves the `GITHUB_` prefix, which is also why the PAT is not
called `GITHUB_TOKEN`.

### `f1` — Monaco 2027 ticket announcement

Polls every 20 min for ACM announcing the 2027 Monaco Grand Prix ticket sale.
The race is 3-6 June 2027 (the 15-16 May 2027 date is the Monaco E-Prix, a
different event on a different site).

Two sources, deliberately unequal:

- `acm.mc/wp-json/wp/v2/posts` is the primary. It is the only endpoint verified
  to answer a datacenter IP, and it is where the announcement gets published. A
  failure here throws, on the cinema canary principle.
- `monaco-grandprix.com/wp-json/acf/v3/editions/2469` is the better signal — its
  `billetterie_presale_open_date` carries the exact on-sale datetime weeks ahead
  — but the host 403s datacenter IPs. Best-effort: a failure logs and is skipped,
  never alarms, never fails the run. Edition post ids are reused and re-slugged
  each year, so `2469` survives the 2026 → 2027 rename.

Stateless like `cinema`, by construction: an announcement only counts while it is
within `FRESH_DAYS` (45), so last year's `billetterie-2026-prenez-date` cannot
alarm and no high-water mark has to be stored. It re-fires every cycle until the
workflow is disabled.

Timing, from ACM's own history: 2025 tickets opened end of July 2024, 2026 was
announced 07/08/2025 with presale 08/09 and general sale 22/09. Built 26/07/2026,
inside that window.

Known ceilings: per-grandstand availability is not obtainable — it sits behind a
`PHPSESSID`-bound XHR in a JS configurator, and Cloudflare's waiting room
activates at the moment it would matter. Actions crons also slip 5-20 min under
load, so this is built to catch the announcement (weeks of warning), not the
on-sale instant. Set a real alarm from the date it reports.

Secrets: `NTFY_TOPIC`.

### `keepalive` — monthly heartbeat

Not a watcher. GitHub disables every schedule in a repo after 60 days with no
repository activity, and workflow runs do not count — so a watcher armed in
July for a December release quietly disarms itself in September. On the 1st of
each month this pushes an empty commit (`git commit --allow-empty`, no state
file, nothing to read) and then pings a status line per scheduled workflow. The
ping runs only after the commit lands, so the push to the phone is proof the
whole thing worked rather than proof the job started.

The watcher list is read off `.github/workflows/*.yml` rather than hardcoded, so
a new watcher shows up in the ping without anyone remembering to add it. Cinema
gets its `watches.json` entries and their filters appended, because that is the
one part that goes stale. Ceiling: a workflow file on disk means "scheduled",
not "still enabled" — checking the latter needs the Actions API and a token,
which is the thing keepalive exists to make unnecessary.

Unverified: whether a push made with the built-in `GITHUB_TOKEN` resets the
60-day clock. If schedules get disabled anyway, check out with `GH_PAT`.

Secrets: `NTFY_TOPIC`.

## History

Built 20/07/2026 as a single-purpose cinema watcher for THE ODYSSEY IMAX — the
30/07+ dates dropped while the first version was being written, tickets secured
same day. Generalized into an alert hub on 25/07/2026, when syncing the Notion
projects database by hand got old.
