import assert from 'node:assert/strict';
import test from 'node:test';

import { todayLocalDate } from '../src/datetime';
import {
  buildJournal,
  buildProjectJournal,
  digestSession,
  type BuildJournalOptions,
  type ProjectInput,
} from '../src/journal';
import type { SessionRef } from '../src/sessions';

const J = (o: unknown): string => JSON.stringify(o);

/** A SessionRef factory — only the fields a test cares about need overriding. */
function ref(over: Partial<SessionRef> & { id: string; path: string }): SessionRef {
  return {
    agent: 'claude-code',
    cwd: '/repo',
    sizeBytes: 100,
    mtimeMs: Date.parse('2026-05-20T12:00:00Z'),
    meta: {},
    sidecarFiles: [],
    ...over,
  };
}

// A session run on 2026-05-20 (UTC noon — same local date in every real tz).
const SID_A = '/store/a.jsonl';
const TRANSCRIPT_A = [
  J({ type: 'user', timestamp: '2026-05-20T12:00:00.000Z', message: { role: 'user', content: 'build the login page' } }),
  J({
    type: 'assistant',
    timestamp: '2026-05-20T12:01:00.000Z',
    message: {
      role: 'assistant',
      model: 'claude-opus-4-7',
      content: [
        { type: 'text', text: 'on it' },
        { type: 'tool_use', name: 'Read', input: { file_path: '/repo/login.ts' } },
        { type: 'tool_use', name: 'Edit', input: { file_path: '/repo/login.ts' } },
      ],
    },
  }),
  J({
    type: 'assistant',
    timestamp: '2026-05-20T12:05:00.000Z',
    message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] },
  }),
  J({
    type: 'user',
    timestamp: '2026-05-20T12:06:00.000Z',
    message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] },
  }),
].join('\n');

// A second session in the same project, three days later.
const SID_B = '/store/b.jsonl';
const TRANSCRIPT_B = [
  J({ type: 'user', timestamp: '2026-05-23T12:00:00.000Z', message: { role: 'user', content: 'fix the bug' } }),
  J({
    type: 'assistant',
    timestamp: '2026-05-23T12:10:00.000Z',
    message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: '/repo/fix.ts' } }] },
  }),
].join('\n');

// A session in a different project, same day as A.
const SID_C = '/store/c.jsonl';
const TRANSCRIPT_C = [
  J({ type: 'user', timestamp: '2026-05-20T12:00:00.000Z', message: { role: 'user', content: 'docs update' } }),
  J({
    type: 'assistant',
    timestamp: '2026-05-20T12:02:00.000Z',
    message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/other/README.md' } }] },
  }),
].join('\n');

const DAY_A = todayLocalDate(new Date('2026-05-20T12:00:00Z'));
const DAY_B = todayLocalDate(new Date('2026-05-23T12:00:00Z'));

const STORE: Record<string, string> = {
  [SID_A]: TRANSCRIPT_A,
  [SID_B]: TRANSCRIPT_B,
  [SID_C]: TRANSCRIPT_C,
};
const opts: BuildJournalOptions = { loadTranscript: (p) => STORE[p] ?? '' };

test('digestSession mines timespan, opening prompt, files, commands and tool tally', () => {
  const d = digestSession(ref({ id: 'a', path: SID_A }), TRANSCRIPT_A)[0]!;
  assert.equal(d.date, DAY_A);
  assert.equal(d.startedAt, '2026-05-20T12:00:00.000Z');
  assert.equal(d.endedAt, '2026-05-20T12:06:00.000Z');
  assert.equal(d.activeMs, 6 * 60_000);
  assert.equal(d.model, 'claude-opus-4-7');
  assert.equal(d.openingPrompt, 'build the login page');
  assert.equal(d.userTurns, 1); // the tool-result-only user turn does not count
  assert.equal(d.assistantTurns, 2);
  assert.deepEqual(d.filesEdited, ['/repo/login.ts']);
  assert.deepEqual(d.filesRead, ['/repo/login.ts']);
  assert.deepEqual(d.commands, ['npm test']);
  assert.deepEqual(d.toolCounts, { Read: 1, Edit: 1, Bash: 1 });
});

