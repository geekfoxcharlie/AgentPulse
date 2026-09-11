# AgentPulse

AgentPulse is a dynamic API reference for local agents. It centrally records APIs that a person has already prepared, their capability groups, credential locations, calling instructions, and on-demand health snapshots. Locally installed command-line tools can be registered as `cli` capabilities with the same groups, usage notes, and passive health checks.

Agents query and configure AgentPulse through its CLI, then call third-party APIs or local commands directly, or open registered websites in the user's real browser. A local, read-only web page lets people review the same configuration and status.

## Project status

The 0.1 MVP is implemented. Register locally available API keys, tokens, and required account identifiers as environment variables to run real health checks. The built-in catalog includes Exa, Firecrawl Search, Tavily, X API Search Posts, Serper, Brave Search, GitHub Repository Search, skills.sh, DeepSeek (default `deepseek-flash`), OpenCode Go (default `deepseek-v4.1-flash`), Cloudflare GPT Image 2, the browser-harness CLI for driving the local Chrome profile, and research websites opened in that browser. See the [0.1 MVP Spec](.kiro/specs/0.1-mvp/requirements.md), the [Cloudflare image-generation spec](.kiro/specs/0.2-cloudflare-image-generation/requirements.md), the [CLI capabilities spec](.kiro/specs/0.3-cli-capabilities/requirements.md), the [GitHub repository-search spec](.kiro/specs/0.4-github-repository-search/requirements.md), and the [site capabilities spec](.kiro/specs/0.5-site-capabilities/requirements.md) for scope and local setup steps.

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

For GitHub repository search, make a `GITHUB_TOKEN` available to the current process, then register the template. Its health check uses GitHub's `/rate_limit` endpoint rather than consuming the stricter repository-search rate limit:

```bash
agentpulse api add --template github-repository-search --configured-at ~/.zshenv
agentpulse group search --health --json
agentpulse api github-repository-search --json
```

For skills.sh Agent Skills search, make a `VERCEL_OIDC_TOKEN` available to the current process, then register the template. The health probe runs a one-result search.

```bash
agentpulse api add --template skills-sh --configured-at ~/.zshenv
agentpulse group search --health --json
agentpulse api skills-sh --json
```

For DeepSeek chat completions, make a `DEEPSEEK_API_KEY` available to the current process, then register the template. The health probe lists models and does not generate text. The default model is `deepseek-flash` (DeepSeek-V4.1-Flash):

```bash
agentpulse api add --template deepseek --configured-at ~/.zshenv
agentpulse group llm --health --json
agentpulse api deepseek --json
```

For the OpenCode Go subscription, make an `OPENCODE_GO_API_KEY` available to the current process, then register the template. The Go key is the OpenAI-compatible gateway at `https://opencode.ai/zen/go/v1`; the default model is `deepseek-v4.1-flash` (DeepSeek V4.1 Flash). The health probe calls the non-generative `GET /usage` endpoint, which validates the key and the active Go subscription without generating text:

```bash
agentpulse api add --template opencode-go --configured-at ~/.zshenv
agentpulse group llm --health --json
agentpulse api opencode-go --json
```

OpenCode Go is intended for coding agents: send typical coding-agent traffic, identify your client with its own user agent, and send a stable `x-opencode-session` header per conversation. A valid key without a Go subscription fails the probe with `403`.

For Cloudflare GPT Image 2, make both `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` available to the current process, then register the template and inspect it like a search API:

```bash
agentpulse api add --template cloudflare-gpt-image-2 --configured-at ~/.zshenv
agentpulse group image-generation --health --json
agentpulse api cloudflare-gpt-image-2 --json
```

Cloudflare routes this third-party model through the account's default AI Gateway. The health check only lists the account's gateways: it never generates an image or incurs inference charges. It needs `AI Gateway > Read`; Cloudflare's setup guide recommends `AI Gateway > Read`, `AI Gateway > Edit`, and `Workers AI > Read` for the full integration, plus available credits for actual image requests.

For the local browser capability, no credential is needed:

```bash
agentpulse cli add --template browser-harness
agentpulse group browser --health --json
agentpulse cli browser-harness --json
```

The browser-harness health probe runs `browser-harness doctor --json`, a read-only check of the installed version, daemon liveness, and its CDP connection. It never launches a browser or repairs anything.

For research websites that are not APIs, no credential is needed. Open them with browser-harness in the user's real Chrome. Sites are not health-probed; if login is required and a sign-in wall appears, stop and ask the user to log in:

```bash
agentpulse site add --template perplexity
agentpulse group sites --json
agentpulse site perplexity --json
```

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
