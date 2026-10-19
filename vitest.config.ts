import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{ts,tsx}'],
    // 每个测试文件使用独立临时数据库文件；单进程串行执行避免临时目录互相干扰。
    // Vitest 4+：pool 相关选项已提到顶层。
    pool: 'forks',
    maxWorkers: 1,
    testTimeout: 30_000,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
});
