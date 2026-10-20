/**
 * 单份草稿（架构第 68 节）。
 *
 *   DELETE /api/drafts/{draftId}   删除草稿
 *
 * 只有「从未发布过」的稿件能删——已提交、还在检查或待修改的都算；
 * 已发布过的会被拒（要先撤回，历史修订不可删）。删除是整套的：
 * 草稿 + 附件链接 + 修订快照 + 提交记录 + 评测本体，见 reviewsService.deleteDraft。
 *
 * 为什么要有这个接口：规范更新后，旧草稿会留在列表里没法清理；
 * 作者只能一直看着一份写废的稿子。
 */

import { getDb } from '@/server/platform/db';
import { reviewsService } from '@/server/modules/reviews';
import { currentContext, okJson, errorResponse, requestMeta } from '../../_lib/context';

export const runtime = 'nodejs';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ draftId: string }> },
): Promise<Response> {
  const { requestId } = requestMeta(request);
  try {
    const ctx = await currentContext();
    const { draftId } = await params;
    const result = await reviewsService.deleteDraft(ctx, { draftId }, getDb());
    return okJson(result, requestId);
  } catch (e) {
    return errorResponse(e, requestId);
  }
}
