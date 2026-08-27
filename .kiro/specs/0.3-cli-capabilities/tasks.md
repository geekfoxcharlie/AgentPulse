# AgentPulse 0.3 CLI Capabilities Tasks

Spec version: 0.3
Status: Ready for implementation

## 1. Configuration model

- [x] Add `schemas/cli.schema.json` for `kind: cli` capabilities.
- [x] Extend types: `CliDefinition`, `CliTemplate`, `Registry.clis`, `ConfigPaths.clisDir`, CLI probe and error-category types.
- [x] `config.ts`: `validateCli`, `clis/` directory loading, `upsertCli`, `getCli`, `setCliEnabled`, and cross-kind duplicate-ID rejection.

## 2. Templates

- [x] Add the `browser` group template (order 30).
- [x] Add `templates/clis/browser-harness.yaml` with the passive `doctor --json` probe.
- [x] `templates.ts`: load `templates/clis/`, `validateCliTemplate`, `instantiateCliTemplate`.

## 3. Health

- [x] `health.ts`: `runCliCommand` spawn helper (no shell, timeout kill), `probeCli` status mapping, new error categories.
- [x] Group health probes both APIs and CLI capabilities; shared cache, TTL, and invalidation.
- [x] `spawnImpl` injection seam in `HealthOptions` for tests.

## 4. Query, CLI, and web

- [x] `query.ts`: `cliView`, `groupView.clis`, `groupsView.cliCount`.
- [x] `cli.ts`: `cli add/update/enable/disable/<id>` commands, `templates` listing, help text.
- [x] `web/server.ts`: render CLI capability cards and count them in the ledger.

## 5. Documentation

- [x] `docs/REQUIREMENTS.md`: add R1.3 CLI capability section.
- [x] `guides/agent-context.md`: `agentpulse cli` in the rule block and an example.
- [x] README: mention the browser group and `cli add` in the catalog paragraph.

## 6. Automated verification

- [x] Schema validation accepts/rejects the right shapes, including whitespace-commands and API-ID collisions.
- [x] Template catalog and materialization tests for `browser-harness`.
- [x] Probe status mapping tests via `spawnImpl`: healthy, command_missing, exit_code, timeout.
- [x] Cache invalidation on `upsertCli`; group view and web render include CLI entries.
- [x] Full `npm run typecheck` and `npm test` pass.

## 7. Registration

- [x] Build and run `agentpulse cli add --template browser-harness`.
- [x] `agentpulse group browser --health --json` reports `healthy` with the real install; probe stays passive.
