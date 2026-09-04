# AgentPulse 0.4 GitHub Repository Search Design

Spec version: 0.4
Status: Implemented

## 1. Template contract

The implementation is data-only: AgentPulse's existing HTTP API-template schema already represents the GitHub contract.

```yaml
credential:
  type: environment
  defaultName: GITHUB_TOKEN
  placement:
    type: bearer
probe:
  method: GET
  url: https://api.github.com/rate_limit
  headers:
    Accept: application/vnd.github+json
    X-GitHub-Api-Version: 2026-03-10
  assertions:
    - path: resources.search
      exists: true
```

The regular usage contract remains `GET /search/repositories`, with the caller supplying an encoded `q` query and optional sorting and pagination parameters. The health probe deliberately differs from the regular usage contract.

## 2. Health and safety boundary

GitHub search has a dedicated per-minute limit. `GET /rate_limit` verifies token injection, API reachability, API-version compatibility, and the availability of GitHub's search rate-limit resource without running a search. GitHub documents that this endpoint does not count against the primary rate limit, though it can count against secondary limits; AgentPulse's existing one-hour cache limits its normal frequency.

The probe response only demonstrates that the configured token can call `/rate_limit`. It does not prove a given query is valid, the caller can see a particular private repository, or the search results will be complete.

## 3. Compatibility and verification

No schema, CLI, web, or request-engine change is required. The template loader already exposes API-template metadata to the CLI and web view, and the generic health runner already injects Bearer credentials, static headers, and checks nested JSON assertion paths.

Tests use a local fetch substitute to assert the exact URL, headers, absence of a request body, and a representative `resources.search` response. This protects the contract without recording secrets or making a network request.
