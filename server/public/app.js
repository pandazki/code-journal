// Work Memory Archive — vanilla SPA, ES modules, no bundler.
// Editorial UI consuming the GET /api/* routes from src/routes/*.

import { marked } from "https://esm.sh/marked@12";

marked.setOptions({ gfm: true, breaks: false, smartLists: true });

const $app = document.getElementById("app");
const $nav = document.getElementById("nav");

// ─── Utilities ─────────────────────────────────────────────────────────

const html = (strings, ...values) =>
  strings.reduce((acc, s, i) => acc + s + (values[i] !== undefined ? values[i] : ""), "");

const escapeHtml = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));

const todayIso = () => new Date().toISOString().slice(0, 10);

const fmtDate = (iso) => {
  if (!iso) return "—";
  return iso; // plain YYYY-MM-DD; the mono font + color tokens carry the styling
};

const fmtDateLong = (iso) => {
  if (!iso) return "—";
  const dt = new Date(iso + "T00:00:00Z");
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return `${iso} · ${days[dt.getUTCDay()]}`;
};

const fmtRelativeDate = (iso) => {
  if (!iso) return "";
  const t = new Date(iso + "T00:00:00Z").getTime();
  const now = new Date(todayIso() + "T00:00:00Z").getTime();
  const days = Math.round((now - t) / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) return `${Math.floor(days/7)} wk ago`;
  if (days < 365) return `${Math.floor(days/30)} mo ago`;
  return `${Math.floor(days/365)} yr ago`;
};

const fmtTs = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + "Z";
};

// Compact ISO-8601 → wall-clock display. Preserves the source's offset
// (we string-slice instead of constructing a Date) so a `+08:00` entry
// reads as `2026-05-11 10:46` not `02:46Z`. Format the range so a same-
// day span doesn't repeat the date.
const fmtShortTs = (iso) => {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/);
  return m ? `${m[1]} ${m[2]}` : String(iso);
};
const fmtRange = (start, end) => {
  if (!start) return "";
  if (!end || end === start) return fmtShortTs(start);
  const s = fmtShortTs(start);
  const e = fmtShortTs(end);
  const [sd, st] = s.split(" ");
  const [ed, et] = e.split(" ");
  if (sd === ed) return `${sd} ${st} → ${et}`;
  return `${s} → ${e}`;
};