test('digestSession skips synthetic user turns when picking the headline', () => {
  const text = [
    J({
      type: 'user',
      timestamp: '2026-05-22T10:00:00.000Z',
      message: { role: 'user', content: '<local-command-caveat>Caveat: messages below…</local-command-caveat>' },
    }),
    J({
      type: 'user',
      timestamp: '2026-05-22T10:01:00.000Z',
      message: { role: 'user', content: 'actually build the thing' },
    }),
    J({
      type: 'user',
      timestamp: '2026-05-22T10:02:00.000Z',
      isMeta: true,
      message: { role: 'user', content: 'an injected meta note' },
    }),
  ].join('\n');
  const d = digestSession(ref({ id: 'syn', path: '/s/syn.jsonl' }), text)[0]!;
  assert.equal(d.openingPrompt, 'actually build the thing'); // not the caveat
  assert.equal(d.userTurns, 1); // caveat and isMeta turn both excluded
});

test('digestSession splits a session that spans days into one digest per day', () => {
  const text = [
    J({
      type: 'user',
      timestamp: '2026-05-20T23:30:00.000Z',
      message: { role: 'user', content: 'start the migration' },
    }),
    J({
      type: 'assistant',
      timestamp: '2026-05-20T23:45:00.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/r/a.ts' } }] },
    }),
    J({
      type: 'user',
      timestamp: '2026-05-22T09:00:00.000Z',
      message: { role: 'user', content: 'resume and finish it' },
    }),
    J({
      type: 'assistant',
      timestamp: '2026-05-22T09:20:00.000Z',
      message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Write', input: { file_path: '/r/b.ts' } }] },
    }),
  ].join('\n');
  const ds = digestSession(ref({ id: 'span', path: '/s/span.jsonl' }), text);
  assert.equal(ds.length, 2);
  assert.notEqual(ds[0]!.date, ds[1]!.date);
  assert.equal(ds[0]!.openingPrompt, 'start the migration');
  assert.deepEqual(ds[0]!.filesEdited, ['/r/a.ts']);
  assert.equal(ds[1]!.openingPrompt, 'resume and finish it'); // the day's own first prompt
  assert.deepEqual(ds[1]!.filesEdited, ['/r/b.ts']);
});

test('digestSession falls back to mtime when the transcript carries no timestamps', () => {
  const mtime = Date.parse('2026-05-21T12:00:00Z');
  const text = J({ type: 'user', message: { role: 'user', content: 'hi' } });
  const d = digestSession(ref({ id: 'x', path: '/store/x.jsonl', mtimeMs: mtime }), text)[0]!;
  assert.equal(d.startedAt, null);
  assert.equal(d.endedAt, null);
  assert.equal(d.activeMs, 0);
  assert.equal(d.date, todayLocalDate(new Date(mtime)));
});

test('buildProjectJournal groups sessions into days, newest first', () => {
  const input: ProjectInput = {
    projectId: 'demo',
    displayName: 'Demo',
    cwds: ['/repo'],
    sessions: [ref({ id: 'a', path: SID_A }), ref({ id: 'b', path: SID_B })],
  };
  const pj = buildProjectJournal(input, opts);
  assert.equal(pj.totalSessions, 2);
  assert.equal(pj.days.length, 2);
  assert.equal(pj.days[0]!.date, DAY_B); // newest first
  assert.equal(pj.days[1]!.date, DAY_A);
  assert.equal(pj.firstDate, DAY_A);
  assert.equal(pj.lastDate, DAY_B);
  assert.equal(pj.totalActiveMs, 6 * 60_000 + 10 * 60_000);

  const dayA = pj.days[1]!;
  assert.equal(dayA.sessionCount, 1);
  assert.deepEqual(dayA.filesEdited, ['/repo/login.ts']);
  assert.equal(dayA.commandCount, 1);
  assert.equal(dayA.openingPrompt, 'build the login page');
});

