import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.{js,mjs,cjs,ts}'],
    clearMocks: true,
    mockReset: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      include: [
        'src/profile-context.js',
        'src/core/**/*.{js,mjs,cjs,ts}',
        'tools/traceability.mjs',
      ],
      exclude: ['**/*.test.*'],
      reporter: ['text', 'json-summary', 'html'],
      thresholds: {
        100: true,
        perFile: true,
      },
    },
  },
});
