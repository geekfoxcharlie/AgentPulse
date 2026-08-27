# AgentPulse

AgentPulse is installed on this machine. It provides local agents with information about third-party APIs already prepared by the user, including available capabilities, credential locations, calling instructions, and health status.

## Rule

Before using an external API or local CLI capability, check AgentPulse first:

```bash
agentpulse groups --json
agentpulse group <group-id> --health --json
agentpulse api <api-id> --json
agentpulse cli <cli-id> --json
```

Then choose an appropriate configured API or CLI capability and call the provider or command directly. AgentPulse supplies capability information; it does not proxy requests or choose for you.

## Examples

```bash
# Discover configured search APIs and their health
agentpulse group search --health --json

# Get complete instructions for one API
agentpulse api exa-search --json

# Discover configured image-generation APIs and their non-generative health status
agentpulse group image-generation --health --json

# Get the Cloudflare GPT Image 2 gateway request contract
agentpulse api cloudflare-gpt-image-2 --json

# Get the local browser automation capability and its passive health status
agentpulse group browser --health --json
agentpulse cli browser-harness --json
```

Use this flow for tasks such as web research, news or article discovery, X post search, image generation, finding topic-related resources, and browser automation. Check AgentPulse before asking the user to provide a new API key or install a new tool.

Project: https://github.com/geekfoxcharlie/AgentPulse