test('buildProjectJournal cuts days into phases at activity gaps', () => {
  const at = (date: string) =>
    J({ type: 'user', timestamp: date + 'T12:00:00.000Z', message: { role: 'user', content: 'work' } });
  const store: Record<string, string> = {
    '/p/e1.jsonl': at('2026-03-01'),
    '/p/e2.jsonl': at('2026-03-03'), // 2-day gap — same phase
    '/p/e3.jsonl': at('2026-04-15'), // 43-day gap — opens a new phase
  };
  const pj = buildProjectJournal(
    {
      projectId: 'gap',
      displayName: 'Gap',
      cwds: ['/p'],
      sessions: [
        ref({ id: 'e1', path: '/p/e1.jsonl' }),
        ref({ id: 'e2', path: '/p/e2.jsonl' }),
        ref({ id: 'e3', path: '/p/e3.jsonl' }),
      ],
    },
    { loadTranscript: (p) => store[p] ?? '' },
  );
  assert.equal(pj.phases.length, 2);
  assert.equal(pj.phases[0]!.index, 1);
  assert.equal(pj.phases[0]!.dayCount, 2); // Mar 1 + Mar 3
  assert.equal(pj.phases[1]!.dayCount, 1); // Apr 15
  assert.equal(pj.phases[1]!.days[0]!.date, pj.days[0]!.date); // newest day, newest phase
});

test('buildProjectJournal buckets git commits into their day', () => {
  const pj = buildProjectJournal(
    {
      projectId: 'demo',
      displayName: 'Demo',
      cwds: ['/repo'],
      sessions: [ref({ id: 'a', path: SID_A })],
      commits: [
        { sha: 'abc123def456', shortSha: 'abc123d', date: DAY_A, subject: 'wire the thing' },
        { sha: 'eeeeee', shortSha: 'eeeeee', date: '2099-01-01', subject: 'a session-less day' },
      ],
    },
    opts,
  );
  const dayA = pj.days.find((d) => d.date === DAY_A)!;
  assert.equal(dayA.commits.length, 1);
  assert.equal(dayA.commits[0]!.subject, 'wire the thing');
  assert.equal(pj.totalCommits, 1); // the commit on a session-less day is dropped
});

test('buildJournal rolls activity up across projects by date', () => {
  const journal = buildJournal(
    [
      {
        projectId: 'demo',
        displayName: 'Demo',
        cwds: ['/repo'],
        sessions: [ref({ id: 'a', path: SID_A }), ref({ id: 'b', path: SID_B })],
      },
      {
        projectId: 'other',
        displayName: 'Other',
        cwds: ['/other'],
        sessions: [ref({ id: 'c', path: SID_C, cwd: '/other' })],
      },
    ],
    opts,
  );
  assert.equal(journal.projects.length, 2);
  assert.equal(journal.activity.length, 2);

  const a = journal.activity.find((x) => x.date === DAY_A)!;
  assert.equal(a.sessionCount, 2); // session A (demo) + session C (other)
  assert.equal(a.projectCount, 2);

  const b = journal.activity.find((x) => x.date === DAY_B)!;
  assert.equal(b.sessionCount, 1);
  assert.equal(b.projectCount, 1);
});

// A single event at 19:30 UTC — still the 20th in UTC, already the 21st in
// UTC+8. The timezone a project reckons in decides which day it files under.
const SID_TZ = '/store/tz.jsonl';
const TRANSCRIPT_TZ = J({
  type: 'user',
  timestamp: '2026-05-20T19:30:00.000Z',
  message: { role: 'user', content: 'late-night commit' },
});

test('digestSession files a session under the calendar day of the given timezone', () => {
  const r = ref({ id: 'tz', path: SID_TZ });
  assert.equal(digestSession(r, TRANSCRIPT_TZ, undefined, 'UTC')[0]!.date, '2026-05-20');
  assert.equal(digestSession(r, TRANSCRIPT_TZ, undefined, 'Asia/Shanghai')[0]!.date, '2026-05-21');
});

test('buildProjectJournal buckets day cards by the project timezone', () => {
  const opts: BuildJournalOptions = { loadTranscript: () => TRANSCRIPT_TZ };
  const base: ProjectInput = {
    projectId: 'demo',
    displayName: 'Demo',
    cwds: ['/repo'],
    sessions: [ref({ id: 'tz', path: SID_TZ })],
  };
  const utc = buildProjectJournal({ ...base, timezone: 'UTC' }, opts);
  const sh = buildProjectJournal({ ...base, timezone: 'Asia/Shanghai' }, opts);
  assert.equal(utc.days[0]!.date, '2026-05-20');
  assert.equal(sh.days[0]!.date, '2026-05-21');
});
