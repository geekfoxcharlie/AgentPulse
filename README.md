# AgentPulse

AgentPulse is a dynamic API reference for local agents. It centrally records APIs that a person has already prepared, their capability groups, credential locations, calling instructions, and on-demand health snapshots.

Agents query and configure AgentPulse through its CLI, then call third-party APIs directly. A local, read-only web page lets people review the same configuration and status.

## Project status

The 0.1 MVP is implemented. Register locally available API keys, tokens, and required account identifiers as environment variables to run real health checks. The built-in catalog includes Exa, Firecrawl Search, Tavily, X API Search Posts, Serper, Brave Search, and Cloudflare GPT Image 2. See the [0.1 MVP Spec](.kiro/specs/0.1-mvp/requirements.md) and the [Cloudflare image-generation spec](.kiro/specs/0.2-cloudflare-image-generation/requirements.md) for scope and local setup steps.

## Quick start

Node.js 22+ is required.

```bash
npm install
npm run build
npm link

agentpulse templates --group search
agentpulse api add --template exa-search --configured-at ~/.zshenv
agentpulse group search --health --json
agentpulse web
```

Before registering a template, find where the current system setup provides its environment variables and pass that location as metadata. AgentPulse never sources, reads, or writes that location; the variables must already be available to the CLI process.

For Cloudflare GPT Image 2, make both `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` available to the current process, then register the template and inspect it like a search API:

```bash
agentpulse api add --template cloudflare-gpt-image-2 --configured-at ~/.zshenv
agentpulse group image-generation --health --json
agentpulse api cloudflare-gpt-image-2 --json
```

Cloudflare routes this third-party model through the account's default AI Gateway. The health check only lists the account's gateways: it never generates an image or incurs inference charges. It needs `AI Gateway > Read`; Cloudflare's setup guide recommends `AI Gateway > Read`, `AI Gateway > Edit`, and `Workers AI > Read` for the full integration, plus available credits for actual image requests.

`npm link` exposes the current build as the local `agentpulse` command. A person or trusted agent configures the system environment; AgentPulse records only the variable name and configuration location, never accepts, reads, writes, or displays the secret value.

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
