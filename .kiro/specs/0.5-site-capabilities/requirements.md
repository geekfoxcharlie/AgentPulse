# AgentPulse 0.5 Site Capabilities Requirements

Spec version: 0.5
Status: Ready for implementation

## 1. Goal

Let AgentPulse register research and creator websites as first-class `site` capabilities alongside HTTP APIs and local CLIs. Agents open them with `browser-harness` in the user's real Chrome profile. Login is checked at task time; AgentPulse never probes a site or opens a browser for health.

The durable product requirements remain in [`docs/REQUIREMENTS.md`](../../../docs/REQUIREMENTS.md). This Spec owns only the 0.5 site-capability increment and its acceptance criteria.

## 2. Requirements

### Requirement 1: Site capability kind

AgentPulse MUST support a third capability kind, `site`, describing a website the agent opens in the user's real browser. A site capability MUST record:

- stable unique ID, name, description, and capability group;
- `url` and `docsUrl`;
- `login.required`, `login.check`, and optional `login.loginUrl`;
- `enabled` flag;
- `usage` notes and a copyable `browser-harness` example.

A site capability MUST NOT declare an HTTP `service`, `credential`, `environment`, or `probe` block. Site IDs MUST NOT collide with API or CLI IDs.

### Requirement 2: No site health probe

Group health checks MUST list enabled sites as `unknown` and disabled sites as `disabled`. They MUST NOT fetch the site URL, launch a browser, or inspect login state.

### Requirement 3: Built-in sites catalog

AgentPulse MUST provide a built-in `sites` group template and site templates for: Perplexity, Google Trends, Baidu Index, Google Scholar, Wayback Machine, Douyin Creator Center, and Xiaohongshu Creator Center.

Each template MUST tell the agent to use `browser-harness` against the real Chrome profile, and MUST say whether login is required. If login is required and a sign-in wall appears, the agent MUST stop and ask the user to log in.

### Requirement 4: Query and configuration surface

The CLI MUST expose, mirroring the CLI-capability surface:

- `agentpulse site add --template <id>` and `agentpulse site add|update --file <path>`;
- `agentpulse site enable|disable <id>`;
- `agentpulse site <id>` with human and JSON output;
- sites listed inside `agentpulse group <id>` output and counted as `siteCount`;
- `agentpulse templates` listing site templates separately from API and CLI templates.

Site instantiation MUST NOT require `--configured-at`. The read-only web page MUST render site capabilities with URL, login requirement, and usage, without a probe.

## 3. Non-goals

- Health-checking login state.
- Entering passwords or completing login on the user's behalf.
- Treating these websites as HTTP search APIs.
- Scheduling or keeping sessions alive.

## 4. Acceptance criteria

1. `agentpulse templates --group sites --json` exposes the seven site templates, including `perplexity` with `loginRequired: true` and `google-trends` with `loginRequired: false`.
2. `agentpulse site add --template perplexity` materializes the `sites` group and the site capability without any credential prompt.
3. `agentpulse group sites --health --json` returns the site as `unknown` and does not issue HTTP or CLI probes.
4. Automated tests cover schema validation, template materialization, duplicate-ID rejection, group health skip, CLI views, and the web dashboard render.
