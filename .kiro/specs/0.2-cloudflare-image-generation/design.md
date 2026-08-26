# AgentPulse 0.2 Cloudflare Image Generation Design

Spec version: 0.2
Status: Ready for local configuration

## 1. Configuration model

Existing APIs keep the single `credential` object because it describes the request authentication injection. `environment` is an optional array for additional values required to construct or validate an endpoint.

```yaml
credential:
  type: environment
  name: CLOUDFLARE_API_TOKEN
  configuredAt: ~/.zshenv
  placement:
    type: bearer
environment:
  - name: CLOUDFLARE_ACCOUNT_ID
    configuredAt: ~/.zshenv
    description: Cloudflare account ID used in the AI Gateway request path.
```

This keeps the common one-token templates unchanged while allowing two or more named local values. `configuredAt` records where the system setup provides those values; AgentPulse never sources or writes that location. URL placeholders use `{{ENVIRONMENT_VARIABLE}}`; only declared requirements may be referenced.

An auxiliary requirement may additionally include `placement`. The common probe builder then injects its environment value as a bearer token, named header, or query parameter. The Cloudflare account ID has no placement because it is a path value.

## 2. Request and health design

The regular AgentPulse usage example remains the inference contract:

```text
POST /accounts/{account_id}/ai/run
model: openai/gpt-image-2
```

The health contract is deliberately separate:

```text
GET /accounts/{account_id}/ai-gateway/gateways?per_page=1
Authorization: Bearer $CLOUDFLARE_API_TOKEN
```

The generic probe executor expands the account-ID placeholder, injects the bearer token, and asserts Cloudflare's `{ success: true, result: [...] }` response. It neither sends a request body nor invokes a model.

## 3. Security and error handling

- All declared variables are checked before the network request.
- Health cache records only whether required variables were present, never their values.
- Network-error sanitization redacts the bearer token and every declared environment value.
- CLI and web query views show variable names and locations only.

## 4. User-authorized runtime diagnostic

The regular health command always calls only the gateway-list endpoint. Once `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` are available and the user explicitly authorizes an inference, create a temporary diagnostic under the system temporary directory. It makes exactly one low-quality, 1024x1024 `openai/gpt-image-2` request using the documented `/ai/run` envelope.

The diagnostic reads the model outcome from Cloudflare's outer REST envelope: `success`, `result.state`, and `result.result.image`. It reports only a redacted status, completion state, and whether an image URL was returned; it neither prints the URL nor downloads the image. Remove the script immediately after execution. This is a manual end-to-end check, never a health probe or automated test.
