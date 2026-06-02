// Observation console — vanilla ES module, no deps.
// Reads /api/observations + /api/observations/episode; writes project config via
// POST /api/observations/config. Renders a typeset ledger of where the user
// injected direction, plus a Settings view.

const main = document.querySelector('#main');
const body = document.body;

// ── theme ────────────────────────────────────────────────────────────────
const THEME_KEY = 'cj-theme';
function applyTheme(t) {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
applyTheme(localStorage.getItem(THEME_KEY));
document.querySelector('.theme-toggle')?.addEventListener('click', () => {
  const cur = document.documentElement.dataset.theme;
  const sysDark = matchMedia('(prefers-color-scheme: dark)').matches;
  const next = cur ? (cur === 'dark' ? 'light' : 'dark') : sysDark ? 'light' : 'dark';
  applyTheme(next);
  localStorage.setItem(THEME_KEY, next);
});
document.querySelector('#settings-btn')?.addEventListener('click', () => {
  location.hash = location.hash.startsWith('#/settings') ? '#/' : '#/settings';
});

// ── helpers ────────────────────────────────────────────────────────────────
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function langAttr(text) {
  const cjk = (String(text).match(/[一-鿿぀-ヿ]/g) || []).length;
  return cjk > String(text).length * 0.2 ? ' lang="zh"' : '';
}

function parseFields(payload) {
  const out = {};
  const re = /\*\*([^*]+?)\*\*:\s*([\s\S]*?)(?=\n\*\*[^\n]+?\*\*\s*:|$)/g;
  let m;
  while ((m = re.exec(payload)) !== null) {
    out[m[1].trim().toLowerCase()] = m[2].trim().replace(/^["“「]|["”」]$/g, '').trim();
  }
  return out;
}

const INJECTED = new Set(['engaged', 'overrode', 'ignored']);
const DECLINED = new Set(['assented', 'deferred']);
const STANCE_ORDER = ['engaged', 'overrode', 'ignored', 'assented', 'deferred'];

function model(ev) {
  const f = parseFields(ev.payload || '');
  const lens = ev.lens_id;
  if (lens === 'anchored-deferral') {
    const stance = (f['stance'] || '').toLowerCase().split(/[^a-z]/)[0];
    const dir = INJECTED.has(stance) ? 'injected' : DECLINED.has(stance) ? 'declined' : 'none';
    return {
      anchor: ev.turn_anchor, stance, dir, label: stance || 'stance',
      aiLabel: 'AI decision point', ai: f['anchor verbatim'] || '',
      userLabel: 'You', user: f['user response verbatim'] || '',
      arc: f['anchor (ai salience event)'] ? `Anchor — ${f['anchor (ai salience event)']}` : '',
      why: f['why this stance, not another'] || f['redirected to'] || '',
      refs: ev.source_refs || [], raw: ev.payload || '',
    };
  }
  if (lens === 'user-initiated-pivot') {
    return {
      anchor: ev.turn_anchor, stance: 'pivot', dir: 'injected', label: 'user pivot',
      aiLabel: 'AI (no decision point)', ai: f['event (preceding ai turn — verbatim)'] || f['before'] || '',
      userLabel: 'You steered', user: f['event (user direction — verbatim)'] || '',
      arc: f['arc'] || '', why: f['why this satisfies the criteria'] || '',
      refs: ev.source_refs || [], raw: ev.payload || '',
    };
  }
  return {
    anchor: ev.turn_anchor, stance: 'negative-space', dir: 'injected', label: 'macro pivot',
    aiLabel: 'AI proposed', ai: f['event (ai proposal — verbatim)'] || f['before'] || '',
    userLabel: 'You', user: f['event (user response — verbatim)'] || '',
    arc: f['arc'] || '', why: f['why this satisfies the criteria'] || '',
    refs: ev.source_refs || [], raw: ev.payload || '',
  };
}

function refStr(r) {
  if (r.type === 'turn') return `T${r.id}`;
  if (r.type === 'turn-range') return `T${r.from}–T${r.to}`;
  if (r.type === 'commit') return (r.sha || '').slice(0, 8);
  if (r.type === 'file') return r.path;
  return JSON.stringify(r);
}
function primaryTurn(anchor) { const m = String(anchor).match(/\d+/); return m ? Number(m[0]) : 0; }
function fmtDur(sec) {
  if (sec == null) return '—';
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); }
async function postJSON(url, payload) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `${r.status}`);
  return data;
}

