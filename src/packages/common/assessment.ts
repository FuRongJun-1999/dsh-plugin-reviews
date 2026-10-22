/**
 * 测评档位（对齐 dsh-bench 测评规范 v3.0）。
 *
 * 四个可选档位：
 *  - quick    快测（安装、功能点、卸载残留；不进能力榜）
 *  - standard 标准测评（完整对照实验 + 统计判定；五状态）
 *  - deep     深度审计（标准测评 + 安全六威胁全项）
 *  - security 仅安全审计（本次只做安全专项，不产出能力结论）
 *
 * 插件标签由档位推导，不额外存「安全审计」标记，避免两个真相：
 *  - 测评程度：none（未测评）/ quick（已快测）/ standard（已标测）；
 *    历史修订没有档位时是 unlabelled（未标注档位），不猜成「未测评」。
 *  - 安全审计：deep/security 为 true，quick/standard 为 false；
 *    历史修订无档位、且没有可判定的新修订时为 null（未标注）。
 *
 * 客户端与服务端共用本模块：提交表单、API 校验、插件标签、筛选同源。
 *
 * @module packages/common/assessment
 */

import { err } from './errors';

export type AssessmentLevel = 'quick' | 'standard' | 'deep' | 'security';

export type AssessmentTier = 'none' | 'quick' | 'standard' | 'unlabelled';

export interface AssessmentDef {
  readonly key: AssessmentLevel;
  readonly label: string;
  /** 计入的测评程度档位（用于插件标签）。 */
  readonly tier: Exclude<AssessmentTier, 'unlabelled'>;
  /** 本次是否包含安全审计。 */
  readonly security: boolean;
}

/** 规范写死的四个档位，顺序即界面顺序。 */
export const ASSESSMENTS: readonly AssessmentDef[] = Object.freeze([
  { key: 'quick', label: '快测', tier: 'quick', security: false },
  { key: 'standard', label: '标准测评', tier: 'standard', security: false },
  { key: 'deep', label: '深度审计（标准测评 + 安全审计）', tier: 'standard', security: true },
  { key: 'security', label: '仅安全审计', tier: 'none', security: true },
]);

export function isAssessmentLevel(value: unknown): value is AssessmentLevel {
  return typeof value === 'string' && ASSESSMENTS.some((a) => a.key === value);
}

export function assessmentDef(key: AssessmentLevel): AssessmentDef {
  const found = ASSESSMENTS.find((a) => a.key === key);
  if (!found) throw new Error(`未知测评档位：${key}`);
  return found;
}

/** 档位键 → 中文标签；未知键返回 null（调用方自定呈现，不假装知道）。 */
export function assessmentLabel(key: string | null | undefined): string | null {
  if (!key || !isAssessmentLevel(key)) return null;
  return assessmentDef(key).label;
}

/**
 * 解析档位键。**必填**：正式提交必须说明这是哪一档（规范：档位决定能说什么）。
 * @param raw 请求里的原始值
 * @param path 字段路径（用于字段级错误）
 */
export function parseAssessmentLevel(raw: unknown, path = 'assessmentLevel'): AssessmentLevel {
  if (raw === undefined || raw === null || raw === '') {
    throw err.input('提交前请选择测评档位（快测／标准测评／深度审计／仅安全审计）。', [
      { path, message: '必填：quick／standard／deep／security' },
    ]);
  }
  if (!isAssessmentLevel(raw)) {
    throw err.input('测评档位不在四档之内。', [
      { path, message: '只接受：' + ASSESSMENTS.map((a) => `${a.label}（${a.key}）`).join('、') },
    ]);
  }
  return raw;
}

/** 草稿保存允许未选档位：缺键 / null 一律规范化为 null。 */
export function parseOptionalAssessmentLevel(raw: unknown, path = 'assessmentLevel'): AssessmentLevel | null {
  if (raw === undefined || raw === null) return null;
  return parseAssessmentLevel(raw, path);
}

/** 插件标签文案（测评程度）。 */
export function tierLabel(tier: AssessmentTier): string {
  switch (tier) {
    case 'none':
      return '未测评';
    case 'quick':
      return '已快测';
    case 'standard':
      return '已标测';
    case 'unlabelled':
      return '未标注档位';
  }
}

/** 插件标签文案（安全审计）。null = 历史数据不足以判断。 */
export function securityLabel(value: boolean | null): string {
  return value === true ? '已安全审计' : value === false ? '未安全审计' : '安全审计未标注';
}

/**
 * 由一组公开修订的档位聚合出插件标签。
 *
 * @param levels 该插件所有公开修订的 assessment_level（历史修订为 null）
 * @returns tier 取最高档；security 任一 deep/security 即 true，
 *          非空档位都不含安全审计时 false，仍有历史无档位修订时 null。
 */
export function aggregateAssessment(levels: readonly (AssessmentLevel | null)[]): {
  tier: AssessmentTier;
  security: boolean | null;
} {
  if (levels.length === 0) return { tier: 'none', security: false };

  let tier: AssessmentTier = 'unlabelled';
  let security: boolean | null = null;
  let assessed = 0;

  for (const level of levels) {
    if (level === null) continue;
    assessed += 1;
    const def = assessmentDef(level);
    if (def.tier === 'standard') tier = 'standard';
    else if (def.tier === 'quick' && tier !== 'standard') tier = 'quick';
    else if (def.tier === 'none' && tier === 'unlabelled') tier = 'none';
    if (def.security) security = true;
  }

  if (security === null) {
    // 有非空档位且都不含安全审计 → false；还存在无档位的历史修订 → 无法判断（null）。
    security = assessed === levels.length ? false : null;
  }
  return { tier, security };
}
