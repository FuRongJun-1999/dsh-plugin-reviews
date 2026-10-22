-- 0010_review_assessment.sql
--
-- 评测修订增补「测评档位」（对齐 dsh-bench 测评规范 v3.0 的快测／标准测评／深度审计／安全审计）。
--
-- 设计取舍（如实写在这里）：
--   * 档位是**修订快照的一部分**：每版评测各自带自己的档位——改了档位就要出新修订，
--     旧修订的档位留在账本里可复核，不做就地覆盖。
--   * 可空：本迁移之前的历史修订没有档位。**不假装补写**——老数据如实显示「未标注档位」，
--     不猜成「未测评」。
--   * **安全审计不单独存列**：由档位推导（deep / security 含安全审计），避免两个真相。
--   * CHECK 把四档闭集写进库，应用层漏判时数据库拒绝写入。

ALTER TABLE review_revisions ADD COLUMN assessment_level TEXT
  CHECK (assessment_level IS NULL OR assessment_level IN ('quick','standard','deep','security'));