// ── overview ─────────────────────────────────────────────────────────────
function renderOverview(data) {
  const projects = data.projects || [];
  const withEvents = projects.filter((p) => p.events.total > 0);
  const total = projects.reduce((a, p) => a + p.events.total, 0);
  if (projects.length === 0) { main.innerHTML = emptyState(); return; }

  const rows = projects.map((p, i) => {
    const e = p.events;
    const isEmpty = e.total === 0 ? ' is-empty' : '';
    const canOpen = p.latest_episode ? '' : 'disabled';
    return `
      <li class="project-row${isEmpty}" data-animate style="--d:${i * 40}ms">
        <div>
          <button class="project-name" data-pid="${esc(p.id)}" data-n="${p.latest_episode ? p.latest_episode.episode : ''}" ${canOpen}>${esc(p.display_name)}</button>
          <div class="project-byline">
            ${e.total > 0 ? `<span class="n">${e.total}</span> events` : '<span>no events yet</span>'}
            ${e.total > 0 ? `<span>·</span><span>strict ${e['strict-negative-space'] || 0}</span><span>deferral ${e['anchored-deferral'] || 0}</span><span>pivot ${e['user-initiated-pivot'] || 0}</span>` : ''}
            <span>·</span><span>${p.episode_count} ${p.episode_count === 1 ? 'episode' : 'episodes'}</span>
            ${p.latest_episode ? '' : '<span>·</span><span>run compose to read</span>'}
          </div>
        </div>
        <div>${shapeGlyph(p)}</div>
      </li>`;
  }).join('');

  main.innerHTML = `
    <section class="overview">
      <div class="index-head" data-animate>
        <h1>The ledger</h1>
        <span class="byline mono">${withEvents.length} of ${projects.length} projects · ${total} events</span>
      </div>
      <ul class="project-list">${rows}</ul>
      <p class="stance-gloss" data-animate style="--d:240ms">
        Each mark is one event where you set direction. Ink for direction
        <b>injected</b>; faint for <b>declined</b>. Pick a project to read its audit.
      </p>
    </section>`;

  main.querySelectorAll('.project-name:not([disabled])').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pid = btn.dataset.pid, n = btn.dataset.n;
      if (n) location.hash = `#/p/${encodeURIComponent(pid)}/${n}`;
    });
  });
  stagger();
}

function shapeGlyph(p) {
  const e = p.events;
  if (e.total === 0) return '<span class="shape-cap">—</span>';
  const parts = [
    { k: 'strict-negative-space', n: e['strict-negative-space'] || 0 },
    { k: 'anchored-deferral', n: e['anchored-deferral'] || 0 },
    { k: 'user-initiated-pivot', n: e['user-initiated-pivot'] || 0 },
  ];
  const max = Math.max(1, ...parts.map((x) => x.n));
  const bars = parts.map((x) => {
    const h = 6 + Math.round((x.n / max) * 26);
    const mark = x.k === 'anchored-deferral' ? 'var(--ink-2)' : 'var(--accent)';
    return `<span class="bar" style="height:${h}px;--mark:${mark}" title="${x.k}: ${x.n}"></span>`;
  }).join('');
  return `<div class="shape-glyph">${bars}</div><div class="shape-cap">density</div>`;
}

// ── episode ────────────────────────────────────────────────────────────────
const LENS_META = {
  'strict-negative-space': { title: 'Strict negative-space', blurb: 'Macro pivots — the AI proposed something specific, you didn’t take it, and the work went a different way.' },
  'anchored-deferral': { title: 'Anchored deferral', blurb: 'Your stance where the AI exposed a decision point. Approval (assented/deferred) is kept distinct from engagement.' },
  'user-initiated-pivot': { title: 'User-initiated pivot', blurb: 'Direction you injected with no AI prompt in front of you.', tag: 'experimental' },
};

