import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { loadRegistry } from "../lib/config.js";
import { asAppError } from "../lib/errors.js";
import { getCachedHealthSnapshots } from "../lib/health.js";
import { groupView, groupsView } from "../lib/query.js";
import type { ConfigPaths } from "../lib/types.js";

export async function startWebServer(paths: ConfigPaths, requestedPort = 4123): Promise<{ server: Server; url: string }> {
  const server = createServer(async (request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    if (new URL(request.url ?? "/", "http://127.0.0.1").pathname !== "/") {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
      return;
    }

    try {
      const registry = await loadRegistry(paths);
      const snapshots = await getCachedHealthSnapshots(registry, paths);
      const [groups, details] = await Promise.all([
        groupsView(registry, paths),
        Promise.all(registry.groups.map((group) => groupView(registry, group.id, paths, snapshots)))
      ]);
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      if (request.method === "GET") response.end(renderDashboard(groups, details, paths));
      else response.end();
    } catch (error: unknown) {
      const appError = asAppError(error);
      response.writeHead(500, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      if (request.method === "GET") response.end(renderFailure(appError.message, paths));
      else response.end();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${address.port}` };
}

function renderDashboard(
  groups: Awaited<ReturnType<typeof groupsView>>,
  details: Awaited<ReturnType<typeof groupView>>[],
  paths: ConfigPaths
): string {
  const totalApis = details.reduce((sum, group) => sum + group.apis.length, 0);
  const activeApis = details.flatMap((group) => group.apis).filter((api) => api.enabled).length;
  const lastCheck = details
    .flatMap((group) => group.apis)
    .map((api) => api.health.checkedAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);

  return page(
    "AgentPulse · Local API Index",
    `<main class="shell">
      <header class="masthead">
        <div class="wordmark">AGENTPULSE <span>// local reference</span></div>
        <div class="masthead-copy">
          <p class="eyebrow">Local API field manual</p>
          <h1>Configured capabilities,<br><em>without relying on memory.</em></h1>
          <p class="lede">This is a read-only index. Agents query it through the CLI and call third-party APIs directly; this page only shows the current configuration and existing health snapshots.</p>
        </div>
        <div class="pulse-rail" aria-label="AgentPulse signal rail"><i></i><i></i><i></i><i></i></div>
      </header>

      <section class="ledger" aria-label="API summary">
        <div><span>Groups</span><strong>${groups.length}</strong></div>
        <div><span>Registered APIs</span><strong>${totalApis}</strong></div>
        <div><span>Enabled</span><strong>${activeApis}</strong></div>
        <div><span>Last check</span><strong class="date">${lastCheck ? escapeHtml(formatDate(lastCheck)) : "Not checked yet"}</strong></div>
      </section>

      ${details.length === 0 ? renderEmptyState(paths) : details.map((detail) => renderGroup(detail)).join("\n")}

      <footer>Configuration root: <code>${escapeHtml(paths.configDir)}</code><span>Health status is refreshed on demand by the CLI; reloading this page never sends third-party API requests.</span></footer>
    </main>`
  );
}

function renderGroup(detail: Awaited<ReturnType<typeof groupView>>): string {
  return `<section class="group-block" id="${escapeHtml(detail.group.id)}">
    <div class="group-heading">
      <div>
        <p class="eyebrow">GROUP / ${escapeHtml(detail.group.id)}</p>
        <h2>${escapeHtml(detail.group.name)}</h2>
      </div>
      <p>${escapeHtml(detail.group.description)}</p>
    </div>
    <div class="api-stack">
      ${detail.apis.length === 0 ? "<p class=\"no-api\">No API is configured in this group yet.</p>" : detail.apis.map(renderApi).join("\n")}
    </div>
  </section>`;
}

function renderApi(api: Awaited<ReturnType<typeof groupView>>["apis"][number]): string {
  const health = api.health;
  const placement = api.credential.placement.type === "bearer"
    ? "Bearer header"
    : `${api.credential.placement.type} · ${api.credential.placement.name}`;
  const healthMeta = health.checkedAt
    ? `Checked ${formatDate(health.checkedAt)} · ${health.isExpired ? "Cache expired" : `Valid until ${formatDate(health.expiresAt ?? health.checkedAt)}`}`
    : health.status === "disabled" ? "Manually disabled; not checked" : "No health snapshot yet";
  const configState = api.credential.availableToProcess ? "Available to the current CLI process" : "Not available to the current CLI process";

  return `<article class="api-card">
    <div class="api-main">
      <div class="api-title"><span class="status ${health.status}">${healthLabel(health.status)}</span><h3>${escapeHtml(api.name)}</h3></div>
      <p>${escapeHtml(api.description)}</p>
      <div class="api-meta"><code>${escapeHtml(api.id)}</code><span>${escapeHtml(api.probe.method)} ${escapeHtml(new URL(api.probe.url).host)}</span>${health.latencyMs !== undefined ? `<span>${health.latencyMs} ms</span>` : ""}</div>
    </div>
    <div class="health-note ${health.isExpired ? "stale" : ""}">
      <span>${escapeHtml(healthMeta)}</span>
      ${health.error ? `<small>${escapeHtml(health.error.message)}</small>` : ""}
    </div>
    <details>
      <summary>View usage and credential reference</summary>
      <div class="details-grid">
        <dl>
          <div><dt>Environment variable</dt><dd><code>${escapeHtml(api.credential.name)}</code></dd></div>
          <div><dt>Configured at</dt><dd><code>${escapeHtml(api.credential.configuredAt)}</code></dd></div>
          <div><dt>Authentication</dt><dd>${escapeHtml(placement)}</dd></div>
          <div><dt>Current process</dt><dd>${escapeHtml(configState)}</dd></div>
          <div><dt>Probe endpoint</dt><dd><code>${escapeHtml(api.probe.url)}</code></dd></div>
        </dl>
        <div class="usage"><p>${escapeHtml(api.usage.notes)}</p><pre><code>${escapeHtml(api.usage.example)}</code></pre><a href="${escapeHtml(api.service.docsUrl)}" rel="noreferrer" target="_blank">Official documentation ↗</a></div>
      </div>
    </details>
  </article>`;
}

function renderEmptyState(paths: ConfigPaths): string {
  return `<section class="empty-state">
    <p class="eyebrow">No APIs registered</p>
    <h2>Add a search tool to the index first.</h2>
    <p>Built-in templates are available for Exa, Firecrawl Search, Tavily, X API Search Posts, Serper, and Brave Search. They appear here after the CLI instantiates them.</p>
    <pre><code>agentpulse templates --group search
agentpulse api add --template brave-search --configured-at ~/.config/agentpulse/secrets.zsh</code></pre>
    <small>Current configuration directory: <code>${escapeHtml(paths.configDir)}</code></small>
  </section>`;
}

function renderFailure(message: string, paths: ConfigPaths): string {
  return page(
    "AgentPulse · Configuration needs attention",
    `<main class="shell failure"><header class="masthead"><div class="wordmark">AGENTPULSE <span>// local reference</span></div></header><section class="empty-state"><p class="eyebrow">Configuration unavailable</p><h1>Repair this local reference first.</h1><p>${escapeHtml(message)}</p><pre><code>agentpulse validate --json</code></pre><small>Configuration root: <code>${escapeHtml(paths.configDir)}</code></small></section></main>`
  );
}

function page(title: string, content: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>${escapeHtml(title)}</title><style>${styles}</style></head><body>${content}</body></html>`;
}

function healthLabel(status: string): string {
  return { healthy: "Healthy", unhealthy: "Unhealthy", misconfigured: "Needs configuration", disabled: "Disabled", unknown: "Not checked" }[status] ?? status;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

const styles = `
  :root { --ink:#142C3F; --harbour:#24617F; --sky:#CBE9EE; --paper:#F2F7F5; --signal:#ED7556; --moss:#2E7B65; --muted:#627782; --line:#B6D2D4; --mono:"SFMono-Regular",Consolas,"Liberation Mono",monospace; }
  * { box-sizing:border-box; } body { margin:0; color:var(--ink); background:radial-gradient(circle at 82% 4%, #d3eef0 0 13%, transparent 33%), linear-gradient(125deg,#eef7f4,#dceef0); font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif; }
  body::before { content:""; position:fixed; inset:0; pointer-events:none; opacity:.33; background-image:linear-gradient(90deg,transparent 49.85%,rgba(20,44,63,.08) 50%,transparent 50.15%),linear-gradient(0deg,transparent 49.85%,rgba(20,44,63,.055) 50%,transparent 50.15%); background-size:32px 32px; }
  .shell { position:relative; max-width:1120px; margin:0 auto; padding:34px 28px 56px; } .masthead { display:grid; grid-template-columns:1fr 1.8fr auto; gap:30px; align-items:end; padding:16px 0 37px; border-bottom:1px solid var(--ink); }
  .wordmark { align-self:start; font:700 13px/1 var(--mono); letter-spacing:.1em; color:var(--harbour); } .wordmark span { color:var(--muted); font-weight:500; letter-spacing:0; }
  .eyebrow { margin:0 0 10px; color:var(--harbour); font:700 11px/1.2 var(--mono); letter-spacing:.12em; text-transform:uppercase; } h1,h2,h3,p { margin-top:0; } h1,h2 { font-family:Iowan Old Style,"Songti SC","Noto Serif CJK SC",serif; font-weight:500; letter-spacing:-.045em; } h1 { max-width:660px; margin-bottom:17px; font-size:clamp(42px,6vw,76px); line-height:.95; } h1 em { color:var(--harbour); font-style:italic; } .lede { max-width:620px; margin-bottom:0; color:#49616D; line-height:1.65; font-size:15px; }
  .pulse-rail { width:88px; height:130px; display:flex; flex-direction:column; justify-content:space-between; padding:4px 0; background:linear-gradient(var(--ink),var(--ink)) 24px 0/1px 100% no-repeat; } .pulse-rail i { display:block; width:50px; height:11px; border-radius:999px; background:var(--harbour); box-shadow:0 0 0 5px rgba(36,97,127,.12); } .pulse-rail i:nth-child(2) { width:75px; background:var(--signal); margin-left:14px; } .pulse-rail i:nth-child(3) { width:32px; background:var(--moss); } .pulse-rail i:nth-child(4) { width:61px; margin-left:9px; background:var(--ink); }
  .ledger { display:grid; grid-template-columns:repeat(4,1fr); border-bottom:1px solid var(--line); } .ledger div { min-height:112px; padding:22px 20px 18px 0; border-right:1px solid var(--line); } .ledger div + div { padding-left:20px; } .ledger div:last-child { border-right:0; } .ledger span { display:block; margin-bottom:10px; color:var(--muted); font:11px/1 var(--mono); } .ledger strong { font:500 35px/.9 Iowan Old Style,"Songti SC",serif; } .ledger strong.date { font:600 15px/1.25 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif; letter-spacing:-.02em; }
  .group-block { padding:39px 0 0; } .group-heading { display:flex; justify-content:space-between; align-items:end; padding-bottom:16px; border-bottom:1px solid var(--ink); gap:30px; } .group-heading h2 { margin:0; font-size:38px; } .group-heading > p { max-width:430px; margin:0; color:var(--muted); font-size:14px; line-height:1.5; text-align:right; }
  .api-stack { display:grid; } .api-card { display:grid; grid-template-columns:minmax(0,1fr) 245px; padding:25px 0 0; border-bottom:1px solid var(--line); } .api-main { padding:0 28px 24px 0; } .api-title { display:flex; gap:12px; align-items:center; } .api-title h3 { margin:0; font-size:20px; letter-spacing:-.025em; } .api-main > p { margin:12px 0; color:#4A616C; line-height:1.5; font-size:14px; } .api-meta { display:flex; flex-wrap:wrap; gap:8px 16px; color:var(--muted); font:11px/1.25 var(--mono); } code { font-family:var(--mono); } .status { display:inline-block; min-width:53px; padding:5px 7px; border:1px solid currentColor; color:var(--muted); font:700 10px/1 var(--mono); text-align:center; } .status.healthy { color:var(--moss); background:#e7f4ed; } .status.unhealthy { color:#a33931; background:#fbe9e7; } .status.misconfigured { color:#946000; background:#fff2cf; } .status.disabled { color:#718089; } .status.unknown { color:var(--harbour); background:#e2f0f1; }
  .health-note { border-left:1px solid var(--line); padding:1px 0 18px 20px; color:var(--muted); font-size:12px; line-height:1.45; } .health-note.stale { color:#9A5D12; } .health-note small { display:block; margin-top:7px; color:#A34339; line-height:1.4; } details { grid-column:1/-1; border-top:1px dashed var(--line); } summary { padding:13px 0; cursor:pointer; color:var(--harbour); font:700 12px/1 var(--mono); } summary:focus-visible { outline:2px solid var(--signal); outline-offset:4px; } .details-grid { display:grid; grid-template-columns:minmax(250px,.9fr) minmax(0,1.55fr); gap:28px; padding:4px 0 25px; } dl { margin:0; } dl div { padding:8px 0; border-bottom:1px solid #d3e3e2; } dt { color:var(--muted); font-size:11px; } dd { margin:3px 0 0; font-size:12px; overflow-wrap:anywhere; } .usage p { color:#4A616C; font-size:13px; line-height:1.5; } pre { overflow:auto; margin:10px 0 12px; padding:13px; background:#102A3A; color:#DDEFF1; font:11px/1.5 var(--mono); } .usage a { color:var(--harbour); font-size:13px; font-weight:700; }
  .empty-state { margin-top:39px; max-width:730px; padding:36px; background:rgba(255,255,255,.54); border:1px solid var(--ink); box-shadow:12px 12px 0 rgba(36,97,127,.14); } .empty-state h2 { margin-bottom:12px; font-size:42px; } .empty-state p { color:#4A616C; line-height:1.6; } .empty-state small { color:var(--muted); font-size:12px; } .no-api { color:var(--muted); padding:24px 0; } footer { display:flex; justify-content:space-between; gap:20px; margin-top:34px; color:var(--muted); font-size:11px; line-height:1.5; } .failure .masthead { grid-template-columns:1fr; padding-bottom:20px; } .failure .empty-state { margin-top:42px; }
  @media (max-width:720px) { .shell { padding:20px 18px 38px; } .masthead { grid-template-columns:1fr; gap:20px; } .pulse-rail { width:100%; height:16px; flex-direction:row; align-items:center; justify-content:space-between; padding:0; background:linear-gradient(90deg,var(--ink),var(--ink)) 0 50%/100% 1px no-repeat; } .pulse-rail i,.pulse-rail i:nth-child(n) { height:10px; width:10px; margin:0; border-radius:50%; } .ledger { grid-template-columns:1fr 1fr; } .ledger div:nth-child(2) { border-right:0; } .ledger div:nth-child(-n+2) { border-bottom:1px solid var(--line); } .ledger strong { font-size:30px; } .group-heading { display:block; } .group-heading > p { margin-top:12px; text-align:left; } .api-card { grid-template-columns:1fr; } .api-main { padding-right:0; } .health-note { border-left:0; border-top:1px dotted var(--line); padding:12px 0 17px; } .details-grid { grid-template-columns:1fr; gap:14px; } footer { display:block; } footer span { display:block; margin-top:8px; } }
  @media (prefers-reduced-motion: no-preference) { .pulse-rail i:nth-child(2) { animation:pulse 3.8s ease-in-out infinite; } @keyframes pulse { 50% { transform:translateX(-10px); } } }
`;
