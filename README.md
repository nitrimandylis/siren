```
 ███████╗██╗██████╗ ███████╗███╗   ██╗
 ██╔════╝██║██╔══██╗██╔════╝████╗  ██║
 ███████╗██║██████╔╝█████╗  ██╔██╗ ██║
 ╚════██║██║██╔══██╗██╔══╝  ██║╚██╗██║
 ███████║██║██║  ██║███████╗██║ ╚████║
 ╚══════╝╚═╝╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝
```

<div align="center">

### `EVERY ALERT THAT HAS TO POLL SOMETHING, IN ONE REPO`

*a folder, a cron, a push to your phone — repeat*

![runtime](https://img.shields.io/badge/runtime-bun-e63946?style=flat-square&labelColor=111111) ![ci](https://img.shields.io/badge/runs_on-github_actions-e63946?style=flat-square&labelColor=111111) ![deps](https://img.shields.io/badge/dependencies-0-ffb703?style=flat-square&labelColor=111111) ![watchers](https://img.shields.io/badge/watchers-3-ffb703?style=flat-square&labelColor=111111) ![license](https://img.shields.io/badge/license-MIT-e63946?style=flat-square&labelColor=111111)

</div>

---

## 📡 What is this

Some things you only find out by asking again and again: did the tickets drop, did the row get added, did the number move. Siren is where those questions live. Each one is a folder with a script, a GitHub Actions cron on its own schedule, and an [ntfy.sh](https://ntfy.sh) push at the end of it.

No database, no queue, no plugin system. A watcher is a folder and a workflow file. Adding one is copying a folder.

```console
nick@siren:~$ bun cinema/watch.ts
AVENGERS: nothing yet
DUNE: nothing yet

nick@siren:~$ bun repos/sync.ts
2 added, 3 refreshed, 2 readmes
[i] the machine asks so you don't have to.
```

## 🎬 `cinema` — ticket drops

IMAX tickets for hype releases at Village Cinemas Greece sell out in hours, and the new date blocks appear whenever the cinema feels like it. This watcher polls the booking page every five minutes, parses the `bookingData` JSON embedded in the HTML, and fires an **urgent** push the moment showtimes matching your hunt list go live.

There is no state. A triggered watch alarms again every five minutes until you delete its entry from `cinema/watches.json` — it is an alarm, not a log, and you silence it the same way you silence any alarm: by getting up and buying the tickets.

Each entry in `cinema/watches.json` is one movie you refuse to miss:

| | field | what it actually does |
|---|---|---|
| 01 | **title** | case-insensitive substring match against the listings — `"DUNE"` catches `DUNE: PART THREE` |
| 02 | **imax** | optional — only IMAX / IMAX 3D screens count (there is exactly one IMAX in Greece, at The Mall Athens) |
| 03 | **cinema** | optional cinema id — `21` The Mall Athens, `01` Rentis, `03` Pagrati, `22` Thessaloniki, `23` Volos, `26` Athens Metro Mall, `30` Larissa |
| 04 | **from** | optional `YYYY-MM-DD` — ignore showtimes before this date (for when the near dates are already gone) |

Built for THE ODYSSEY in IMAX. The 30/07 dates dropped while the first version was still being written (tickets secured, watcher instantly obsolete, repo repurposed the same week).
**Credits:** the `bookingData` trick comes from [johneliades/village_crawler](https://github.com/johneliades/village_crawler), which mapped out the Village booking page's embedded JSON first.
## 🏁 `f1` — Monaco ticket announcements

Monaco Grand Prix tickets are not a page you can watch for a buy button. Per-grandstand availability sits behind a session-bound XHR inside a JavaScript configurator, and Cloudflare's waiting room switches on at exactly the moment it would matter. What *is* catchable is the announcement, which ACM publishes four to six weeks before the sale — so this watches for that and hands you the date, rather than pretending it can win a click race.

Two sources, deliberately unequal:

| | source | role |
|---|---|---|
| 01 | `acm.mc/wp-json/wp/v2/posts` | **primary** — the only endpoint verified to answer a datacenter IP, and where the announcement lands. A failure throws, because a watcher that has been quietly 403ing for a month looks exactly like one with nothing to report |
| 02 | `monaco-grandprix.com/.../editions/2469` | **best-effort** — its `billetterie_presale_open_date` is the exact on-sale datetime, weeks early. The host 403s some datacenter ranges but answers Actions runners; kept best-effort anyway, since Cloudflare's waiting room goes live at exactly the moment this matters. Logs and skips on failure, never alarms, never fails the run |

There is no state, by construction. An announcement only counts while it is inside a 45-day freshness window, so last year's `billetterie-2026-prenez-date` cannot fire and no high-water mark has to be stored anywhere. Same alarm-not-a-log contract as `cinema`.

ACM's own history sets the expectation: 2025 tickets opened end of July 2024, and 2026 was announced on 7 August 2025 with presale on 8 September. The race itself is **3-6 June 2027** — the 15-16 May 2027 date you will find everywhere is the Monaco E-Prix, which is Formula E and a different event entirely.

## 🗂 `repos` — Notion sync

A projects database is only useful while it is true. This one diffs GitHub against a Notion database once a day, matched on a `GitHub Repo ID` property so renaming a repo does not fork it into two rows. A new repo gets a row, a drifted `Last Pushed` gets corrected, and the push only fires when something actually changed.

`Category` is left blank on new rows deliberately. It is the one field an API cannot guess, and an empty cell is a better reminder than a wrong guess. Idea-stage rows with no repo id are never touched.

The repo's README becomes the page body, so the database reads as a portfolio instead of a table of links. Notion's API takes block objects rather than markdown, so `repos/markdown.ts` converts the constructs a README actually uses — headings, lists, quotes, fenced code, inline links and emphasis — and drops badge rows and centering `<div>`s, which carry nothing outside GitHub. Tables survive as code blocks rather than being rebuilt as Notion tables.

The body belongs to the sync, not to you. A `README synced` date property records which README commit a body came from; when the README moves, the old body is deleted block by block and rebuilt. A push that never touched the README changes nothing. **Notes typed into one of these pages do not survive the next README commit** — put them in a property, or in the README itself. Repos that aren't projects (the profile README, for one) go in the `IGNORED` set at the top of `sync.ts`.

This repo is public, so its Actions logs are world-readable — the job prints counts only. The repo names go to your phone, not the log.

## 🚀 Run it

```bash
git clone https://github.com/nitrimandylis/siren.git
cd siren
bun test              # 40 tests on the parsers, filters, diff, and markdown
bun cinema/watch.ts   # one manual poll
bun f1/watch.ts       # one manual check
bun repos/sync.ts     # one manual sync
```

To arm it, set these as GitHub Actions secrets:

| secret | used by | what it is |
|---|---|---|
| `NTFY_TOPIC` | all | your ntfy topic — pick something unguessable like `odyssey-imax-x7k2f9`, then subscribe to it in the ntfy app |
| `GH_PAT` | `repos` | classic token with `repo` scope, so private repos are visible |
| `NOTION_API_KEY` | `repos` | internal integration token, with the database shared to that integration |

GitHub disables schedules after 60 days without commits, which is exactly how a watcher armed in July turns out to be dead in December. The `keepalive` workflow pushes an empty commit on the 1st of each month to reset that clock, then pings your current watch list — so the monthly notification is also your only proof the thing is still armed and still hunting what you think it is.

## 🔩 Under the hood

```mermaid
flowchart LR
    A[Actions cron<br/>per watcher] --> B[poll the source]
    B --> C[diff against what you want]
    C -->|something changed| D[ntfy.sh push]
    C -->|nothing yet| E[exit 0, try again next cron]
```

| layer | path | job |
|---|---|---|
| push | `ntfy.ts` | the one place `NTFY_TOPIC` is read — every watcher sends through it |
| watcher | `cinema/`, `f1/`, `repos/` | one folder each, self-contained, no shared state |
| markdown | `repos/markdown.ts` | markdown → Notion blocks, because the API refuses markdown |
| cron | `.github/workflows/*.yml` | one workflow per watcher, own schedule, offset from `:00` because github delays on-the-hour jobs |
| keepalive | `keepalive.ts` | monthly empty commit so github never disables the schedules, plus a "still armed" ping listing every watcher |
| tests | `*.test.ts`, `*/*.test.ts` | what actually breaks if a parser, the diff, or the markdown breaks |

**Stack:** bun · typescript · github actions · ntfy.sh — no dependencies, the sources' own JSON does all the work

---

<div align="center">

**[Nick Trimandylis](https://github.com/nitrimandylis)**

`THE F5 KEY IS RETIRED`

MIT licensed.

</div>
