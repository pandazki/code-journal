/**
 * Grounding gate tests — the mechanical verifier added after the v3
 * re-validation found ungrounded events surviving on a clean digest.
 */
import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';

import { checkEventGrounding, locateSnippet, type TurnText } from '../src/lib/grounding';

const turns: TurnText[] = [
  { id: 32, text: '我可以给 loader 加 schema 校验,用 zod 定义 config 的 shape。要加吗?' },
  { id: 33, text: '算了,先别加校验。先做环境变量覆盖。' },
  { id: 86, text: 'ok 你本地启动 我找个目录试试效果' },
  { id: 126, text: '接下来想怎样,你选: 跑 work-report;keep-or-delete;提交。' },
];

describe('grounding gate', () => {
  it('passes a well-grounded negative-space event', () => {
    const ev = {
      lens_id: 'strict-negative-space',
      turn_anchor: 'T32-T33',
      payload:
        '**Event (AI proposal — verbatim)**: 我可以给 loader 加 schema 校验,用 zod 定义 config 的 shape。要加吗?\n' +
        '**Event (user response — verbatim)**: 算了,先别加校验。先做环境变量覆盖。\n' +
        '**Event classification**: negative-space',
    };
    const r = checkEventGrounding(ev, turns);
    assert.equal(r.grounded, true, JSON.stringify(r.checks));
  });

  it('REJECTS a misgrounded citation (proposal really at T126, cited as T85)', () => {
    const ev = {
      lens_id: 'strict-negative-space',
      turn_anchor: 'T85-T95',
      payload:
        '**Event (AI proposal — verbatim)**: 接下来想怎样,你选: 跑 work-report;keep-or-delete;提交。\n' +
        '**Event (user response — verbatim)**: ok 你本地启动 我找个目录试试效果\n' +
        '**Event classification**: negative-space',
    };
    const r = checkEventGrounding(ev, turns);
    assert.equal(r.grounded, false);
    const citation = r.checks.find((c) => c.name === 'citation_accurate');
    assert.equal(citation?.pass, false, 'citation should fail: proposal at T126 not near T85');
  });

  it('PASSES a recurring verbatim when ONE occurrence sits at the cited anchor (multi-occurrence)', () => {
    // Generalization test (pneuma-craft T638) surfaced this: the AI repeated a
    // patch-list verbatim earlier in the session, so first-match citation falsely
    // killed a correctly-cited event. The gate must accept the occurrence nearest
    // the cited anchor.
    const multi: TurnText[] = [
      { id: 40, role: 'assistant', kind: 'text', text: '上游要发两个 patch: react@0.3.2 和 core@0.3.2' },
      { id: 600, role: 'assistant', kind: 'text', text: '中间无关内容' },
      { id: 638, role: 'assistant', kind: 'text', text: '上游要发两个 patch: react@0.3.2 和 core@0.3.2' },
    ];
    const ev = {
      lens_id: 'anchored-deferral',
      turn_anchor: 'T638',
      payload:
        '**Anchor verbatim**: 上游要发两个 patch: react@0.3.2 和 core@0.3.2\n' +
        '**User response verbatim**: 我自己发吧\n**Stance**: overrode',
    };
    const r = checkEventGrounding(ev, multi);
    assert.equal(r.checks.find((c) => c.name === 'citation_accurate')?.pass, true);
  });

  it('REJECTS a chronology violation (response precedes proposal)', () => {
    // proposal at T126, response at T86 → response is 40 turns BEFORE the proposal
    const ev = {
      lens_id: 'strict-negative-space',
      turn_anchor: 'T126',
      payload:
        '**Event (AI proposal — verbatim)**: 接下来想怎样,你选: 跑 work-report;keep-or-delete;提交。\n' +
        '**Event (user response — verbatim)**: ok 你本地启动 我找个目录试试效果\n',
    };
    const r = checkEventGrounding(ev, turns);
    assert.equal(r.grounded, false);
    const chrono = r.checks.find((c) => c.name === 'chronology');
    assert.equal(chrono?.pass, false);
  });

  it('REJECTS an event whose verbatim does not appear at all', () => {
    const ev = {
      lens_id: 'anchored-deferral',
      turn_anchor: 'T32',
      payload:
        '**Anchor verbatim**: 这句话根本不在 transcript 里出现过完全是编的\n' +
        '**User response verbatim**: 算了,先别加校验。先做环境变量覆盖。\n' +
        '**Stance**: overrode',
    };
    const r = checkEventGrounding(ev, turns);
    assert.equal(r.grounded, false);
    assert.equal(r.checks.find((c) => c.name === 'proposal_found')?.pass, false);
  });

  it('tolerates whitespace/line-wrap differences in verbatim', () => {
    const ev = {
      lens_id: 'strict-negative-space',
      turn_anchor: 'T32',
      payload:
        '**Event (AI proposal — verbatim)**: 我可以给 loader 加 schema 校验,\n用 zod 定义 config 的 shape。要加吗?\n' +
        '**Event (user response — verbatim)**: 算了,先别加校验。先做环境变量覆盖。',
    };
    const r = checkEventGrounding(ev, turns);
    assert.equal(r.grounded, true, JSON.stringify(r.checks));
  });

  it('user-initiated-pivot: REJECTS when an AI fork preceded the user direction (leg 1)', () => {
    const withRoles: TurnText[] = [
      { id: 1, role: 'user', kind: 'text', text: '帮我加个功能' },
      { id: 2, role: 'assistant', kind: 'text', text: '我们用 A 还是 B?' }, // a fork
      { id: 3, role: 'user', kind: 'text', text: '算了,先去把 auth.ts 的登录修了' },
    ];
    const ev = {
      lens_id: 'user-initiated-pivot',
      turn_anchor: 'T3',
      payload:
        '**Event (preceding AI turn — verbatim)**: 我们用 A 还是 B?\n' +
        '**Event (user direction — verbatim)**: 算了,先去把 auth.ts 的登录修了\n' +
        '**Event classification**: user-initiated-pivot',
    };
    const r = checkEventGrounding(ev, withRoles);
    assert.equal(r.grounded, false);
    assert.equal(r.checks.find((c) => c.name === 'no_preceding_fork')?.pass, false);
  });

  it('user-initiated-pivot: PASSES when the preceding AI turn was not a fork', () => {
    const withRoles: TurnText[] = [
      { id: 10, role: 'user', kind: 'text', text: '加个配置加载' },
      { id: 11, role: 'assistant', kind: 'text', text: '配置加载做好了,我接着更新 CHANGELOG。' }, // no fork
      { id: 12, role: 'user', kind: 'text', text: '等一下,先去 src/cli.ts 加个 try/catch' },
    ];
    const ev = {
      lens_id: 'user-initiated-pivot',
      turn_anchor: 'T12',
      payload:
        '**Event (preceding AI turn — verbatim)**: 配置加载做好了,我接着更新 CHANGELOG。\n' +
        '**Event (user direction — verbatim)**: 等一下,先去 src/cli.ts 加个 try/catch\n' +
        '**Event classification**: user-initiated-pivot',
    };
    const r = checkEventGrounding(ev, withRoles);
    assert.equal(r.checks.find((c) => c.name === 'no_preceding_fork')?.pass, true);
    assert.equal(r.grounded, true);
  });

  it('locateSnippet finds the right turn', () => {
    assert.equal(locateSnippet('算了,先别加校验', turns), 33);
    assert.equal(locateSnippet('完全不存在的句子xyz', turns), -1);
  });
});
