/**
 * catalog 模块对外类型（契约 已删除的设计稿《模块签名契约》 第 2 节）。
 */

import type { PageRequest, PageResult } from '@/packages/common/result';
import type { AssessmentTier } from '@/packages/common/assessment';

/**
 * 收录检查所需的外部探针。
 * 由调用方注入（真实实现走 GitHub API；测试注入 stub），
 * 这样"收录检查"这个核心判定可以在没有网络的情况下被穷尽测试。
 */
export interface CatalogProbe {
  /** 读取仓库基础信息；失败抛 provider_unavailable，未配置抛 provider_not_configured。 */
  fetchRepository(input: { owner: string; repo: string }): Promise<{
    githubRepositoryId: string;
    fullName: string;
    htmlUrl: string;
    isArchived: boolean;
    /**
     * 以下展示字段**全部来自同一个响应体**（迁移 0005）：拿不到就是 null / 空数组，
     * **不猜、不补默认值、不为此新增任何外部请求**。
     */
    description: string | null;
    topics: string[];
    ownerLogin: string | null;
    ownerAvatarUrl: string | null;
    /** GitHub 仓库 updated_at（UTC 毫秒）；用于展示"仓库更新于"，**不参与排序口径**。 */
    repoUpdatedAt: number | null;
  }>;
  /** 读取插件子目录 package.json 的 dsh.bundle 声明；不存在或未声明返回 null。 */
  fetchPluginManifest(input: { owner: string; repo: string; pluginPath: string }): Promise<{
    bundlePath: string;
    bundleExists: boolean;
    /** 清单里的展示字段（同一个已被完整解析的 package.json，同样不新增请求）。 */
    name: string | null;
    description: string | null;
    author: string | null;
    version: string | null;
  } | null>;
}

export interface AcceptPluginSubmissionInput {
  url: string;
  requestKey: string;
}

export interface AcceptPluginSubmissionResult {
  pluginId: string;
  repositoryId: string;
  /** true = 本次创建了 plugin 行；false = 命中既有 (repository_id, plugin_path)。 */
  created: boolean;
  /**
   * true = 命中 **request_key 幂等重放**（同一请求键返回原结果，本次没有产生新变更）。
   *
   * 必须与 `created: false` 区分开：`created:false` 还包含"这个插件以前就收录过"，
   * 那种情况**是**一次真实的业务动作（会刷新资料），不该被当成重放。
   * 频控用它决定要不要退还额度（规格：重放不另算一次提交）。
   */
  replayed: boolean;
  status: 'accepted';
}

export interface PluginView {
  pluginId: string;
  pluginPath: string;
  /** 收录时间。 */
  createdAt: number;
  updatedAt: number;
  /** 展示字段（迁移 0005）：缺就是 null / 空数组，页面显示"暂无"。 */
  displayName: string | null;
  /** 已归一：插件简介优先，缺则回退仓库简介。 */
  description: string | null;
  authorLogin: string | null;
  manifestVersion: string | null;
  infoUpdatedAt: number | null;
  topics: string[];
  ownerLogin: string | null;
  ownerAvatarUrl: string | null;
  repoUpdatedAt: number | null;
  /** 测评程度标签（由公开修订的档位聚合；历史无档位为 unlabelled）。 */
  assessmentTier: AssessmentTier;
  /** 是否已有公开的安全审计；null = 历史数据不足以判断。 */
  securityAudit: boolean | null;
  repository: {
    repositoryId: string;
    githubRepositoryId: string;
    fullName: string;
    htmlUrl: string;
    isArchived: boolean;
    availabilityState: 'unknown' | 'available' | 'unavailable';
    lastCheckedAt: number | null;
    lastSuccessfulCheckAt: number | null;
  };
}

export interface PluginSummary {
  pluginId: string;
  pluginPath: string;
  repositoryFullName: string;
  repositoryHtmlUrl: string;
  isArchived: boolean;
  updatedAt: number;
  /** 展示字段（迁移 0005）：缺就是 null / 空数组，页面显示"暂无"，不用空串冒充。 */
  displayName: string | null;
  /** 已归一：插件简介优先，缺则回退仓库简介。 */
  description: string | null;
  ownerLogin: string | null;
  ownerAvatarUrl: string | null;
  topics: string[];
  authorLogin: string | null;
  manifestVersion: string | null;
  infoUpdatedAt: number | null;
  repoUpdatedAt: number | null;
  /** 当前**公开**评测数（判据与内容可见性解析完全一致，见 service 内注释）。 */
  publicReviewCount: number;
  /** 测评程度标签（由公开修订的档位聚合；历史无档位为 unlabelled）。 */
  assessmentTier: AssessmentTier;
  /** 是否已有公开的安全审计；null = 历史数据不足以判断。 */
  securityAudit: boolean | null;
  availabilityState: 'unknown' | 'available' | 'unavailable';
}

/** 目录浏览的筛选条件（全部可选；缺省即"不筛"）。 */
export interface PluginDirectoryQuery extends PageRequest {
  /** 关键词：匹配展示名 / 仓库全名 / 简介（中文子串可用，`%` `_` 会被转义）。 */
  q?: string;
  /** 用途标签：命中 repositories.topics 里的任意一个；`__none__` 表示"未分类"。 */
  tag?: string;
  hasReviews?: 'all' | 'yes' | 'no';
  /**
   * 测评档位筛选（与插件标签同一口径）：
   *  - quick：最高档 = 快测；standard：最高档 = 标准测评/深度审计；
   *  - security：至少一篇公开修订含安全审计（deep/security）。
   */
  assessment?: 'all' | 'quick' | 'standard' | 'security';
  /** info = 资料更新时间（默认）；reviews = 公开评测数。 */
  sort?: 'info' | 'reviews';
}

/** 标签聚合项（用于筛选 chip 行）。 */
export interface PluginTagSummary {
  /** `__none__` = 未分类（topics 为空或全是非法值）。 */
  tag: string;
  pluginCount: number;
}

export interface CatalogService {
  parseSubmissionUrl(url: string): { owner: string; repo: string; pluginPath: string } | { error: string };
  acceptPluginSubmission(
    ctx: CallerContextLike,
    input: AcceptPluginSubmissionInput,
    deps: { probe: CatalogProbe },
  ): Promise<AcceptPluginSubmissionResult>;
  /**
   * **系统路径**收录：插件目录自动发现专用。
   * 与用户路径共用检查与入库；审计记 actor_kind='system'（actor_user_id 为 NULL）并带上 task_id，
   * 且**不占**单个用户的提交额度（规格第 29 行：定时发现走系统调度预算）。
   * 只允许服务端内部调用，**没有**对应 HTTP 路由。
   */
  acceptPluginSubmissionBySystem(
    input: { url: string; operationKey: string; taskId: string | null; reason?: string },
    deps: { probe: CatalogProbe },
  ): Promise<AcceptPluginSubmissionResult>;
  getPlugin(pluginId: string): Promise<PluginView | null>;
  listPlugins(req: PluginDirectoryQuery): Promise<PageResult<PluginSummary>>;
  listPluginTags(): Promise<PluginTagSummary[]>;
}

/** 仅需 userId 的最小上下文形状；避免 catalog 依赖不必要的字段。 */
export interface CallerContextLike {
  userId: string | null;
  accountStatus: 'active' | 'disabled' | null;
  role?: 'user' | 'admin' | null;
}