function renderEpisode(data, pid, n) {
  if (data.error) {
    main.innerHTML = `<p class="empty-note"><strong>Not found.</strong> ${esc(data.error)}. <button class="back-link" id="back">The ledger</button></p>`;
    main.querySelector('#back')?.addEventListener('click', () => { location.hash = '#/'; });
    return;
  }
  const ep = data.episode || {};
  const meas = ep.measurements || {};
  const win = ep.window || null;
  const events = data.events || {};

  const deferral = (events['anchored-deferral'] || []).map(model);
  const stanceCounts = STANCE_ORDER.reduce((a, k) => ((a[k] = 0), a), {});
  deferral.forEach((m) => { if (stanceCounts[m.stance] != null) stanceCounts[m.stance]++; });
  const injectedN = stanceCounts.engaged + stanceCounts.overrode + stanceCounts.ignored;
  const declinedN = stanceCounts.assented + stanceCounts.deferred;

  const allModels = [
    ...(events['strict-negative-space'] || []).map(model),
    ...deferral,
    ...(events['user-initiated-pivot'] || []).map(model),
  ];
  const maxTurn = Math.max(win && win.turns ? win.turns : 0, ...allModels.map((m) => primaryTurn(m.anchor)), 1);

  const tabs = (data.episodes || []).map((e) =>
    `<button class="episode-tab" data-pid="${esc(pid)}" data-n="${e.episode}" ${e.episode === n ? 'aria-current="true"' : ''}>Ep ${e.episode} · ${esc(e.date)}</button>`
  ).join('');

  main.innerHTML = `
    <div class="reader-top" data-animate>
      <button class="back-link" id="back">The ledger</button>
      <div class="episode-tabs">${tabs}</div>
    </div>
    <header class="episode-masthead" data-animate style="--d:40ms">
      <h1>${esc(data.project.display_name)}</h1>
      <div class="episode-dateline">
        <span>Episode ${esc(ep.episode ?? n)}</span>
        ${ep.composed_at ? `<span>composed ${esc(String(ep.composed_at).slice(0, 10))}</span>` : ''}
        ${win && win.turns ? `<span class="accent">${win.turns} turns observed</span>` : ''}
        <span>${allModels.length} events</span>
      </div>
    </header>
    <div class="reader-grid">
      <div class="reading-col">
        ${stanceLedger(stanceCounts, injectedN, declinedN)}
        ${densityStrip(allModels, maxTurn)}
        ${lensSection('strict-negative-space', events)}
        ${lensSection('anchored-deferral', events)}
        ${lensSection('user-initiated-pivot', events)}
      </div>
      <aside class="marginalia" data-animate style="--d:120ms">${marginalia(meas, win, ep, allModels.length)}</aside>
    </div>`;

  main.querySelector('#back')?.addEventListener('click', () => { location.hash = '#/'; });
  main.querySelectorAll('.episode-tab').forEach((b) =>
    b.addEventListener('click', () => { location.hash = `#/p/${encodeURIComponent(b.dataset.pid)}/${b.dataset.n}`; }));
  stagger();
}

function stanceLedger(counts, injectedN, declinedN) {
  const totalDef = injectedN + declinedN;
  if (totalDef === 0) {
    return `<section class="stance-ledger" data-animate><span class="label">Stance distribution</span>
      <p class="stance-gloss">No decision-point responses in this episode.</p></section>`;
  }
  const segs = STANCE_ORDER.filter((k) => counts[k] > 0)
    .map((k) => `<div class="stance-seg" data-k="${k}" style="flex-grow:${counts[k]}" title="${k}: ${counts[k]}"></div>`).join('');
  const keys = STANCE_ORDER.map((k) => {
    const dir = INJECTED.has(k) ? 'injected' : 'declined';
    return `<span class="stance-key ${counts[k] === 0 ? 'zero' : ''}"><span class="swatch" data-k="${k}"></span>${k} <span class="n">${counts[k]}</span> <span class="label" style="letter-spacing:.1em">${dir}</span></span>`;
  }).join('');
  return `
    <section class="stance-ledger" data-animate>
      <span class="label">Stance distribution</span>
      <div class="stance-band" role="img" aria-label="${injectedN} injected, ${declinedN} declined">${segs}</div>
      <div class="stance-keys">${keys}</div>
      <p class="stance-gloss"><b>${injectedN}</b> of ${totalDef} responses injected direction;
        <b>${declinedN}</b> deferred or merely approved. Counts, not a score — stance shape is noisy between runs.</p>
    </section>`;
}

