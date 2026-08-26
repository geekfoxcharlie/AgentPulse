# AgentPulse 0.2 Cloudflare Image Generation Requirements

Spec version: 0.2
Status: Ready for local configuration

## 1. Goal

Add a locally installable Cloudflare GPT Image 2 API to AgentPulse without making health checks generate images or consume inference credits. A separately authorized, one-time diagnostic may validate inference after configuration.

The durable product requirements remain in [`docs/REQUIREMENTS.md`](../../../docs/REQUIREMENTS.md). This Spec owns only the 0.2 Cloudflare image-generation increment and its acceptance criteria.

## 2. Requirements

### Requirement 1: Image-generation catalog entry

AgentPulse MUST provide the following built-in templates:

| Type | ID | Name |
| --- | --- | --- |
| Group | `image-generation` | Image Generation |
| API | `cloudflare-gpt-image-2` | Cloudflare GPT Image 2 |

The API usage example MUST call `POST /accounts/{account_id}/ai/run` with the model `openai/gpt-image-2`. It MUST not contain secret values.

### Requirement 2: Multiple local environment requirements

An API MUST retain its primary request credential and MAY declare any number of additional named environment requirements. Each additional requirement MUST include its environment-variable name, configuration location, and a human-readable purpose. `~/.zshenv` is the documented default location. The location is metadata only: AgentPulse MUST NOT source, read, or write it.

An additional requirement MAY also declare bearer, header, or query placement. In that case, AgentPulse MUST inject it with the primary credential when building the probe request, allowing APIs with two or more request tokens without a separate configuration model.

All declared values MUST be present before a health probe is sent. Their actual values MUST be available to request URL templates, but MUST NOT be written to API configuration, JSON output, the web page, health cache, or errors.

The Cloudflare template MUST declare:

- `CLOUDFLARE_API_TOKEN` as the bearer credential;
- `CLOUDFLARE_ACCOUNT_ID` as a URL-path requirement.

### Requirement 3: Non-generative health probe

The Cloudflare template health probe MUST call:

```text
GET /accounts/{account_id}/ai-gateway/gateways?per_page=1
```

It MUST assert a successful Cloudflare response (`success: true`) with a `result` field. It MUST NOT call `/ai/run`, select a model, create an image, or charge inference credits.

The usage notes MUST state the distinction:

- the probe validates account ID, token, and `AI Gateway > Read` access;
- actual image requests also require `Workers AI > Read` and available Cloudflare credits;
- a healthy probe is not proof that an image inference will succeed.

### Requirement 4: User-authorized live diagnostic

After the user exposes both environment variables to the process and expressly authorizes a billable inference, a temporary, untracked diagnostic MAY be created. It MUST send exactly one `POST /accounts/{account_id}/ai/run` request for `openai/gpt-image-2`, using `quality: low` and `size: 1024x1024`. It MUST validate Cloudflare's REST envelope (`success: true`), then `result.state: Completed` and the presence of `result.result.image`, without printing the image URL or saving the image.

The diagnostic MUST redact secrets from any failure and be deleted in the same task. It is separate from the normal health probe and MUST NOT become an automated test or a recurring health check. Until both the variables and explicit authorization are available, this requirement remains pending rather than being simulated with a real Cloudflare request.

### Requirement 5: Documentation and tests

README, long-lived requirements, architecture documentation, and agent guidance MUST describe the non-generative behavior consistently. Automated tests MUST cover:

- the `image-generation` group and template;
- both Cloudflare environment requirements;
- URL substitution and an API with more than one auxiliary environment requirement;
- the non-generative GET request and response assertions;
- credential and account-ID redaction.

## 3. Non-goals

- Proxying or storing Cloudflare credentials.
- Generating an image as a health check or automated test. A one-time, explicitly authorized manual diagnostic is the sole exception.
- Claiming that gateway-list access guarantees model entitlement, billing, or inference success.
- Selecting or creating a specific AI Gateway automatically.

## 4. Acceptance criteria

1. `agentpulse templates --group image-generation --json` exposes `cloudflare-gpt-image-2` and both required variable names.
2. Instantiating the template records references only and creates the `image-generation` user group.
3. A health check with either variable missing returns `misconfigured` without a network request.
4. A fully configured health check produces only the documented gateway-list GET request.
5. Automated tests pass without real Cloudflare credentials or image generation.
6. After user configuration and explicit authorization, the temporary live diagnostic issues one low-quality 1024x1024 inference, proves a completed result or returns a redacted actionable error, and is then deleted.
