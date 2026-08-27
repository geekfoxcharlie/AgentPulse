import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { loadRegistry } from "../lib/config.js";
import { asAppError } from "../lib/errors.js";
import { getCachedHealthSnapshots } from "../lib/health.js";
import { groupView, groupsView, type ApiView, type CliView } from "../lib/query.js";
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

type ChannelView = (ApiView & { kindLabel: "API" }) | (CliView & { kindLabel: "CLI" });

function channelsOf(details: Awaited<ReturnType<typeof groupView>>[]): ChannelView[] {
  return details.flatMap((detail) => [
    ...detail.apis.map((api): ChannelView => ({ ...api, kindLabel: "API" as const })),
    ...detail.clis.map((cli): ChannelView => ({ ...cli, kindLabel: "CLI" as const }))
  ]);
}

const STATUS_CLASS: Record<string, string> = { healthy: "ok", unhealthy: "alarm", misconfigured: "warn", unknown: "standby", disabled: "off" };

function statusClass(status: string): string {
  return STATUS_CLASS[status] ?? "standby";
}

function renderDashboard(
  groups: Awaited<ReturnType<typeof groupsView>>,
  details: Awaited<ReturnType<typeof groupView>>[],
  paths: ConfigPaths
): string {
  const channels = channelsOf(details);
  const nominal = channels.filter((channel) => channel.health.status === "healthy" && !channel.health.isExpired).length;
  const attention = channels.filter((channel) => channel.health.status === "unhealthy" || channel.health.status === "misconfigured").length;
  const stale = channels.filter((channel) => channel.health.isExpired).length;
  const lastProbe = channels
    .map((channel) => channel.health.checkedAt)
    .filter((value): value is string => value !== null)
    .sort()
    .at(-1);

  return page(
    "AgentPulse · Field Console",
    `<main class="shell">
      <div class="topbar">
        <span class="brand"><i class="brandchip" aria-hidden="true"></i>AGENTPULSE <em>FIELD CONSOLE</em></span>
        <span class="topnote">MODE <b>READ-ONLY</b></span>
        <span class="topnote">LOCAL HOST ONLY</span>
      </div>

      <header class="masthead">
        <div class="masthead-copy">
          <p class="eyebrow">LOCAL CAPABILITY INDEX</p>
          <h1>ALL CHANNELS<br>ON THIS MACHINE,<br><em>ONE PANEL.</em></h1>
          <p class="lede">Configured capabilities on this machine: what exists, how to call it, and the last probe snapshot. This page renders cached results only — refreshes happen through the CLI and never from this page.</p>
        </div>
        <div class="masthead-side">
          <div class="kv"><span>LAST PROBE</span><strong>${lastProbe ? escapeHtml(formatDate(lastProbe)) : "—"}</strong></div>
          <div class="kv"><span>CHANNELS NOMINAL</span><strong class="${nominal === channels.length && channels.length > 0 ? "v-ok" : attention > 0 ? "v-alarm" : ""}">${nominal}<em>/${channels.length}</em></strong></div>
        </div>
      </header>

      <section class="screen" aria-label="Pulse trace of last probe latencies">
        ${renderTrace(channels)}
        <div class="screen-cap"><span>TRACE = LAST PROBE LATENCY</span><span>SEGMENT = CHANNEL · COLOR = STATUS</span></div>
      </section>

      <section class="ledger" aria-label="Inventory summary">
        <div><span>MODULES</span><strong>${groups.length}</strong></div>
        <div><span>CHANNELS</span><strong>${channels.length}</strong></div>
        <div><span>NOMINAL</span><strong class="v-ok">${nominal}</strong></div>
        <div><span>ATTENTION</span><strong class="${attention > 0 ? "v-alarm" : ""}">${attention}</strong></div>
        <div><span>STALE</span><strong class="${stale > 0 ? "v-warn" : ""}">${stale}</strong></div>
      </section>

      ${details.length === 0 ? renderEmptyState(paths) : details.map((detail) => renderGroup(detail)).join("\n")}

      <footer>
        <span>Configuration root: <code>${escapeHtml(paths.configDir)}</code></span>
        <span>Read-only console — reloading never sends third-party requests. Probe on demand: <code>agentpulse group &lt;group-id&gt; --health</code></span>
      </footer>
    </main>`
  );
}

