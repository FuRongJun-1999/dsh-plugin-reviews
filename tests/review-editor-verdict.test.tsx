// @vitest-environment jsdom
/**
 * 评测编辑器：提交前判定必填的前端行为。
 *
 * 缺陷背景：未选判定点「提交审核」时，旧实现先保存、再把一个**裸对象**当
 * ApiError 抛出；ErrorNotice 调 describeFields() 时二次崩溃，用户看到的是
 * 整页「这个页面出错了」。正确行为是就地表单提示，不发提交请求。
 *
 * 鉴别方式：把 onSubmit 里的前置校验删掉、恢复成抛错，第一条用例必红
 * （提示不出现、且会重新出现「操作失败」/整页异常）。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
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
  },
  payloadSchemaVersion: 2,
  saveVersion: 0,
  createdAt: 1_700_000_000_000,
  savedAt: 1_700_000_000_000,
};

interface Call {
  url: string;
  method: string;
}

function stubFetch(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ url: String(input), method });
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
      return {
        json: async () => ({ ok: true, data: DRAFT, request_id: 'r' }),
      };
    }),
  );
  return calls;
}

beforeEach(() => {
  // jsdom 没有实现滚动；断言只关心是否提示，不关心滚动。
  Object.defineProperty(Element.prototype, 'scrollIntoView', { writable: true, value: vi.fn() });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('评测编辑器 · 提交前判定必填', () => {
  it('未选判定点提交：就地提示、不发保存/提交请求、不出现「操作失败」', async () => {
    const calls = stubFetch();
    render(<ReviewEditor draftId="draft-1" />);

    await screen.findByText('编辑评测草稿');
    // 档位是新增的提交必填项：先选档位，才能测到「判定未选」这一条。
    fireEvent.click(screen.getByRole('radio', { name: '快测' }));
    fireEvent.click(screen.getByRole('button', { name: '提交审核' }));

    const hint = await screen.findByRole('alert');
    expect(hint.textContent).toContain('请先选择判定');
    expect(screen.queryByText(/操作失败/)).toBeNull();
    expect(screen.queryByText(/这个页面出错了/)).toBeNull();

    // 只有打开草稿的 GET；没有 PUT（保存）与 PATCH（提交）。
    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });

  it('选了「没法测」再提交：正常保存并提交（校验不误伤合法路径）', async () => {
    const calls = stubFetch();
    render(<ReviewEditor draftId="draft-1" />);

    await screen.findByText('编辑评测草稿');
    fireEvent.click(screen.getByRole('radio', { name: '快测' }));
    fireEvent.click(screen.getByRole('radio', { name: '没法测' }));
    fireEvent.click(screen.getByRole('button', { name: '提交审核' }));

    await waitFor(() => expect(screen.getByText(/已提交审核/)).toBeTruthy());
    expect(calls.map((c) => c.method)).toEqual(['GET', 'PUT', 'PATCH']);
  });
});
