/**
 * 测试支撑：真实临时数据库 + 真实迁移。
 *
 * 纪律：业务测试**必须**使用真实文件数据库与实际迁移，不用 :memory: 冒充行为一致。
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SqliteDatabase } from '../../src/server/platform/db';
import { openDatabase } from '../../src/server/platform/db';
import { migrate } from '../../src/server/platform/migrate';
import { newId } from '../../src/server/platform/id';

export interface TestDb {
  db: SqliteDatabase;
  file: string;
  dir: string;
  cleanup: () => void;
}

/** 建立隔离的临时数据库并跑完全部迁移。 */
export function createTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-review-test-'));
  const file = join(dir, 'app.sqlite');
  const db = openDatabase({ file });
  const result = migrate({ db, file });
  if (result.foreignKeyCheck.length > 0) {
    throw new Error(`测试库迁移后外键不一致：${JSON.stringify(result.foreignKeyCheck)}`);
  }
  return {
    db,
    file,
    dir,
    cleanup: () => {
      try {
        db.close();
      } catch {
        /* 已关闭 */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** 插入一个用户，返回 ID。 */
export function insertUser(
  db: SqliteDatabase,
  overrides: { role?: 'user' | 'admin'; accountStatus?: 'active' | 'disabled'; nickname?: string } = {},
): string {
  const id = newId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, nickname, role, account_status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, overrides.nickname ?? '测试用户', overrides.role ?? 'user', overrides.accountStatus ?? 'active', now, now);
  return id;
}

/** 插入仓库，返回 ID。 */
export function insertRepository(db: SqliteDatabase, githubId = `gh-${Math.random().toString(16).slice(2)}`): string {
  const id = newId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO repositories (id, github_repository_id, full_name, html_url, availability_state, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'available', ?, ?)`,
  ).run(id, githubId, `owner/repo-${githubId}`, `https://github.com/owner/repo-${githubId}`, now, now);
  return id;
}

/** 插入插件，返回 ID。 */
export function insertPlugin(db: SqliteDatabase, repositoryId: string, pluginPath = '.'): string {
  const id = newId();
  const now = Date.now();
  db.prepare(`INSERT INTO plugins (id, repository_id, plugin_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
    id,
    repositoryId,
    pluginPath,
    now,
    now,
  );
  return id;
}

/**
 * 在同一事务内配对插入公共内容实体与评测（延迟外键的核心用例）。
 * 返回 reviewId（= contentEntityId）。
 */
export function insertReview(
  db: SqliteDatabase,
  input: { authorId: string; pluginId: string | null; sourceKind?: 'community' | 'site' },
): string {
  const id = newId();
  const now = Date.now();
  const run = db.transaction(() => {
    db.prepare(
      `INSERT INTO content_entities (id, content_type, author_id, review_id, created_at)
       VALUES (?, 'review', ?, ?, ?)`,
    ).run(id, input.authorId, id, now);
    db.prepare(`INSERT INTO reviews (id, plugin_id, source_kind) VALUES (?, ?, ?)`).run(
      id,
      input.pluginId,
      input.sourceKind ?? 'community',
    );
  });
  run();
  return id;
}

/** 插入一条评测修订（不可变快照）。 */
export function insertReviewRevision(
  db: SqliteDatabase,
  input: {
    reviewId: string;
    pluginId: string;
    revisionNumber: number;
    title?: string;
    body?: string;
    pluginVersion?: unknown;
    dshVersion?: unknown;
    assessmentLevel?: 'quick' | 'standard' | 'deep' | 'security' | null;
  },
): string {
  const id = newId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO review_revisions
       (id, review_id, revision_number, plugin_id, title, body_markdown, plugin_version, dsh_version, assessment_level, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.reviewId,
    input.revisionNumber,
    input.pluginId,
    input.title ?? '一篇评测',
    input.body ?? '正文',
    JSON.stringify(input.pluginVersion ?? { kind: 'unknown' }),
    JSON.stringify(input.dshVersion ?? { kind: 'unknown' }),
    input.assessmentLevel ?? null,
    now,
  );
  return id;
}

/** 插入顶层评论。 */
export function insertRootComment(db: SqliteDatabase, input: { contentEntityId: string; authorId: string }): string {
  const id = newId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO comments (id, content_entity_id, author_id, created_at) VALUES (?, ?, ?, ?)`,
  ).run(id, input.contentEntityId, input.authorId, now);
  return id;
}

/** 插入回复。 */
export function insertReply(
  db: SqliteDatabase,
  input: { contentEntityId: string; authorId: string; replyTo: string; root: string },
): string {
  const id = newId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO comments (id, content_entity_id, author_id, reply_to_comment_id, root_comment_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, input.contentEntityId, input.authorId, input.replyTo, input.root, now);
  return id;
}

/** 断言某个操作会抛出 SQLite 约束错误，并返回错误信息。 */
export function expectSqliteError(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('预期抛出数据库约束错误，但操作成功了');
}
