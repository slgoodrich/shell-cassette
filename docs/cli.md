# shell-cassette CLI reference

The `shell-cassette` binary ships five subcommands as of v0.5:

| Subcommand   | Purpose                                                  | Read/Write          |
| ------------ | -------------------------------------------------------- | ------------------- |
| `scan`       | Verify cassettes have no unredacted credentials.         | Read-only           |
| `re-redact`  | Re-apply current redaction rules to existing cassettes.  | Writes (idempotent) |
| `show`       | Pretty-print a cassette for human inspection.            | Read-only           |
| `review`     | Walk un-redacted findings interactively.                 | Writes on confirm   |
| `prune`      | Remove recordings by 0-based index.                      | Writes              |

All subcommands share the same color and TTY conventions (TTY auto-detect, `NO_COLOR` env var honored, `--no-color` and `--color=always` overrides) and the same exit-code semantics: 0 on success, 2 on error. `scan` additionally returns 1 when at least one cassette is dirty; `re-redact` returns 1 when at least one cassette was modified.

`scan` and `re-redact` are documented in the [README](../README.md). The rest of this file covers `show`, `review`, and `prune`.

---

## `shell-cassette show <path>`

Pretty-print a cassette. Read-only.

### Synopsis

```
shell-cassette show <path> [--json] [--full] [--lines <N>] [--no-color] [--color=always] [--help]
```

### Description

Renders a cassette file in one of two formats:

- **Terminal mode (default).** Sectioned output: header (path + size), version line (recorder identity if present, fallback for v1 cassettes), redactions summary by rule, then per-recording listing with index, command, args, cwd, redacted env keys, exit code (green for 0, red otherwise), duration, and stdout/stderr/allLines with line-count truncation. Color highlights placeholders in cyan and emphasis in bold.
- **`--json` mode.** Structured payload locked at `showVersion: 1`.

### Flags

| Flag             | Default     | Description                                       |
| ---------------- | ----------- | ------------------------------------------------- |
| `--json`         | off         | Emit structured output.                           |
| `--full`         | off         | Disable line truncation.                          |
| `--lines <N>`    | 5           | Lines per stream in terminal mode.                |
| `--no-color`     | env-aware   | Force color off.                                  |
| `--color=always` | env-aware   | Force color on.                                   |
| `--help`         |             | Print usage.                                      |

### Exit codes

| Code | Meaning                                             |
| ---- | --------------------------------------------------- |
| 0    | Cassette displayed.                                 |
| 2    | Missing path, malformed cassette, conflicting flags. |

### `--json` output shape

Locked at `showVersion: 1`:

```json
{
  "showVersion": 1,
  "summary": {
    "path": "tests/__cassettes__/foo.json",
    "fileSize": 1234,
    "version": 2,
    "recordedBy": { "name": "shell-cassette", "version": "0.5.0" },
    "recordingCount": 3,
    "redactions": {
      "total": 4,
      "byRule": { "github-pat-classic": 2, "openai-api-key": 1, "aws-access-key-id": 1 },
      "bySource": { "env": 1, "args": 1, "stdout": 2 }
    }
  },
  "cassette": { "...": "full deserialized cassette JSON" }
}
```

`cassette` is the entire deserialized file. For very large cassettes, prefer the `summary` field for piping to `jq`.

### Examples

```bash
# Inspect a cassette
shell-cassette show tests/__cassettes__/login.json

# Just the summary
shell-cassette show tests/__cassettes__/login.json --json | jq '.summary'

# Full content, no truncation
shell-cassette show tests/__cassettes__/login.json --full
```

---

## `shell-cassette review <path>`

Walk un-redacted findings interactively. Writes on confirm.

### Synopsis

```
shell-cassette review <path> [--json] [--include-match] [--config <path>] [--no-color] [--color=always] [--help]
```

### Description

Pre-scans the cassette for un-redacted findings using the same regex rules as `scan`, plus the env-key-match path (env values whose key is in the curated list). Then walks each finding one at a time. For each finding the user picks an action:

| Key   | Action  | Description                                                                                                                                              |
| ----- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `(a)` | accept  | Apply default redaction. The match becomes `<redacted:source:rule:N>` (counter-tagged).                                                                  |
| `(s)` | skip    | Leave the match in body. Persists a `SuppressedEntry` so the match is not re-flagged on subsequent runs of `review` or `re-redact`.                     |
| `(r)` | replace | Substitute a user-provided string. Not available for `args` (canonicalize-incompatible). Recorded as `rule: 'custom'` in the redaction summary.          |
| `(d)` | delete  | Remove the entire recording from the cassette. Confirms before adding the decision.                                                                      |
| `(b)` | back    | Revisit the previous finding. Removes the prior decision (the user must re-decide). Unwinds multi-step jumps from `(d)elete`.                            |
| `(q)` | quit    | Discard all decisions and exit without writing.                                                                                                          |
| `(?)` | help    | Print key reference.                                                                                                                                     |

After all findings are walked, a summary screen lists decisions and asks `Apply changes? (y/N)`. `y` writes the cassette atomically; `n` discards.

### Flags

