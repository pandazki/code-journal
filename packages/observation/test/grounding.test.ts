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

  it('locateSnippet finds the right turn', () => {
    assert.equal(locateSnippet('算了,先别加校验', turns), 33);
    assert.equal(locateSnippet('完全不存在的句子xyz', turns), -1);
  });
});