const fmtBytes = (n) => {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const truncate = (s, max = 80) => {
  s = String(s ?? "");
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
};

const CODE_VIEW_MAX_LINES = 5000;

/**
 * Render raw text into a line-numbered <pre class="code-view"> — no syntax
 * highlighting, no parsing/pretty-printing. Each source line becomes one
 * <span class="code-line"> so a CSS counter can paint the gutter. Long lines
 * scroll horizontally; the block scrolls vertically with a max-height.
 * Files over CODE_VIEW_MAX_LINES are truncated with a note.
 */
const renderCodeView = (text, downloadUrl) => {
  const raw = String(text ?? "");
  // Split keeping it simple — \n boundaries; tolerate trailing newline.
  let lines = raw.split("\n");
  // A trailing "\n" yields a final "" element — drop it so we don't show a
  // phantom blank last line (the original file content is unchanged either way).
  if (lines.length > 1 && lines[lines.length - 1] === "") lines = lines.slice(0, -1);
  const total = lines.length;
  let truncated = false;
  if (total > CODE_VIEW_MAX_LINES) {
    lines = lines.slice(0, CODE_VIEW_MAX_LINES);
    truncated = true;
  }
  // Each line is a display:block <span> — no literal "\n" inside, the block
  // does the wrapping. Empty lines get a zero-width space so the row keeps
  // its height.
  const body = lines
    .map((ln) => `<span class="code-line">${ln.length ? escapeHtml(ln) : "&#8203;"}</span>`)
    .join("");
  return html`
    <div class="code-view__bar">
      <span class="code-view__count">${total} ${total === 1 ? "line" : "lines"}</span>
      ${downloadUrl ? html`<a class="code-view__dl" href="${escapeHtml(downloadUrl)}" download>↓ download</a>` : ""}
    </div>
    <pre class="code-view"><code>${body}</code></pre>
    ${truncated ? html`<p class="code-view__trunc">… (truncated to first ${CODE_VIEW_MAX_LINES} lines — download for the full file)</p>` : ""}
  `;
};

const fetchJson = async (path) => {
  const res = await fetch(path, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
};

const fetchText = async (path) => {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.text();
};

const setNav = (route) => {
  for (const a of $nav.querySelectorAll("a[data-route]")) {
    a.classList.toggle("active", a.dataset.route === route);
  }
};

const renderError = (e) => {
  $app.innerHTML = html`<p class="error">Couldn't load: ${escapeHtml(e?.message || e)}</p>`;
};

const renderLoading = () => {
  $app.innerHTML = `<p class="loading"><i>Loading…</i></p>`;
};

// ─── Routes ────────────────────────────────────────────────────────────

const routes = [
  { rx: /^\/?$/,                                                  handler: routeHome,    nav: "" },
  { rx: /^\/projects$/,                                           handler: routeProjects, nav: "projects" },
  { rx: /^\/projects\/([^/]+)$/,                                  handler: routeProjectDetail, nav: "projects" },
  { rx: /^\/projects\/([^/]+)\/sessions$/,                        handler: routeProjectSessions, nav: "projects" },
  { rx: /^\/projects\/([^/]+)\/sessions\/([^/]+)$/,               handler: routeSession, nav: "projects" },
  { rx: /^\/projects\/([^/]+)\/sessions\/([^/]+)\/sub\/([^/]+)$/, handler: routeSubagent, nav: "projects" },
  { rx: /^\/projects\/([^/]+)\/worklog$/,                         handler: routeProjectWorklog, nav: "projects" },
  { rx: /^\/projects\/([^/]+)\/worklog\/([^/]+)$/,                handler: routeWorklogEntry, nav: "projects" },
  { rx: /^\/projects\/([^/]+)\/dates\/(\d{4}-\d{2}-\d{2})$/,      handler: routeProjectDate, nav: "projects" },
  { rx: /^\/projects\/([^/]+)\/dates\/(\d{4}-\d{2}-\d{2})\/users\/([^/]+)$/, handler: routeReport, nav: "projects" },
  { rx: /^\/users$/,                                              handler: routeUsers, nav: "users" },
  { rx: /^\/users\/([^/]+)$/,                                     handler: routeUserDetail, nav: "users" },
  { rx: /^\/users\/([^/]+)\/dates\/(\d{4}-\d{2}-\d{2})$/,         handler: routeUserDate, nav: "users" },
  { rx: /^\/dates$/,                                              handler: routeDates, nav: "dates" },
];

async function dispatch() {
  const path = (location.hash || "#/").replace(/^#/, "") || "/";
  for (const { rx, handler, nav } of routes) {
    const m = path.match(rx);
    if (m) {
      setNav(nav);
      renderLoading();
      try { await handler(...m.slice(1)); }
      catch (e) { renderError(e); console.error(e); }
      window.scrollTo(0, 0);
      return;
    }
  }
  renderError(new Error(`No route for ${path}`));
}

window.addEventListener("hashchange", dispatch);
window.addEventListener("DOMContentLoaded", dispatch);

// ─── Home ──────────────────────────────────────────────────────────────

async function routeHome() {
  const [projects, users] = await Promise.all([
    fetchJson("/api/projects"),
    fetchJson("/api/users"),
  ]);

  // Build a flat recent list across all projects/users.
  // Use latest_date / latest_submission_ts to pick a recent set.
  const recentDates = new Set();
  for (const p of projects) recentDates.add(p.latest_date);
  // Ask each project for its recent dates and assemble cross-axis "recent" rows
  const recentByDate = {};
  await Promise.all(projects.slice(0, 12).map(async (p) => {
    if (!p.latest_date) return;
    try {
      const list = await fetchJson(`/api/projects/${encodeURIComponent(p.project_id)}/dates/${p.latest_date}`);
      for (const item of list) {
        const k = p.latest_date;
        recentByDate[k] = recentByDate[k] || [];
        recentByDate[k].push({ project_id: p.project_id, ...item });
      }
    } catch {}
  }));
  const recentDateKeys = Object.keys(recentByDate).sort().reverse().slice(0, 6);

  $app.innerHTML = html`
    <section class="home__masthead">
      <p class="kicker">code-journal · example server</p>
      <h1 class="display-xl">Daily reports submitted by the plugin.</h1>
      <p class="subtitle">Browse by project, contributor, or date. Each report is the markdown your CLI POSTed; the server only files it. Open one to read what landed.</p>
    </section>

    <section class="home__grid">
      <div>
        <h2 class="section__head">Projects</h2>
        ${projects.length === 0
          ? `<p class="empty">No projects yet.</p>`
          : `<ul class="section__list">${
              projects.slice(0, 8).map(p => html`
                <li><a class="section__row" href="#/projects/${encodeURIComponent(p.project_id)}">
                  <span class="name">${escapeHtml(p.project_id)}</span>
                  <span class="meta">${p.report_count} ${p.report_count === 1 ? "report" : "reports"}${p.latest_date ? " · " + fmtRelativeDate(p.latest_date) : ""}</span>
                </a></li>
              `).join("")
            }${projects.length > 8 ? `<li><a class="section__row" href="#/projects"><span class="name"><em>See all ${projects.length}…</em></span></a></li>` : ""}</ul>`
        }
      </div>

      <div>
        <h2 class="section__head">Contributors</h2>
        ${users.length === 0
          ? `<p class="empty">No contributors yet.</p>`
          : `<ul class="section__list">${
              users.slice(0, 8).map(u => html`
                <li><a class="section__row" href="#/users/${encodeURIComponent(u.username)}">
                  <span class="name">${escapeHtml(u.display_name || u.username)}</span>
                  <span class="meta">${u.project_count} ${u.project_count === 1 ? "project" : "projects"} · ${u.date_count} ${u.date_count === 1 ? "day" : "days"}</span>
                </a></li>
              `).join("")
            }${users.length > 8 ? `<li><a class="section__row" href="#/users"><span class="name"><em>See all ${users.length}…</em></span></a></li>` : ""}</ul>`
        }
      </div>

      <div>
        <h2 class="section__head">By Date</h2>
        ${recentDateKeys.length === 0
          ? `<p class="empty">No submissions yet.</p>`
          : `<ul class="section__list">${
              recentDateKeys.map(d => {
                const items = recentByDate[d];
                const isToday = d === todayIso();
                return html`
                  <li><a class="section__row" href="#/dates">
                    <span class="name">${fmtDate(d)}${isToday ? '<span class="badge-today">today</span>' : ''}</span>
                    <span class="meta">${items.length} ${items.length === 1 ? "report" : "reports"}</span>
                  </a></li>
                `;
              }).join("")
            }<li><a class="section__row" href="#/dates"><span class="name"><em>Full timeline…</em></span></a></li></ul>`
        }
      </div>
    </section>

    ${recentDateKeys.length > 0 ? html`
      <section class="recent">
        <header class="recent__head">
          <p class="kicker">Most recent</p>
          <h2>What landed lately</h2>
        </header>
        <div class="recent__list">
          ${recentDateKeys.map(d => html`
            <div class="recent__date">${fmtDate(d)}</div>
            <div class="recent__entries">
              ${recentByDate[d].map(item => html`
                <a class="recent__entry" href="#/projects/${encodeURIComponent(item.project_id)}/dates/${d}/users/${encodeURIComponent(item.username)}">
                  <span class="recent__title">
                    <em>${escapeHtml(item.project_id)}</em> · ${escapeHtml(item.display_name || item.username)}
                  </span>
                  <span class="recent__meta">${item.meta?.format || "daily"} · ${item.meta?.payload_size_bytes ?? 0}b</span>
                </a>
              `).join("")}
            </div>
          `).join("")}
        </div>
      </section>
    ` : ""}
  `;
}

// ─── Project list ──────────────────────────────────────────────────────

async function routeProjects() {
  const projects = await fetchJson("/api/projects");
  $app.innerHTML = html`
    <header class="detail__masthead">
      <p class="kicker">Index</p>
      <h1 class="detail__title">Projects</h1>
      <div class="detail__meta">
        <span><strong>${projects.length}</strong> total</span>
      </div>
    </header>

    ${projects.length === 0
      ? `<p class="empty">No projects yet. Submit a report from your code-journal CLI to populate this index.</p>`
      : html`<ul class="section__list">${
          projects.map(p => html`
            <li><a class="section__row" href="#/projects/${encodeURIComponent(p.project_id)}">
              <span class="name">${escapeHtml(p.project_id)}</span>
              <span class="meta">${p.report_count} reports · ${p.users.length} contributors${p.latest_date ? " · last " + fmtRelativeDate(p.latest_date) : ""}</span>
            </a></li>
          `).join("")
        }</ul>`
    }
  `;
}

// ─── Project detail ────────────────────────────────────────────────────

async function routeProjectDetail(projectId) {
  const project = await fetchJson(`/api/projects/${encodeURIComponent(projectId)}`);
  // For each date, fetch contributor list
  const dateRows = await Promise.all(
    project.dates.map(async (d) => ({
      date: d,
      list: await fetchJson(`/api/projects/${encodeURIComponent(projectId)}/dates/${d}`),
    }))
  );

  $app.innerHTML = html`
    <p class="crumbs"><a href="#/">Archive</a><span class="sep">/</span><a href="#/projects">Projects</a></p>

    <header class="detail__masthead">
      <p class="kicker">Project</p>
      <h1 class="detail__title">${escapeHtml(project.project_id)}</h1>
      <div class="detail__meta">
        <span><strong>${project.total}</strong> ${project.total === 1 ? "report" : "reports"}</span>
        <span><strong>${project.dates.length}</strong> ${project.dates.length === 1 ? "day" : "days"}</span>
        <span><strong>${project.users.length}</strong> ${project.users.length === 1 ? "contributor" : "contributors"}</span>
      </div>
    </header>

    <nav class="project-extras">
      <a class="project-extras__link" href="#/projects/${encodeURIComponent(project.project_id)}/sessions">Sessions (${project.session_count ?? 0})</a>
      <a class="project-extras__link" href="#/projects/${encodeURIComponent(project.project_id)}/worklog">Work log (${project.worklog_count ?? 0})</a>
    </nav>

    ${dateRows.length === 0
      ? `<p class="empty">No reports yet.</p>`
      : html`<div class="dates">${
          dateRows.map(({ date, list }) => html`
            <div class="dates__date">${fmtDate(date)}${date === todayIso() ? '<span class="badge-today">today</span>' : ''}</div>
            <div class="dates__contributors">
              ${list.map(item => html`
                <a class="dates__contrib" href="#/projects/${encodeURIComponent(projectId)}/dates/${date}/users/${encodeURIComponent(item.username)}">
                  <span class="dates__name">${escapeHtml(item.display_name || item.username)}</span>
                  <span class="dates__sub">${item.meta?.format || "daily"} · ${(item.meta?.payload_size_bytes ?? 0)}b · ${(item.meta?.language || "en")}</span>
                </a>
              `).join("")}
            </div>
          `).join("")
        }</div>`
    }
  `;
}

// ─── Project · Date (overview, picks a contributor) ────────────────────

async function routeProjectDate(projectId, date) {
  const list = await fetchJson(`/api/projects/${encodeURIComponent(projectId)}/dates/${date}`);
  $app.innerHTML = html`
    <p class="crumbs">
      <a href="#/projects">Projects</a><span class="sep">/</span>
      <a href="#/projects/${encodeURIComponent(projectId)}">${escapeHtml(projectId)}</a><span class="sep">/</span>
      ${fmtDate(date)}
    </p>
    <header class="detail__masthead">
      <p class="kicker">${escapeHtml(projectId)} · day</p>
      <h1 class="detail__title">${fmtDateLong(date)}</h1>
      <div class="detail__meta">
        <span><strong>${list.length}</strong> ${list.length === 1 ? "contributor" : "contributors"}</span>
      </div>
    </header>
    ${list.length === 0
      ? `<p class="empty">No reports for this day.</p>`
      : html`<div class="dates"><div class="dates__date">Contributors</div><div class="dates__contributors">${
          list.map(item => html`
            <a class="dates__contrib" href="#/projects/${encodeURIComponent(projectId)}/dates/${date}/users/${encodeURIComponent(item.username)}">
              <span class="dates__name">${escapeHtml(item.display_name || item.username)}</span>
              <span class="dates__sub">${item.meta?.format || "daily"} · ${(item.meta?.payload_size_bytes ?? 0)}b</span>
            </a>
          `).join("")
        }</div></div>`
    }
  `;
}

// ─── Project · Sessions ────────────────────────────────────────────────

async function routeProjectSessions(projectId) {
  const list = await fetchJson(`/api/projects/${encodeURIComponent(projectId)}/sessions`);
  $app.innerHTML = html`
    <p class="crumbs">
      <a href="#/projects">Projects</a><span class="sep">/</span>
      <a href="#/projects/${encodeURIComponent(projectId)}">${escapeHtml(projectId)}</a><span class="sep">/</span>
      Sessions
    </p>
    <header class="detail__masthead">
      <p class="kicker">${escapeHtml(projectId)} · raw sessions</p>
      <h1 class="detail__title">Sessions</h1>
      <div class="detail__meta">
        <span><strong>${list.length}</strong> ${list.length === 1 ? "session" : "sessions"}</span>
      </div>
    </header>
    ${list.length === 0
      ? `<p class="empty">No sessions uploaded for this project yet.</p>`
      : html`<ul class="section__list">${
          list.map(s => html`
            <li><a class="section__row" href="#/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(s.session_id)}">
              <span class="name mono">${escapeHtml(s.session_id)}</span>
              <span class="meta">${escapeHtml(s.agent || "unknown")} · ${fmtBytes(s.size_bytes)} · ${s.received_ts ? fmtTs(s.received_ts) : "—"}</span>
            </a></li>
          `).join("")
        }</ul>`
    }
  `;
}

// ─── Session viewer — structured JSONL ─────────────────────────────────
//
// The session content is JSONL (one JSON object per line). We parse it
// line-by-line into entries, classify each (agent-aware, best-effort), and
// render a two-pane browser: a scrollable left list (line# · type badge ·
// one-line preview) and a right detail pane (formatted form on top, raw JSON
// below). The original line-numbered code view is kept as a "Raw" tab.

// Coarse categories → CSS badge colors.
const SESSION_CATEGORIES = new Set([
  "user", "assistant", "tool", "tool-result", "hook", "system", "meta", "other",
]);

/** Pull the textual content out of a CC/Codex message-shaped object.
 *  `content` may be a plain string or an array of typed blocks. */
function messageText(content) {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const bits = [];
  for (const block of content) {
    if (block == null) continue;
    if (typeof block === "string") { bits.push(block); continue; }
    const t = block.type;
    if (t === "text" && typeof block.text === "string") bits.push(block.text);
    else if (t === "output_text" && typeof block.text === "string") bits.push(block.text);
    else if (t === "input_text" && typeof block.text === "string") bits.push(block.text);
    else if (t === "tool_use" || t === "server_tool_use") bits.push(`→ [${block.name || "tool"}]`);
    else if (t === "tool_result") {
      const r = block.content;
      bits.push(typeof r === "string" ? r : messageText(r));
    } else if (t === "image") bits.push("[image]");
    else if (typeof block.text === "string") bits.push(block.text);
  }
  return bits.join(" ").replace(/\s+/g, " ").trim();
}

/** First tool-use block in a CC assistant message content array, if any. */
function firstToolUse(content) {
  if (!Array.isArray(content)) return null;
  for (const b of content) {
    if (b && (b.type === "tool_use" || b.type === "server_tool_use")) return b;
  }
  return null;
}

// Hook-ish CC entry types (top-level type or attachment.type).
const CC_HOOK_TYPES = new Set([
  "hook_started", "hook_response", "hook_success", "hook_failure",
  "hook_additional_context", "hook_blocked", "hook",
]);

/**
 * Map an entry to one of SESSION_CATEGORIES — used for badge color.
 * Best-effort; unknown shapes land in "other".
 */
function categorize(entry, agent) {
  if (!entry || typeof entry !== "object") return "other";
  if (entry._unparsed !== undefined) return "other";
  const type = entry.type;

  if (agent === "claude-code") {
    if (type === "user") {
      // a user turn that is *only* tool_result blocks reads as tool output
      const c = entry.message && entry.message.content;
      if (Array.isArray(c) && c.length && c.every((b) => b && b.type === "tool_result")) {
        return "tool-result";
      }
      return "user";
    }
    if (type === "assistant") {
      const c = entry.message && entry.message.content;
      return firstToolUse(c) ? "tool" : "assistant";
    }
    if (type === "system") return "system";
    if (type === "summary" || type === "last-prompt" || type === "permission-mode" ||
        type === "file-history-snapshot" || type === "command_permissions" ||
        type === "skill_listing" || type === "deferred_tools_delta" || type === "task_reminder") {
      return "meta";
    }
    const at = entry.attachment && entry.attachment.type;
    if (CC_HOOK_TYPES.has(type) || (at && CC_HOOK_TYPES.has(at))) return "hook";
    return "other";
  }

  if (agent === "codex") {
    if (type === "session_meta" || type === "turn_context" || type === "compacted" ||
        type === "turn_diff") return "meta";
    if (type === "event_msg") return "system";
    if (type === "response_item") {
      const p = entry.payload || {};
      const kind = p.type || p.role;
      if (kind === "message") return (p.role === "user" || p.role === "human") ? "user" : "assistant";
      if (kind === "function_call" || kind === "local_shell_call" || kind === "custom_tool_call") return "tool";
      if (kind === "function_call_output" || kind === "local_shell_call_output" ||
          kind === "custom_tool_call_output") return "tool-result";
      if (kind === "reasoning") return "assistant";
      return "other";
    }
    return "other";
  }

  // unknown agents — only the few universally-stable types get a color
  if (type === "user") return "user";
  if (type === "assistant") return "assistant";
  if (type === "system") return "system";
  return "other";
}

/** A short badge label for an entry (the type name, basically). */
function badgeLabel(entry, agent) {
  if (!entry || typeof entry !== "object") return "(json)";
  if (entry._unparsed !== undefined) return "(unparsed)";
  if (agent === "codex" && entry.type === "response_item") {
    const p = entry.payload || {};
    const k = p.type || p.role;
    return k ? `response · ${k}` : "response_item";
  }
  if (agent === "codex" && entry.type === "event_msg") {
    const p = entry.payload || {};
    const k = p.type;
    return k ? `event · ${k}` : "event_msg";
  }
  if (agent === "claude-code") {
    const at = entry.attachment && entry.attachment.type;
    if (at && CC_HOOK_TYPES.has(at)) return at;
    if (entry.type === "system" && entry.subtype) return `system · ${entry.subtype}`;
  }
  return String(entry.type || "(json)");
}

/** A one-line preview string for the left list. Plain text — caller escapes. */
function previewLine(entry, agent) {
  if (!entry || typeof entry !== "object") return "(json)";
  if (entry._unparsed !== undefined) return truncate(String(entry._unparsed), 90);
  const type = entry.type;

  if (agent === "claude-code") {
    if (type === "permission-mode") return `permission mode: ${entry.permissionMode ?? "?"}`;
    if (type === "summary") return truncate(String(entry.summary ?? ""), 90);
    if (type === "last-prompt") return truncate(String(entry.lastPrompt ?? ""), 90);
    if (type === "file-history-snapshot") return "file history snapshot";
    if (type === "command_permissions") return "command permissions";
    if (type === "skill_listing") return "skill listing";
    if (type === "deferred_tools_delta") return "deferred tools delta";
    if (type === "task_reminder") return "task reminder";
    const at = entry.attachment && entry.attachment.type;
    if (CC_HOOK_TYPES.has(type) || (at && CC_HOOK_TYPES.has(at))) {
      const hn = entry.hookName || (entry.attachment && entry.attachment.hookName) ||
                 entry.hook_event_name || (entry.attachment && entry.attachment.hook_event_name);
      return `hook: ${hn || (at || type)}`;
    }
    if (type === "user") {
      const c = entry.message && entry.message.content;
      const txt = messageText(c);
      if (!txt && Array.isArray(c) && c.some((b) => b && b.type === "tool_result")) {
        return "👤 ← [tool result]";
      }
      return "👤 " + truncate(txt || "(empty)", 80);
    }
    if (type === "assistant") {
      const c = entry.message && entry.message.content;
      const tu = firstToolUse(c);
      const txt = messageText(c);
      if (tu) return `🤖 → [${tu.name || "tool"}]` + (txt ? " " + truncate(txt, 60) : " …");
      return "🤖 " + truncate(txt || "(empty)", 80);
    }
    if (type === "system") return truncate(messageText(entry.message?.content) || entry.content || entry.subtype || "system", 90);
  }

  if (agent === "codex") {
    if (type === "session_meta") return "session meta";
    if (type === "turn_context") return "turn context";
    if (type === "compacted") return "compacted";
    if (type === "turn_diff") return "turn diff";
    if (type === "event_msg") {
      const p = entry.payload || {};
      return `event: ${p.type || type}`;
    }
    if (type === "response_item") {
      const p = entry.payload || {};
      const kind = p.type || p.role;
      if (kind === "message") {
        const who = (p.role === "user" || p.role === "human") ? "👤" : "🤖";
        return `${who} ${truncate(messageText(p.content) || "(empty)", 80)}`;
      }
      if (kind === "function_call" || kind === "custom_tool_call")
        return `→ [${p.name || "fn"}]` + (p.arguments ? " " + truncate(String(p.arguments), 60) : " …");
      if (kind === "local_shell_call") return `→ [shell]`;
      if (kind === "function_call_output" || kind === "custom_tool_call_output" || kind === "local_shell_call_output") {
        const out = p.output;
        return "← " + truncate(typeof out === "string" ? out : JSON.stringify(out ?? ""), 80);
      }
      if (kind === "reasoning") return "💭 reasoning";
      return kind ? String(kind) : "response_item";
    }
  }

  if (type) {
    const txt = messageText(entry.message?.content);
    if (txt) return truncate(txt, 90);
    return truncate(JSON.stringify(entry), 90);
  }
  return truncate(JSON.stringify(entry), 90);
}

/** True when this entry should render in the rich "message" detail layout. */
function isMessageEntry(entry, agent) {
  if (!entry || typeof entry !== "object") return false;
  if (agent === "claude-code") {
    return (entry.type === "user" || entry.type === "assistant") && entry.message && typeof entry.message === "object";
  }
  if (agent === "codex") {
    return entry.type === "response_item" && entry.payload && (entry.payload.type === "message" || (entry.payload.role && entry.payload.content));
  }
  return false;
}

/** Pretty-print JSON, swallowing cycles (shouldn't happen with parsed JSONL). */
function prettyJson(v) {
  try { return JSON.stringify(v, null, 2); }
  catch { return String(v); }
}

const SESSION_DETAIL_TEXT_MAX = 4000;

/** Render the content blocks of a message into HTML (text via marked). */
function renderMessageContent(content) {
  if (content == null) return `<p class="session-msg__empty">(no content)</p>`;
  if (typeof content === "string") {
    return content.trim() ? `<div class="session-msg__text">${marked.parse(content)}</div>` : `<p class="session-msg__empty">(empty)</p>`;
  }
  if (!Array.isArray(content)) return `<pre class="session-raw">${escapeHtml(prettyJson(content))}</pre>`;
  const parts = [];
  for (const block of content) {
    if (block == null) continue;
    if (typeof block === "string") {
      if (block.trim()) parts.push(`<div class="session-msg__text">${marked.parse(block)}</div>`);
      continue;
    }
    const t = block.type;
    if ((t === "text" || t === "output_text" || t === "input_text") && typeof block.text === "string") {
      if (block.text.trim()) parts.push(`<div class="session-msg__text">${marked.parse(block.text)}</div>`);
    } else if (t === "thinking" || t === "reasoning") {
      const rt = block.thinking || block.text || (Array.isArray(block.summary) ? block.summary.map((s) => s?.text || "").join("\n") : "");
      parts.push(`<div class="session-block session-block--thinking"><span class="session-block__label">💭 thinking</span>${rt ? `<div class="session-msg__text">${marked.parse(String(rt))}</div>` : ""}</div>`);
    } else if (t === "tool_use" || t === "server_tool_use") {
      parts.push(html`
        <div class="session-block session-block--tool">
          <span class="session-block__label">→ [${escapeHtml(block.name || "tool")}]</span>
          ${block.input !== undefined ? `<pre class="session-raw">${escapeHtml(prettyJson(block.input))}</pre>` : ""}
        </div>`);
    } else if (t === "tool_result") {
      const raw = typeof block.content === "string" ? block.content : messageText(block.content);
      const truncated = raw.length > SESSION_DETAIL_TEXT_MAX;
      parts.push(html`
        <div class="session-block session-block--result">
          <span class="session-block__label">← tool result${block.is_error ? " (error)" : ""}</span>
          <pre class="session-raw">${escapeHtml(truncated ? raw.slice(0, SESSION_DETAIL_TEXT_MAX) + "\n… (truncated — see raw JSON below)" : raw || "(empty)")}</pre>
        </div>`);
    } else if (t === "image") {
      parts.push(`<div class="session-block session-block--image"><span class="session-block__label">[image]</span></div>`);
    } else {
      parts.push(`<pre class="session-raw">${escapeHtml(prettyJson(block))}</pre>`);
    }
  }
  return parts.length ? parts.join("") : `<p class="session-msg__empty">(no renderable content)</p>`;
}

/** Render the right-hand detail pane for one entry. Returns an HTML string. */
function renderEntryDetail(entry, agent, lineNo) {
  if (!entry || typeof entry !== "object") {
    return `<pre class="session-raw">${escapeHtml(String(entry))}</pre>`;
  }
  if (entry._unparsed !== undefined) {
    return html`
      <p class="session-detail__note">Line ${lineNo} didn't parse as JSON — shown verbatim.</p>
      <pre class="session-raw">${escapeHtml(String(entry._unparsed))}</pre>`;
  }

  const rawBlock = html`
    <details class="session-detail__raw">
      <summary>raw JSON</summary>
      <pre class="session-raw">${escapeHtml(prettyJson(entry))}</pre>
    </details>`;

  // ── message entries: the rich layout ──
  if (isMessageEntry(entry, agent)) {
    let role, model, content;
    if (agent === "claude-code") {
      const m = entry.message || {};
      role = m.role || entry.type;
      model = m.model;
      content = m.content;
    } else {
      const p = entry.payload || {};
      role = p.role || "assistant";
      model = p.model;
      content = p.content;
    }
    return html`
      <div class="session-msg">
        <div class="session-msg__head">
          <span class="session-msg__role badge cat-${escapeHtml(categorize(entry, agent))}">${escapeHtml(role)}</span>
          ${model ? `<span class="session-msg__model">${escapeHtml(model)}</span>` : ""}
          ${entry.timestamp ? `<span class="session-msg__ts">${escapeHtml(String(entry.timestamp))}</span>` : ""}
        </div>
        <div class="session-msg__body">${renderMessageContent(content)}</div>
      </div>
      ${rawBlock}`;
  }

  // ── known non-message types: a <dl> of notable scalars + collapsed raw ──
  const NOTABLE = [
    "type", "subtype", "summary", "lastPrompt", "permissionMode", "hookName",
    "hook_event_name", "timestamp", "uuid", "parentUuid", "sessionId", "version",
    "gitBranch", "cwd", "userType", "isSidechain", "requestId", "model", "id",
    "leafUuid", "level", "toolUseID", "isMeta", "isCompactSummary", "isApiErrorMessage",
  ];
  const rows = [];
  const seen = new Set();
  const pushRow = (k, v) => {
    if (seen.has(k)) return;
    if (v === undefined || v === null || v === "") return;
    if (typeof v === "object") return; // scalars only here
    seen.add(k);
    rows.push(html`<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`);
  };
  for (const k of NOTABLE) pushRow(k, entry[k]);
  // codex payloads: surface a few scalar fields from the nested payload too
  if (entry.payload && typeof entry.payload === "object" && !Array.isArray(entry.payload)) {
    for (const k of ["type", "id", "role", "name", "status", "call_id", "model", "summary"]) {
      pushRow("payload." + k, entry.payload[k]);
    }
  }
  if (entry.attachment && typeof entry.attachment === "object" && !Array.isArray(entry.attachment)) {
    for (const k of ["type", "hookName", "hook_event_name"]) pushRow("attachment." + k, entry.attachment[k]);
  }
  // any remaining top-level scalars not already shown
  for (const [k, v] of Object.entries(entry)) {
    if (typeof v !== "object") pushRow(k, v);
  }

  if (rows.length === 0) {
    // nothing scalar to show — fall back to pretty JSON only
    return html`<pre class="session-raw">${escapeHtml(prettyJson(entry))}</pre>`;
  }
  return html`
    <dl class="session-detail__dl">${rows.join("")}</dl>
    ${rawBlock}`;
}

/** Build the per-session metadata header from a sessions-list entry (or nulls). */
function renderSessionMeta(sessionId, listEntry, lineCount) {
  const cfg = (listEntry && listEntry.config) || {};
  const started = cfg.startedAt || (listEntry && listEntry.received_ts) || null;
  const startedLabel = cfg.startedAt ? "started" : "received";
  const rows = [
    ["session id", sessionId, true],
    ["agent", (listEntry && listEntry.agent) || "unknown", false],
    ["agent version", cfg.version, false],
    ["model", cfg.model, false],
    ["git branch", cfg.gitBranch, false],
    [startedLabel, started ? fmtTs(started) : null, false],
    ["cwd", cfg.cwd || (listEntry && listEntry.cwd), true],
    ["lines", String(lineCount), false],
    ["size", listEntry ? fmtBytes(listEntry.size_bytes) : null, false],
    ["originator", cfg.originator, false],
  ].filter(([, v]) => v !== undefined && v !== null && v !== "");
  return html`<dl class="session-head__dl">${
    rows.map(([k, v, mono]) => html`<dt>${escapeHtml(k)}</dt><dd class="${mono ? "mono" : ""}">${escapeHtml(String(v))}</dd>`).join("")
  }</dl>`;
}

// Parse JSONL text → entries. Blank lines dropped; unparsable lines kept as
// { _unparsed: <raw line> }. The source line# of each kept entry is tracked.
function parseJsonl(text) {
  const entries = [];
  String(text ?? "").split("\n").forEach((ln, i) => {
    if (ln.trim() === "") return;
    let parsed;
    try { parsed = JSON.parse(ln); }
    catch { parsed = { _unparsed: ln }; }
    entries.push({ lineNo: i + 1, entry: parsed });
  });
  return entries;
}

// Render a JSONL transcript — a session or one of its subagents — into $app:
// a crumbs line, masthead, optional head/extra HTML, then the Structured/Raw
// tabbed two-pane browser. `crumbs`, `headHtml` and `extraHtml` are trusted
// HTML strings; `kicker` and `title` are escaped here.
function renderTranscriptInto({ crumbs, kicker, title, headHtml, extraHtml, text, entries, agent, downloadUrl }) {
  $app.innerHTML = html`
    ${crumbs}
    <header class="detail__masthead">
      <p class="kicker">${escapeHtml(kicker)}</p>
      <h1 class="detail__title mono">${escapeHtml(title)}</h1>
    </header>

    ${headHtml || ""}
    ${extraHtml || ""}

    <div class="session-tabs" role="tablist">
      <button class="session-tab active" data-tab="structured" role="tab" aria-selected="true">Structured</button>
      <button class="session-tab" data-tab="raw" role="tab" aria-selected="false">Raw</button>
      <a class="session-tabs__dl" href="${escapeHtml(downloadUrl)}" download>↓ download</a>
    </div>

    <section class="session-panel" data-panel="structured">
      ${entries.length === 0
        ? `<p class="empty">This file has no parseable lines.</p>`
        : html`
          <div class="session-view">
            <ul class="session-list" role="listbox">
              ${entries.map(({ lineNo, entry }, idx) => {
                const cat = categorize(entry, agent);
                return html`
                  <li class="session-list__row${idx === 0 ? " selected" : ""}" data-idx="${idx}" role="option" aria-selected="${idx === 0 ? "true" : "false"}">
                    <span class="session-list__ln">${lineNo}</span>
                    <span class="badge cat-${escapeHtml(cat)}">${escapeHtml(badgeLabel(entry, agent))}</span>
                    <span class="session-list__preview">${escapeHtml(previewLine(entry, agent))}</span>
                  </li>`;
              }).join("")}
            </ul>
            <div class="session-detail" id="session-detail"></div>
          </div>`
      }
    </section>

    <section class="session-panel" data-panel="raw" hidden>
      <div class="code-view__wrap">${renderCodeView(text, downloadUrl)}</div>
    </section>
  `;

  // ── wire the tabs ──
  const panels = $app.querySelectorAll(".session-panel");
  for (const btn of $app.querySelectorAll(".session-tab")) {
    btn.addEventListener("click", () => {
      const which = btn.dataset.tab;
      for (const t of $app.querySelectorAll(".session-tab")) {
        const on = t === btn;
        t.classList.toggle("active", on);
        t.setAttribute("aria-selected", on ? "true" : "false");
      }
      for (const p of panels) p.hidden = p.dataset.panel !== which;
    });
  }

  // ── wire the left list → detail pane ──
  const detailEl = $app.querySelector("#session-detail");
  const rows = [...$app.querySelectorAll(".session-list__row")];
  const select = (idx) => {
    const item = entries[idx];
    if (!item || !detailEl) return;
    for (const r of rows) {
      const on = Number(r.dataset.idx) === idx;
      r.classList.toggle("selected", on);
      r.setAttribute("aria-selected", on ? "true" : "false");
    }
    detailEl.innerHTML = renderEntryDetail(item.entry, agent, item.lineNo);
    detailEl.scrollTop = 0;
  };
  for (const r of rows) {
    r.addEventListener("click", () => select(Number(r.dataset.idx)));
  }
  if (entries.length > 0) select(0);
}

// Sidecar files arrive as a flat list of { rel_path, size_bytes }. The subagent
// transcripts (subagents/agent-*.jsonl) get their own browsable section; the
// rest (tool-results/*) are uploaded for completeness but not surfaced here.
function renderSubagentsSection(projectId, sessionId, files) {
  const subs = files
    .filter((f) => f && typeof f.rel_path === "string"
      && f.rel_path.startsWith("subagents/") && f.rel_path.endsWith(".jsonl"))
    .sort((a, b) => a.rel_path.localeCompare(b.rel_path));
  if (subs.length === 0) return "";
  const encId = encodeURIComponent(projectId);
  const encSid = encodeURIComponent(sessionId);
  return html`
    <details class="session-subagents" open>
      <summary>${subs.length} subagent ${subs.length === 1 ? "transcript" : "transcripts"}</summary>
      <ul class="section__list">
        ${subs.map((f) => {
          const file = f.rel_path.slice("subagents/".length);
          const id = file.replace(/\.jsonl$/, "");
          return html`<li><a class="section__row" href="#/projects/${encId}/sessions/${encSid}/sub/${encodeURIComponent(file)}">
            <span class="name mono">${escapeHtml(id)}</span>
            <span class="meta">subagent · ${fmtBytes(f.size_bytes)}</span>
          </a></li>`;
        }).join("")}
      </ul>
    </details>`;
}

async function routeSession(projectId, sessionId) {
  const encId = encodeURIComponent(projectId);
  const encSid = encodeURIComponent(sessionId);
  const url = `/api/projects/${encId}/sessions/${encSid}`;
  // Fetch the raw content, the sessions list (for the metadata header) and the
  // sidecar file list in parallel. The latter two are best-effort — the page
  // still renders without them.
  const [text, list, files] = await Promise.all([
    fetchText(url),
    fetchJson(`/api/projects/${encId}/sessions`).catch(() => []),
    fetchJson(`${url}/files`).catch(() => []),
  ]);
  const listEntry = Array.isArray(list)
    ? list.find((s) => s && s.session_id === sessionId) || null
    : null;
  const agent = (listEntry && listEntry.agent) || "unknown";
  const entries = parseJsonl(text);

  const crumbs = html`
    <p class="crumbs">
      <a href="#/projects">Projects</a><span class="sep">/</span>
      <a href="#/projects/${encId}">${escapeHtml(projectId)}</a><span class="sep">/</span>
      <a href="#/projects/${encId}/sessions">Sessions</a><span class="sep">/</span>
      <span class="mono">${escapeHtml(sessionId)}</span>
    </p>`;
  renderTranscriptInto({
    crumbs,
    kicker: `${projectId} · session · ${agent}`,
    title: sessionId,
    headHtml: html`<div class="session-head">${renderSessionMeta(sessionId, listEntry, entries.length)}</div>`,
    extraHtml: renderSubagentsSection(projectId, sessionId, Array.isArray(files) ? files : []),
    text,
    entries,
    agent,
    downloadUrl: url,
  });
}

// A subagent transcript is itself a Claude Code JSONL file living at
// subagents/<agentFile> in the parent session's sidecar dir; its sibling
// .meta.json carries the agent type + dispatch description.
async function routeSubagent(projectId, sessionId, agentFile) {
  const file = decodeURIComponent(agentFile);
  const encId = encodeURIComponent(projectId);
  const encSid = encodeURIComponent(sessionId);
  const filesBase = `/api/projects/${encId}/sessions/${encSid}/files`;
  const jsonlUrl = `${filesBase}?path=${encodeURIComponent("subagents/" + file)}`;
  const metaUrl = `${filesBase}?path=${encodeURIComponent("subagents/" + file.replace(/\.jsonl$/, ".meta.json"))}`;
  const [text, metaText] = await Promise.all([
    fetchText(jsonlUrl),
    fetchText(metaUrl).catch(() => null),
  ]);
  let meta = null;
  if (metaText) { try { meta = JSON.parse(metaText); } catch { meta = null; } }
  const id = file.replace(/\.jsonl$/, "");
  const entries = parseJsonl(text);

  const crumbs = html`
    <p class="crumbs">
      <a href="#/projects">Projects</a><span class="sep">/</span>
      <a href="#/projects/${encId}">${escapeHtml(projectId)}</a><span class="sep">/</span>
      <a href="#/projects/${encId}/sessions">Sessions</a><span class="sep">/</span>
      <a href="#/projects/${encId}/sessions/${encSid}">${escapeHtml(sessionId)}</a><span class="sep">/</span>
      <span class="mono">${escapeHtml(id)}</span>
    </p>`;
  const metaRows = [
    ["agent type", meta && meta.agentType],
    ["description", meta && meta.description],
    ["tool use id", meta && meta.toolUseId],
    ["lines", String(entries.length)],
  ].filter(([, v]) => v !== undefined && v !== null && v !== "");
  const headHtml = html`<div class="session-head"><dl class="session-head__dl">${
    metaRows.map(([k, v]) => html`<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(String(v))}</dd>`).join("")
  }</dl></div>`;

  renderTranscriptInto({
    crumbs,
    kicker: `${projectId} · subagent of ${sessionId}`,
    title: id,
    headHtml,
    text,
    entries,
    agent: "claude-code",
    downloadUrl: jsonlUrl,
  });
}

// ─── Project · Work log ────────────────────────────────────────────────

async function routeProjectWorklog(projectId) {
  const list = await fetchJson(`/api/projects/${encodeURIComponent(projectId)}/worklog`);
  $app.innerHTML = html`
    <p class="crumbs">
      <a href="#/projects">Projects</a><span class="sep">/</span>
      <a href="#/projects/${encodeURIComponent(projectId)}">${escapeHtml(projectId)}</a><span class="sep">/</span>
      Work log
    </p>
    <header class="detail__masthead">
      <p class="kicker">${escapeHtml(projectId)} · raw work-log entries</p>
      <h1 class="detail__title">Work log</h1>
      <div class="detail__meta">
        <span><strong>${list.length}</strong> ${list.length === 1 ? "entry" : "entries"}</span>
      </div>
    </header>
    ${list.length === 0
      ? `<p class="empty">No work-log entries uploaded for this project yet.</p>`
      : html`<ul class="worklog-list">${
          list.map(e => {
            const range = fmtRange(e.work_started_at, e.work_ended_at);
            const kind = e.kind || "note";
            return html`
              <li class="worklog-row">
                <a class="worklog-row__link" href="#/projects/${encodeURIComponent(projectId)}/worklog/${encodeURIComponent(e.entry_id)}">
                  <div class="worklog-row__head">
                    <span class="worklog-row__kind">${escapeHtml(kind)}</span>
                    ${range ? `<span class="worklog-row__time">${escapeHtml(range)}</span>` : ""}
                  </div>
                  <div class="worklog-row__summary">${e.summary ? escapeHtml(truncate(e.summary, 180)) : '<span class="muted">(no summary)</span>'}</div>
                  <div class="worklog-row__id mono">${escapeHtml(e.entry_id)}</div>
                </a>
              </li>
            `;
          }).join("")
        }</ul>`
    }
  `;
}

async function routeWorklogEntry(projectId, entryId) {
  const url = `/api/projects/${encodeURIComponent(projectId)}/worklog/${encodeURIComponent(entryId)}`;
  const text = await fetchText(url);
  $app.innerHTML = html`
    <p class="crumbs">
      <a href="#/projects">Projects</a><span class="sep">/</span>
      <a href="#/projects/${encodeURIComponent(projectId)}">${escapeHtml(projectId)}</a><span class="sep">/</span>
      <a href="#/projects/${encodeURIComponent(projectId)}/worklog">Work log</a><span class="sep">/</span>
      <span class="mono">${escapeHtml(entryId)}</span>
    </p>
    <header class="detail__masthead">
      <p class="kicker">${escapeHtml(projectId)} · work-log entry</p>
      <h1 class="detail__title mono">${escapeHtml(entryId)}</h1>
    </header>
    <div class="code-view__wrap">${renderCodeView(text, url)}</div>
  `;
}

// ─── Report viewer ─────────────────────────────────────────────────────

async function routeReport(projectId, date, username) {
  const data = await fetchJson(
    `/api/projects/${encodeURIComponent(projectId)}/dates/${date}/users/${encodeURIComponent(username)}`
  );
  // Strip the JSON frontmatter from the markdown body before rendering
  const body = stripFrontmatter(data.content);
  const renderedHtml = marked.parse(body);

  const meta = data.meta || {};
  // Sidecar entries (when present): render below the body so a reader can
  // expand the original thinking-layer fields even if the rendered markdown
  // skipped them. New reports submitted by post-source_entries-wire clients
  // have this; legacy submissions return [] and we hide the section.
  const entries = Array.isArray(data.entries) ? data.entries : [];
  // Prefer the sidecar's display_name (e.g. "Brian Lee") over the URL slug
  // (e.g. "brian"). Falls back when the sidecar is legacy / missing.
  const displayName = meta.display_name || username;

  $app.innerHTML = html`
    <p class="crumbs">
      <a href="#/projects">Projects</a><span class="sep">/</span>
      <a href="#/projects/${encodeURIComponent(projectId)}">${escapeHtml(projectId)}</a><span class="sep">/</span>
      <a href="#/projects/${encodeURIComponent(projectId)}/dates/${date}">${fmtDate(date)}</a><span class="sep">/</span>
      ${escapeHtml(displayName)}
    </p>

    <header class="detail__masthead">
      <p class="kicker">${escapeHtml(displayName)} on ${escapeHtml(projectId)}</p>
      <h1 class="detail__title">${fmtDateLong(date)}${date === todayIso() ? '<span class="badge-today">today</span>' : ''}</h1>
      <p class="report-meta-line">
        ${escapeHtml(meta.format || "daily")} · ${meta.payload_size_bytes ?? 0} bytes · sha256 ${escapeHtml(String(meta.payload_sha256 || "").slice(0, 12))}…
      </p>
    </header>

    <div class="detail__body detail__body--with-aside">
      <div class="detail__main">
        <article class="report-body">
          ${renderedHtml}
        </article>
        ${renderSourceEntries(entries)}
      </div>
      <aside class="detail__aside">
        <dl>
          <dt>Submitted</dt>
          <dd>${fmtTs(meta.received_ts)}</dd>
          <dt>Client wrote</dt>
          <dd>${fmtTs(meta.client_ts)}</dd>
          <dt>Format</dt>
          <dd>${escapeHtml(meta.format || "daily")}</dd>
          ${meta.language ? html`<dt>Language</dt><dd>${escapeHtml(meta.language)}</dd>` : ""}
          <dt>Size</dt>
          <dd>${meta.payload_size_bytes ?? 0} bytes</dd>
          <dt>SHA-256</dt>
          <dd>${escapeHtml(meta.payload_sha256 || "—")}</dd>
          ${(meta.source_entry_ids && meta.source_entry_ids.length) ? html`
            <dt>Source entries</dt>
            <dd>${meta.source_entry_ids.map(escapeHtml).join("<br>")}</dd>
          ` : ""}
          <dt>Filename</dt>
          <dd>${escapeHtml(meta.filename || "—")}</dd>
        </dl>
      </aside>
    </div>
  `;
}

/**
 * Render the sidecar source-entries panel as a collapsed <details>.
 * Returns "" when there are no entries — old submissions never see the
 * empty-state rectangle.
 *
 * Each entry shows id + kind + work-period in the header, summary as
 * the lede, then a <dl> of present-only thinking fields. Refs land in
 * a small monospace footer. The panel sits between the rendered
 * markdown and the meta sidebar so a curious reader can drill in
 * without losing the report's main flow.
 */
function renderSourceEntries(entries) {
  if (!entries || entries.length === 0) return "";

  const fmtTimeRange = (e) => {
    if (e.work_started_at && e.work_ended_at && e.work_started_at !== e.work_ended_at) {
      return `${escapeHtml(e.work_started_at)} → ${escapeHtml(e.work_ended_at)}`;
    }
    if (e.work_started_at) return escapeHtml(e.work_started_at);
    if (e.work_ended_at) return escapeHtml(e.work_ended_at);
    return "";
  };

  const renderField = (label, value, kind = "scalar") => {
    if (value === undefined || value === null || value === "" ||
        (Array.isArray(value) && value.length === 0)) return "";
    let body;
    if (kind === "list") {
      body = `<ul>${value.map((v) => `<li>${escapeHtml(String(v))}</li>`).join("")}</ul>`;
    } else {
      body = escapeHtml(String(value));
    }
    return html`<dt>${escapeHtml(label)}</dt><dd>${body}</dd>`;
  };

  const renderRefs = (refs) => {
    if (!refs || typeof refs !== "object") return "";
    const pairs = Object.entries(refs).filter(([, v]) => v !== null && v !== "" && v !== undefined);
    if (pairs.length === 0) return "";
    return html`
      <footer class="se-refs">
        ${pairs.map(([k, v]) => html`<span class="se-ref"><em>${escapeHtml(k)}</em> ${escapeHtml(String(v))}</span>`).join("")}
      </footer>
    `;
  };

  const items = entries.map((e) => {
    const tr = fmtTimeRange(e);
    return html`
      <li class="source-entry">
        <header class="se-header">
          <code>${escapeHtml(e.id || "")}</code>
          <span class="se-kind">${escapeHtml(e.kind || "")}</span>
          ${tr ? html`<span class="se-time">${tr}</span>` : ""}
        </header>
        ${e.summary ? html`<div class="se-summary">${escapeHtml(e.summary)}</div>` : ""}
        <dl class="se-fields">
          ${renderField("Motivation", e.motivation)}
          ${renderField("Approach", e.approach)}
          ${renderField("Attempts", e.attempts, "list")}
          ${renderField("Lessons", e.lessons, "list")}
          ${renderField("Decisions", e.decisions, "list")}
          ${renderField("Next steps", e.next_steps, "list")}
          ${e.tags && e.tags.length ? html`<dt>Tags</dt><dd>${e.tags.map((t) => `<span class="se-tag">${escapeHtml(t)}</span>`).join(" ")}</dd>` : ""}
        </dl>
        ${renderRefs(e.refs)}
      </li>
    `;
  }).join("");

  return html`
    <details class="source-entries">
      <summary><span class="kicker">Original entries (${entries.length})</span></summary>
      <ul class="source-entries__list">${items}</ul>
    </details>
  `;
}

function stripFrontmatter(text) {
  // Reports begin with "---\n{json}\n---\n\n<body>". Drop the first JSON block.
  if (!text || !text.startsWith("---")) return text || "";
  const parts = text.split("---", 3);
  // parts[0] == "", parts[1] == "\n<json>\n", parts[2] == "\n\n<body>"
  if (parts.length < 3) return text;
  return parts[2].replace(/^\s+/, "");
}

// ─── User list ─────────────────────────────────────────────────────────

async function routeUsers() {
  const users = await fetchJson("/api/users");
  $app.innerHTML = html`
    <header class="detail__masthead">
      <p class="kicker">Index</p>
      <h1 class="detail__title">Contributors</h1>
      <div class="detail__meta">
        <span><strong>${users.length}</strong> total</span>
      </div>
    </header>
    ${users.length === 0
      ? `<p class="empty">No contributors yet.</p>`
      : html`<ul class="section__list">${
          users.map(u => html`
            <li><a class="section__row" href="#/users/${encodeURIComponent(u.username)}">
              <span class="name">${escapeHtml(u.display_name || u.username)}</span>
              <span class="meta">${u.project_count} projects · ${u.date_count} days${u.latest_submission_ts ? " · last " + fmtRelativeDate(u.latest_submission_ts.slice(0, 10)) : ""}</span>
            </a></li>
          `).join("")
        }</ul>`
    }
  `;
}

// ─── User detail ───────────────────────────────────────────────────────

async function routeUserDetail(username) {
  const user = await fetchJson(`/api/users/${encodeURIComponent(username)}`);
  // For each date, get the project rows
  const dateRows = await Promise.all(
    user.dates.map(async (d) => ({
      date: d,
      list: await fetchJson(`/api/users/${encodeURIComponent(username)}/dates/${d}`),
    }))
  );

  $app.innerHTML = html`
    <p class="crumbs"><a href="#/users">Contributors</a></p>

    <header class="detail__masthead">
      <p class="kicker">Contributor</p>
      <h1 class="detail__title">${escapeHtml(user.display_name || user.username)}</h1>
      <div class="detail__meta">
        <span><strong>${user.projects.length}</strong> ${user.projects.length === 1 ? "project" : "projects"}</span>
        <span><strong>${user.dates.length}</strong> ${user.dates.length === 1 ? "day" : "days"}</span>
      </div>
    </header>

    ${dateRows.length === 0
      ? `<p class="empty">No submissions yet.</p>`
      : html`<div class="dates">${
          dateRows.map(({ date, list }) => html`
            <div class="dates__date">${fmtDate(date)}${date === todayIso() ? '<span class="badge-today">today</span>' : ''}</div>
            <div class="dates__contributors">
              ${list.map(item => html`
                <a class="dates__contrib" href="#/projects/${encodeURIComponent(item.project_id)}/dates/${date}/users/${encodeURIComponent(username)}">
                  <span class="dates__name">${escapeHtml(item.project_id)}</span>
                  <span class="dates__sub">${item.meta?.format || "daily"} · ${(item.meta?.payload_size_bytes ?? 0)}b</span>
                </a>
              `).join("")}
            </div>
          `).join("")
        }</div>`
    }
  `;
}

// ─── User × Date ───────────────────────────────────────────────────────

async function routeUserDate(username, date) {
  const list = await fetchJson(`/api/users/${encodeURIComponent(username)}/dates/${date}`);
  // The URL path carries only the slug; pull the display name from any list
  // entry's sidecar so the header reads naturally. Falls back to the slug
  // when the user has no entries on this date (list empty) or when sidecars
  // predate display_name.
  const displayName = list[0]?.display_name || username;
  $app.innerHTML = html`
    <p class="crumbs">
      <a href="#/users">Contributors</a><span class="sep">/</span>
      <a href="#/users/${encodeURIComponent(username)}">${escapeHtml(displayName)}</a><span class="sep">/</span>
      ${fmtDate(date)}
    </p>
    <header class="detail__masthead">
      <p class="kicker">${escapeHtml(displayName)} · day</p>
      <h1 class="detail__title">${fmtDateLong(date)}</h1>
    </header>
    ${list.length === 0
      ? `<p class="empty">No submissions on this day.</p>`
      : html`<div class="dates"><div class="dates__date">Projects</div><div class="dates__contributors">${
          list.map(item => html`
            <a class="dates__contrib" href="#/projects/${encodeURIComponent(item.project_id)}/dates/${date}/users/${encodeURIComponent(username)}">
              <span class="dates__name">${escapeHtml(item.project_id)}</span>
              <span class="dates__sub">${item.meta?.format || "daily"} · ${(item.meta?.payload_size_bytes ?? 0)}b</span>
            </a>
          `).join("")}
        }</div></div>`
    }
  `;
}

// ─── By date (timeline across all projects/users) ──────────────────────

async function routeDates() {
  // Walk projects → dates → contributors, group everything into a timeline
  const projects = await fetchJson("/api/projects");
  const byDate = {};
  await Promise.all(projects.map(async (p) => {
    const detail = await fetchJson(`/api/projects/${encodeURIComponent(p.project_id)}`).catch(() => null);
    if (!detail) return;
    await Promise.all(detail.dates.map(async (date) => {
      const list = await fetchJson(`/api/projects/${encodeURIComponent(p.project_id)}/dates/${date}`).catch(() => []);
      for (const item of list) {
        byDate[date] = byDate[date] || [];
        byDate[date].push({ project_id: p.project_id, ...item });
      }
    }));
  }));
  const dates = Object.keys(byDate).sort().reverse();

  $app.innerHTML = html`
    <header class="detail__masthead">
      <p class="kicker">Index</p>
      <h1 class="detail__title">By Date</h1>
      <div class="detail__meta">
        <span><strong>${dates.length}</strong> ${dates.length === 1 ? "day" : "days"}</span>
        <span><strong>${dates.reduce((n, d) => n + byDate[d].length, 0)}</strong> reports</span>
      </div>
    </header>
    ${dates.length === 0
      ? `<p class="empty">No submissions yet.</p>`
      : html`<div class="dates">${
          dates.map(date => html`
            <div class="dates__date">${fmtDate(date)}${date === todayIso() ? '<span class="badge-today">today</span>' : ''}</div>
            <div class="dates__contributors">
              ${byDate[date].map(item => html`
                <a class="dates__contrib" href="#/projects/${encodeURIComponent(item.project_id)}/dates/${date}/users/${encodeURIComponent(item.username)}">
                  <span class="dates__name"><em>${escapeHtml(item.project_id)}</em> · ${escapeHtml(item.display_name || item.username)}</span>
                  <span class="dates__sub">${item.meta?.format || "daily"} · ${(item.meta?.payload_size_bytes ?? 0)}b</span>
                </a>
              `).join("")}
            </div>
          `).join("")
        }</div>`
    }
  `;
}

