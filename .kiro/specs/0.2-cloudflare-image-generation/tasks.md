# AgentPulse 0.2 Cloudflare Image Generation Tasks

Spec version: 0.2
Status: Ready for local configuration

## 1. Catalog and configuration

- [x] Add the `image-generation` built-in group.
- [x] Add the `cloudflare-gpt-image-2` template and a direct image-generation usage example.
- [x] Add auxiliary environment requirements to the schema, configuration model, template materialization, CLI output, and read-only web view.
- [x] Ensure the schema accepts more than one auxiliary environment requirement.

## 2. Safe health check

- [x] Replace the image-producing `/ai/run` health probe with the AI Gateway list endpoint.
- [x] Assert `success: true` and `result` without sending a request body.
- [x] Document the different permission and verification boundaries for health checks and actual inference.
- [x] Redact every declared environment value from network errors.

## 3. Automated verification

- [x] Cover the Cloudflare template request shape with a local fetch substitute.
- [x] Cover missing variables, successful non-generative responses, and redaction.
- [x] Cover multiple auxiliary environment requirements and URL interpolation.
- [x] Run the full test suite and configuration validation.

## 4. User-authorized live diagnostic

- [x] Confirm `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are exposed to the AgentPulse process.
- [x] Create and run a temporary low-quality GPT Image 2 generation diagnostic after explicit user authorization.
- [x] Record the Cloudflare REST envelope shape, report a redacted result, and delete all temporary diagnostics in the same task.
