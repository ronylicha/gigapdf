import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    include: ['src/**/__tests__/**/*.test.ts', 'src/**/__tests__/**/*.test.tsx'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    setupFiles: ['src/__tests__/vitest-setup.ts'],
    pool: 'forks',
    isolate: false,
    fileParallelism: false,
    maxConcurrency: 1,
    maxWorkers: 1,
    minWorkers: 1,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.tsx'],
      exclude: ['src/index.ts', 'src/**/__tests__/**'],
      thresholds: {
        global: {
          branches: 80,
          functions: 80,
          lines: 80,
          statements: 80,
        },
      },
    },
  },
});