function densityStrip(models, maxTurn) {
  if (models.length === 0) return '';
  const ticks = models.map((m) => {
    const t = primaryTurn(m.anchor);
    const pct = Math.max(0, Math.min(100, (t / maxTurn) * 100));
    const cls = m.dir === 'injected' ? 'injected' : m.dir === 'declined' ? 'declined' : '';
    return `<span class="density-tick ${cls}" style="left:${pct}%;height:${m.dir === 'injected' ? 70 : 45}%" title="${esc(m.anchor)} · ${esc(m.label)}"></span>`;
  }).join('');
  return `
    <section class="density" data-animate style="--d:60ms">
      <span class="label">Where direction landed</span>
      <div class="density-rule" role="img" aria-label="Turn positions of ${models.length} events">${ticks}</div>
      <div class="density-ends"><span>start</span><span>turn ${maxTurn}</span></div>
    </section>`;
}

function marginalia(meas, win, ep, total) {
  const conv = meas.m5_convergence || {};
  const lat = meas.m2_latency_seconds || {};
  const density = meas.m1_anchor_density_per_100t != null
    ? Number(meas.m1_anchor_density_per_100t).toFixed(1)
    : win && win.turns ? ((total / win.turns) * 100).toFixed(1) : null;
  const lv = (ep && ep.source_signals) || [];
  const versions = lv.map((s) => `<div class="marg-row"><span class="k">${esc(String(s.lens_id).replace(/-/g, ' '))}</span><span class="v">${esc(s.lens_version)}</span></div>`).join('');
  const medianLat = lat.median != null ? fmtDur(lat.median) : null;
  return `
    <div class="marg-block">
      <h3>Measurements</h3>
      <div class="marg-row"><span class="k">events</span><span class="v">${total}</span></div>
      ${density ? `<div class="marg-row"><span class="k">density /100t</span><span class="v">${density}</span></div>` : ''}
      <div class="marg-row"><span class="k">convergence</span><span class="v">${conv.convergent ?? 0}/${conv.total_strict ?? 0}</span></div>
      ${medianLat ? `<div class="marg-row"><span class="k">median reply</span><span class="v">${medianLat}</span></div>` : ''}
    </div>
    ${quintileBlock(meas.m6_anchor_positions)}
    ${versions ? `<div class="marg-block"><h3>Lens versions</h3>${versions}</div>` : ''}
    <div class="marg-block">
      <h3>How to read</h3>
      <p style="margin:0;color:var(--ink-3)">A logbook entry, not a dashboard. Counts, not scores. Every quote is verbatim; ungrounded events were dropped before this page.</p>
    </div>`;
}

function quintileBlock(m6) {
  const q = (m6 && m6.quintile_distribution) || null;
  if (!q || !q.length) return '';
  const max = Math.max(1, ...q);
  const bars = q.map((n, i) => {
    const h = 4 + Math.round((n / max) * 26);
    return `<span class="q-bar" style="height:${h}px" title="${['0–20%', '20–40%', '40–60%', '60–80%', '80–100%'][i]}: ${n}"></span>`;
  }).join('');
  return `<div class="marg-block"><h3>Anchor position</h3><div class="q-strip">${bars}</div><div class="q-ends"><span>open</span><span>close</span></div></div>`;
}

function lensSection(lensId, events) {
  const list = events[lensId] || [];
  const meta = LENS_META[lensId];
  const items = list.map(model);
  const inner = items.length ? items.map(eventEntry).join('') : `<p class="lens-empty">No ${meta.title.toLowerCase()} events this episode.</p>`;
  return `
    <section class="lens-section" data-animate>
      <div class="lens-head"><h2>${meta.title}</h2><span class="lens-count mono">${items.length}</span>${meta.tag ? `<span class="lens-tag">${meta.tag}</span>` : ''}</div>
      <p class="lens-blurb">${meta.blurb}</p>
      ${inner}
    </section>`;
}

