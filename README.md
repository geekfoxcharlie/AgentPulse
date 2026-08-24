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

## Install the agent context

After installing AgentPulse, generate a reusable context file for Codex or another local agent:

```bash
mkdir -p ~/.codex
agentpulse context > ~/.codex/AgentPulse.md
```

Reference the file from Codex Custom Instructions using its absolute path, for example:

```text
@/Users/your-name/.codex/AgentPulse.md
```

## Documentation

- [Product requirements](docs/REQUIREMENTS.md): product goals, enduring requirements, trust model, and non-goals.
- [System architecture](docs/ARCHITECTURE.md): system boundary, components, data ownership, and runtime flows.
- [Agent context](guides/agent-context.md): installable discovery instructions and usage examples for local agents.
- [0.1 MVP Spec](.kiro/specs/0.1-mvp/requirements.md): current search catalog, design, and tasks.

The [system architecture](docs/ARCHITECTURE.md) defines the single-source-of-truth and update rules for documentation. The README is only the project entry point; it does not duplicate the full requirements or design.
