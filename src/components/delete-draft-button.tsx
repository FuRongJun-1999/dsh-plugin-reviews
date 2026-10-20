'use client';

/**
 * 删除一份草稿。
 *
 * 三条刻意的设计：
 *  1. 两段式确认：先点「删除这份草稿」展开确认区，再点「确认删除」才发请求。
 *     删除不能从界面撤销，一键误触太容易。
 *  2. 说清删掉什么：草稿正文、附件引用、以及这篇的提交记录会一起删。
 *     已发布过的评测走不到这条路（只能撤回，历史修订保留）。
 *  3. 成功后刷新页面：草稿从列表消失，作者能直接看到结果。
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, ErrorNotice, apiFetch } from './api-client';

export function DeleteDraftButton({ draftId }: { draftId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await apiFetch<{ deleted: true }>(`/api/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' });
      setOpen(false);
      router.refresh();
    } catch (e) {
      setError(e as ApiError);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="button" onClick={() => setOpen(true)}>
        删除这份草稿
      </button>
    );
  }

  return (
    <div>
      <p className="muted" style={{ fontSize: 12, margin: '6px 0' }}>
        删除后不能恢复：草稿正文、附件引用和这篇的提交记录会一起删掉。
        已发布过的评测删不了，请改用「撤回」。
      </p>
      {error ? <ErrorNotice error={error} onDismiss={() => setError(null)} /> : null}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => void remove()} disabled={busy} className="button primary">
          {busy ? '删除中…' : '确认删除'}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={busy}
          className="button"
        >
          取消
        </button>
      </div>
    </div>
  );
}
