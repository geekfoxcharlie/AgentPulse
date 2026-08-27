# AgentPulse 0.3 CLI Capabilities Requirements

Spec version: 0.3
Status: Ready for implementation

## 1. Goal

Let AgentPulse register locally installed command-line tools as first-class capabilities alongside HTTP APIs, and ship a built-in `browser-harness` CLI template whose health probe is passive: it reports readiness without launching a browser, opening a tab, or touching the user's session.

The durable product requirements remain in [`docs/REQUIREMENTS.md`](../../../docs/REQUIREMENTS.md). This Spec owns only the 0.3 CLI-capability increment and its acceptance criteria.

## 2. Requirements

### Requirement 1: CLI capability kind

AgentPulse MUST support a second capability kind, `cli`, describing a command-line tool installed on this machine instead of an HTTP endpoint. A CLI capability MUST record:

- stable unique ID, name, description, and capability group;
- `command` — the executable the agent invokes (resolved via `PATH`, or an absolute path), containing no whitespace;
- `docsUrl` — official documentation;
- `install` — the install `method` and the exact install `command` used on this machine, as provenance metadata;
- `enabled` flag;
- `usage` notes and a copyable example;
- a minimal health check definition.

A CLI capability MUST NOT declare an HTTP `service`, `credential`, or `environment` block. CLI capability IDs MUST NOT collide with API IDs, because both share one health-cache namespace.

### Requirement 2: CLI health probe

A CLI health probe MUST run `command` with the declared `args` under the declared `timeoutMs` and compare the process exit code against `expectedExit`. Status mapping:

- exit code matches — `healthy`;
- executable not found (`ENOENT`) — `misconfigured` with a `command_missing` error;
- probe times out — `unhealthy` with a `timeout` error;
- any other exit code — `unhealthy` with an `exit_code` error and a bounded, sanitized tail of the command's output;
- any other spawn failure — `unhealthy` with an `execution` error.

The probe MUST NOT run through a shell, so arguments are never re-interpreted. Health results follow the existing group cache: one-hour TTL, invalidation on configuration change.

The built-in `browser-harness` probe MUST invoke `doctor --json`, which is read-only: it checks the installed version, daemon liveness, and the daemon's live CDP connection, and never starts a daemon, launches a browser, or auto-heals anything.

### Requirement 3: Built-in browser catalog entry

AgentPulse MUST provide the following built-in templates:

| Type | ID | Name |
| --- | --- | --- |
| Group | `browser` | Browser |
| CLI | `browser-harness` | Browser Harness |

The `browser-harness` template MUST document the heredoc invocation pattern with pre-imported Python helpers, MUST state when to prefer it over plain HTTP fetch, and MUST state that the probe is passive.

### Requirement 4: Query and configuration surface

The CLI MUST expose, mirroring the API surface:

- `agentpulse cli add --template <id>` and `agentpulse cli add|update --file <path>`;
- `agentpulse cli enable|disable <id>`;
- `agentpulse cli <id>` with human and JSON output;
- CLI capabilities listed inside `agentpulse group <id>` output and counted in group health;
- `agentpulse templates` listing CLI templates separately from HTTP API templates.

CLI instantiation MUST NOT require `--configured-at`, because a local tool has no credential location to record. The read-only web page MUST render CLI capabilities with their command, install provenance, probe, and health, without credential rows.

## 3. Non-goals

- Registering credentials or environment requirements for CLI capabilities.
- Executing capability business commands on behalf of agents; AgentPulse remains a field manual, not a proxy.
- Probes that repair, install, upgrade, or otherwise mutate the machine.
- Windows-specific shell quoting rules; probes spawn without a shell.

## 4. Acceptance criteria

1. `agentpulse templates --group browser --json` exposes the `browser-harness` CLI template with its probe arguments `["doctor", "--json"]`.
2. `agentpulse cli add --template browser-harness` materializes the `browser` group and the CLI capability without any credential prompt.
3. A group health check with the executable missing returns `misconfigured` / `command_missing` without spawning a shell.
4. A health check against the real install reports `healthy` while `browser-harness doctor --json` exits 0, and the probe process exits within the configured timeout; no browser or daemon is started by the probe itself.
5. Nonzero exits map to `unhealthy` / `exit_code` with a bounded output tail; timeouts map to `unhealthy` / `timeout`.
6. Automated tests cover schema validation, template materialization, all probe status mappings, cache invalidation, duplicate-ID rejection, CLI views, and the web dashboard render — without requiring browser-harness to be installed.
