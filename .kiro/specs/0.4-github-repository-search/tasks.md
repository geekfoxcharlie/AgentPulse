# AgentPulse 0.4 GitHub Repository Search Tasks

Spec version: 0.4
Status: Implemented

## 1. Catalog and documentation

- [x] Add `github-repository-search` to the built-in `search` API templates.
- [x] Record `GITHUB_TOKEN`, Bearer placement, the official REST documentation, current API-version header, and a copyable repository-search example.
- [x] Document the provider's qualifier, partial-result, result-ceiling, and rate-limit boundaries in the template usage notes.
- [x] Update the long-lived requirements and README catalog and setup instructions.

## 2. Passive health check

- [x] Use `GET /rate_limit` rather than `GET /search/repositories` for health checks.
- [x] Require `resources.search` in the successful response.
- [x] Document that the result validates configuration and reachability, not search quality or completeness.

## 3. Automated verification

- [x] Cover the expanded search-template catalog and CLI discovery output.
- [x] Cover GitHub Bearer injection, required headers, rate-limit URL, and no request body.
- [x] Cover a healthy local `resources.search` response without a real GitHub request.
- [ ] Optionally perform a user-authorized live health check after a real `GITHUB_TOKEN` is configured.
