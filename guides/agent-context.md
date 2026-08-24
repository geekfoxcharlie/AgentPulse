# AgentPulse

AgentPulse is installed on this machine. It provides local agents with information about third-party APIs already prepared by the user, including available capabilities, credential locations, calling instructions, and health status.

## Rule

Before using an external API, check AgentPulse first:

```bash
agentpulse groups --json
agentpulse group <group-id> --health --json
agentpulse api <api-id> --json
```

Then choose an appropriate configured API and call that provider directly. AgentPulse supplies API information; it does not proxy the request or choose the API for you.

## Examples

```bash
# Discover configured search APIs and their health
agentpulse group search --health --json

# Get complete instructions for one API
agentpulse api exa-search --json
```

Use this flow for tasks such as web research, news or article discovery, X post search, and finding topic-related resources. Check AgentPulse before asking the user to provide a new API key.

Project: https://github.com/geekfoxcharlie/AgentPulse
