/**
 * 插件目录的测评档位标签与筛选（真实临时库 + 真实迁移）。
 *
 * 盯三件事：
 *  1. 聚合口径：最高档 + 任一安全审计；历史无档位是「未标注」而不是「未测评」；
 *  2. 筛选口径与标签一致：quick=最高档 1、standard=最高档 2、security=存在 deep/security；
 *  3. 与公开可见性同源：撤回的评测不参与聚合（这里用未发布/草稿对照）。
 *
 * 鉴别方式：把 assessmentBadgeOf 的 tier 判断或 buildDirectoryWhere 的三条条件删掉，
 * 对应用例必红。
 */

import { describe, expect, it, afterEach } from 'vitest';
import { createTestDb, insertPlugin, insertRepository, insertReview, insertReviewRevision, insertUser, type TestDb } from './support/db';
import { createCatalogService } from '../src/server/modules/catalog/service';
import type { CatalogService } from '../src/server/modules/catalog/types';

let ctx: TestDb | null = null;

afterEach(() => {
  ctx?.cleanup();
  ctx = null;
});

type Level = 'quick' | 'standard' | 'deep' | 'security' | null;

interface SeedPlugin {
  fullName: string;
  updatedAt: number;
  /** 每项是一篇公开评测的档位；null 表示历史修订（无档位）。 */
  reviews?: Level[];
  /** 另建若干未发布草稿（不应影响公开标签）。 */
  drafts?: Level[];
}

function seed(items: SeedPlugin[]): { db: TestDb['db']; service: CatalogService } {
  ctx = createTestDb();
  const db = ctx.db;
  const userId = insertUser(db);
  const service = createCatalogService({ db });

  for (const item of items) {
    const repoId = insertRepository(db, `gh-${item.fullName}`);
    db.prepare('UPDATE repositories SET full_name = ?, updated_at = ? WHERE id = ?').run(
      item.fullName,
      item.updatedAt,
      repoId,
    );
    const pluginId = insertPlugin(db, repoId);
    db.prepare('UPDATE plugins SET updated_at = ? WHERE id = ?').run(item.updatedAt, pluginId);

    const add = (levels: Level[], publish: boolean) => {
      levels.forEach((level, index) => {
        const reviewId = insertReview(db, { authorId: userId, pluginId });
        const revisionId = insertReviewRevision(db, {
          reviewId,
          pluginId,
          revisionNumber: 1,
          title: `${item.fullName} 第 ${index + 1} 篇`,
          assessmentLevel: level,
        });
        if (publish) {
          db.prepare('UPDATE reviews SET published_revision_id = ? WHERE id = ?').run(revisionId, reviewId);
        }
      });
    };
    add(item.reviews ?? [], true);
    add(item.drafts ?? [], false);
  }

  return { db, service };
}

const all = (over: Record<string, unknown> = {}) => ({ page: 1, page_size: 20, ...over });

