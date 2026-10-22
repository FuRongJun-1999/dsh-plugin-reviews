/**
 * 草稿保存载荷：判定与证据链必须真的写进 payload。
 *
 * 背景（缺陷）：PUT /api/drafts 的载荷构造函数曾漏掉 verdict/evidence，
 * 而编辑器确实把这两项发上来、reviews 模块也确实支持解析它们——于是
 * 「选了判定 → 保存 → 重新打开」判定消失，提交时又被当成「没选判定」。
 *
 * 鉴别方式：把 draftPayloadOf 里新增的 verdict/evidence 两行删掉，本文件
 * 第一条用例必红（其余用例不受影响）。
 */

import { describe, expect, it } from 'vitest';
import { draftPayloadOf } from '../src/app/api/drafts/route';
import { parseDraftPayload } from '../src/server/modules/reviews';

const EVIDENCE = { url: 'https://github.com/a/b/compare/x...y', note: '配对 A/B 读数' };

describe('PUT /api/drafts 保存载荷', () => {
  it('保留判定与证据链（重新打开草稿要能还原）', () => {
    const payload = draftPayloadOf({
      title: '一篇实测评测',
      pluginId: 'plugin-1',
      pluginVersion: { kind: 'unknown' },
      dshVersion: { kind: 'unknown' },
      body: [{ key: 'p0', markdown: '正文' }],
      verdict: 'helpful',
      evidenceRefs: [EVIDENCE],
      assessmentLevel: 'deep',
    });

    expect(payload.verdict).toBe('helpful');
    expect(payload.evidence).toEqual([EVIDENCE]);
    expect(payload.assessmentLevel).toBe('deep');
  });

  it('未给出判定/证据时落为 null 与空数组（v1 载荷兼容，不伪造）', () => {
    const payload = draftPayloadOf({ title: '草稿', body: [] });

    expect(payload.verdict).toBeNull();
    expect(payload.evidence).toEqual([]);
    expect(payload.assessmentLevel).toBeNull();
    // 旧草稿读出来仍然是合法载荷，不会因为升级而读不出来。
    expect(parseDraftPayload(payload).verdict).toBeNull();
    expect(parseDraftPayload(payload).evidence).toEqual([]);
    expect(parseDraftPayload(payload).assessmentLevel).toBeNull();
  });

  it('非法判定原样透传，由 parseDraftPayload fail-closed 拒绝（不静默改成 null）', () => {
    const payload = draftPayloadOf({ title: '草稿', body: [], verdict: 'great' });

    expect(payload.verdict).toBe('great');
    expect(() => parseDraftPayload(payload)).toThrow();
  });
});