| Flag                | Default     | Description                                                                                                |
| ------------------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| `--json`            | off         | Read-only structured output. No prompts.                                                                   |
| `--include-match`   | off         | With `--json`, include raw match values. **UNSAFE for piping to logs / CI artifacts.**                     |
| `--config <path>`   |             | Override config discovery.                                                                                 |
| `--no-color`        | env-aware   |                                                                                                            |
| `--color=always`    | env-aware   |                                                                                                            |
| `--help`            |             |                                                                                                            |

### Exit codes

| Code | Meaning                                              |
| ---- | ---------------------------------------------------- |
| 0    | Reviewed (with or without changes).                  |
| 2    | Missing path, malformed cassette, conflicting flags. |

### `--json` output shape

Locked at `reviewVersion: 1`:

```json
{
  "reviewVersion": 1,
  "summary": {
    "totalFindings": 12,
    "byRule": { "github-pat-classic": 8, "openai-api-key": 4 },
    "bySource": { "args": 3, "stdout": 9 }
  },
  "findings": [
    {
      "id": "rec2-stdout-4:15-github-pat-classic",
      "recordingIndex": 2,
      "source": "stdout",
      "rule": "github-pat-classic",
      "matchHash": "sha256:abc123...",
      "matchLength": 40,
      "matchPreview": "ghp_...7890",
      "position": "4:15",
      "context": {
        "lineNumber": 4,
        "before": ["...line 2...", "...line 3..."],
        "line": "...line 4 with match...",
        "after": ["...line 5...", "...line 6..."]
      }
    }
  ]
}
```

With `--include-match`, each finding gains a `match` field with the raw matched string. Treat the resulting JSON as sensitive.

### Match preview format

- Length >= 12: first 4 + `...` + last 4 (e.g., `ghp_...7890`).
- Length < 12: full match.

### Finding ID format

`rec<recordingIndex>-<source>-<position>-<rule>`. Position varies by source:

- `<line>:<col>` for stdout, stderr, allLines.
- `<argIndex>:<col>` for args.
- `<KEY>:0` for env values (env-key-match findings) or `<KEY>:<col>` for env values matched by regex.

### Skip semantics

`(s)kip` writes a `SuppressedEntry` to the recording's `_suppressed` array on apply. Both `review`'s pre-scan and `re-redact` consult `_suppressed` and skip matches whose `matchHash` is present. Skip is per-cassette and persists across runs. Quitting before apply discards all decisions, so skip is recoverable until you confirm.

### Examples

```bash
# Walk findings interactively
shell-cassette review tests/__cassettes__/foo.json

# Inspect findings without prompting
shell-cassette review tests/__cassettes__/foo.json --json

# Get raw match values for offline review (do NOT pipe to logs)
shell-cassette review tests/__cassettes__/foo.json --json --include-match
```

---

## `shell-cassette prune <path>`

Remove recordings by 0-based index. Writes.

### Synopsis

```
shell-cassette prune <path> --delete <indexes>
shell-cassette prune <path> --json
shell-cassette prune <path> --help
```

### Description

Two modes (one is required when a path is provided):

- `--delete <indexes>` — comma-separated 0-based indexes. The named recordings are removed; the remaining recordings keep their relative order. Atomic write via the temp-file + rename pipeline.
- `--json` — structured listing of recordings (`pruneVersion: 1`). Read-only.

There is no interactive walk in v0.5. The typical workflow is `prune --json | jq` to choose indexes by command, args, or exit code, then `prune --delete <list>`.

### Flags

| Flag                  | Default   | Description                                          |
| --------------------- | --------- | ---------------------------------------------------- |
| `--delete <indexes>`  |           | Comma-separated 0-based indexes to remove.           |
| `--json`              | off       | Read-only structured listing.                        |
| `--quiet`             | off       | Suppress stdout summary on `--delete`.               |
| `--no-color`          | env-aware |                                                      |
| `--color=always`      | env-aware |                                                      |
| `--help`              |           |                                                      |

### Exit codes

| Code | Meaning                                                                                                  |
| ---- | -------------------------------------------------------------------------------------------------------- |
| 0    | Listed (`--json`) or deleted successfully.                                                               |
| 2    | Missing path, no mode flag, out-of-range index, duplicate index, empty `--delete=` list, malformed JSON. |

### `--json` output shape

Locked at `pruneVersion: 1`:

```json
{
  "pruneVersion": 1,
  "recordings": [
    {
      "index": 0,
      "command": "gh",
      "args": ["repo", "create", "..."],
      "exitCode": 0,
      "durationMs": 1234,
      "redactionCount": 1
    }
  ]
}
```

### Examples

```bash
# List all recordings
shell-cassette prune tests/__cassettes__/foo.json --json

# Pick non-zero-exit recordings via jq, then delete
shell-cassette prune tests/__cassettes__/foo.json --json \
  | jq -r '.recordings[] | select(.exitCode != 0) | .index' \
  | paste -sd ','
shell-cassette prune tests/__cassettes__/foo.json --delete 1,3,7

# Delete a single recording without the summary line
shell-cassette prune tests/__cassettes__/foo.json --delete 0 --quiet
```

When prune writes a cassette, it stamps `recordedBy` with the current shell-cassette identity so the file's recorder metadata reflects the most recent write (consistent with `re-redact` and `review`'s confirm-write).
