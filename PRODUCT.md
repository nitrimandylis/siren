# siren

Home for every alert that has to poll something on a schedule. Each watcher is
a folder, a workflow, and its own cron. Everything ends in an ntfy.sh push to
my phone.

## Layout

- `ntfy.ts` — shared push helper, the one place `NTFY_TOPIC` is read.
- `notion.ts` — shared Notion client, the one place the API version is pinned.
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
  `billetterie_presale_open_date` carries the exact on-sale datetime weeks ahead.
  The host 403s *some* datacenter IPs (Anthropic's fetcher gets one), but a real
  Actions runner reached it on 26/07/2026. Kept best-effort anyway: a failure
  logs and is skipped, never alarms, never fails the run, because Cloudflare's
  waiting room goes live at exactly the moment this matters most. Edition post
  ids are reused and re-slugged each year, so `2469` survives the 2026 → 2027
  rename.

Four phases, because the announcement and the sale are weeks apart and cinema's
single-alarm contract does not survive that gap — you would silence the
announcement in August and hear nothing in September. `resolve()` ranks them: a
sale date that has passed beats everything, a post saying the sale is open beats
a date that has not passed, a known future date beats a vague announcement, an
announcement beats nothing.

- `live` — urgent, and repeats every cycle until you act. This is the cinema
  contract, and the only phase where repeating is correct.
- `dated` / `announced` — high priority, sent **once**. News is only news once;
  repeating it every 20 minutes for six weeks is how you train yourself to
  ignore the one push that matters.

`shouldSend()` holds that rule, and its real job is the store blinking out.
Losing the store drops the phase from `dated` back to `announced` with nothing
having actually happened, so alerting on *any* change would push twice per 403 —
down on the blip, up when it clears — every 20 minutes. A downgrade is therefore
silence, and it does not write state either, so the higher phase survives the
outage. Only a rank increase or new detail at the same rank alerts.

Store datetimes are Monaco local with no zone on them and Actions runners are
UTC, so they are parsed with an explicit `+02:00`. Without it a 09:00 sale reads
as 09:00 UTC and `live` fires two hours after the sale opened. Ceiling: CEST is
correct for the Aug-Sep window every sale has landed in, an hour out if one ever
moves to winter, which is inside the cron's own 5-20 min slip.

Ticket-post matching stays stateless: an announcement only counts inside
`FRESH_DAYS` (60), so last year's `billetterie-2026-prenez-date` can never fire.
60 and not 45 because the 2026 announcement-to-general-sale gap was 46 days
(07/08 → 22/09), so a 45-day window went stale a day before its own sale.
The once-only rule is the exception to the repo's no-state default — `state.txt`
holds one line, `phase` plus what produced it, committed back by the workflow
(`contents: write`). It is the smallest thing that works; every stateless
alternative was more code and worse behaviour. Nothing sensitive: a phase name
and a public slug.

Slug order matters. `LIVE_SLUG` is checked before the save-the-date patterns
because `ouverture-de-la-billetterie-officielle` matches both, and reading it as
a save-the-date would downgrade the one alert that must be urgent.

Timing, from ACM's own history: 2025 tickets opened end of July 2024, 2026 was
announced 07/08/2025 with presale 08/09 and general sale 22/09. Built 26/07/2026,
inside that window.

Known ceilings: per-grandstand availability is not obtainable — it sits behind a
`PHPSESSID`-bound XHR in a JS configurator, and Cloudflare's waiting room
activates at the moment it would matter. Actions crons also slip 5-20 min under
load, so this is built to catch the announcement (weeks of warning), not the
on-sale instant. Set a real alarm from the date it reports.

Secrets: `NTFY_TOPIC`.

### `managebac` — Notion Assignments sync

Daily walk of ManageBac's Tasks & Deadlines into the Notion Assignments
database. The scraping is not here: it lives in `bacpack`, which the workflow
checks out alongside this repo and imports `fetchTasks` from. bacpack is
deliberately ignorant of Notion, so this folder is the glue it refuses to be.

Matched on a `ManageBac` URL property, keyed on the **trailing** task id rather
than the whole URL. ManageBac task URLs look like
`/student/classes/12914478/events/48354386` and the class id in the middle is
reissued every September, so keying on the whole URL would fork every row
annually. Keying on the title would fork on the first edit, since assignment
titles get rewritten to be actionable the moment a row lands.

Create-and-refresh only, never delete and never overwrite judgement. `Type` is
left blank (Homework vs Assessment vs IA cannot be guessed) and `Priority`
defaults to Medium so a new row reads as unranked rather than unseen. Once a row
exists only `Due` is touched: Status, Task and Priority belong to Nick. A task
falling off ManageBac's upcoming list means it passed, not that the row goes.

Class names are matched by lowercased substring against the database's own
subject vocabulary, first match wins, unmapped lands in `Other`. All nine real class
names were checked against the table on 2026-08-03. They are not in the repo:
siren is public and a class list is a timetable, the same reason bacpack's
examples never name the school. `sync.test.ts` pins reworded versions that keep each
name's awkward shape, and the real list lives in project memory.

Nothing detects a September rename automatically. The table just stops matching
and the rows land in `Other`, which is visible because the push names the
subject of every row it files. `tok` is last in the table because three letters
can hide inside a longer word.

Dates use local components rather than `toISOString`. bacpack builds the Date
from ManageBac's wall-clock text, so a midnight deadline read from Athens
converts back to the previous day in UTC and quietly moves the deadline.

The cookie is written to `~/.config/managebac/cookie` by the workflow because
that is the only place bacpack's client reads it from. `printf`, not `echo`, so
it never reaches the log even before GitHub masks it.

## Discussions, which is where the homework actually is

Tasks & Deadlines is only the formal stuff: it held **2** items where the class
discussion pages held **31** across eight months. Most homework is set in a
discussion post, so the watcher reads those too.

It cannot classify them, and does not try. Teachers fill the category field in
about half the time (16 of 31 posts, only 5 of them `Homework`), and the highest
stakes post in the set, the Maths IA first-draft deadline, is filed under
`Announcements`. The due date is never a field, it is prose, and the prose is
adversarial: `HW for Tuesday May 5` carries its date in the title, `Solve from
May 24, question 2` names a past paper rather than a deadline, and `solve them
if you have the time` is not a task at all. Any regex over that files real work
on invented dates.

So every new post becomes a row with **no Due and no Priority**, which is the
triage queue: a ManageBac link and no date means you have not read it yet. You
set the date, or you delete the row. Volume is about one post a week across all
nine classes, so triage is a minute.

**State is `managebac/seen.txt`, one integer**, committed back by the workflow
like `f1/state.txt`. Discussion ids are a global ascending sequence, verified
across all 31 posts sorted by id landing in exactly date order with zero
inversions, so "new" is one comparison. It is a file and not a Notion lookup on
purpose: if "already filed" meant "a row with this link exists", deleting a post
you judged not to be homework would bring it back the next morning. Deleting has
to stick.

**A first run seeds and files nothing.** Importing eight months of backlog as
untriaged rows would make deleting all of them the first job.

Cross-posts are collapsed on title plus exact timestamp. The same CS
announcement goes to both Computer Science classes as two separate records with
two ids, so the watermark cannot catch it. The timestamp has to be in the key
because Global Politics has three distinct posts all titled `Homework`.

Known ceilings: the discussions page shows five posts and paginates behind a
"Show More" whose route is not mapped, so a class that goes quiet for a term and
then posts six times in a day would lose the oldest. Row names come straight
from the post title, so three of them will say `Homework` until you rename them.

Known ceilings: undated tasks are skipped, since the database sorts on Due and a
row without one does not surface. The cookie lasts about a year and its death is
a hard failure with a clear 401, not a silent no-op. Nothing flows the other
way — Notion to ManageBac needs a human, because ManageBac has no delete
endpoint and a retried write double-posts to a real school record.

Secrets: `NTFY_TOPIC`, `NOTION_API_KEY`, `MANAGEBAC_SCHOOL`, `MANAGEBAC_COOKIE`.
Needs `contents: write` for the watermark.

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

Verified 2026-07-31: a push made with the built-in `GITHUB_TOKEN` does reset
the 60-day clock. No need to check out with `GH_PAT`.

Secrets: `NTFY_TOPIC`.

## History

Built 20/07/2026 as a single-purpose cinema watcher for THE ODYSSEY IMAX — the
30/07+ dates dropped while the first version was being written, tickets secured
same day. Generalized into an alert hub on 25/07/2026, when syncing the Notion
projects database by hand got old.