function renderTrace(channels: ChannelView[]): string {
  const width = 1000;
  const height = 130;
  const baseline = 86;
  if (channels.length === 0) {
    return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="No channels registered">
      <line x1="0" y1="${baseline}" x2="${width}" y2="${baseline}" class="trace-flat"/>
      <text x="500" y="52" text-anchor="middle" class="trace-note">NO SIGNAL</text>
    </svg>`;
  }
  const gap = 10;
  const slot = (width - gap * (channels.length - 1)) / channels.length;
  const segments = channels.map((channel, index) => {
    const x0 = index * (slot + gap);
    const x1 = x0 + slot;
    const st = statusClass(channel.health.status);
    if (channel.health.status === "unknown" || channel.health.status === "disabled" || channel.health.latencyMs === undefined) {
      return `<path d="M ${x0.toFixed(1)} ${baseline} L ${x1.toFixed(1)} ${baseline}" class="trace-flat"/>`;
    }
    const amp = 12 + 46 * Math.min(1, Math.log10(1 + (channel.health.latencyMs ?? 0)) / 3.4);
    const up = baseline - amp;
    const px = x0 + slot * 0.34;
    const apex = x0 + slot * 0.46;
    const back = x0 + slot * 0.58;
    return `<path d="M ${x0.toFixed(1)} ${baseline} L ${px.toFixed(1)} ${baseline} L ${apex.toFixed(1)} ${up.toFixed(1)} L ${(apex + Math.min(6, slot * 0.06)).toFixed(1)} ${baseline + 9} L ${back.toFixed(1)} ${baseline} L ${x1.toFixed(1)} ${baseline}" class="trace-st st-${st}${channel.health.isExpired ? " trace-dim" : ""}" style="animation-delay:${(index * 90).toFixed(0)}ms"/>`;
  }).join("");

  return `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="One waveform segment per channel; amplitude maps last probe latency">
    <line x1="0" y1="${baseline}" x2="${width}" y2="${baseline}" class="trace-base"/>
    ${segments}
  </svg>`;
}

function renderGroup(detail: Awaited<ReturnType<typeof groupView>>): string {
  const entries = channelsOf([detail]);
  const dots = entries.map((entry) => `<i class="dot ${statusClass(entry.health.status)}${entry.health.isExpired ? " dim" : ""}" title="${escapeHtml(entry.id)}: ${escapeHtml(entry.health.status)}"></i>`).join("");

  return `<section class="module" id="${escapeHtml(detail.group.id)}">
    <div class="module-head">
      <div class="module-id">
        <p class="eyebrow">MODULE / ${escapeHtml(detail.group.id)}</p>
        <h2>${escapeHtml(detail.group.name)}</h2>
      </div>
      <p class="module-desc">${escapeHtml(detail.group.description)}</p>
      <div class="module-meter">
        <span class="ch-count">${entries.length} CH</span>
        <span class="dot-row" aria-hidden="true">${dots}</span>
      </div>
    </div>
    <div class="chan-stack">
      ${entries.length === 0 ? "<p class=\"no-chan\">No capability is configured in this module yet.</p>" : entries.map((entry) => renderChannel(entry)).join("\n")}
    </div>
  </section>`;
}

function renderChannel(entry: ChannelView): string {
  const st = entry.health.status;
  const cls = statusClass(st);
  const latency = entry.health.latencyMs !== undefined ? `${entry.health.latencyMs} ms` : "—";
  const healthMeta = entry.health.checkedAt
    ? `Last probe ${formatDate(entry.health.checkedAt)} · ${entry.health.isExpired ? "cache expired" : `cache valid until ${formatDate(entry.health.expiresAt ?? entry.health.checkedAt)}`}`
    : st === "disabled" ? "Disabled — never probed" : "No probe yet";
  const ref = entry.kindLabel === "CLI"
    ? `<code class="ref-cmd">${escapeHtml(entry.command)}</code>`
    : `<code class="ref-env">${escapeHtml(entry.credential.name)}</code>`;

  return `<details class="chan st-${cls}">
    <summary>
      <span class="lamp ${cls}" role="img" aria-label="${escapeHtml(st)}${entry.health.isExpired ? " (cache expired)" : ""}"></span>
      <span class="chan-name">${escapeHtml(entry.name)}<small>${escapeHtml(entry.id)} · ${entry.kindLabel}</small></span>
      <span class="chan-status">${escapeHtml(st.toUpperCase())}</span>
      <span class="chan-latency">${latency}</span>
      <span class="chan-ref">${ref}</span>
      <span class="chev" aria-hidden="true"></span>
    </summary>
    <div class="chan-detail">
      ${entry.kindLabel === "CLI" ? renderCliDetail(entry as CliView, healthMeta) : renderApiDetail(entry as ApiView, healthMeta)}
    </div>
  </details>`;
}

function renderApiDetail(api: ApiView, healthMeta: string): string {
  const placement = api.credential.placement.type === "bearer"
    ? "Bearer header"
    : `${api.credential.placement.type} · ${api.credential.placement.name}`;
  const configState = api.credential.availableToProcess ? "Available to the current CLI process" : "Not available to the current CLI process";
  const additionalEnvironment = api.environment.map((requirement) => {
    const availability = requirement.availableToProcess ? "Available to the current CLI process" : "Not available to the current CLI process";
    const requirementPlacement = requirement.placement
      ? requirement.placement.type === "bearer"
        ? "Bearer header"
        : `${requirement.placement.type} · ${requirement.placement.name}`
      : "Endpoint requirement";
    return `<div><dt>${escapeHtml(requirement.description)}</dt><dd><code>${escapeHtml(requirement.name)}</code> · ${escapeHtml(requirementPlacement)} · ${escapeHtml(requirement.configuredAt)} · ${escapeHtml(availability)}</dd></div>`;
  }).join("");

  return `<div class="detail-grid">
    <dl>
      <div><dt>Status</dt><dd>${escapeHtml(healthMeta)}${api.health.error ? ` — ${escapeHtml(api.health.error.message)}` : ""}</dd></div>
      <div><dt>Environment variable</dt><dd><code>${escapeHtml(api.credential.name)}</code></dd></div>
      <div><dt>Configured at</dt><dd><code>${escapeHtml(api.credential.configuredAt)}</code></dd></div>
      <div><dt>Authentication</dt><dd>${escapeHtml(placement)}</dd></div>
      <div><dt>Current process</dt><dd>${escapeHtml(configState)}</dd></div>
      ${additionalEnvironment}
      <div><dt>Probe endpoint</dt><dd><code>${escapeHtml(api.probe.method)} ${escapeHtml(api.probe.url)}</code></dd></div>
    </dl>
    <div class="usage">
      <p>${escapeHtml(api.usage.notes)}</p>
      <pre><code>${escapeHtml(api.usage.example)}</code></pre>
      <a href="${escapeHtml(api.service.docsUrl)}" rel="noreferrer" target="_blank">Official documentation ↗</a>
    </div>
  </div>`;
}

function renderCliDetail(cli: CliView, healthMeta: string): string {
  return `<div class="detail-grid">
    <dl>
      <div><dt>Status</dt><dd>${escapeHtml(healthMeta)}${cli.health.error ? ` — ${escapeHtml(cli.health.error.message)}` : ""}</dd></div>
      <div><dt>Command</dt><dd><code>${escapeHtml(cli.command)}</code></dd></div>
      <div><dt>Install method</dt><dd>${escapeHtml(cli.install.method)}</dd></div>
      <div><dt>Installed via</dt><dd><code>${escapeHtml(cli.install.command)}</code></dd></div>
      <div><dt>Health probe</dt><dd><code>${escapeHtml(cli.command)} ${escapeHtml(cli.probe.args.join(" "))}</code> expects exit ${cli.probe.expectedExit}</dd></div>
    </dl>
    <div class="usage">
      <p>${escapeHtml(cli.usage.notes)}</p>
      <pre><code>${escapeHtml(cli.usage.example)}</code></pre>
      <a href="${escapeHtml(cli.docsUrl)}" rel="noreferrer" target="_blank">Official documentation ↗</a>
    </div>
  </div>`;
}

function renderEmptyState(paths: ConfigPaths): string {
  return `<section class="module empty">
    <p class="eyebrow">NO MODULES INSTALLED</p>
    <h2>No capability registered on this machine.</h2>
    <p>Built-in templates cover six independent search APIs, Cloudflare GPT Image 2, and the browser-harness CLI. Instantiate one and it appears here as a channel.</p>
    <pre><code>agentpulse templates --group search
agentpulse api add --template brave-search --configured-at ~/.zshenv
agentpulse cli add --template browser-harness</code></pre>
    <small>Current configuration directory: <code>${escapeHtml(paths.configDir)}</code></small>
  </section>`;
}

function renderFailure(message: string, paths: ConfigPaths): string {
  return page(
    "AgentPulse · Configuration needs attention",
    `<main class="shell failure">
      <div class="topbar"><span class="brand"><i class="brandchip" aria-hidden="true"></i>AGENTPULSE <em>FIELD CONSOLE</em></span><span class="topnote">FAULT</span></div>
      <section class="module empty">
        <p class="eyebrow">PANEL OFFLINE</p>
        <h2>Repair this local reference first.</h2>
        <p>${escapeHtml(message)}</p>
        <pre><code>agentpulse validate --json</code></pre>
        <small>Configuration root: <code>${escapeHtml(paths.configDir)}</code></small>
      </section>
    </main>`
  );
}

function page(title: string, content: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>${escapeHtml(title)}</title><style>${styles}</style></head><body>${content}</body></html>`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

const styles = `
  :root {
    --chassis: #0F1714; --panel: #15211B; --panel-raise: #182720; --screen: #0B120F;
    --line: #2C4034; --line-soft: #203028;
    --ink: #E9F2EC; --ink-dim: #9FB4AA; --ink-faint: #6E857B;
    --ok: #3FCE88; --warn: #E8B44A; --alarm: #FF6E55; --standby: #56C2D3;
    --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
    --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", sans-serif;
    --display: "Avenir Next Condensed", "Helvetica Neue", "Arial Narrow", var(--sans);
  }
  * { box-sizing: border-box; }
  body { margin: 0; color: var(--ink); background: var(--chassis); font-family: var(--sans); font-size: 14px; line-height: 1.5; -webkit-font-smoothing: antialiased; }
  body::after { content: ""; position: fixed; inset: 0; pointer-events: none; background: radial-gradient(ellipse at 50% -10%, rgba(63, 206, 136, 0.05), transparent 55%); }
  .shell { position: relative; max-width: 1180px; margin: 0 auto; padding: 0 28px 64px; }
  code, pre { font-family: var(--mono); }
  a { color: var(--alarm); font-weight: 700; text-decoration: none; }
  a:hover { text-decoration: underline; }
  :focus-visible { outline: 2px solid var(--alarm); outline-offset: 3px; border-radius: 2px; }

  .topbar { display: flex; align-items: center; gap: 28px; padding: 14px 0 12px; border-bottom: 1px solid var(--line); font: 600 11px/1 var(--mono); letter-spacing: 0.12em; color: var(--ink-dim); }
  .brand { display: flex; align-items: center; gap: 10px; color: var(--ink); }
  .brand em { font-style: normal; color: var(--ink-faint); font-weight: 500; }
  .brandchip { width: 9px; height: 9px; background: var(--ok); box-shadow: 0 0 10px 1px rgba(63, 206, 136, 0.55); }
  .topnote { margin-left: auto; }
  .topnote b { color: var(--ink); font-weight: 700; }
  .topnote + .topnote { margin-left: 0; }

  .masthead { display: grid; grid-template-columns: minmax(0, 1.9fr) auto; gap: 36px; align-items: end; padding: 40px 0 30px; }
  .eyebrow { margin: 0 0 10px; color: var(--ok); font: 700 10px/1.2 var(--mono); letter-spacing: 0.22em; }
  h1 { margin: 0 0 16px; font-family: var(--display); font-weight: 800; font-size: clamp(40px, 5.6vw, 64px); line-height: 0.98; letter-spacing: 0.01em; text-transform: uppercase; }
  h1 em { font-style: normal; color: var(--ink-dim); }
  .lede { max-width: 640px; margin: 0; color: var(--ink-dim); font-size: 14px; line-height: 1.65; }
  .masthead-side { display: flex; flex-direction: column; gap: 14px; padding-bottom: 4px; }
  .kv { display: flex; flex-direction: column; gap: 5px; border-left: 2px solid var(--line); padding-left: 14px; }
  .kv span { color: var(--ink-faint); font: 600 10px/1 var(--mono); letter-spacing: 0.16em; }
  .kv strong { font-family: var(--display); font-weight: 700; font-size: 26px; letter-spacing: 0.02em; }
  .kv strong em { font-style: normal; color: var(--ink-faint); font-size: 18px; }
  .v-ok { color: var(--ok); } .v-warn { color: var(--warn); } .v-alarm { color: var(--alarm); }

  .screen { position: relative; background: var(--screen); border: 1px solid var(--line); box-shadow: inset 0 0 48px rgba(0, 0, 0, 0.55), 0 0 32px rgba(63, 206, 136, 0.05); overflow: hidden; }
  .screen::after { content: ""; position: absolute; inset: 0; pointer-events: none; background: repeating-linear-gradient(0deg, transparent 0 3px, rgba(233, 242, 236, 0.016) 3px 4px); }
  .screen svg { display: block; width: 100%; height: 132px; }
  .trace-base { stroke: var(--line-soft); stroke-width: 1; vector-effect: non-scaling-stroke; }
  .trace-flat { stroke: var(--ink-faint); stroke-width: 1.5; opacity: 0.5; vector-effect: non-scaling-stroke; stroke-dasharray: 3 5; }
  .trace-st { fill: none; stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linejoin: round; stroke-dasharray: 400; stroke-dashoffset: 400; animation: trace-draw 1.3s ease-out forwards; }
  .trace-st.st-ok { stroke: var(--ok); filter: drop-shadow(0 0 4px rgba(63, 206, 136, 0.5)); }
  .trace-st.st-alarm { stroke: var(--alarm); filter: drop-shadow(0 0 4px rgba(255, 110, 85, 0.5)); }
  .trace-st.st-warn { stroke: var(--warn); filter: drop-shadow(0 0 4px rgba(232, 180, 74, 0.45)); }
  .trace-dim { opacity: 0.45; }
  .trace-note { fill: var(--ink-faint); font: 700 11px var(--mono); letter-spacing: 0.3em; }
  .screen-cap { display: flex; justify-content: space-between; padding: 8px 14px 10px; border-top: 1px solid var(--line-soft); color: var(--ink-faint); font: 500 9.5px/1 var(--mono); letter-spacing: 0.14em; }

  .ledger { display: grid; grid-template-columns: repeat(5, 1fr); border-bottom: 1px solid var(--line); }
  .ledger div { min-height: 96px; padding: 20px 18px 16px 0; border-right: 1px solid var(--line-soft); }
  .ledger div + div { padding-left: 20px; }
  .ledger div:last-child { border-right: 0; }
  .ledger span { display: block; margin-bottom: 10px; color: var(--ink-faint); font: 600 10px/1 var(--mono); letter-spacing: 0.16em; }
  .ledger strong { font-family: var(--display); font-weight: 700; font-size: 36px; line-height: 1; letter-spacing: 0.02em; }

  .module { position: relative; margin-top: 36px; background: var(--panel); border: 1px solid var(--line-soft); }
  .module::before, .module::after { content: ""; position: absolute; width: 12px; height: 12px; border-color: var(--line); border-style: solid; }
  .module::before { top: -1px; left: -1px; border-width: 2px 0 0 2px; }
  .module::after { bottom: -1px; right: -1px; border-width: 0 2px 2px 0; }
  .module-head { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; gap: 28px; align-items: end; padding: 22px 24px 16px; border-bottom: 1px solid var(--line-soft); }
  .module-head h2 { margin: 0; font-family: var(--display); font-weight: 700; font-size: 26px; letter-spacing: 0.03em; text-transform: uppercase; line-height: 1; }
  .module-desc { margin: 0; color: var(--ink-dim); font-size: 12.5px; line-height: 1.55; }
  .module-meter { display: flex; align-items: center; gap: 14px; }
  .ch-count { color: var(--ink-faint); font: 700 11px/1 var(--mono); letter-spacing: 0.1em; }
  .dot-row { display: flex; gap: 4px; }
  .dot { width: 7px; height: 7px; border-radius: 50%; }
  .dot.dim { opacity: 0.4; }
  .dot.ok { background: var(--ok); } .dot.warn { background: var(--warn); } .dot.alarm { background: var(--alarm); }
  .dot.standby { background: transparent; border: 1px solid var(--standby); } .dot.off { background: #3A4A42; }

  .chan-stack { display: grid; }
  .no-chan { margin: 0; padding: 22px 24px; color: var(--ink-faint); font-size: 13px; }
  .chan { min-width: 0; border-bottom: 1px solid var(--line-soft); }
  .chan:last-child { border-bottom: 0; }
  .chan summary { display: grid; grid-template-columns: 40px minmax(0, 1.25fr) 118px 86px minmax(0, 1fr) 22px; gap: 14px; align-items: center; padding: 15px 24px; cursor: pointer; list-style: none; }
  .chan summary::-webkit-details-marker { display: none; }
  .chan summary:hover { background: var(--panel-raise); }
  .chan[open] summary { background: var(--panel-raise); }
  .lamp { justify-self: center; width: 9px; height: 9px; border-radius: 50%; }
  .lamp.ok { background: var(--ok); box-shadow: 0 0 9px 1px rgba(63, 206, 136, 0.5); }
  .lamp.warn { background: var(--warn); box-shadow: 0 0 9px 1px rgba(232, 180, 74, 0.45); }
  .lamp.alarm { background: var(--alarm); box-shadow: 0 0 10px 1px rgba(255, 110, 85, 0.55); animation: lamp-blink 1.2s steps(2, start) infinite; }
  .lamp.standby { background: transparent; border: 1.5px solid var(--standby); }
  .lamp.off { background: #3A4A42; }
  .chan-name { min-width: 0; font-weight: 650; font-size: 14.5px; }
  .chan-name small { display: block; margin-top: 2px; color: var(--ink-faint); font: 500 10.5px/1 var(--mono); letter-spacing: 0.04em; }
  .chan-status { font: 700 10px/1 var(--mono); letter-spacing: 0.14em; }
  .st-ok .chan-status { color: var(--ok); } .st-warn .chan-status { color: var(--warn); }
  .st-alarm .chan-status { color: var(--alarm); } .st-standby .chan-status { color: var(--standby); } .st-off .chan-status { color: var(--ink-faint); }
  .chan-latency { color: var(--ink-dim); font: 500 11.5px/1 var(--mono); text-align: right; }
  .chan-ref { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ref-env, .ref-cmd { font-size: 11px; color: var(--ink-dim); background: var(--screen); border: 1px solid var(--line-soft); padding: 4px 8px; }
  .chev { width: 8px; height: 8px; border-right: 2px solid var(--ink-faint); border-bottom: 2px solid var(--ink-faint); transform: rotate(-45deg); transition: transform 0.15s ease; justify-self: end; }
  .chan[open] .chev { transform: rotate(45deg); }
  .chan-detail { border-top: 1px dashed var(--line-soft); background: var(--screen); }
  .detail-grid { display: grid; grid-template-columns: minmax(260px, 0.95fr) minmax(0, 1.5fr); gap: 30px; padding: 20px 24px 26px; }
  .detail-grid > * { min-width: 0; }
  dl { margin: 0; }
  dl div { padding: 8px 0; border-bottom: 1px solid var(--line-soft); }
  dl div:last-child { border-bottom: 0; }
  dt { color: var(--ink-faint); font: 600 10px/1 var(--mono); letter-spacing: 0.12em; text-transform: uppercase; }
  dd { margin: 5px 0 0; font-size: 12.5px; line-height: 1.55; overflow-wrap: anywhere; }
  dd code { color: var(--ink-dim); font-size: 11.5px; }
  .usage p { margin: 0 0 10px; color: var(--ink-dim); font-size: 13px; line-height: 1.6; }
  pre { overflow: auto; margin: 0 0 14px; padding: 14px; background: var(--chassis); border: 1px solid var(--line-soft); color: #C9DCD1; font-size: 11px; line-height: 1.6; }

  .module.empty { margin-top: 44px; padding: 36px; max-width: 760px; }
  .module.empty h2 { margin: 0 0 12px; font-family: var(--display); font-weight: 700; font-size: 34px; text-transform: uppercase; }
  .module.empty p { margin: 0 0 8px; color: var(--ink-dim); line-height: 1.6; }
  .module.empty small { display: block; margin-top: 14px; color: var(--ink-faint); font-size: 12px; }
  .module.empty pre { margin-top: 16px; }

  footer { display: flex; justify-content: space-between; gap: 24px; margin-top: 38px; padding-top: 16px; border-top: 1px solid var(--line); color: var(--ink-faint); font-size: 11.5px; line-height: 1.6; }
  footer code { color: var(--ink-dim); font-size: 10.5px; }
  .failure .topbar { border-bottom: 0; }

  @keyframes trace-draw { to { stroke-dashoffset: 0; } }
  @keyframes lamp-blink { 50% { opacity: 0.25; } }

  @media (max-width: 880px) {
    .shell { padding: 0 16px 48px; }
    .topbar { flex-wrap: wrap; gap: 12px 20px; }
    .masthead { grid-template-columns: 1fr; gap: 22px; padding: 28px 0 22px; }
    .masthead-side { flex-direction: row; gap: 26px; }
    .ledger { grid-template-columns: repeat(3, 1fr); }
    .ledger div:nth-child(3) { border-right: 0; }
    .ledger div:nth-child(-n+3) { border-bottom: 1px solid var(--line-soft); }
    .module-head { grid-template-columns: 1fr; gap: 10px; }
    .module-meter { justify-content: flex-start; }
    .chan summary { grid-template-columns: 30px minmax(0, 1fr) auto 20px; gap: 10px; padding: 14px 16px; }
    .chan-latency, .chan-ref { display: none; }
    .detail-grid { grid-template-columns: 1fr; gap: 18px; }
    footer { flex-direction: column; gap: 8px; }
  }
  @media (prefers-reduced-motion: reduce) {
    * { animation: none !important; transition: none !important; }
    .trace-st { stroke-dasharray: none; stroke-dashoffset: 0; }
  }
`;
