# AgentPulse

AgentPulse is installed on this machine. It provides local agents with information about third-party APIs already prepared by the user, including available capabilities, credential locations, calling instructions, and health status. It also lists research websites that are opened in the user's real browser.

## Rule

Before using an external API, local CLI, or research website, check AgentPulse first:

```bash
agentpulse status --json
agentpulse groups --json
agentpulse group <group-id> --health --json
agentpulse api <api-id> --json
agentpulse cli <cli-id> --json
agentpulse site <site-id> --json
```

Then choose an appropriate configured API, CLI, or site and call the provider, command, or browser directly. AgentPulse supplies capability information; it does not proxy requests or choose for you.

## Examples

```bash
# Discover configured search APIs and their health
agentpulse group search --health --json

# Get complete instructions for one API
agentpulse api exa-search --json

# Discover configured LLM APIs and their non-generative health status
agentpulse group llm --health --json
agentpulse api deepseek --json
agentpulse api opencode-go --json

# Discover configured image-generation APIs and their non-generative health status
agentpulse group image-generation --health --json

# Get the Cloudflare GPT Image 2 gateway request contract
agentpulse api cloudflare-gpt-image-2 --json

# Get the local browser automation capability and its passive health status
agentpulse group browser --health --json
agentpulse cli browser-harness --json

# Discover research websites opened in the user's real Chrome
agentpulse group sites --json
agentpulse site perplexity --json
```

Use this flow for tasks such as web research, news or article discovery, X post search, chat completions, image generation, finding topic-related resources, browser automation, and querying login-walled research websites. Open sites with browser-harness against the user's real Chrome profile. If a site requires login and a sign-in wall appears, stop and ask the user to log in; do not enter a password. Sites are not health-probed. Check AgentPulse before asking the user to provide a new API key or install a new tool.

Project: https://github.com/geekfoxcharlie/AgentPulse
