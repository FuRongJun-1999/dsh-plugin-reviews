/**
 * 删除草稿（2026-10-19 需求：规范更新后要能清理旧稿）。
 *
 * 边界：**从未发布过**的稿件都能删——没提交过、已提交但还在检查或待修改的都算；
 * 发布过的不能删（只能撤回，历史修订留账本）。
 *
 * 每个用例都能在实现被破坏时变红：
 *  - 去掉 `published_revision_id !== null` 的判断 → 「已发布不能删」用例失败；
 *  - 去掉 owner 检查 → 「删别人的草稿」用例失败；
 *  - 少删一层（比如不删 content_submissions）→ 「已提交未发布」用例因残留行失败；
 *  - 误删修订快照 → 被 trg_review_revisions_no_delete 直接 ABORT（不是靠断言发现）。
 */

import { describe, expect, it, afterEach } from 'vitest';
import {
  createTestDb,
  insertPlugin,
  insertRepository,
  insertReview,
  insertReviewRevision,
  insertUser,
  type TestDb,
} from './support/db';
import { reviewsService } from '../src/server/modules/reviews';
import type { CallerContext } from '../src/server/platform/context';
import { ErrorCodes, isDomainError } from '../src/packages/common/errors';
import { newId } from '../src/server/platform/id';

let ctx: TestDb | null = null;

afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

function setup(): TestDb {
  ctx = createTestDb();
  return ctx;
}

function caller(userId: string): CallerContext {
  return { userId, role: 'user', accountStatus: 'active' };
}

async function expectCode(promise: Promise<unknown>, code: string): Promise<void> {
  try {
    await promise;
  } catch (e) {
    if (!isDomainError(e)) throw new Error(`预期 DomainError(${code})，实际 ${(e as Error).name}`);
    expect(e.code).toBe(code);
    return;
  }
  throw new Error(`预期抛出 ${code}，但成功了`);
}

/** 建一份挂在评测上的草稿（草稿表没有公共辅助，按真实列插入）。 */
function insertDraft(db: TestDb['db'], ownerId: string, reviewId: string): string {
  const id = newId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO content_drafts (id, owner_id, draft_type, review_id, payload, payload_schema_version, save_version, created_at, saved_at)
     VALUES (?, ?, 'review', ?, '{}', 1, 0, ?, ?)`,
  ).run(id, ownerId, reviewId, now, now);
  return id;
}

describe('删除草稿', () => {
  it('没提交过的草稿能删：草稿行没了，公开面本来就看不到', async () => {
    const { db } = setup();
    const author = insertUser(db);
    const reviewId = insertReview(db, { authorId: author, pluginId: null });
    const draftId = insertDraft(db, author, reviewId);

    const result = await reviewsService.deleteDraft(caller(author), { draftId }, db);
    expect(result.deleted).toBe(true);
    expect(result.reviewId).toBe(reviewId);

    expect(db.prepare('SELECT COUNT(*) AS n FROM content_drafts WHERE id = ?').get(draftId)).toEqual({ n: 0 });
  });

  it('已提交但还没发布：草稿与提交记录删掉，修订快照受保护留下', async () => {
    const { db } = setup();
    const author = insertUser(db);
    const repo = insertRepository(db);
    const plugin = insertPlugin(db, repo);
    const reviewId = insertReview(db, { authorId: author, pluginId: plugin });
    const draftId = insertDraft(db, author, reviewId);
    const revisionId = insertReviewRevision(db, { reviewId, pluginId: plugin, revisionNumber: 1 });
    const now = Date.now();
    db.prepare(
      `INSERT INTO content_submissions
         (id, submitted_by, submission_type, review_revision_id, draft_id, draft_save_version,
          request_key, request_digest, processing_state, state_version, publication_context,
          submitted_at, updated_at)
       VALUES (?, ?, 'review_revision', ?, ?, 0, ?, ?, 'pending', 0, '{}', ?, ?)`,
    ).run(newId(), author, revisionId, draftId, 'rk-delete-1', 'a'.repeat(64), now, now);

    const result = await reviewsService.deleteDraft(caller(author), { draftId }, db);
    expect(result.removed.submissions).toBe(1);
    // 快照受 trg_review_revisions_no_delete 保护：数量不变，且如实报出来
    expect(result.kept.revisions).toBe(1);
    expect(db.prepare('SELECT COUNT(*) AS n FROM review_revisions WHERE review_id = ?').get(reviewId)).toEqual({ n: 1 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM content_submissions WHERE draft_id = ?').get(draftId)).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM content_drafts WHERE id = ?').get(draftId)).toEqual({ n: 0 });
    // 「最新提交」指针置空，不留悬空引用
    expect(db.prepare('SELECT latest_submitted_revision_id AS v FROM reviews WHERE id = ?').get(reviewId)).toEqual({ v: null });
  });

  it('已发布过的不能被删（只能撤回）', async () => {
    const { db } = setup();
    const author = insertUser(db);
    const repo = insertRepository(db);
    const plugin = insertPlugin(db, repo);
    const reviewId = insertReview(db, { authorId: author, pluginId: plugin });
    const draftId = insertDraft(db, author, reviewId);
    const revisionId = insertReviewRevision(db, { reviewId, pluginId: plugin, revisionNumber: 1 });
    db.prepare('UPDATE reviews SET published_revision_id = ? WHERE id = ?').run(revisionId, reviewId);

    await expectCode(reviewsService.deleteDraft(caller(author), { draftId }, db), ErrorCodes.FORBIDDEN);
    expect(db.prepare('SELECT COUNT(*) AS n FROM content_drafts WHERE id = ?').get(draftId)).toEqual({ n: 1 });
  });

  it('删不了别人的草稿', async () => {
    const { db } = setup();
    const author = insertUser(db);
    const other = insertUser(db);
    const reviewId = insertReview(db, { authorId: author, pluginId: null });
    const draftId = insertDraft(db, author, reviewId);
    await expectCode(reviewsService.deleteDraft(caller(other), { draftId }, db), ErrorCodes.FORBIDDEN);
    expect(ctx !== null).toBe(true);
  });

  it('草稿不存在时按不可访问处理', async () => {
    const { db } = setup();
    const author = insertUser(db);
    await expectCode(reviewsService.deleteDraft(caller(author), { draftId: newId() }, db), ErrorCodes.TARGET_UNAVAILABLE);
  });
});
