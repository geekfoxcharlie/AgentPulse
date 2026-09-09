# AgentPulse 0.5 Site Capabilities Design

## Data

User config lives at `~/.config/agentpulse/sites/<id>.yaml`. Schema: `schemas/site.schema.json`. Built-in templates live in `templates/sites/` with `kind: site-template`; instantiation copies them as `kind: site` and materializes the `sites` group if missing.

Sites share the capability ID namespace with APIs and CLIs. They have no probe fingerprint and are never written to the health cache. `getCachedHealthSnapshots` and `checkGroupHealth` include them only as `unknown` or `disabled`.

## Query

- `agentpulse site <id>` returns identity, URL, login block, usage, and a synthetic health snapshot.
- `agentpulse group sites` lists sites with login required/not required rather than a probe status.
- `groups` includes `siteCount`. Health totals still count only APIs and CLIs, plus disabled sites.

## Execution

Agents read `usage.example` and run `browser-harness` themselves. AgentPulse stays off the request path.
