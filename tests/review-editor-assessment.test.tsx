// @vitest-environment jsdom
/**
 * 评测编辑器：测评档位必选 + 随保存/提交发送。
 *
 * 缺陷背景：档位是提交必填项（快测/标准测评/深度审计/仅安全审计），
 * 漏选时应就地表单提示，不发起 PUT/PATCH，也不走 ErrorNotice。
 *
 * 鉴别方式：删掉 onSubmit 里的 assessmentLevel 前置校验 → 第一条红；
 * 删掉 doSave/PATCH 里的 assessmentLevel 字段 → 第三条红。
 */

import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReviewEditor } from '../src/components/review-editor';

vi.mock('next/link', () => ({
  default: ({ children, href, ...rest }: { children?: ReactNode; href?: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const DRAFT = {
  draftId: 'draft-1',
  reviewId: 'review-1',
  ownerId: 'user-1',
  pluginId: 'plugin-1',
  payload: {
    title: '一篇实测评测',
    pluginId: 'plugin-1',
    pluginVersion: { kind: 'unknown' },
    dshVersion: { kind: 'unknown' },
    body: [{ key: 'p0', markdown: '正文' }],
    verdict: null,
    evidence: [],
    assessmentLevel: null,
  },
  payloadSchemaVersion: 3,
  saveVersion: 0,
  createdAt: 1_700_000_000_000,
  savedAt: 1_700_000_000_000,
};

interface Call {
  url: string;
  method: string;
  body: string | null;
}

function stubFetch(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({
        url: String(input),
        method,
        body: typeof init?.body === 'string' ? init.body : null,
      });
      if (method === 'PUT') {
        return { json: async () => ({ ok: true, data: { saveVersion: 1, savedAt: 2, replayed: false }, request_id: 'r' }) };
      }
      if (method === 'PATCH') {
        return {
          json: async () => ({
            ok: true,
            data: { submissionId: 's1', reviewRevisionId: 'v1', reviewId: 'review-1', processingState: 'pending', taskId: null },
            request_id: 'r',
          }),
        };
      }
      return { json: async () => ({ ok: true, data: DRAFT, request_id: 'r' }) };
    }),
  );
  return calls;
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollIntoView', { writable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('评测编辑器 · 提交前测评档位必填', () => {
  it('未选档位点提交：就地提示、不发保存/提交请求', async () => {
    const calls = stubFetch();
    render(<ReviewEditor draftId="draft-1" />);
    await screen.findByText('编辑评测草稿');

    fireEvent.click(screen.getByRole('button', { name: '提交审核' }));

    const hint = await screen.findByRole('alert');
    expect(hint.textContent).toContain('请先选择测评档位');
    expect(screen.queryByText(/操作失败/)).toBeNull();
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('选了档位但没选判定：档位提示消失，换成判定提示，仍不发请求', async () => {
    const calls = stubFetch();
    render(<ReviewEditor draftId="draft-1" />);
    await screen.findByText('编辑评测草稿');

    fireEvent.click(screen.getByRole('radio', { name: '快测' }));
    fireEvent.click(screen.getByRole('button', { name: '提交审核' }));

    const hint = await screen.findByRole('alert');
    expect(hint.textContent).toContain('请先选择判定');
    expect(screen.queryByText(/请先选择测评档位/)).toBeNull();
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('档位 + 判定都选了：正常保存并提交，且请求体带上 assessmentLevel', async () => {
    const calls = stubFetch();
    render(<ReviewEditor draftId="draft-1" />);
    await screen.findByText('编辑评测草稿');

    fireEvent.click(screen.getByRole('radio', { name: '快测' }));
    fireEvent.click(screen.getByRole('radio', { name: '没法测' }));
    fireEvent.click(screen.getByRole('button', { name: '提交审核' }));

    await waitFor(() => expect(screen.getByText(/已提交审核/)).toBeTruthy());
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PUT', 'PATCH']);

    for (const call of calls.filter((c) => c.method !== 'GET')) {
      const body = JSON.parse(call.body ?? '{}') as { assessmentLevel?: string };
      expect(body.assessmentLevel).toBe('quick');
    }
  });
});
