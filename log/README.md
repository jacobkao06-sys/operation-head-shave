# Audit log

Written by `.github/workflows/check.yml` on every scheduled run. SPEC.md §8.

- `state.json` — the full state snapshot as of the last run. Contains no
  secrets: the Instagram access token lives in KV and is never returned by
  `/api/check`.
- `events.ndjson` — append-only, one JSON object per line, oldest first. Every
  state transition, every email, every admin override with its actor and reason.

Git history is the tamper-evident part: each run is its own commit, timestamped
by GitHub. Do not rewrite this directory's history.

Uploaded photos are never committed here (SPEC.md §13).
