# AgentPulse

AgentPulse is a dynamic API reference for local agents. It centrally records APIs that a person has already prepared, their capability groups, credential locations, calling instructions, and on-demand health snapshots.

Agents query and configure AgentPulse through its CLI, then call third-party APIs directly. A local, read-only web page lets people review the same configuration and status.

## Project status

The 0.1 MVP is implemented. Register locally available search API keys or tokens as environment variables to run real health checks. The built-in catalog currently includes Exa, Firecrawl Search, Tavily, X API Search Posts, Serper, and Brave Search. See the [0.1 MVP Spec](.kiro/specs/0.1-mvp/requirements.md) for the scope and remaining local setup steps.

## Quick start

Node.js 22+ is required.

```bash
npm install
npm run build
npm link

agentpulse templates --group search
agentpulse api add --template exa-search --configured-at ~/.config/agentpulse/secrets.zsh
agentpulse group search --health --json
agentpulse web
```

`npm link` exposes the current build as the local `agentpulse` command. A person or trusted agent writes the actual secret to its registered location; AgentPulse records only the variable name and location, never accepts or displays the secret value.

## Documentation

- [Product requirements](docs/REQUIREMENTS.md): product goals, enduring requirements, trust model, and non-goals.
- [System architecture](docs/ARCHITECTURE.md): system boundary, components, data ownership, and runtime flows.
- [Agent context prompt](guides/agent-context.md): the shortest discovery prompt to inject into local agents.
- [0.1 MVP Spec](.kiro/specs/0.1-mvp/requirements.md): current search catalog, design, and tasks.

The [system architecture](docs/ARCHITECTURE.md) defines the single-source-of-truth and update rules for documentation. The README is only the project entry point; it does not duplicate the full requirements or design.
