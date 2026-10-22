/**
 * 测评档位闭集与插件标签聚合（dsh-bench 测评规范 v3.0）。
 *
 * 纪律：每条断言都对应一个可被破坏的行为——
 *  - 删除某档位 / 改 tier 映射 → 第一条红；
 *  - 把历史 null 当成「未测评」 → 聚合用例红；
 *  - 允许空档位提交 → parseAssessmentLevel 用例红。
 */

import { describe, expect, it } from 'vitest';
import {
  ASSESSMENTS,
  aggregateAssessment,
  assessmentLabel,
  isAssessmentLevel,
  parseAssessmentLevel,
  parseOptionalAssessmentLevel,
  securityLabel,
  tierLabel,
} from '../src/packages/common/assessment';
import { ErrorCodes, isDomainError } from '../src/packages/common/errors';

describe('测评档位闭集', () => {
  it('四档顺序、标签、tier 与安全审计映射稳定', () => {
    expect(ASSESSMENTS.map((a) => a.key)).toEqual(['quick', 'standard', 'deep', 'security']);
    expect(ASSESSMENTS.map((a) => a.label)).toEqual([
      '快测',
      '标准测评',
      '深度审计（标准测评 + 安全审计）',
      '仅安全审计',
    ]);
    expect(ASSESSMENTS.map((a) => a.tier)).toEqual(['quick', 'standard', 'standard', 'none']);
    expect(ASSESSMENTS.map((a) => a.security)).toEqual([false, false, true, true]);
  });

  it('isAssessmentLevel 只认四个键（中文标签与大小写都不算）', () => {
    expect(isAssessmentLevel('quick')).toBe(true);
    expect(isAssessmentLevel('QUICK')).toBe(false);
    expect(isAssessmentLevel('快测')).toBe(false);
    expect(isAssessmentLevel(null)).toBe(false);
    expect(assessmentLabel('nope')).toBeNull();
    expect(assessmentLabel('deep')).toBe('深度审计（标准测评 + 安全审计）');
  });

  it('parseAssessmentLevel：缺失/空串/非法值都按 input_invalid 拒绝，并带字段路径', () => {
    for (const bad of [undefined, null, '', 'great', 1]) {
      try {
        parseAssessmentLevel(bad);
        throw new Error('应当拒绝：' + String(bad));
      } catch (e) {
        expect(isDomainError(e)).toBe(true);
        if (isDomainError(e)) {
          expect(e.code).toBe(ErrorCodes.INPUT_INVALID);
          expect(e.fields?.[0]?.path).toBe('assessmentLevel');
        }
      }
    }
    expect(parseAssessmentLevel('security')).toBe('security');
  });

  it('parseOptionalAssessmentLevel：缺键/空值 → null，非法值仍然拒绝', () => {
    expect(parseOptionalAssessmentLevel(undefined)).toBeNull();
    expect(parseOptionalAssessmentLevel(null)).toBeNull();
    expect(parseOptionalAssessmentLevel('quick')).toBe('quick');
    expect(() => parseOptionalAssessmentLevel('nope')).toThrow();
  });
});

describe('插件标签聚合', () => {
  it('没有任何公开评测 → 未测评 + 未安全审计', () => {
    expect(aggregateAssessment([])).toEqual({ tier: 'none', security: false });
  });

  it('只有历史无档位修订 → 未标注档位 + 安全审计未标注（不猜）', () => {
    expect(aggregateAssessment([null])).toEqual({ tier: 'unlabelled', security: null });
    expect(aggregateAssessment([null, null])).toEqual({ tier: 'unlabelled', security: null });
  });

  it('快测 → 已快测 / 未安全审计', () => {
    expect(aggregateAssessment(['quick'])).toEqual({ tier: 'quick', security: false });
  });

  it('标准测评 → 已标测 / 未安全审计', () => {
    expect(aggregateAssessment(['standard'])).toEqual({ tier: 'standard', security: false });
  });

  it('深度审计 → 已标测 / 已安全审计', () => {
    expect(aggregateAssessment(['deep'])).toEqual({ tier: 'standard', security: true });
  });

  it('仅安全审计 → 未测评 / 已安全审计', () => {
    expect(aggregateAssessment(['security'])).toEqual({ tier: 'none', security: true });
  });

  it('多篇取最高档：快测 + 标准 → 已标测', () => {
    expect(aggregateAssessment(['quick', 'standard'])).toEqual({ tier: 'standard', security: false });
  });

  it('历史 null + 快测 → 已快测，但安全审计仍无法判断', () => {
    expect(aggregateAssessment(['quick', null])).toEqual({ tier: 'quick', security: null });
  });
});

describe('标签文案', () => {
  it('测评程度三档 + 未标注', () => {
    expect(tierLabel('none')).toBe('未测评');
    expect(tierLabel('quick')).toBe('已快测');
    expect(tierLabel('standard')).toBe('已标测');
    expect(tierLabel('unlabelled')).toBe('未标注档位');
  });

  it('安全审计三态', () => {
    expect(securityLabel(true)).toBe('已安全审计');
    expect(securityLabel(false)).toBe('未安全审计');
    expect(securityLabel(null)).toBe('安全审计未标注');
  });
});