describe('插件标签聚合', () => {
  it('无评测 / 快测 / 标准 / 深度 / 仅安全 / 历史无档位 各自映射正确', async () => {
    const { service } = seed([
      { fullName: 'none/plugin', updatedAt: 6000 },
      { fullName: 'quick/plugin', updatedAt: 5000, reviews: ['quick'] },
      { fullName: 'standard/plugin', updatedAt: 4000, reviews: ['standard'] },
      { fullName: 'deep/plugin', updatedAt: 3000, reviews: ['deep'] },
      { fullName: 'security/plugin', updatedAt: 2000, reviews: ['security'] },
      { fullName: 'legacy/plugin', updatedAt: 1000, reviews: [null] },
    ]);
    const result = await service.listPlugins(all());
    const by = Object.fromEntries(result.items.map((i) => [i.repositoryFullName, i]));

    expect([by['none/plugin'].assessmentTier, by['none/plugin'].securityAudit]).toEqual(['none', false]);
    expect([by['quick/plugin'].assessmentTier, by['quick/plugin'].securityAudit]).toEqual(['quick', false]);
    expect([by['standard/plugin'].assessmentTier, by['standard/plugin'].securityAudit]).toEqual(['standard', false]);
    expect([by['deep/plugin'].assessmentTier, by['deep/plugin'].securityAudit]).toEqual(['standard', true]);
    expect([by['security/plugin'].assessmentTier, by['security/plugin'].securityAudit]).toEqual(['none', true]);
    expect([by['legacy/plugin'].assessmentTier, by['legacy/plugin'].securityAudit]).toEqual(['unlabelled', null]);
  });

  it('多篇取最高档；历史 null 让安全审计保持「未标注」', async () => {
    const { service } = seed([
      { fullName: 'multi/mixed', updatedAt: 3000, reviews: ['quick', 'standard'] },
      { fullName: 'multi/legacy', updatedAt: 2000, reviews: ['quick', null] },
      { fullName: 'multi/audited', updatedAt: 1000, reviews: ['quick', 'deep'] },
    ]);
    const result = await service.listPlugins(all());
    const by = Object.fromEntries(result.items.map((i) => [i.repositoryFullName, i]));

    expect([by['multi/mixed'].assessmentTier, by['multi/mixed'].securityAudit]).toEqual(['standard', false]);
    expect([by['multi/legacy'].assessmentTier, by['multi/legacy'].securityAudit]).toEqual(['quick', null]);
    expect([by['multi/audited'].assessmentTier, by['multi/audited'].securityAudit]).toEqual(['standard', true]);
  });

  it('未发布草稿不参与公开标签', async () => {
    const { service } = seed([
      { fullName: 'draft/only', updatedAt: 1000, drafts: ['deep'] },
    ]);
    const result = await service.listPlugins(all());
    expect([result.items[0].assessmentTier, result.items[0].securityAudit]).toEqual(['none', false]);
  });

  it('getPlugin 与列表同一口径', async () => {
    const { service } = seed([{ fullName: 'detail/audited', updatedAt: 1000, reviews: ['deep'] }]);
    const listed = await service.listPlugins(all());
    const detail = await service.getPlugin(listed.items[0].pluginId);
    expect(detail?.assessmentTier).toBe('standard');
    expect(detail?.securityAudit).toBe(true);
  });
});

describe('档位筛选', () => {
  it('quick 只命中最高档=快测；standard 命中标准/深度；security 命中含安全审计', async () => {
    const { service } = seed([
      { fullName: 'a/quick', updatedAt: 6000, reviews: ['quick'] },
      { fullName: 'b/standard', updatedAt: 5000, reviews: ['standard'] },
      { fullName: 'c/deep', updatedAt: 4000, reviews: ['deep'] },
      { fullName: 'd/security', updatedAt: 3000, reviews: ['security'] },
      { fullName: 'e/none', updatedAt: 2000 },
      { fullName: 'f/legacy', updatedAt: 1000, reviews: [null] },
    ]);

    const quick = await service.listPlugins(all({ assessment: 'quick' }));
    expect(quick.items.map((i) => i.repositoryFullName)).toEqual(['a/quick']);

    const standard = await service.listPlugins(all({ assessment: 'standard' }));
    expect(standard.items.map((i) => i.repositoryFullName).sort()).toEqual(['b/standard', 'c/deep']);

    const security = await service.listPlugins(all({ assessment: 'security' }));
    expect(security.items.map((i) => i.repositoryFullName).sort()).toEqual(['c/deep', 'd/security']);

    const plain = await service.listPlugins(all({ assessment: 'all' }));
    expect(plain.total).toBe(6);
  });

  it('档位筛选与 hasReviews 可叠加（AND）', async () => {
    const { service } = seed([
      { fullName: 'a/quick', updatedAt: 3000, reviews: ['quick'] },
      { fullName: 'b/none', updatedAt: 2000 },
    ]);
    const result = await service.listPlugins(all({ assessment: 'quick', hasReviews: 'yes' }));
    expect(result.items.map((i) => i.repositoryFullName)).toEqual(['a/quick']);
  });
});
