# AgentPulse 0.4 GitHub Repository Search Requirements

Spec version: 0.4
Status: Implemented

## 1. Goal

Add GitHub's official repository search as an installable `search` API template without consuming GitHub's strict search quota during normal AgentPulse health checks.

The durable product requirements remain in [`docs/REQUIREMENTS.md`](../../../docs/REQUIREMENTS.md). This Spec owns only the GitHub repository-search increment and its acceptance criteria.

## 2. Requirements

### Requirement 1: Repository-search catalog entry

AgentPulse MUST provide an API template with ID `github-repository-search` in the existing `search` group. It MUST declare:

- service base URL `https://api.github.com` and GitHub's official repository-search documentation;
- `GITHUB_TOKEN` as its default environment credential, injected as a Bearer token;
- a usage example for `GET /search/repositories` that sends `Accept: application/vnd.github+json` and the declared GitHub API-version header.

The usage notes MUST describe URL-encoded `q` queries, repository qualifiers, the 1,000-result ceiling, `incomplete_results`, and GitHub's search-rate-limit and retry boundary. The template MUST not store a token value.

### Requirement 2: Passive health probe

The health probe MUST issue exactly this non-search request:

```text
GET https://api.github.com/rate_limit
Accept: application/vnd.github+json
Authorization: Bearer $GITHUB_TOKEN
X-GitHub-Api-Version: 2026-03-10
```

It MUST expect HTTP 200 and assert the response has `resources.search`. It MUST not call `/search/repositories`, consume GitHub's primary search quota, or claim that a healthy result proves a repository search is complete or relevant.

### Requirement 3: Offline verification

Automated tests MUST cover template discovery, the Bearer-authenticated rate-limit request shape, static request headers, response assertion, and a healthy response using a local fetch substitute. Tests MUST NOT send a real GitHub request or require a real token.

## 3. Non-goals

- GitHub Projects, code search, issue search, or GraphQL search.
- GitHub Enterprise Server base-URL support.
- Proxying GitHub requests, storing tokens, or routing other search providers.

## 4. Acceptance criteria

1. `agentpulse templates --group search --json` lists `github-repository-search` with `GITHUB_TOKEN` as its default credential.
2. Instantiating the template creates a normal user-level API configuration without exposing any secret.
3. A configured health check only requests `/rate_limit` and returns healthy for a response containing `resources.search`.
4. The full build, test suite, and configuration validation pass without live GitHub access.
