/**
 * 提交链路：测评档位必填、随修订快照落库、重放去重。
 *
 * 纪律：每条用例都必须在实现被破坏时变红——
 *  - 去掉 submitReview 里的 parseAssessmentLevel → 「缺档位被拒」红；
 *  - 从 INSERT 里去掉 assessment_level → 「档位落进快照」红；
 *  - 把档位从 submissionDigest 里去掉 → 「同键不同档位」不再报 request_key_reused。
 *
 * 所有集成用例使用真实临时文件数据库 + 真实迁移。
 */

import { describe, expect, it, afterEach } from 'vitest';
import { createTestDb, insertPlugin, insertRepository, insertReview, insertUser, type TestDb } from './support/db';
import { submitReview } from '../src/server/workflows/submit-review';
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

/** 造 用户 + 仓库 + 插件 + 评测文章 + 已保存草稿（save_version=1）。 */
function makeReviewDraft(db: TestDb['db']): { authorId: string; reviewId: string; pluginId: string; draftId: string } {
  const authorId = insertUser(db);
  const repositoryId = insertRepository(db);
  const pluginId = insertPlugin(db, repositoryId);
  const reviewId = insertReview(db, { authorId, pluginId });
  const now = Date.now();
  const draftId = newId();
  db.prepare(
    `INSERT INTO content_drafts (id, owner_id, draft_type, review_id, payload, save_version, created_at, saved_at)
     VALUES (?, ?, 'review', ?, ?, 1, ?, ?)`,
  ).run(
    draftId,
    authorId,
    reviewId,
    JSON.stringify({ title: '标题', pluginVersion: { kind: 'unknown' }, dshVersion: { kind: 'unknown' }, pluginId, body: [] }),
    now,
    now,
  );
  return { authorId, reviewId, pluginId, draftId };
}

const GOOD_BODY = '这是一篇关于 DSH 插件的实测评测正文，包含安装步骤、实际表现与结论，长度足够通过基础筛查。';

function submitWith(
  db: TestDb['db'],
  fixture: { authorId: string; draftId: string },
  overrides: Record<string, unknown> = {},
) {
  const authorCtx: CallerContext = { userId: fixture.authorId, role: 'user', accountStatus: 'active' };
  return submitReview(
    authorCtx,
    {
      draftId: fixture.draftId,
      expectedSaveVersion: 1,
      requestKey: `req-${newId()}`,
      publishIntent: 'publish',
      title: '一篇实测评测',
      bodyMarkdown: GOOD_BODY,
      pluginVersion: { kind: 'unknown' },
      dshVersion: { kind: 'unknown' },
      verdict: 'untestable',
      evidenceRefs: [],
      assessmentLevel: 'standard',
      ...overrides,
    },
    db,
  );
}

describe('提交时测评档位必填', () => {
  it('缺档位被拒（input_invalid），不产生修订快照', async () => {
    const { db } = setup();
    const fixture = makeReviewDraft(db);
    try {
      await submitWith(db, fixture, { assessmentLevel: null });
      throw new Error('应当拒绝缺档位的提交');
    } catch (e) {
      expect(isDomainError(e)).toBe(true);
      if (isDomainError(e)) expect(e.code).toBe(ErrorCodes.INPUT_INVALID);
    }
    const count = db.prepare('SELECT COUNT(*) AS n FROM review_revisions').get() as { n: number };
    expect(count.n).toBe(0);
  });

  it('非法档位被拒（input_invalid）', async () => {
    const { db } = setup();
    const fixture = makeReviewDraft(db);
    try {
      await submitWith(db, fixture, { assessmentLevel: 'gold' });
      throw new Error('应当拒绝非法档位');
    } catch (e) {
      expect(isDomainError(e)).toBe(true);
      if (isDomainError(e)) expect(e.code).toBe(ErrorCodes.INPUT_INVALID);
    }
  });

  it('合法档位原样落进修订快照（四档各测一次）', async () => {
    for (const level of ['quick', 'standard', 'deep', 'security'] as const) {
      const { db } = setup();
      const fixture = makeReviewDraft(db);
      const result = await submitWith(db, fixture, { assessmentLevel: level });
      const rev = db
        .prepare('SELECT assessment_level, verdict FROM review_revisions WHERE id = ?')
        .get(result.reviewRevisionId) as { assessment_level: string | null; verdict: string | null };
      expect(rev.assessment_level).toBe(level);
      expect(rev.verdict).toBe('untestable');
      ctx?.cleanup();
      ctx = null;
    }
  });

  it('draft_only 允许不带档位（保存草稿不是正式提交）', async () => {
    const { db } = setup();
    const fixture = makeReviewDraft(db);
    const result = await submitWith(db, fixture, {
      publishIntent: 'draft_only',
      assessmentLevel: null,
      verdict: null,
    });
    const rev = db
      .prepare('SELECT assessment_level FROM review_revisions WHERE id = ?')
      .get(result.reviewRevisionId) as { assessment_level: string | null };
    expect(rev.assessment_level).toBeNull();
  });

  it('同 requestKey 重放：档位不同视为同键不同内容（request_key_reused）', async () => {
    const { db } = setup();
    const fixture = makeReviewDraft(db);
    const key = `req-${newId()}`;
    await submitWith(db, fixture, { requestKey: key, assessmentLevel: 'quick' });
    try {
      await submitWith(db, fixture, { requestKey: key, assessmentLevel: 'standard' });
      throw new Error('应当拒绝同键不同档位');
    } catch (e) {
      expect(isDomainError(e)).toBe(true);
      if (isDomainError(e)) expect(e.code).toBe(ErrorCodes.REQUEST_KEY_REUSED);
    }
  });
});
