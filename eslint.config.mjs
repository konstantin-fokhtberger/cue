import js from '@eslint/js';
import globals from 'globals';

const commonRules = {
  'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
};

export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'out/**',
      'coverage/**',
      'reports/**',
      '.stryker-tmp/**',
      '.obsidian/**',
      'docs/.obsidian/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['main.js', 'preload.js', 'src/**/*.js', 'test/**/*.{js,mjs}', '*.config.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        ...globals.node,
      },
    },
    rules: commonRules,
  },
  {
    files: ['test/**/*.mjs', '*.config.mjs'],
    languageOptions: {
      sourceType: 'module',
    },
  },
  {
    files: ['renderer/{icons,renderer}.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.browser,
      },
    },
    rules: commonRules,
  },
  {
    files: ['renderer/pcm-processor.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        AudioWorkletProcessor: 'readonly',
        registerProcessor: 'readonly',
        sampleRate: 'readonly',
      },
    },
    rules: commonRules,
  },
];