function eventEntry(m) {
  const dirLabel = m.dir === 'injected' ? 'injected' : m.dir === 'declined' ? 'declined' : '';
  const ai = m.ai ? `<dt>${esc(m.aiLabel)}</dt><dd${langAttr(m.ai)}>${esc(m.ai)}</dd>` : '';
  const user = m.user ? `<dt>${esc(m.userLabel)}</dt><dd class="user"${langAttr(m.user)}>${esc(m.user)}</dd>` : '';
  const refs = (m.refs || []).map((r) => `<span>${esc(refStr(r))}</span>`).join('');
  return `
    <article class="event">
      <div class="event-anchor">${esc(m.anchor)}</div>
      <div class="event-body">
        <span class="event-stance" data-dir="${m.dir}"><span class="dot"></span>${esc(m.label)}${dirLabel ? ` · ${dirLabel}` : ''}</span>
        ${m.arc ? `<p class="event-arc">${esc(m.arc)}</p>` : ''}
        <dl class="verbatim">${ai}${user}</dl>
        <details class="event-more">
          <summary>source &amp; reasoning</summary>
          <div class="event-detail">
            ${m.why ? `<p class="why">${esc(m.why)}</p>` : ''}
            ${refs ? `<div class="refs">${refs}</div>` : ''}
            <pre class="raw">${esc(m.raw)}</pre>
          </div>
        </details>
      </div>
    </article>`;
}

// ── settings ─────────────────────────────────────────────────────────────
function renderSettings(data) {
  const projects = data.projects || [];
  const languages = data.languages || [];
  document.querySelector('#settings-btn')?.setAttribute('aria-current', 'true');
  const rows = projects.map((p, i) => {
    const lv = p.lens_versions || {};
    const versions = Object.entries(lv).map(([k, v]) => `${k.replace(/-/g, ' ')} ${v}`).join(' · ') || '—';
    const langSel = p.analysis_language_auto ? 'auto' : p.analysis_language;
    const autoLabel = (languages.find((l) => l.code === p.analysis_language)?.label) || p.analysis_language;
    const langOpts = [
      `<option value="auto" ${langSel === 'auto' ? 'selected' : ''}>Auto-detect${p.analysis_language_auto ? ` (now: ${esc(autoLabel)})` : ''}</option>`,
      ...languages.map((l) => `<option value="${esc(l.code)}" ${langSel === l.code ? 'selected' : ''}>${esc(l.label)}</option>`),
    ].join('');
    return `
      <div class="settings-project" data-pid="${esc(p.id)}" data-animate style="--d:${i * 40}ms">
        <h2>${esc(p.display_name)}</h2>
        <div class="field-grid">
          <div class="field">
            <label for="lang-${i}">Analysis language</label>
            <select id="lang-${i}" data-k="analysis_language">${langOpts}</select>
            <span class="hint">Language the lenses write findings in. Auto-detect infers it from your own messages; quotes always stay in their original language.</span>
          </div>
          <div class="field">
            <label for="model-${i}">Model</label>
            <select id="model-${i}" data-k="model">
              <option value="sonnet" ${p.config_model === 'opus' ? '' : 'selected'}>sonnet</option>
              <option value="opus" ${p.config_model === 'opus' ? 'selected' : ''}>opus</option>
            </select>
            <span class="hint">Which model applies the lenses. haiku is not allowed.</span>
          </div>
          <div class="field">
            <label for="thr-${i}">Compose threshold</label>
            <input id="thr-${i}" data-k="compose_threshold" type="number" min="1" max="999" value="${esc(p.compose_threshold ?? 10)}" />
            <span class="hint">New events before sync auto-composes an episode.</span>
          </div>
          <div class="field">
            <label>Lens versions</label>
            <span class="ro">${esc(versions)}</span>
            <span class="hint">Read-only — bumped in code when a lens prompt changes.</span>
          </div>
        </div>
        <div class="settings-actions">
          <button class="btn" data-save="${esc(p.id)}">Save</button>
          <span class="save-state" id="save-${i}"></span>
        </div>
      </div>`;
  }).join('');

  main.innerHTML = `
    <section class="settings">
      <button class="back-link" id="back" style="margin-bottom:var(--s4)">The ledger</button>
      <h1 data-animate>Settings</h1>
      <p class="intro" data-animate style="--d:30ms">Per-project observation config. Stored locally in
        <span class="mono">~/.code-journal/observations/&lt;project&gt;/state.json</span>; nothing leaves your machine.</p>
      ${projects.length ? rows : '<p class="empty-note">No projects yet. Run <code>code-journal sync</code> first.</p>'}
    </section>`;

  main.querySelector('#back')?.addEventListener('click', () => { location.hash = '#/'; });
  main.querySelectorAll('[data-save]').forEach((btn, i) => {
    btn.addEventListener('click', async () => {
      const wrap = btn.closest('.settings-project');
      const pid = btn.dataset.save;
      const model = wrap.querySelector('[data-k="model"]').value;
      const thr = Number(wrap.querySelector('[data-k="compose_threshold"]').value);
      const analysis_language = wrap.querySelector('[data-k="analysis_language"]').value;
      const state = wrap.querySelector('.save-state');
      btn.disabled = true; state.className = 'save-state'; state.textContent = 'saving…';
      try {
        await postJSON('/api/observations/config', { pid, model, compose_threshold: thr, analysis_language });
        state.className = 'save-state ok'; state.textContent = 'saved ✓';
        setTimeout(() => route(), 600); // re-render: lang change flips auto + the "now:" label
      } catch (err) {
        state.className = 'save-state'; state.textContent = `error: ${err.message}`;
      } finally {
        btn.disabled = false;
        setTimeout(() => { if (state.textContent.startsWith('saved')) state.textContent = ''; }, 2500);
      }
    });
  });
  // Upgrade the language / model <select>s to the styled dropdown. They keep
  // their data-k + value, so the Save handlers above read them unchanged.
  if (window.CJSelect) window.CJSelect.enhanceAll(main);
  stagger();
}

