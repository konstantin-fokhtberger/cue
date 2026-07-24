/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  mutate: ['src/profile-context.js', 'src/core/**/*.{js,mjs,cjs,ts}'],
  ignorePatterns: [
    'node_modules',
    'dist',
    'out',
    'coverage',
    'reports',
    '.obsidian',
    'docs/.obsidian',
  ],
  testRunner: 'vitest',
  vitest: {
    configFile: 'vitest.config.mjs',
    related: true,
  },
  reporters: ['clear-text', 'progress', 'html', 'json'],
  thresholds: {
    high: 100,
    low: 100,
    break: 100,
  },
  coverageAnalysis: 'perTest',
  tempDirName: '.stryker-tmp',
  htmlReporter: {
    fileName: 'reports/mutation/html/index.html',
  },
  jsonReporter: {
    fileName: 'reports/mutation/mutation.json',
  },
};

export default config;
