/* ===========================================================================
   journal.js — Code Journal web GUI. Vanilla DOM, no dependencies.

   Fetches the journal from GET /api/journal — assembled by @code-journal/core
   from the local coding-agent sessions — and renders it. The day's short line
   and a project's metadata summary are computed here from pure metadata; the
   written narrative (day.story, project.story, phase titles) arrives later
   from the narrative engine and is rendered when present.

   Routes:  #/                          the overview
            #/project/<id>              a project's arc
            #/day/<projectId>/<date>    a single day's entry
   =========================================================================== */
(function () {
  'use strict';

  const view = document.getElementById('view');

  // the journal + indexes — populated once /api/journal has loaded
  let J = null;
  let TODAY = '';
  let RANGE = { start: '', end: '' };
  let projById = new Map();
  let dayMapByProj = new Map();
  let activityByDate = new Map();

  // --- small helpers -------------------------------------------------------
  const MON3 = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONTHL = ['January','February','March','April','May','June','July','August',
    'September','October','November','December'];
  const WD = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const WD3 = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const num = (n) => n.toLocaleString('en-US');
  const dowOf = (s) => new Date(s + 'T00:00:00Z').getUTCDay();
  function fmt(s) {
    const [y, m, d] = s.split('-').map(Number);
    const wd = dowOf(s);
    return { y, m, d, wd, month3: MON3[m - 1], monthLong: MONTHL[m - 1], weekday: WD[wd], wd3: WD3[wd] };
  }
  const timeOf = (iso) => {
    const m = String(iso || '').match(/T(\d{2}):(\d{2})/);
    return m ? m[1] + ':' + m[2] : '—';
  };
  const hrs = (ms) => {
    const h = ms / 3.6e6;
    return h < 1 ? Math.round(ms / 6e4) + ' min' : h.toFixed(h < 10 ? 1 : 0) + ' h';
  };
  const baseName = (p) => String(p || '').split('/').pop();
  /** A headline for a day or a session — engine title, prompt, or a metadata fallback. */
  function titleOf(x) {
    if (x.title) return x.title;
    if (x.openingPrompt) return x.openingPrompt;
    const edited = x.filesEdited || [];
    if (edited.length) {
      const lead = baseName(edited[0]);
      return edited.length > 1 ? lead + ' + ' + (edited.length - 1) + ' more files' : 'Worked on ' + lead;
    }
    return (x.sessionCount ? x.sessionCount + ' sessions' : 'A session') + ' — reading and exploring';
  }

  function shiftDays(ymd, n) {
    const d = new Date(ymd + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function mondayOnOrBefore(ymd) {
    const d = new Date(ymd + 'T00:00:00Z');
    while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  }

  function el(tag, attrs) {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      const v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'html') n.innerHTML = v;
      else if (k === 'data') for (const dk in v) n.dataset[dk] = v[dk];
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v);
    }
    for (let i = 2; i < arguments.length; i++) {
      const kid = arguments[i];
      if (kid == null) continue;
      (Array.isArray(kid) ? kid : [kid]).forEach((c) => {
        if (c == null || c === false) return;
        n.append(c.nodeType ? c : document.createTextNode(String(c)));
      });
    }
    return n;
  }

  /** The metadata one-liner a day card shows — no LLM, just the facts. */
  function daySummary(d) {
    const span = hrs(d.activeMs);
    const lead = d.filesEdited[0] ? baseName(d.filesEdited[0]) : null;
    const second = d.filesEdited[1] ? baseName(d.filesEdited[1]) : null;
    if (d.sessionCount === 1)
      return 'One ' + span + ' session — ' + d.filesEdited.length + ' files, ' + d.commandCount + ' commands.';
    if (lead && second)
      return d.sessionCount + ' sessions, ' + span + ' — ' + lead + ' and ' + second + ' took most of the edits.';
    if (lead)
      return d.sessionCount + ' sessions, ' + span + ' — mostly ' + lead + '.';
    return d.sessionCount + ' sessions, ' + span + ' — reading and tracing, little written.';
  }

  // --- heatmap -------------------------------------------------------------
  function levelOverview(c) { return c <= 0 ? 0 : c === 1 ? 1 : c <= 3 ? 2 : c <= 6 ? 3 : 4; }
  function levelProject(c) { return c <= 0 ? 0 : c >= 4 ? 4 : c; }

  function buildHeatmapGrid(startStr, endStr, getCount, level, onpick, onhover) {
    const start = new Date(startStr + 'T00:00:00Z');
    const end = new Date(endStr + 'T00:00:00Z');
    const totalDays = Math.round((end - start) / 864e5) + 1;
    const weeks = Math.ceil(totalDays / 7);

    const months = el('div', { class: 'heatmap-months' });
    let prevMonth = -1;
    for (let w = 0; w < weeks; w++) {
      const md = new Date(start);
      md.setUTCDate(md.getUTCDate() + w * 7);
      const mo = md.getUTCMonth();
      months.append(el('span', null, mo !== prevMonth ? ((prevMonth = mo), MON3[mo]) : ''));
    }

    const weekdays = el('div', { class: 'heatmap-weekdays' });
    ['Mon', '', 'Wed', '', 'Fri', '', ''].forEach((t) => weekdays.append(el('span', null, t)));

    const grid = el('div', { class: 'heatmap' });
    for (let w = 0; w < weeks; w++) {
      for (let r = 0; r < 7; r++) {
        const idx = w * 7 + r;
        if (idx >= totalDays) { grid.append(el('div', { class: 'tile', data: { empty: '1' } })); continue; }
        const d = new Date(start);
        d.setUTCDate(d.getUTCDate() + idx);
        const ds = d.toISOString().slice(0, 10);
        const count = getCount(ds);
        const f = fmt(ds);
        const tile = el('button', {
          class: 'tile', type: 'button',
          data: { level: String(level(count)) },
          'aria-label': f.weekday + ', ' + f.monthLong + ' ' + f.d + ': ' + count + ' sessions',
          onclick: () => onpick(ds, count),
          onmouseenter: () => onhover(ds, count),
          onfocus: () => onhover(ds, count),
        });
        if (ds === TODAY) tile.dataset.today = '1';
        grid.append(tile);
      }
    }
    return el('div', { class: 'heatmap-grid' }, months, weekdays, grid);
  }

  function heatmapSection(opts) {
    const caption = el('p', { class: 'heatmap-caption', html: opts.summaryHTML });
    const setCap = (ds, count) => { caption.innerHTML = opts.captionFor(ds, count); };
    const grid = buildHeatmapGrid(opts.start, opts.end, opts.getCount, opts.level, opts.onpick, setCap);
    grid.querySelector('.heatmap').addEventListener('mouseleave', () => {
      caption.innerHTML = opts.summaryHTML;
    });
    const swatches = el('div', { class: 'swatches' });
    [0, 1, 2, 3, 4].forEach((l) => swatches.append(el('div', { class: 'tile', data: { level: String(l) } })));
    return el('section', { class: 'almanac' },
      el('div', { class: 'almanac-head' },
        el('div', null,
          el('span', { class: 'section-kicker' }, opts.kicker),
          el('h2', { class: 'section-title' }, opts.title)),
        caption),
      el('div', { class: 'heatmap-frame' }, grid),
      el('div', { class: 'heatmap-legend' },
        el('span', null, 'Quiet'), swatches, el('span', null, 'Intense')));
  }

  // --- reveal stagger ------------------------------------------------------
  function reveal(node, i) {
    node.classList.add('reveal');
    node.style.setProperty('--i', i);
    return node;
  }

  // --- the overview --------------------------------------------------------
  function renderOverview() {
    if (J.projects.length === 0) {
      mount([el('div', { class: 'state' },
        el('p', { class: 'state-line' }, 'No coding-agent sessions found yet.'),
        el('p', { class: 'state-sub' },
          'Run an agent in a git repo, then reopen code-journal — its work will appear here.'))]);
      return;
    }

    const activeDays = J.activity.length;
    const totalSessions = J.activity.reduce((t, a) => t + a.sessionCount, 0);
    const weeks = Math.max(1, Math.round((new Date(RANGE.end) - new Date(RANGE.start)) / 6048e5));

    const almanac = heatmapSection({
      kicker: 'Your coding, day by day',
      title: 'The Almanac',
      start: RANGE.start, end: RANGE.end,
      getCount: (ds) => { const a = activityByDate.get(ds); return a ? a.sessionCount : 0; },
      level: levelOverview,
      onpick: (ds) => {
        const a = activityByDate.get(ds);
        if (!a) return;
        let best = null;
        for (const p of J.projects) {
          const d = dayMapByProj.get(p.projectId).get(ds);
          if (d && (!best || d.sessionCount > best.d.sessionCount)) best = { p, d };
        }
        if (best) go('#/day/' + best.p.projectId + '/' + ds);
      },
      captionFor: (ds, count) => {
        const f = fmt(ds);
        if (count <= 0) return '<b>' + f.wd3 + ', ' + f.month3 + ' ' + f.d + '</b> — a quiet day';
        const a = activityByDate.get(ds);
        return '<b>' + f.wd3 + ', ' + f.month3 + ' ' + f.d + '</b> — ' + count +
          ' session' + (count > 1 ? 's' : '') + ' across ' + a.projectCount +
          ' project' + (a.projectCount > 1 ? 's' : '');
      },
      summaryHTML: '<b>' + num(activeDays) + ' active days</b> over ' + weeks +
        ' weeks — ' + num(totalSessions) + ' sessions in all. Hover a day.',
    });

    // recent stream
    const allDays = [];
    J.projects.forEach((p) => p.days.forEach((d) => allDays.push({ d, p })));
    allDays.sort((a, b) => b.d.date.localeCompare(a.d.date));

    const stream = el('div', { class: 'stream' }, el('span', { class: 'section-kicker' }, 'Lately'));
    allDays.slice(0, 14).forEach(({ d, p }) => {
      const f = fmt(d.date);
      stream.append(el('a', { class: 'day-blurb', href: '#/day/' + p.projectId + '/' + d.date },
        el('span', { class: 'blurb-date' }, f.month3, el('b', null, String(f.d)), f.wd3),
        el('div', null,
          el('div', { class: 'blurb-headline' }, titleOf(d)),
          el('p', { class: 'blurb-narr' }, daySummary(d)),
          el('div', { class: 'blurb-meta' },
            el('span', { class: 'proj' }, p.displayName),
            el('span', null, d.sessionCount + ' session' + (d.sessionCount > 1 ? 's' : '')),
            el('span', null, d.filesEdited.length + ' files'),
            d.commits.length ? el('span', null, d.commits.length + ' commits') : null))));
    });

    // project index, busiest first
    const index = el('aside', { class: 'project-index' }, el('span', { class: 'section-kicker' }, 'Projects'));
    [...J.projects]
      .sort((a, b) => b.totalSessions - a.totalSessions)
      .forEach((p) => {
        const first = fmt(p.firstDate || TODAY);
        const map = dayMapByProj.get(p.projectId);
        const strip = el('div', { class: 'index-strip' });
        for (let i = 35; i >= 0; i--) {
          const ds = shiftDays(TODAY, -i);
          const day = map.get(ds);
          strip.append(el('i', { data: { level: String(levelProject(day ? day.sessionCount : 0)) } }));
        }
        index.append(el('a', { class: 'index-item', href: '#/project/' + p.projectId },
          el('div', { class: 'index-name' }, p.displayName),
          el('div', { class: 'index-arc' },
            'Since ' + first.monthLong + ' ' + first.y + ' · ' +
            num(p.totalSessions) + ' sessions · ' + p.days.length + ' active days'),
          strip));
      });

    mount([
      reveal(almanac, 0),
      reveal(el('div', { class: 'overview-cols' }, stream, index), 1),
    ]);
  }

  // --- a single day's entry -----------------------------------------------
  function buildNarrative(day) {
    const n = el('div', { class: 'narrative' });
    if (Array.isArray(day.story) && day.story.length) {
      day.story.forEach((p) => n.append(el('p', null, p)));
      n.append(el('span', { class: 'narrative-sig' },
        'Recap written by code-journal’s narrative engine — everything else on this page is plain metadata'));
    } else {
      n.append(el('p', null, daySummary(day)));
      n.append(el('span', { class: 'narrative-sig' },
        'A metadata recap — the written narrative comes from the journal’s narrative engine, not yet run'));
    }
    return n;
  }

  function renderDay(projectId, date) {
    const proj = projById.get(projectId);
    const day = proj && dayMapByProj.get(projectId).get(date);
    if (!day) return renderMissing();
    const f = fmt(date);

    const marginBlock = (label, value, big) =>
      el('div', { class: 'margin-block' },
        el('span', { class: 'margin-label' }, label),
        el('span', { class: 'margin-value' + (big ? ' big' : '') }, value));

    const margin = el('aside', { class: 'entry-margin' },
      marginBlock('Sessions', String(day.sessionCount), true),
      marginBlock('Span', timeOf(day.startedAt) + ' – ' + timeOf(day.endedAt)),
      el('div', { class: 'margin-rule' }),
      marginBlock('Files edited', String(day.filesEdited.length)),
      marginBlock('Commands', String(day.commandCount)),
      day.commits.length ? marginBlock('Commits', String(day.commits.length)) : null,
      marginBlock('Active', hrs(day.activeMs)),
      el('div', { class: 'margin-rule' }),
      marginBlock('Agents', day.agents.join(', ')));

    const main = el('div', null,
      el('div', { class: 'date-header' },
        el('div', { class: 'date-weekday' }, f.weekday),
        el('h1', { class: 'date-main' }, f.monthLong + ' ' + f.d),
        el('span', { class: 'date-year' }, String(f.y))),
      el('div', { class: 'entry-headline' }, titleOf(day)),
      buildNarrative(day));

    if (day.commits.length) {
      const cl = el('div', { class: 'commits' },
        el('div', { class: 'sessions-head' },
          day.commits.length + ' commit' + (day.commits.length > 1 ? 's' : '') + ' this day'));
      day.commits.forEach((c) =>
        cl.append(el('div', { class: 'commit' },
          el('span', { class: 'commit-sha' }, c.shortSha),
          el('span', { class: 'commit-subject' }, c.subject))));
      main.append(cl);
    }

    const sessions = el('div', null,
      el('div', { class: 'sessions-head' },
        day.sessionCount + ' session' + (day.sessionCount > 1 ? 's' : '') + ', oldest first'));
    [...day.sessions].reverse().forEach((s) => sessions.append(sessionEl(s)));
    main.append(sessions);

    const idx = proj.days.findIndex((d) => d.date === date);
    main.append(el('nav', { class: 'page-turn' },
      turnLink('prev', 'Previous entry', proj.days[idx + 1], projectId),
      turnLink('next', 'Next entry', proj.days[idx - 1], projectId)));

    mount([
      crumb([['#/', 'Journal'], ['#/project/' + projectId, proj.displayName]], f.monthLong + ' ' + f.d),
      reveal(el('div', { class: 'entry' }, margin, main), 0),
    ]);
  }

  function turnLink(dir, label, day, projectId) {
    if (!day) return el('span', { class: 'turn ' + dir, 'aria-disabled': 'true' },
      el('span', { class: 'turn-label' }, label), el('span', { class: 'turn-date' }, '—'));
    const f = fmt(day.date);
    return el('a', { class: 'turn ' + dir, href: '#/day/' + projectId + '/' + day.date },
      el('span', { class: 'turn-label' }, (dir === 'prev' ? '← ' : '') + label + (dir === 'next' ? ' →' : '')),
      el('span', { class: 'turn-date' }, f.month3 + ' ' + f.d));
  }

  function sessionEl(s) {
    const top = el('div', { class: 'session-top' },
      el('span', { class: 'session-time' }, timeOf(s.startedAt) + '–' + timeOf(s.endedAt)),
      el('span', { class: 'session-agent' }, s.agent),
      el('span', null, s.model || '—'),
      el('span', null, s.userTurns + ' turns' + (s.gitBranch ? ' · ' + s.gitBranch : '')));

    const filesBody = el('div', { class: 'disclosure-body' }, el('div', null, (() => {
      const ul = el('ul', { class: 'file-list' });
      s.filesEdited.forEach((file) => ul.append(el('li', { class: 'edited' }, file)));
      s.filesRead.filter((r) => !s.filesEdited.includes(r))
        .forEach((file) => ul.append(el('li', { class: 'read' }, file)));
      if (!s.filesEdited.length && !s.filesRead.length) ul.append(el('li', null, 'no files touched'));
      return ul;
    })()));
    const cmdBody = el('div', { class: 'disclosure-body' }, el('div', null, (() => {
      const ul = el('ul', { class: 'cmd-list' });
      if (!s.commands.length) ul.append(el('li', null, 'no shell commands'));
      s.commands.forEach((c) => ul.append(el('li', null, c)));
      return ul;
    })()));

    const readOnly = s.filesRead.filter((r) => !s.filesEdited.includes(r)).length;
    return el('div', { class: 'session' }, top,
      el('p', { class: 'session-prompt' }, titleOf(s)),
      el('div', { class: 'disclosure-row' },
        discloseBtn(s.filesEdited.length + ' edited · ' + readOnly + ' read', filesBody),
        discloseBtn(s.commands.length + ' commands', cmdBody),
        el('a', { class: 'tx-link', href: '#/transcript/' + encodeURIComponent(s.path) }, 'open transcript →')),
      filesBody, cmdBody);
  }

  function discloseBtn(label, body) {
    const btn = el('button', { class: 'disclosure', type: 'button', 'aria-expanded': 'false' },
      el('span', { class: 'caret' }, '▸'), label);
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', String(!open));
      body.classList.toggle('open', !open);
    });
    return btn;
  }

  // --- a project's arc, told as a book ------------------------------------
  const ROMAN = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  function roman(n) {
    let out = '';
    for (const [v, s] of ROMAN) while (n >= v) { out += s; n -= v; }
    return out;
  }

  function projectDayRow(projectId, d) {
    const f = fmt(d.date);
    const dots = el('div', { class: 'tl-dots' });
    for (let i = 0; i < Math.min(d.sessionCount, 6); i++) dots.append(el('i', null));
    return el('a', { class: 'timeline-day', href: '#/day/' + projectId + '/' + d.date },
      el('span', { class: 'tl-date' }, f.month3, el('b', null, String(f.d)), f.wd3),
      el('div', null,
        el('div', { class: 'tl-headline' }, titleOf(d)),
        el('p', { class: 'tl-narr' }, daySummary(d))),
      dots);
  }

  function buildProjectHead(proj) {
    const head = el('div', { class: 'project-head' }, el('h1', { class: 'project-title' }, proj.displayName));
    const n = el('div', { class: 'narrative' });
    if (Array.isArray(proj.story) && proj.story.length) {
      proj.story.forEach((p) => n.append(el('p', null, p)));
      n.append(el('span', { class: 'narrative-sig' }, 'Arc recap written by the journal’s narrative engine'));
    } else if (proj.firstDate) {
      const first = fmt(proj.firstDate), last = fmt(proj.lastDate);
      n.append(el('p', null,
        'Begun ', el('b', null, first.monthLong + ' ' + first.y), '. ' +
          num(proj.totalSessions) + ' sessions across ' + proj.days.length +
          ' active days, last touched ' + last.monthLong + ' ' + last.d + '.'));
      n.append(el('span', { class: 'narrative-sig' },
        'A metadata summary — the written arc comes from the journal’s narrative engine, not yet run'));
    }
    head.append(n);
    return head;
  }

  function renderProject(projectId) {
    const proj = projById.get(projectId);
    if (!proj) return renderMissing();
    const map = dayMapByProj.get(projectId);

    const heat = heatmapSection({
      kicker: 'Every working day',
      title: 'In Ink',
      start: mondayOnOrBefore(proj.firstDate || TODAY), end: TODAY,
      getCount: (ds) => { const d = map.get(ds); return d ? d.sessionCount : 0; },
      level: levelProject,
      onpick: (ds) => { if (map.get(ds)) go('#/day/' + projectId + '/' + ds); },
      captionFor: (ds, count) => {
        const f = fmt(ds);
        return '<b>' + f.wd3 + ', ' + f.month3 + ' ' + f.d + '</b> — ' +
          (count <= 0 ? 'untouched' : count + ' session' + (count > 1 ? 's' : ''));
      },
      summaryHTML: '<b>' + proj.days.length + ' active days</b> · ' +
        num(proj.totalSessions) + ' sessions · ' + Math.round(proj.totalActiveMs / 3.6e6) +
        ' hours' + (proj.totalCommits ? ' · ' + num(proj.totalCommits) + ' commits' : '') +
        '. Hover a day.',
    });

    const chapters = el('div', { class: 'chapters' }, el('span', { class: 'section-kicker' }, 'The chapters'));
    proj.phases.slice().reverse().forEach((ph, i) => {
      const a = fmt(ph.startDate), b = fmt(ph.endDate);
      const range = a.month3 + ' ' + a.d + ' – ' + b.month3 + ' ' + b.d;
      const metaText = (ph.title ? range + ' · ' : '') +
        ph.dayCount + ' days · ' + ph.sessionCount + ' sessions';
      const body = el('div', { class: 'chapter-days' },
        el('div', null, ...ph.days.map((d) => projectDayRow(projectId, d))));
      if (i === 0) body.classList.add('open');
      const head = el('button',
        { class: 'chapter-head', type: 'button', 'aria-expanded': i === 0 ? 'true' : 'false' },
        el('span', { class: 'chapter-num' }, 'Chapter ' + roman(ph.index)),
        el('h3', { class: 'chapter-title' }, ph.title || range),
        ph.summary ? el('p', { class: 'chapter-summary' }, ph.summary) : null,
        el('div', { class: 'chapter-meta' },
          el('span', null, metaText), el('span', { class: 'caret' }, '▸')));
      head.addEventListener('click', () => {
        const open = head.getAttribute('aria-expanded') === 'true';
        head.setAttribute('aria-expanded', String(!open));
        body.classList.toggle('open', !open);
      });
      chapters.append(el('section', { class: 'chapter' }, head, body));
    });

    mount([
      crumb([['#/', 'Journal']], proj.displayName),
      reveal(buildProjectHead(proj), 0),
      reveal(heat, 1),
      reveal(chapters, 2),
    ]);
  }

  // --- a session's raw transcript ------------------------------------------
  function renderTranscript(enc) {
    const path = decodeURIComponent(enc);
    renderState('Loading the transcript…');
    fetch('/api/transcript?path=' + encodeURIComponent(path))
      .then((r) => r.json())
      .then((data) => {
        if (data.error) {
          renderState('That transcript isn’t in the journal.', path);
          return;
        }
        const list = el('div', { class: 'transcript' });
        data.entries.forEach((e) => {
          list.append(el('div', { class: 'tx-row', data: { cat: e.cat } },
            el('span', { class: 'tx-n' }, String(e.n)),
            el('span', { class: 'tx-badge' }, e.badge),
            el('span', { class: 'tx-text' }, e.text)));
        });
        const head = el('div', { class: 'tx-head' },
          el('span', { class: 'section-kicker' }, data.agent + ' · transcript'),
          el('h1', { class: 'section-title' }, baseName(path)),
          el('p', { class: 'tx-meta' },
            data.total + ' entries' +
              (data.total > data.entries.length ? ' · showing the first ' + data.entries.length : '')));
        mount([crumb([['#/', 'Journal']], 'Transcript'), reveal(head, 0), reveal(list, 1)]);
      })
      .catch((err) => renderState('Could not load the transcript.', String((err && err.message) || err)));
  }

  function renderMissing() {
    mount([el('div', { class: 'project-head' },
      el('h1', { class: 'project-title' }, 'Nothing filed here'),
      el('p', { class: 'project-arc' },
        'That page isn’t in the journal. ', el('a', { class: 'ln', href: '#/' }, 'Back to the almanac'), '.'))]);
  }

  // --- shared chrome -------------------------------------------------------
  function crumb(links, here) {
    const c = el('nav', { class: 'breadcrumb' });
    links.forEach(([href, label]) => {
      c.append(el('a', { href: href }, label), el('span', { class: 'sep' }, '/'));
    });
    c.append(el('span', { class: 'here' }, here));
    return c;
  }

  function mount(nodes) {
    view.replaceChildren(...nodes);
    window.scrollTo(0, 0);
    view.focus({ preventScroll: true });
  }

  // --- settings ------------------------------------------------------------
  // Per-project timezone — the zone a project's day cards and activity heatmap
  // are reckoned in. Changing it rebuilds that project on the server (days can
  // shift across midnight), so on save we re-fetch the whole journal.
  function renderSettings() {
    mount([crumb([['#/', 'Journal']], 'Settings'),
      el('div', { class: 'state' }, el('p', { class: 'state-line' }, 'Loading settings…'))]);
    fetch('/api/journal/settings')
      .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then((data) => {
        const section = el('section', { class: 'settings' });
        section.append(el('h1', {}, 'Settings'));
        section.append(el('p', { class: 'settings-intro' },
          'The timezone a project’s day cards and heatmap are reckoned in. ' +
          'Auto follows this machine’s zone (' + (data.host || 'host') + '). ' +
          'Stored in ~/.code-journal/journal-settings.json — nothing leaves this machine.'));

        const zones = data.zones || [];
        (data.projects || []).forEach((p) => {
          const sel = el('select', { class: 'tz-select' });
          const auto = el('option', { value: '' }, 'Auto (host: ' + (data.host || '—') + ')');
          if (!p.timezone) auto.selected = true;
          sel.append(auto);
          zones.forEach((z) => {
            const o = el('option', { value: z }, z);
            if (p.timezone === z) o.selected = true;
            sel.append(o);
          });
          const status = el('span', { class: 'tz-status' });
          sel.addEventListener('change', () => {
            status.textContent = 'saving…';
            status.className = 'tz-status';
            postSetting(p.id, sel.value, status);
          });
          section.append(el('div', { class: 'settings-row' },
            el('div', { class: 'settings-row-name' }, p.displayName),
            el('div', { class: 'settings-row-control' }, sel, status)));
        });
        if (!(data.projects || []).length) {
          section.append(el('p', { class: 'state-sub' }, 'No projects discovered yet.'));
        }
        mount([crumb([['#/', 'Journal']], 'Settings'), reveal(section, 0)]);
      })
      .catch((err) => mount([crumb([['#/', 'Journal']], 'Settings'),
        el('div', { class: 'state' },
          el('p', { class: 'state-line' }, 'Could not load settings.'),
          el('p', { class: 'state-sub' }, String((err && err.message) || err)))]));
  }

  function postSetting(projectId, timezone, status) {
    fetch('/api/journal/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId, timezone }),
    })
      .then((r) => r.json().then((b) => ({ ok: r.ok, b })))
      .then(({ ok, b }) => {
        if (!ok) throw new Error((b && b.error) || 'save failed');
        status.textContent = 'saved ✓';
        status.className = 'tz-status ok';
        // The project was rebuilt server-side — pull the fresh journal so day
        // buckets reflect the new zone, then re-render this view.
        return fetch('/api/journal').then((r) => r.json()).then((journal) => {
          J = journal;
          projById = new Map(journal.projects.map((p) => [p.projectId, p]));
          dayMapByProj = new Map(journal.projects.map((p) => [p.projectId, new Map(p.days.map((d) => [d.date, d]))]));
          activityByDate = new Map(journal.activity.map((a) => [a.date, a]));
        });
      })
      .catch((err) => { status.textContent = 'error: ' + ((err && err.message) || err); status.className = 'tz-status err'; });
  }

  // --- routing -------------------------------------------------------------
  function go(hash) { location.hash = hash; }

  function route() {
    if (!J) return;
    const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
    if (parts[0] === 'project' && parts[1]) renderProject(parts[1]);
    else if (parts[0] === 'day' && parts[1] && parts[2]) renderDay(parts[1], parts[2]);
    else if (parts[0] === 'transcript' && parts[1]) renderTranscript(parts[1]);
    else if (parts[0] === 'settings') renderSettings();
    else renderOverview();
  }

  // --- theme ---------------------------------------------------------------
  function effectiveTheme() {
    const set = document.documentElement.dataset.theme;
    if (set) return set;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  function initTheme() {
    const saved = localStorage.getItem('cj-theme');
    if (saved) document.documentElement.dataset.theme = saved;
    document.getElementById('theme-toggle').addEventListener('click', () => {
      const next = effectiveTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.dataset.theme = next;
      localStorage.setItem('cj-theme', next);
    });
  }

  // --- boot ----------------------------------------------------------------
  function renderState(line, sub) {
    view.replaceChildren(el('div', { class: 'state' },
      el('p', { class: 'state-line' }, line),
      sub ? el('p', { class: 'state-sub' }, sub) : null));
  }

  function start(journal) {
    J = journal;
    TODAY = (journal.generatedAt || new Date().toISOString()).slice(0, 10);
    const earliest = journal.activity.length ? journal.activity[0].date : TODAY;
    const capped = earliest < shiftDays(TODAY, -371) ? shiftDays(TODAY, -371) : earliest;
    RANGE = { start: mondayOnOrBefore(capped), end: TODAY };
    projById = new Map(journal.projects.map((p) => [p.projectId, p]));
    dayMapByProj = new Map(journal.projects.map((p) => [p.projectId, new Map(p.days.map((d) => [d.date, d]))]));
    activityByDate = new Map(journal.activity.map((a) => [a.date, a]));

    document.getElementById('masthead-note').textContent = 'Updated ' + fmt(TODAY).month3 + ' ' + fmt(TODAY).d;
    window.addEventListener('hashchange', route);
    route();
  }

  initTheme();
  renderState('Reading your coding-agent sessions…');
  fetch('/api/journal')
    .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .then(start)
    .catch((err) => renderState('Could not load the journal.', String((err && err.message) || err)));
})();
