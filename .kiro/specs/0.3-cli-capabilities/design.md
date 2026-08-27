# AgentPulse 0.3 CLI Capabilities Design

Spec version: 0.3
Status: Ready for implementation

## 1. Configuration model

CLI capabilities live in their own registry section, config directory, schema, and template directory, mirroring the API split:

| Concern | HTTP API | CLI capability |
| --- | --- | --- |
| Config kind | `api` | `cli` |
| Template kind | `api-template` in `templates/apis/` | `cli-template` in `templates/clis/` |
| Config directory | `config/apis/<id>.yaml` | `config/clis/<id>.yaml` |
| JSON schema | `api.schema.json` | `cli.schema.json` |
| Provenance | `credential.configuredAt` | `install.method` + `install.command` |
| Health probe | HTTP request | child process exit code |

Configured shape:

```yaml
schemaVersion: 1
kind: cli
id: browser-harness
name: Browser Harness
group: browser
description: Drive the user's real Chrome profile through an editable CDP harness CLI.
enabled: true
command: browser-harness
docsUrl: https://github.com/browser-use/browser-harness
install:
  method: uv-tool
  command: uv tool install --python 3.12 --upgrade --force browser-harness
probe:
  type: cli
  args: ["doctor", "--json"]
  expectedExit: 0
  timeoutMs: 15000
usage:
  notes: ...
  example: |
    browser-harness <<'PY'
    print(page_info())
    PY
```

`command` allows no whitespace; it resolves through `PATH` at probe time. The schema drops `service`, `credential`, and `environment` entirely instead of making them nullable, so an HTTP-shaped mistake fails validation loudly.

The registry gains `clis: CliDefinition[]`. `validateRegistryData` additionally rejects IDs that appear in both `apis` and `clis`; both kinds share the health-cache entry namespace and group membership.

## 2. Template flow

`loadTemplateCatalog` also reads `templates/clis/`, dispatching on `kind: cli-template`. `validateCliTemplate` materializes the entry as `kind: cli` and validates it against the same rules as a configured capability — the strategy already used for API templates.

`instantiateCliTemplate(paths, templateId)` materializes the template's group on first use (same upsert-group flow as APIs) and writes the capability. There is no `--configured-at` and no `--credential-env`; a local tool's provenance is its install command, which the template already records.

## 3. Health design

`runGroupHealth` now probes `registry.apis` and `registry.clis` of the group in parallel. CLI probes reuse the same health-cache entries, TTL, and in-flight deduplication.

`runCliCommand(command, args, timeoutMs)` spawns the command without a shell, captures combined stdout/stderr, kills the process on timeout, and returns `{ code, timedOut, spawnError }`. `probeCli` maps that to a `HealthEntry`:

| Outcome | Status | Error category |
| --- | --- | --- |
| `code === expectedExit` | `healthy` | — |
| spawn `ENOENT` | `misconfigured` | `command_missing` |
| `timedOut` | `unhealthy` | `timeout` |
| other `code` | `unhealthy` | `exit_code`, message carries exit code plus a 240-character output tail |
| other spawn failure | `unhealthy` | `execution` |

The `HealthError.category` union gains `command_missing`, `exit_code`, and `execution`. `credentialPresent` stays `true` for CLI entries — no credential exists to be missing. Fingerprints hash `enabled`, `command`, and `probe`, so editing any of them invalidates the cache exactly like an API edit.

Tests inject `spawnImpl` through `HealthOptions`, the same seam `fetchImpl` uses for HTTP probes, so no test depends on a real browser-harness install.

## 4. Query, CLI, and web surface

- `cliView` parallels `apiView`: identity, `command`, `install`, probe summary, `usage`, `health` — no credential or environment fields.
- `groupView` returns `{ group, apis, clis }`; `groupsView` counts add `cliCount`; group health maps cover both kinds keyed by ID.
- `agentpulse cli add|update|enable|disable|<id>` mirrors the `api` subcommands. `templates` JSON gains a `cliTemplates` array; the human listing marks entries with their kind.
- The web dashboard renders CLI capabilities as cards without credential rows, showing command, install provenance, and probe; the ledger counts both kinds. Browsing still never triggers probes.

## 5. Documentation alignment

`docs/REQUIREMENTS.md` gains an R1.3 section for CLI capabilities (single source of truth); this spec owns the increment. `guides/agent-context.md` adds `agentpulse cli <id>` to the rule block and one browser example. README's catalog paragraph mentions the browser group.
