# Pipeline metrics (#3679)

Workflow-run and job history, copied from the GitHub API onto the `pipeline-data` branch so it
outlives GitHub's 90-day retention, plus a weekly roll-up. Run by `.github/workflows/pipeline-metrics.yml`
**hourly** (minute 23) and by hand (`workflow_dispatch`, input `max_calls`).

## Files (on `pipeline-data`, under `metrics/`)
| Path | Content |
| --- | --- |
| `runs/<day>.jsonl` | one run row per line (day = created date, UTC). Keys: `id attempt workflow event branch sha prs created started ended status conclusion` |
| `jobs/<day>.jsonl` | one line per run: `{run_id, attempt, jobs:[{name started ended conclusion failed_step}]}` |
| `schedules/<day>.json` | `{workflow.yml: [cron…]}` read from `main` at collect time |
| `state.json` | fetch bookkeeping (when each day's runs were last fetched); the roll-up never reads it |
| `latest.json` | the roll-up (below) |

Only numbers, ids, names, branches, times and conclusions are stored — no actors, titles, commit messages or emails.

## Scripts
- `collect.mjs` — copies facts, computes nothing. Splits the day into windows until each has < 1000 runs (the list API returns at most 1000 per query). Jobs are one lookup per completed, non-skipped run, oldest day first, merged to disk every 100 lookups, so it resumes. Covers today and yesterday by default (`--days N` for a deliberate catch-up by hand). Stops at `--max-calls` (default 1500), after `--max-minutes` (default 20), or when the remaining allowance drops under 1500 (the agent pipeline shares the App token). A call that does not answer within `--call-timeout-seconds` (default 30) stops the run like any failed call. Prints one `collect: <day> runs N, jobs M, calls used K` line per finished day and a final `::notice::` with the stop reason. The workflow publishes what was collected even when this step stops early or times out.
- `rollup.mjs --data <dir>` — no network, no clock. `as_of` is the newest run in the data, so the same data gives byte-identical `latest.json`. Recompute any time: `node scripts/metrics/rollup.mjs --data <checkout of pipeline-data>`.
- `publish.mjs` — commit `metrics/` and push to `pipeline-data`, rebasing on a non-fast-forward.
- `lines.json` — which workflow belongs to which line (tickets, planning, building, fixing, merging, deploys, scheduled). A test requires every workflow file to be listed exactly once.

## Metrics in `latest.json` (per ISO week, Mon–Sun UTC, e.g. `2026-W46`)
- `workflows[wf]` — `runs` = success + failure + timed_out; `failed` = failure + timed_out; `rate` = failed ÷ runs. Cancelled, skipped and unfinished runs are left out.
- `jobs["wf/job"]` — the same per job. `jobs_coverage` = `eligible_runs` vs `runs_with_jobs`: the first week (data starts on the day collection began) and any day a run stopped early rest on only part of their runs; `jobs_coverage` shows the gap.
- `schedules[wf]` — `slots` = cron times in the week (UTC) that could be judged (≥2 h before `as_of`), counted from the UTC day of the workflow's first run seen. A slot is met by a `schedule` run started within 2 h after it. `missed` = unmet slots; `failed_runs` = schedule runs that ended in anything but success; `total` = both.
- `lines[line]` — summed over the line's workflows: `runs`, `failed`, `workflow_rate`, plus `schedule_total`.
- `data_commit` — the last `pipeline-data` commit that touched `metrics/runs|jobs|schedules` (not HEAD, so rollup's own commit does not change it).

## Volume (measured 10 Nov 2026)
No backfill: history starts on the day collection began (owner, 10 Nov). Busiest day measured: 5,918 job lookups. At 0.5–2.6 s a call, a 20-minute run makes ~460–1,500 calls, so 24 hourly runs cover 11,000–36,000 lookups a day.

## Known limits
Only the latest attempt of a re-run is kept. Crons before the first `schedules/` snapshot are assumed equal to it.