function emptyState() {
  return `
    <div class="empty-note">
      <p><strong>No observations yet.</strong></p>
      <p>The observation lens reads your coding-agent sessions and surfaces where
      you set the direction. Run a scan, then come back:</p>
      <p><code>code-journal sync</code> &nbsp;→&nbsp; <code>code-journal compose --project &lt;name&gt;</code></p>
      <p>See <code>docs/observation-lens.md</code> for the full guide.</p>
    </div>`;
}

function stagger() {
  main.querySelectorAll('[data-animate]').forEach((el, i) => {
    const d = el.style.getPropertyValue('--d') || `${i * 30}ms`;
    setTimeout(() => el.classList.add('in'), parseFloat(d) || i * 30);
  });
}

// ── router ─────────────────────────────────────────────────────────────────
async function route() {
  const hash = location.hash.replace(/^#/, '');
  document.querySelector('#settings-btn')?.removeAttribute('aria-current');
  body.dataset.view = 'busy';
  try {
    const mEp = hash.match(/^\/p\/([^/]+)\/(\d+)/);
    if (hash.startsWith('/settings')) {
      const data = await getJSON('/api/observations');
      renderSettings(data);
      document.title = 'Settings — Observation';
    } else if (mEp) {
      const pid = decodeURIComponent(mEp[1]);
      const n = Number(mEp[2]);
      const data = await getJSON(`/api/observations/episode?pid=${encodeURIComponent(pid)}&n=${n}`);
      renderEpisode(data, pid, n);
      document.title = `${data.project?.display_name ?? pid} · Ep ${n} — Observation`;
    } else {
      const data = await getJSON('/api/observations');
      renderOverview(data);
      document.title = 'Observation — code-journal';
    }
  } catch (err) {
    main.innerHTML = `<p class="empty-note"><strong>Couldn’t load.</strong> ${esc(err.message)}.
      Is <code>code-journal</code> running, and have you run a <code>sync</code>?</p>`;
  }
  body.dataset.view = 'ready';
  scrollTo({ top: 0 });
}

addEventListener('hashchange', route);
route();
